import { readFile } from "node:fs/promises";
import path from "node:path";
import { ForgeError, errorMessage } from "../lib/errors.js";
import { writeAtomic } from "../lib/fs.js";
import { sha256, sha256Json } from "../lib/hash.js";
import { assertPatchText } from "../patch/scan.js";
import { readManifest } from "../verify/verify.js";
import type { BundleManifest } from "../patch/bundle.js";
import type { EvidenceReceipt } from "../history/persist.js";
import type { HistoryStore } from "../history/storage.js";
import { HistoryConflictError } from "../history/storage.js";
import type { GitHubClient } from "../github/types.js";
import { requireLivePublishOptIn } from "../github/live-client.js";
import { LocalGitPublisher, type PublishGit } from "./git.js";
import type { RunStatus } from "../tasks/states.js";
import { assertRunTransition } from "../tasks/states.js";

export interface PublishRepoResult {
  repository: string;
  status: "planned" | "published" | "skipped" | "blocked" | "failed";
  base_sha: string;
  result_sha: string | null;
  pull_request_url: string | null;
  detail: string;
}

export interface PublishResult {
  schema_version: "1.0";
  run_id: string;
  dry_run: boolean;
  status: RunStatus;
  repositories: PublishRepoResult[];
}

export async function publishBundle(options: {
  runDir: string;
  apply: boolean;
  github: GitHubClient;
  git?: PublishGit;
  store?: HistoryStore;
  allowLive?: boolean;
  now?: Date;
}): Promise<PublishResult> {
  const manifest = await readManifest(options.runDir);
  const bundle = JSON.parse(await readFile(path.join(options.runDir, "bundle-manifest.json"), "utf8")) as BundleManifest;
  const receipt = await readReceipt(options.runDir);
  if (bundle.bundle_sha256 !== sha256Json({
    schema_version: bundle.schema_version,
    run_id: bundle.run_id,
    task_id: bundle.task_id,
    task_sha: bundle.task_sha,
    control_sha: bundle.control_sha,
    policy_sha256: bundle.policy_sha256,
    task_snapshot_sha256: bundle.task_snapshot_sha256,
    feature_branch: bundle.feature_branch,
    publishable: bundle.publishable,
    outcome: bundle.outcome,
    status: bundle.status,
    patches: bundle.patches,
  })) {
    throw new ForgeError("BUNDLE_TAMPERED", "Bundle manifest hash does not match its contents.", { exitCode: 3 });
  }
  if (manifest.policy_sha256 !== bundle.policy_sha256 || manifest.task_sha !== bundle.task_sha) {
    throw new ForgeError("BUNDLE_TAMPERED", "Bundle does not match the prepared task and policy hashes.", {
      exitCode: 3,
    });
  }
  if (!bundle.publishable || bundle.outcome !== "CHANGES") {
    return {
      schema_version: "1.0",
      run_id: bundle.run_id,
      dry_run: !options.apply,
      status: bundle.outcome === "NO_CHANGE" ? "NO_CHANGE" : "VERIFICATION_FAILED",
      repositories: [],
    };
  }
  if (options.apply && (!receipt || receipt.durable !== true)) {
    throw new ForgeError(
      "PUBLISH_BLOCKED_NO_EVIDENCE",
      "Publication is blocked until a durable evidence receipt exists. History persistence must succeed first.",
    );
  }
  const previous = await readPublication(options.runDir);
  const results: PublishRepoResult[] = [];
  const git = options.git ?? new LocalGitPublisher();
  for (const patch of bundle.patches) {
    const repository = manifest.repositories.find((item) => item.alias === patch.repository);
    if (!repository) {
      results.push(blocked(patch.repository, patch.base_sha, "Bundle repository is not in the prepared manifest."));
      continue;
    }
    if (isGitHubRemote(repository.remote)) {
      if (!options.allowLive) {
        results.push(blocked(patch.repository, patch.base_sha, "Live GitHub remotes require explicit authorization."));
        continue;
      }
      requireLivePublishOptIn();
    }
    const patchText = await readFile(path.join(options.runDir, patch.patch_file), "utf8");
    let paths: string[];
    try {
      paths = assertPatchText(patchText, patch.bytes + 1);
    } catch (error) {
      results.push(blocked(patch.repository, patch.base_sha, errorMessage(error)));
      continue;
    }
    if (sha256(patchText) !== patch.patch_sha256) {
      results.push(blocked(patch.repository, patch.base_sha, "Patch bytes do not match the manifest hash."));
      continue;
    }
    const already = previous?.repositories.find(
      (item) => item.repository === patch.repository && item.status === "published" && item.result_sha,
    );
    const head = await git.branchHead(repository.remote, bundle.feature_branch);
    if (already?.result_sha && head === already.result_sha) {
      const pull = await ensurePull(options.github, repository, bundle, patchText, already.result_sha, options.apply);
      results.push({
        repository: patch.repository,
        status: options.apply ? "skipped" : "planned",
        base_sha: patch.base_sha,
        result_sha: already.result_sha,
        pull_request_url: pull,
        detail: "Patch was already published at the recorded commit.",
      });
      continue;
    }
    if (head) {
      const message = await git.commitMessage(repository.remote, head);
      if (message.includes(`Forge-Patch-SHA256: ${patch.patch_sha256}`) && message.includes(`Task-ID: ${bundle.task_id}`)) {
        const pull = await ensurePull(options.github, repository, bundle, patchText, head, options.apply);
        results.push({
          repository: patch.repository,
          status: options.apply ? "skipped" : "planned",
          base_sha: patch.base_sha,
          result_sha: head,
          pull_request_url: pull,
          detail: "Remote branch already contains this patch.",
        });
        continue;
      }
      results.push(blocked(patch.repository, patch.base_sha, `Branch moved to ${head}; refusing to overwrite.`));
      continue;
    }
    const defaultHead = await git.branchHead(repository.remote, repository.default_branch);
    if (defaultHead !== patch.target_base_sha) {
      results.push(
        blocked(patch.repository, patch.base_sha, `Default branch moved from ${patch.target_base_sha} to ${defaultHead}.`),
      );
      continue;
    }
    if (!options.apply) {
      results.push({
        repository: patch.repository,
        status: "planned",
        base_sha: patch.base_sha,
        result_sha: null,
        pull_request_url: null,
        detail: "Dry run: would create a commit and draft pull request.",
      });
      continue;
    }
    try {
      const message = commitMessage(bundle, patch.patch_sha256);
      const applied = await git.applyAndCommit({
        remote: repository.remote,
        baseSha: patch.base_sha,
        branch: bundle.feature_branch,
        patch: patchText,
        message,
        expectedPaths: paths,
      });
      await git.pushFastForward(repository.remote, bundle.feature_branch, applied.worktree);
      const pull = await ensurePull(options.github, repository, bundle, patchText, applied.sha, true);
      results.push({
        repository: patch.repository,
        status: "published",
        base_sha: patch.base_sha,
        result_sha: applied.sha,
        pull_request_url: pull,
        detail: "Draft pull request recorded.",
      });
      await savePublication(options.runDir, bundle.run_id, results);
    } catch (error) {
      results.push({
        repository: patch.repository,
        status: "failed",
        base_sha: patch.base_sha,
        result_sha: null,
        pull_request_url: null,
        detail: errorMessage(error),
      });
      await savePublication(options.runDir, bundle.run_id, results);
    }
  }
  const status = summarize(results, options.apply);
  if (status === "PUBLISHING" || status === "PUBLISHED" || status === "PARTIAL_PUBLISH" || status === "BLOCKED_STALE_BASE" || status === "PUBLISH_FAILED") {
    assertRunTransition("PUBLISHING", status === "PUBLISHING" ? "PUBLISHED" : status);
  }
  const result: PublishResult = {
    schema_version: "1.0",
    run_id: bundle.run_id,
    dry_run: !options.apply,
    status,
    repositories: results,
  };
  await writeAtomic(path.join(options.runDir, "publication.json"), `${JSON.stringify(result, null, 2)}\n`);
  if (options.store && options.apply) {
    await recordOutcome(options.store, manifest.task_id, result, options.now ?? new Date());
  }
  return result;
}

