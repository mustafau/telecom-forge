import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { sha256Json } from "../lib/hash.js";
import { createRunId } from "../lib/ids.js";
import { ForgeError } from "../lib/errors.js";
import { ensureDir, writeAtomic } from "../lib/fs.js";
import { resolveCommit } from "../lib/git.js";
import { extractControlFiles, loadConfigAtSha, cloneUrl, type LoadedConfig } from "../config/load.js";
import { validateTask, type TaskSnapshot } from "../tasks/validate.js";
import { assertRunTransition, type RunStatus } from "../tasks/states.js";
import { checkoutRepository, remoteBranchSha, repositoriesToFetch, stripCheckoutCredentials } from "./checkout.js";
import { assertOwnerNotPlaceholder } from "../security/refs.js";

export interface ResolvedRepository {
  alias: string;
  owner: string;
  name: string;
  checkout_path: string;
  access: "read-only" | "read-write";
  default_branch: string;
  build_profile: string;
  remote: string;
  local_remote: boolean;
  base_sha: string;
  target_base_sha: string;
  feature_branch_exists: boolean;
  role: "writable" | "context" | "dependency";
}

export interface PreparedManifest {
  schema_version: "1.0";
  run_id: string;
  attempt: number;
  task_id: string;
  task_sha: string;
  task_path: string;
  control_sha: string;
  skills_sha: string;
  feature_branch: string;
  task_snapshot_sha256: string;
  policy_sha256: string;
  prepared_at: string;
  status: RunStatus;
  harness: {
    adapter: string;
    max_runtime_minutes: number;
    provider_env: string;
    model_env: string;
  };
  repositories: ResolvedRepository[];
  workspace_dir: string;
  control_dir: string;
  task_dir: string;
}

export interface PrepareOptions {
  repoRoot: string;
  taskRef: string;
  taskPath: string;
  controlRef?: string;
  outputDir?: string;
  now?: Date;
  env?: NodeJS.ProcessEnv;
}

