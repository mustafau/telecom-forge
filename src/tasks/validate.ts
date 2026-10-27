import path from "node:path";
import { ForgeError } from "../lib/errors.js";
import { sha256, sha256Json } from "../lib/hash.js";
import { isFullSha } from "../security/refs.js";
import { assertPermittedBranch } from "../security/refs.js";
import { pathExistsAt, resolveCommit, showFile } from "../lib/git.js";
import { formatZod, type LoadedConfig } from "../config/load.js";
import { TaskFileSchema, type TaskFile } from "./schema.js";
import { parseYaml } from "../lib/yaml.js";

export interface TaskSnapshot {
  task: TaskFile;
  markdown: string;
  task_sha: string;
  task_path: string;
  task_snapshot_sha256: string;
  writable: string[];
  context: string[];
  diagnostics: string[];
}

export interface ValidateTaskInput {
  repoRoot: string;
  taskRef: string;
  taskPath: string;
  config: LoadedConfig;
}

export async function validateTask(input: ValidateTaskInput): Promise<TaskSnapshot> {
  const diagnostics: string[] = [];
  const taskPath = normalizeTaskPath(input.taskPath);
  const taskSha = await resolveCommit(input.repoRoot, input.taskRef);
  if (!isFullSha(taskSha)) {
    throw new ForgeError("UNSAFE_REF", "Task revision did not resolve to a full SHA.");
  }
  if (!isFullSha(input.taskRef)) {
    const branch = input.taskRef;
    assertBranchMatchesTask(branch);
    diagnostics.push(`Resolved ${branch} to ${taskSha}.`);
  }
  if (!(await pathExistsAt(input.repoRoot, taskSha, taskPath))) {
    throw new ForgeError(
      "TASK_NOT_FOUND",
      `No ${taskPath} at ${taskSha}. Commit the task before validation; uncommitted files are not read.`,
    );
  }
  const yamlText = await showFile(input.repoRoot, taskSha, taskPath);
  const parsed = TaskFileSchema.safeParse(parseYaml(yamlText, taskPath));
  if (!parsed.success) throw new ForgeError("INVALID_TASK", formatZod(parsed.error));
  const task = parsed.data;
  const directory = path.posix.dirname(taskPath);
  const expectedDirectory = `tasks/${task.id}`;
  if (directory !== expectedDirectory) {
    throw new ForgeError(
      "TASK_PATH_MISMATCH",
      `Task id ${task.id} must live at ${expectedDirectory}/, not ${directory}/.`,
    );
  }
  if (path.posix.normalize(task.spec_file) !== "task.md") {
    throw new ForgeError("TASK_PATH_MISMATCH", "spec_file must be task.md in the task directory.");
  }
  if (!isFullSha(input.taskRef)) {
    if (input.taskRef !== task.feature_branch) {
      throw new ForgeError(
        "BRANCH_MISMATCH",
        `Task ref ${input.taskRef} does not match feature_branch ${task.feature_branch}.`,
      );
    }
  }
  assertPermittedBranch(task.feature_branch, input.config.workspace.policy.permitted_branch_prefixes);
  if (task.requirements.draft_pull_requests !== true || input.config.workspace.policy.require_draft_pr !== true) {
    throw new ForgeError("UNSAFE_POLICY", "Draft pull requests are required.");
  }
  const writable = unique(task.scope.writable_repositories);
  const context = unique(task.scope.context_repositories);
  if (writable.length > input.config.workspace.policy.max_writable_repositories) {
    throw new ForgeError(
      "SCOPE_ESCALATION",
      `Task requests ${writable.length} writable repositories; policy allows ${input.config.workspace.policy.max_writable_repositories}.`,
      { exitCode: 3 },
    );
  }
  for (const alias of writable) {
    const repository = input.config.workspace.repositories[alias];
    if (!repository) {
      throw new ForgeError("UNKNOWN_REPOSITORY", `Writable repository "${alias}" is not in the trusted catalog.`, {
        exitCode: 3,
      });
    }
    if (repository.access !== "read-write") {
      throw new ForgeError(
        "SCOPE_ESCALATION",
        `Repository "${alias}" is ${repository.access} in the trusted catalog. A task cannot grant write access.`,
        { exitCode: 3 },
      );
    }
  }
  for (const alias of context) {
    if (!input.config.workspace.repositories[alias]) {
      throw new ForgeError("UNKNOWN_REPOSITORY", `Context repository "${alias}" is not in the trusted catalog.`, {
        exitCode: 3,
      });
    }
    if (writable.includes(alias)) {
      throw new ForgeError("INVALID_TASK", `${alias} cannot be both writable and context.`);
    }
  }
  const markdownPath = path.posix.join(directory, "task.md");
  if (!(await pathExistsAt(input.repoRoot, taskSha, markdownPath))) {
    throw new ForgeError("TASK_NOT_FOUND", `Missing ${markdownPath} at ${taskSha}.`);
  }
  const markdown = await showFile(input.repoRoot, taskSha, markdownPath);
  if (Buffer.byteLength(markdown) > 200_000) {
    throw new ForgeError("INPUT_TOO_LARGE", "task.md exceeds 200000 bytes.");
  }
  const snapshot = {
    task,
    markdown,
    yaml_sha256: sha256(yamlText),
    markdown_sha256: sha256(markdown),
  };
  return {
    task,
    markdown,
    task_sha: taskSha,
    task_path: taskPath,
    task_snapshot_sha256: sha256Json(snapshot),
    writable,
    context,
    diagnostics,
  };
}

export function normalizeTaskPath(taskPath: string): string {
  const normalized = path.posix.normalize(taskPath);
  if (!/^tasks\/TF-[0-9]{4,8}\/task\.yaml$/.test(normalized)) {
    throw new ForgeError(
      "UNSAFE_PATH",
      "task path must look like tasks/TF-0001/task.yaml. Other paths are not task definitions.",
    );
  }
  return normalized;
}

function assertBranchMatchesTask(branch: string): void {
  assertPermittedBranch(branch);
}

function unique(values: string[]): string[] {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) throw new ForgeError("INVALID_TASK", `Duplicate repository alias ${value}.`);
    seen.add(value);
  }
  return [...seen];
}