function summarize(results: PublishRepoResult[], apply: boolean): RunStatus {
  if (!apply) return "PUBLISHING";
  const published = results.filter((item) => item.status === "published" || item.status === "skipped");
  const blocked = results.some((item) => item.status === "blocked");
  const failed = results.some((item) => item.status === "failed");
  if (published.length === results.length && results.length > 0) return "PUBLISHED";
  if (published.length > 0 && (failed || blocked)) return "PARTIAL_PUBLISH";
  if (blocked) return "BLOCKED_STALE_BASE";
  return "PUBLISH_FAILED";
}

function blocked(repository: string, baseSha: string, detail: string): PublishRepoResult {
  return {
    repository,
    status: "blocked",
    base_sha: baseSha,
    result_sha: null,
    pull_request_url: null,
    detail,
  };
}

function commitMessage(bundle: BundleManifest, patchSha: string): string {
  return [
    `feat: ${bundle.task_id}`,
    "",
    `Task-ID: ${bundle.task_id}`,
    `Forge-Run-ID: ${bundle.run_id}`,
    `Forge-Task-SHA: ${bundle.task_sha}`,
    `Forge-Patch-SHA256: ${patchSha}`,
  ].join("\n");
}

async function ensurePull(
  github: GitHubClient,
  repository: { owner: string; name: string; default_branch: string },
  bundle: BundleManifest,
  patch: string,
  sha: string,
  apply: boolean,
): Promise<string | null> {
  if (!apply) return null;
  const record = await github.createOrUpdateDraftPr({
    owner: repository.owner,
    repo: repository.name,
    title: `${bundle.task_id}: ${bundle.feature_branch}`,
    body: pullBody(bundle, patch),
    head: bundle.feature_branch,
    base: repository.default_branch,
    headSha: sha,
    draft: true,
  });
  return record.html_url;
}

