import { ForgeError } from "../lib/errors.js";
import { assertCleanRef } from "../lib/git.js";

const BRANCH_PREFIXES = ["task/", "feature/", "agent/"];

export function assertPermittedBranch(branch: string, prefixes = BRANCH_PREFIXES): string {
  const safe = assertCleanRef(branch);
  if (!prefixes.some((prefix) => safe.startsWith(prefix))) {
    throw new ForgeError(
      "UNSAFE_BRANCH",
      `Branch "${branch}" must start with one of: ${prefixes.join(", ")}.`,
    );
  }
  return safe;
}

export function isFullSha(value: string): boolean {
  return /^[0-9a-f]{40}$/.test(value);
}

export function assertOwnerNotPlaceholder(owner: string, context: string): void {
  if (owner === "YOUR_GITHUB_OWNER" || owner.startsWith("YOUR_")) {
    throw new ForgeError(
      "PLACEHOLDER_OWNER",
      `${context} still uses placeholder owner "${owner}". Configure a real owner or a local remote.`,
    );
  }
}
