import path from "node:path";
import { ForgeError } from "./errors.js";

const SAFE_SEGMENT = /^[A-Za-z0-9._-]+$/;

export function assertSafeRelativePath(input: string, label = "path"): string {
  if (typeof input !== "string" || input.length === 0) {
    throw new ForgeError("UNSAFE_PATH", `${label} must be a non-empty relative path.`);
  }
  if (input.includes("\0") || input.includes("\\") || input.includes("://")) {
    throw new ForgeError("UNSAFE_PATH", `${label} contains an unsupported character or scheme.`);
  }
  if (path.posix.isAbsolute(input) || path.win32.isAbsolute(input)) {
    throw new ForgeError("UNSAFE_PATH", `${label} must not be absolute.`);
  }
  const normalized = path.posix.normalize(input);
  if (
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized.includes("/../") ||
    normalized.endsWith("/..")
  ) {
    throw new ForgeError("UNSAFE_PATH", `${label} must not traverse outside its root.`);
  }
  const segments = normalized.split("/");
  for (const segment of segments) {
    if (segment === "" || segment === "." || segment === "..") {
      throw new ForgeError("UNSAFE_PATH", `${label} contains an empty or parent segment.`);
    }
  }
  return normalized;
}

export function assertSafeAlias(alias: string): string {
  if (!SAFE_SEGMENT.test(alias) || alias === "." || alias === "..") {
    throw new ForgeError(
      "UNSAFE_ALIAS",
      `Repository alias "${alias}" must contain only letters, numbers, dots, underscores, and hyphens.`,
    );
  }
  return alias;
}

export function assertInsideRoot(root: string, candidate: string): string {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(candidate);
  const relative = path.relative(resolvedRoot, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new ForgeError("UNSAFE_PATH", `Path escapes ${resolvedRoot}: ${candidate}`);
  }
  return resolved;
}

export function assertGithubName(value: string, label: string): string {
  if (!/^[A-Za-z0-9._-]+$/.test(value) || value === "." || value === "..") {
    throw new ForgeError("UNSAFE_GITHUB_NAME", `${label} "${value}" is not a safe GitHub name.`);
  }
  return value;
}