function pullBody(bundle: BundleManifest, patch: string): string {
  const files = patch
    .split("\n")
    .filter((line) => line.startsWith("diff --git "))
    .map((line) => line.replace(/^diff --git a\/.+ b\//, ""))
    .join("\n- ");
  return [
    `Task \`${bundle.task_id}\` at \`${bundle.task_sha}\`.`,
    "",
    `Forge run \`${bundle.run_id}\`.`,
    `Control \`${bundle.control_sha}\`.`,
    `Policy \`${bundle.policy_sha256}\`.`,
    `Bundle \`${bundle.bundle_sha256}\`.`,
    "",
    "Changed paths:",
    files ? `- ${files}` : "- (see patch)",
    "",
    "This is a draft pull request. It is not merged and it is not a deployment.",
  ].join("\n");
}

function isGitHubRemote(remote: string): boolean {
  return remote.startsWith("https://github.com/") || remote.startsWith("git@github.com:");
}

async function readReceipt(runDir: string): Promise<EvidenceReceipt | null> {
  try {
    return JSON.parse(await readFile(path.join(runDir, "evidence-receipt.json"), "utf8")) as EvidenceReceipt;
  } catch {
    return null;
  }
}

async function readPublication(runDir: string): Promise<PublishResult | null> {
  try {
    return JSON.parse(await readFile(path.join(runDir, "publication.json"), "utf8")) as PublishResult;
  } catch {
    return null;
  }
}

async function savePublication(runDir: string, runId: string, repositories: PublishRepoResult[]): Promise<void> {
  const partial: PublishResult = {
    schema_version: "1.0",
    run_id: runId,
    dry_run: false,
    status: "PARTIAL_PUBLISH",
    repositories,
  };
  await writeAtomic(path.join(runDir, "publication.json"), `${JSON.stringify(partial, null, 2)}\n`);
}

async function recordOutcome(store: HistoryStore, taskId: string, result: PublishResult, now: Date): Promise<void> {
  const key = `outcomes/tasks/${taskId}/current.json`;
  const body = Buffer.from(
    JSON.stringify(
      {
        schema_version: "1.0",
        task_id: taskId,
        state: result.status === "PUBLISHED" || result.status === "PARTIAL_PUBLISH" ? "REVIEW_PENDING" : "RUNNING",
        publication: result,
        last_reconciled_at: null,
        source_updated_at: now.toISOString(),
      },
      null,
      2,
    ),
  );
  try {
    await store.putMutableSnapshot(key, body);
  } catch (error) {
    if (error instanceof HistoryConflictError) {
      const current = await store.get(key);
      await store.putMutableSnapshot(key, body, sha256(current));
      return;
    }
    throw error;
  }
}
