import path from "node:path";
import { ForgeError } from "../lib/errors.js";
import { assertSafeRelativePath } from "../lib/paths.js";

const PROTECTED: Array<{ reason: string; test: (filePath: string) => boolean }> = [
  { reason: "git metadata", test: (filePath) => filePath === ".git" || filePath.startsWith(".git/") },
  {
    reason: "workflow",
    test: (filePath) => filePath === ".github/workflows" || filePath.startsWith(".github/workflows/"),
  },
  {
    reason: "environment file",
    test: (filePath) => /(^|\/)\.env$/.test(filePath) || /(^|\/)\.env\./.test(filePath),
  },
  {
    reason: "credential file",
    test: (filePath) => /credential/i.test(filePath) || filePath.endsWith(".pem"),
  },
  {
    reason: "private key",
    test: (filePath) => filePath.endsWith(".key") || /(^|\/)id_rsa$/.test(filePath),
  },
  {
    reason: "git hook",
    test: (filePath) => filePath.startsWith(".githooks/") || /(^|\/)hooks\//.test(filePath),
  },
];

export function assertPatchPath(filePath: string): string {
  const normalized = assertSafeRelativePath(filePath.split("\\").join("/"), "patch path");
  const reason = protectedReason(normalized);
  if (reason) {
    throw new ForgeError("PROTECTED_PATH", `Refusing protected ${reason} path "${normalized}".`, {
      exitCode: 3,
    });
  }
  return normalized;
}

export function protectedReason(filePath: string): string | null {
  const normalized = path.posix.normalize(filePath);
  for (const rule of PROTECTED) {
    if (rule.test(normalized)) return rule.reason;
  }
  return null;
}

export function isGitlinkMode(mode: string): boolean {
  return mode === "160000";
}

export function isSymlinkMode(mode: string): boolean {
  return mode === "120000";
}
