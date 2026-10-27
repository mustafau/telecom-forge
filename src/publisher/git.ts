import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ForgeError } from "../lib/errors.js";
import { git, gitOk } from "../lib/git.js";
import { remoteBranchSha } from "../workspace/checkout.js";

export interface ApplyCommitInput {
  remote: string;
  baseSha: string;
  branch: string;
  patch: string;
  message: string;
  expectedPaths: string[];
}

export interface AppliedCommit {
  sha: string;
  worktree: string;
}

export interface PublishGit {
  branchHead(remote: string, branch: string): Promise<string | null>;
  commitMessage(remote: string, sha: string): Promise<string>;
  applyAndCommit(input: ApplyCommitInput): Promise<AppliedCommit>;
  pushFastForward(remote: string, branch: string, worktree: string): Promise<void>;
}

export class LocalGitPublisher implements PublishGit {
  async branchHead(remote: string, branch: string): Promise<string | null> {
    return remoteBranchSha(remote, branch);
  }

  async commitMessage(remote: string, sha: string): Promise<string> {
    return gitOk(["--git-dir", remote, "log", "-1", "--format=%B", sha]);
  }

  async applyAndCommit(input: ApplyCommitInput): Promise<AppliedCommit> {
    const directory = await mkdtemp(path.join(os.tmpdir(), "forge-publish-"));
    await gitOk(["clone", "--no-local", input.remote, directory]);
    await gitOk(["checkout", "--detach", input.baseSha], { cwd: directory });
    const patchFile = path.join(directory, ".forge-patch");
    await writeFile(patchFile, input.patch);
    const check = await git(["apply", "--check", patchFile], { cwd: directory });
    if (check.code !== 0) {
      throw new ForgeError("PATCH_APPLY_FAILED", `git apply --check failed: ${check.stderr.trim()}`);
    }
    const applied = await git(["apply", "--index", patchFile], { cwd: directory });
    if (applied.code !== 0) {
      throw new ForgeError("PATCH_APPLY_FAILED", `git apply --index failed: ${applied.stderr.trim()}`);
    }
    await rm(patchFile, { force: true });
    const staged = (await gitOk(["diff", "--cached", "--name-only"], { cwd: directory }))
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .sort();
    const expected = [...input.expectedPaths].sort();
    if (staged.join("\n") !== expected.join("\n")) {
      throw new ForgeError(
        "PATCH_PATH_MISMATCH",
        `Staged paths ${staged.join(", ") || "(none)"} do not match the bundle paths ${expected.join(", ") || "(none)"}.`,
        { exitCode: 3 },
      );
    }
    await gitOk(["commit", "-m", input.message], { cwd: directory, identity: true });
    const sha = await gitOk(["rev-parse", "HEAD"], { cwd: directory });
    return { sha, worktree: directory };
  }

  async pushFastForward(remote: string, branch: string, worktree: string): Promise<void> {
    const result = await git(["push", remote, `HEAD:refs/heads/${branch}`], { cwd: worktree });
    if (result.code !== 0) {
      throw new ForgeError(
        "PUSH_REJECTED",
        `Non-forced push was rejected for ${branch}: ${result.stderr.trim()}. The remote branch was left unchanged.`,
      );
    }
  }
}