export async function prepareWorkspace(options: PrepareOptions): Promise<PreparedManifest> {
  const now = options.now ?? new Date();
  const controlSha = await resolveCommit(options.repoRoot, options.controlRef ?? "HEAD");
  const config = await loadConfigAtSha(options.repoRoot, controlSha);
  const snapshot = await validateTask({
    repoRoot: options.repoRoot,
    taskRef: options.taskRef,
    taskPath: options.taskPath,
    config,
  });
  const runId = createRunId(options.env ?? process.env, now);
  const runDir = options.outputDir ?? path.join(options.repoRoot, ".forge-runtime", "runs", runId);
  await ensureDir(runDir);
  await acquireLock(options.repoRoot, snapshot.task.id, runId);
  try {
    const controlDir = path.join(runDir, "control");
    const taskDir = path.join(runDir, "task");
    await mkdir(controlDir, { recursive: true });
    await mkdir(taskDir, { recursive: true });
    await extractControlFiles(options.repoRoot, controlSha, controlDir);
    await writeFile(path.join(taskDir, "task.yaml"), await readTaskYaml(options.repoRoot, snapshot), "utf8");
    await writeFile(path.join(taskDir, "task.md"), snapshot.markdown, "utf8");
    const repositories = await materializeRepositories(options.repoRoot, config, snapshot);
    assertRunTransition("CREATED", "VALIDATING");
    assertRunTransition("VALIDATING", "PREPARING");
    const manifest: PreparedManifest = {
      schema_version: "1.0",
      run_id: runId,
      attempt: 1,
      task_id: snapshot.task.id,
      task_sha: snapshot.task_sha,
      task_path: snapshot.task_path,
      control_sha: controlSha,
      skills_sha: controlSha,
      feature_branch: snapshot.task.feature_branch,
      task_snapshot_sha256: snapshot.task_snapshot_sha256,
      policy_sha256: sha256Json({
        policy: config.workspace.policy,
        repositories: config.workspace.repositories,
      }),
      prepared_at: now.toISOString(),
      status: "PREPARING",
      harness: {
        adapter: config.workspace.harness.adapter,
        max_runtime_minutes: config.workspace.harness.max_runtime_minutes,
        provider_env: config.workspace.harness.provider_env,
        model_env: config.workspace.harness.model_env,
      },
      repositories,
      workspace_dir: ".",
      control_dir: relativeTo(options.repoRoot, controlDir),
      task_dir: relativeTo(options.repoRoot, taskDir),
    };
    await writeAtomic(path.join(runDir, "prepared-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    await writeAtomic(
      path.join(options.repoRoot, ".forge-runtime", "runs", `${runId}.json`),
      `${JSON.stringify({ dir: runDir }, null, 2)}\n`,
    );
    return manifest;
  } finally {
    await releaseLock(options.repoRoot, snapshot.task.id, runId);
  }
}

async function materializeRepositories(
  repoRoot: string,
  config: LoadedConfig,
  snapshot: TaskSnapshot,
): Promise<ResolvedRepository[]> {
  const aliases = repositoriesToFetch(snapshot.writable, snapshot.context, (alias) => {
    return config.workspace.repositories[alias]?.depends_on ?? [];
  });
  const resolved: ResolvedRepository[] = [];
  for (const alias of aliases) {
    const repository = config.workspace.repositories[alias];
    if (!repository) {
      throw new ForgeError("UNKNOWN_REPOSITORY", `Catalog no longer contains ${alias}.`);
    }
    const localRemote = config.localRemotes[alias];
    if (!localRemote) assertOwnerNotPlaceholder(repository.owner, alias);
    const remote = cloneUrl(repository, localRemote);
    const featureSha = await remoteBranchSha(remote, snapshot.task.feature_branch);
    const defaultSha = await remoteBranchSha(remote, repository.default_branch);
    if (!defaultSha) {
      throw new ForgeError(
        "MISSING_DEFAULT_BRANCH",
        `${alias} has no ${repository.default_branch} branch at ${remote}.`,
      );
    }
    const baseSha = featureSha ?? defaultSha;
    const destination = path.join(repoRoot, repository.checkout_path);
    await checkoutRepository({
      repoRoot,
      remote,
      checkoutPath: repository.checkout_path,
      sha: baseSha,
    });
    await stripCheckoutCredentials(destination);
    const role = snapshot.writable.includes(alias)
      ? "writable"
      : snapshot.context.includes(alias)
        ? "context"
        : "dependency";
    resolved.push({
      alias,
      owner: repository.owner,
      name: repository.name,
      checkout_path: repository.checkout_path,
      access: repository.access,
      default_branch: repository.default_branch,
      build_profile: repository.build_profile,
      remote,
      local_remote: Boolean(localRemote),
      base_sha: baseSha,
      target_base_sha: defaultSha,
      feature_branch_exists: featureSha !== null,
      role,
    });
  }
  return resolved;
}

function relativeTo(root: string, target: string): string {
  return path.relative(root, target).split(path.sep).join("/");
}

async function readTaskYaml(repoRoot: string, snapshot: TaskSnapshot): Promise<string> {
  const { showFile } = await import("../lib/git.js");
  return showFile(repoRoot, snapshot.task_sha, snapshot.task_path);
}

async function acquireLock(repoRoot: string, taskId: string, runId: string): Promise<void> {
  const lockDir = path.join(repoRoot, ".forge-runtime", "locks", taskId);
  await mkdir(path.dirname(lockDir), { recursive: true });
  try {
    await mkdir(lockDir);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "EEXIST") {
      throw new ForgeError(
        "TASK_LOCKED",
        `Task ${taskId} already has a local preparation lock. Wait for it to finish.`,
      );
    }
    throw error;
  }
  await writeFile(path.join(lockDir, "owner"), runId, "utf8");
}

async function releaseLock(repoRoot: string, taskId: string, runId: string): Promise<void> {
  const lockDir = path.join(repoRoot, ".forge-runtime", "locks", taskId);
  try {
    const owner = await readFile(path.join(lockDir, "owner"), "utf8");
    if (owner.trim() === runId) {
      const { rm } = await import("node:fs/promises");
      await rm(lockDir, { recursive: true, force: true });
    }
  } catch {
    // The lock is advisory for local overlapping prepares.
  }
}
