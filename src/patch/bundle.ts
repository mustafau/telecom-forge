import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { ForgeError } from "../lib/errors.js";
import { ensureDir, writeAtomic } from "../lib/fs.js";
import { sha256, sha256Json } from "../lib/hash.js";
import { git, gitOk } from "../lib/git.js";
import { findRepoRoot, loadConfigAtSha } from "../config/load.js";
import { assertPatchText } from "./scan.js";
import { readManifest, type VerificationReport } from "../verify/verify.js";
import type { RunStatus } from "../tasks/states.js";

export interface PatchEntry {
  repository: string;
  base_sha: string;
  target_base_sha: string;
  paths: string[];
  patch_sha256: string;
  patch_file: string;
  bytes: number;
}

export interface BundleManifest {
  schema_version: "1.0";
  run_id: string;
  task_id: string;
  task_sha: string;
  control_sha: string;
  policy_sha256: string;
  task_snapshot_sha256: string;
  feature_branch: string;
  publishable: boolean;
  outcome: "CHANGES" | "NO_CHANGE" | "DIAGNOSTIC";
  status: RunStatus;
  patches: PatchEntry[];
  bundle_sha256: string;
}

export async function createBundle(runDir: string): Promise<BundleManifest> {
  const manifest = await readManifest(runDir);
  const verification = JSON.parse(await readFile(path.join(runDir, "verification.json"), "utf8")) as VerificationReport;
  const workspace = await findRepoRoot(runDir);
  const config = await loadConfigAtSha(workspace, manifest.control_sha);
  const patchDir = path.join(runDir, "patches");
  await ensureDir(patchDir);
  const patches: PatchEntry[] = [];
  if (verification.status !== "AGENT_FAILED" && verification.status !== "TIMED_OUT") {
    for (const repository of manifest.repositories.filter((item) => item.role === "writable")) {
      const checkout = path.join(workspace, repository.checkout_path);
      const status = await git(["status", "--porcelain=v1"], { cwd: checkout });
      if (status.code !== 0) throw new ForgeError("GIT_FAILED", status.stderr);
      if (status.stdout.trim().length === 0) continue;
      await gitOk(["add", "-A", "--", "."], { cwd: checkout });
      const diff = await git(
        ["diff", "--cached", "--binary", "--full-index", repository.base_sha],
        { cwd: checkout },
      );
      if (diff.code !== 0) throw new ForgeError("GIT_FAILED", diff.stderr);
      const patch = diff.stdout.endsWith("\n") || diff.stdout.length === 0 ? diff.stdout : `${diff.stdout}\n`;
      if (patch.trim().length === 0) continue;
      let paths: string[] = [];
      let publishablePatch = true;
      try {
        paths = assertPatchText(patch, config.workspace.policy.max_patch_bytes_per_repository);
      } catch (error) {
        publishablePatch = false;
        if (verification.publishable) throw error;
        paths = [];
        if (verification.status === "VERIFYING") throw error;
      }
      void publishablePatch;
      const filename = `${repository.alias}.patch`;
      await writeFile(path.join(patchDir, filename), patch);
      patches.push({
        repository: repository.alias,
        base_sha: repository.base_sha,
        target_base_sha: repository.target_base_sha,
        paths,
        patch_sha256: sha256(patch),
        patch_file: `patches/${filename}`,
        bytes: Buffer.byteLength(patch),
      });
    }
  }
  const agentOk = verification.status === "VERIFYING" && verification.failure_category === null;
  const testsOk = verification.checks.every((check) => check.status === "passed");
  const publishable = agentOk && testsOk && patches.length > 0;
  const outcome = !agentOk || !testsOk ? "DIAGNOSTIC" : patches.length === 0 ? "NO_CHANGE" : "CHANGES";
  const status: RunStatus = outcome === "NO_CHANGE" ? "NO_CHANGE" : publishable ? "BUNDLING" : verification.status;
  const unsigned: Omit<BundleManifest, "bundle_sha256"> = {
    schema_version: "1.0",
    run_id: manifest.run_id,
    task_id: manifest.task_id,
    task_sha: manifest.task_sha,
    control_sha: manifest.control_sha,
    policy_sha256: manifest.policy_sha256,
    task_snapshot_sha256: manifest.task_snapshot_sha256,
    feature_branch: manifest.feature_branch,
    publishable,
    outcome,
    status,
    patches,
  };
  const bundle: BundleManifest = { ...unsigned, bundle_sha256: sha256Json(unsigned) };
  await writeAtomic(path.join(runDir, "bundle-manifest.json"), `${JSON.stringify(bundle, null, 2)}\n`);
  const sums = [
    `${bundle.bundle_sha256}  bundle-manifest.json`,
    ...patches.map((patch) => `${patch.patch_sha256}  ${patch.patch_file}`),
  ];
  await writeFile(path.join(runDir, "SHA256SUMS"), `${sums.join("\n")}\n`);
  return bundle;
}
