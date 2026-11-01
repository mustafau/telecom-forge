import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import { ForgeError } from "../lib/errors.js";
import { git } from "../lib/git.js";
import { assertPatchPath, isGitlinkMode, isSymlinkMode } from "../security/protected-paths.js";
import { assertNoSecrets } from "../security/redact.js";

export interface WorktreeChange {
  path: string;
  status: string;
  binary: boolean;
  symlink: boolean;
  bytes: number;
  deletion: boolean;
}

export function parsePorcelain(status: string): Array<{ path: string; status: string }> {
  const changes: Array<{ path: string; status: string }> = [];
  for (const line of status.split("\n")) {
    if (line.length === 0) continue;
    const code = line.slice(0, 2);
    let filePath = line.slice(3);
    if (filePath.includes(" -> ")) filePath = filePath.split(" -> ").at(-1) ?? filePath;
    if (filePath.startsWith('"') && filePath.endsWith('"')) {
      filePath = JSON.parse(filePath) as string;
    }
    changes.push({ path: filePath, status: code });
  }
  return changes;
}

export async function inspectWorktree(checkout: string): Promise<WorktreeChange[]> {
  const toplevel = await git(["rev-parse", "--show-toplevel"], { cwd: checkout });
  if (toplevel.code !== 0) {
    throw new ForgeError("GIT_FAILED", toplevel.stderr.trim() || `git rev-parse failed in ${checkout}`);
  }
  const root = path.resolve(checkout);
  if (path.resolve(toplevel.stdout.trim()) !== root) {
    throw new ForgeError(
      "GIT_FAILED",
      `Checkout ${root} is not its own Git work tree (toplevel=${toplevel.stdout.trim()}). The nested .git is missing or corrupt.`,
    );
  }
  const result = await git(["status", "--porcelain=v1", "-uall"], { cwd: checkout });
  if (result.code !== 0) {
    throw new ForgeError("GIT_FAILED", result.stderr.trim() || "git status failed");
  }
  const status = result.stdout.replace(/\n$/, "");
  const changes: WorktreeChange[] = [];
  for (const entry of parsePorcelain(status)) {
    const absolute = resolveWorktreePath(root, entry.path);
    let symlink = false;
    let bytes = 0;
    let binary = false;
    const deletion = entry.status.includes("D");
    if (!deletion) {
      const info = await lstat(absolute);
      symlink = info.isSymbolicLink();
      bytes = info.size;
      if (!symlink && info.isFile() && bytes > 0 && bytes <= 1_000_000) {
        const sample = await readFile(absolute);
        binary = sample.includes(0);
      } else if (!symlink && bytes > 1_000_000) {
        binary = true;
      }
    }
    changes.push({
      path: entry.path,
      status: entry.status,
      binary,
      symlink,
      bytes,
      deletion,
    });
  }
  return changes;
}

/** Join a porcelain path onto a checkout and reject escapes into the parent workspace. */
export function resolveWorktreePath(checkout: string, relativePath: string): string {
  if (path.isAbsolute(relativePath) || relativePath.split(/[\\/]/).includes("..")) {
    throw new ForgeError(
      "UNSAFE_PATH",
      `Worktree path "${relativePath}" is not confined to the repository checkout.`,
      { exitCode: 3 },
    );
  }
  const root = path.resolve(checkout);
  const absolute = path.resolve(root, relativePath);
  if (absolute !== root && !absolute.startsWith(`${root}${path.sep}`)) {
    throw new ForgeError(
      "UNSAFE_PATH",
      `Worktree path "${relativePath}" resolves outside ${root}.`,
      { exitCode: 3 },
    );
  }
  return absolute;
}

export function assertChangesAllowed(
  changes: WorktreeChange[],
  limits: { maxChangedFiles: number; maxDeletions: number },
): void {
  if (changes.length > limits.maxChangedFiles) {
    throw new ForgeError("PATCH_LIMIT", `Changed file count ${changes.length} exceeds ${limits.maxChangedFiles}.`, {
      exitCode: 3,
    });
  }
  const deletions = changes.filter((change) => change.deletion).length;
  if (deletions > limits.maxDeletions) {
    throw new ForgeError("PATCH_LIMIT", `Deletion count ${deletions} exceeds ${limits.maxDeletions}.`, {
      exitCode: 3,
    });
  }
  for (const change of changes) {
    assertPatchPath(change.path);
    if (change.symlink) {
      throw new ForgeError("UNSAFE_CHANGE", `Refusing symlink ${change.path}.`, { exitCode: 3 });
    }
    if (change.binary) {
      throw new ForgeError("UNSAFE_CHANGE", `Refusing binary file ${change.path}.`, { exitCode: 3 });
    }
  }
}

export function assertPatchText(patch: string, maxBytes: number): string[] {
  if (Buffer.byteLength(patch) > maxBytes) {
    throw new ForgeError("PATCH_LIMIT", `Patch is larger than ${maxBytes} bytes.`, { exitCode: 3 });
  }
  assertNoSecrets(patch, "patch");
  if (patch.includes("GIT binary patch")) {
    throw new ForgeError("UNSAFE_CHANGE", "Binary patches are rejected.", { exitCode: 3 });
  }
  const paths = patchPaths(patch);
  for (const filePath of paths) assertPatchPath(filePath);
  for (const mode of patchModes(patch)) {
    if (isSymlinkMode(mode) || isGitlinkMode(mode)) {
      throw new ForgeError("UNSAFE_CHANGE", `Refusing Git mode ${mode}.`, { exitCode: 3 });
    }
  }
  return paths;
}

export function patchPaths(patch: string): string[] {
  const paths = new Set<string>();
  for (const line of patch.split("\n")) {
    if (line.startsWith("diff --git ")) {
      const match = /diff --git a\/(.+) b\/(.+)$/.exec(line);
      if (!match?.[2]) throw new ForgeError("UNSAFE_CHANGE", `Unparseable diff header: ${line}`, { exitCode: 3 });
      paths.add(cleanDiffPath(match[2]));
    }
    if (line.startsWith("+++ ") || line.startsWith("--- ")) {
      const raw = line.slice(4);
      if (raw !== "/dev/null") paths.add(cleanDiffPath(raw.replace(/^[ab]\//, "")));
    }
  }
  return [...paths];
}

export function patchModes(patch: string): string[] {
  const modes: string[] = [];
  for (const line of patch.split("\n")) {
    const match = /^(?:new file mode|old file mode|new mode|old mode) (\d+)/.exec(line);
    if (match?.[1]) modes.push(match[1]);
  }
  return modes;
}

function cleanDiffPath(filePath: string): string {
  if (filePath.startsWith("/") || filePath.includes("\\") || filePath.split("/").includes("..")) {
    throw new ForgeError("UNSAFE_PATH", `Patch path "${filePath}" is not confined to the repository.`, {
      exitCode: 3,
    });
  }
  return filePath;
}
