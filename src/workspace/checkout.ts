import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { ForgeError } from "../lib/errors.js";
import { git, gitOk } from "../lib/git.js";
import { assertInsideRoot } from "../lib/paths.js";

export interface CheckoutRequest {
  repoRoot: string;
  remote: string;
  checkoutPath: string;
  sha: string;
}

export async function checkoutRepository(request: CheckoutRequest): Promise<void> {
  const destination = assertInsideRoot(request.repoRoot, path.join(request.repoRoot, request.checkoutPath));
  await rm(destination, { recursive: true, force: true });
  await mkdir(path.dirname(destination), { recursive: true });
  await gitOk(["clone", "--no-local", "--no-checkout", request.remote, destination]);
  await gitOk(["checkout", "--detach", request.sha], { cwd: destination });
  await stripCheckoutCredentials(destination);
}

export async function remoteBranchSha(remote: string, branch: string): Promise<string | null> {
  const result = await git(["ls-remote", "--heads", remote, branch]);
  if (result.code !== 0) {
    throw new ForgeError("GIT_FAILED", `Could not list ${branch} on ${remote}: ${result.stderr.trim()}`);
  }
  const line = result.stdout
    .split("\n")
    .map((item) => item.trim())
    .find((item) => item.endsWith(`refs/heads/${branch}`));
  if (!line) return null;
  const sha = line.split(/\s+/)[0] ?? "";
  if (!/^[0-9a-f]{40}$/.test(sha)) {
    throw new ForgeError("GIT_FAILED", `Unexpected ls-remote output for ${branch}.`);
  }
  return sha;
}

export async function commitMessage(remoteOrRepo: string, sha: string, gitDir = false): Promise<string> {
  const args = gitDir ? ["--git-dir", remoteOrRepo, "log", "-1", "--format=%B", sha] : ["log", "-1", "--format=%B", sha];
  return gitOk(args, gitDir ? {} : { cwd: remoteOrRepo });
}

export async function stripCheckoutCredentials(checkout: string): Promise<void> {
  await git(["remote", "remove", "origin"], { cwd: checkout });
  await git(["config", "--local", "--unset-all", "credential.helper"], { cwd: checkout });
  await git(["config", "--local", "credential.helper", ""], { cwd: checkout });
  const hooks = path.join(checkout, ".git", "forge-no-hooks");
  await mkdir(hooks, { recursive: true });
  await git(["config", "--local", "core.hooksPath", hooks], { cwd: checkout });
  const config = await gitOk(["config", "--local", "--list"], { cwd: checkout });
  if (/:\/\/[^/\s]*@/.test(config) || /ghp_|github_pat_|AKIA/.test(config)) {
    throw new ForgeError("CREDENTIAL_LEAK", `Checkout ${checkout} still contains credential-like Git config.`, {
      exitCode: 3,
    });
  }
}

export function repositoriesToFetch(writable: string[], context: string[], dependsOn: (alias: string) => string[]): string[] {
  const selected = new Set<string>([...writable, ...context]);
  const queue = [...selected];
  while (queue.length > 0) {
    const alias = queue.pop();
    if (!alias) continue;
    for (const dependency of dependsOn(alias)) {
      if (!selected.has(dependency)) {
        selected.add(dependency);
        queue.push(dependency);
      }
    }
  }
  return [...selected];
}
