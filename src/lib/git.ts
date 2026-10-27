import { execa } from "execa";
import { ForgeError } from "./errors.js";

export interface GitResult {
  code: number;
  stdout: string;
  stderr: string;
}

const GIT_IDENTITY = ["-c", "user.name=telecom-forge", "-c", "user.email=forge@example.invalid"];

export async function git(
  args: string[],
  options: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    timeoutMs?: number;
    identity?: boolean;
  } = {},
): Promise<GitResult> {
  const fullArgs = options.identity ? [...GIT_IDENTITY, ...args] : args;
  const result = await execa("git", fullArgs, {
    cwd: options.cwd,
    env: options.env,
    timeout: options.timeoutMs,
    reject: false,
    stdin: "ignore",
    windowsHide: true,
    stripFinalNewline: false,
  });
  return {
    code: result.exitCode ?? 1,
    stdout: typeof result.stdout === "string" ? result.stdout : "",
    stderr: typeof result.stderr === "string" ? result.stderr : "",
  };
}

export async function gitOk(
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number; identity?: boolean } = {},
): Promise<string> {
  const result = await git(args, options);
  if (result.code !== 0) {
    throw new ForgeError(
      "GIT_FAILED",
      `git ${args.join(" ")} failed: ${result.stderr.trim() || result.stdout.trim()}`,
      { details: { args, code: result.code } },
    );
  }
  return result.stdout.trim();
}

export function assertCleanRef(ref: string): string {
  if (!/^[A-Za-z0-9._/-]+$/.test(ref) || ref.startsWith("-") || ref.includes("..") || ref.endsWith("/")) {
    throw new ForgeError("UNSAFE_REF", `Git ref "${ref}" is not an accepted branch, tag, or SHA.`);
  }
  if (ref.split("/").some((segment) => segment === "" || segment === "." || segment === "..")) {
    throw new ForgeError("UNSAFE_REF", `Git ref "${ref}" contains an empty or parent segment.`);
  }
  return ref;
}

export async function resolveCommit(repo: string, ref: string): Promise<string> {
  const safe = assertCleanRef(ref);
  const sha = await gitOk(["rev-parse", "--verify", `${safe}^{commit}`], { cwd: repo });
  if (!/^[0-9a-f]{40}$/.test(sha)) {
    throw new ForgeError("UNSAFE_REF", `Resolved ref "${ref}" is not a full commit SHA.`);
  }
  return sha;
}

export async function showFile(repo: string, sha: string, filePath: string): Promise<string> {
  assertCleanRef(sha);
  if (filePath.startsWith("-") || filePath.includes("\0")) {
    throw new ForgeError("UNSAFE_PATH", `Cannot read ${filePath} from Git.`);
  }
  return gitOk(["show", `${sha}:${filePath}`], { cwd: repo });
}

export async function pathExistsAt(repo: string, sha: string, filePath: string): Promise<boolean> {
  const result = await git(["cat-file", "-e", `${sha}:${filePath}`], { cwd: repo });
  return result.code === 0;
}
