import { readFile } from "node:fs/promises";
import path from "node:path";
import { execa } from "execa";
import { ZodError } from "zod";
import { ForgeError } from "../lib/errors.js";
import { pathExistsAt, resolveCommit, showFile } from "../lib/git.js";
import { assertGithubName, assertSafeAlias, assertSafeRelativePath } from "../lib/paths.js";
import { parseYaml } from "../lib/yaml.js";
import { assertCleanRef } from "../lib/git.js";
import { assertPermittedBranch } from "../security/refs.js";
import {
  BuildProfilesSchema,
  LocalRemotesSchema,
  WorkspaceFileSchema,
  type BuildProfilesFile,
  type CatalogRepository,
  type WorkspaceFile,
} from "./schema.js";

export interface LoadedConfig {
  repoRoot: string;
  controlSha: string | null;
  workspace: WorkspaceFile;
  profiles: BuildProfilesFile;
  localRemotes: Record<string, string>;
}

export async function findRepoRoot(start = process.cwd()): Promise<string> {
  let current = path.resolve(start);
  for (;;) {
    try {
      await readFile(path.join(current, "catalog", "workspace.yaml"));
      return current;
    } catch {
      const parent = path.dirname(current);
      if (parent === current) {
        throw new ForgeError(
          "REPO_ROOT_NOT_FOUND",
          "Could not find catalog/workspace.yaml from the current directory.",
        );
      }
      current = parent;
    }
  }
}

export async function loadWorkingTreeConfig(repoRoot: string): Promise<LoadedConfig> {
  const workspaceText = await readFile(path.join(repoRoot, "catalog", "workspace.yaml"), "utf8");
  const profilesText = await readFile(path.join(repoRoot, "catalog", "build-profiles.yaml"), "utf8");
  const workspace = parseWorkspace(workspaceText);
  const profiles = parseProfiles(profilesText);
  validateCatalog(workspace, profiles);
  return {
    repoRoot,
    controlSha: null,
    workspace,
    profiles,
    localRemotes: await readLocalRemotes(repoRoot, workspace),
  };
}

export async function loadConfigAtSha(repoRoot: string, sha: string): Promise<LoadedConfig> {
  const workspace = parseWorkspace(await showFile(repoRoot, sha, "catalog/workspace.yaml"));
  const profiles = parseProfiles(await showFile(repoRoot, sha, "catalog/build-profiles.yaml"));
  validateCatalog(workspace, profiles);
  return {
    repoRoot,
    controlSha: sha,
    workspace,
    profiles,
    localRemotes: await readLocalRemotes(repoRoot, workspace),
  };
}

export function parseWorkspace(text: string): WorkspaceFile {
  const parsed = WorkspaceFileSchema.safeParse(parseYaml(text, "catalog/workspace.yaml"));
  if (!parsed.success) throw new ForgeError("INVALID_CATALOG", formatZod(parsed.error));
  return parsed.data;
}

export function parseProfiles(text: string): BuildProfilesFile {
  const parsed = BuildProfilesSchema.safeParse(parseYaml(text, "catalog/build-profiles.yaml"));
  if (!parsed.success) throw new ForgeError("INVALID_BUILD_PROFILES", formatZod(parsed.error));
  for (const command of Object.values(parsed.data.profiles).flatMap((profile) => profile.commands)) {
    if (command.argv.some((part) => part.includes("\0") || /[\r\n]/.test(part))) {
      throw new ForgeError("INVALID_BUILD_PROFILES", `Command ${command.id} contains an unsafe argument.`);
    }
    if (command.working_directory) {
      assertSafeRelativePath(command.working_directory, `${command.id} working_directory`);
    }
  }
  return parsed.data;
}

export function validateCatalog(workspace: WorkspaceFile, profiles: BuildProfilesFile): void {
  const seenPaths = new Set<string>();
  const sourceDirectory = assertSafeRelativePath(workspace.workspace.source_directory, "source_directory");
  for (const [alias, repository] of Object.entries(workspace.repositories)) {
    assertSafeAlias(alias);
    assertGithubName(repository.owner, `${alias} owner`);
    assertGithubName(repository.name, `${alias} name`);
    const checkout = assertSafeRelativePath(repository.checkout_path, `${alias} checkout_path`);
    const expected = path.posix.join(sourceDirectory, alias);
    if (checkout !== expected) {
      throw new ForgeError(
        "UNSAFE_CHECKOUT_PATH",
        `${alias} checkout_path must be ${expected}, not ${checkout}.`,
      );
    }
    if (seenPaths.has(checkout)) {
      throw new ForgeError("DUPLICATE_CHECKOUT", `Checkout path ${checkout} is used more than once.`);
    }
    seenPaths.add(checkout);
    assertDefaultBranch(repository.default_branch, workspace.policy.permitted_branch_prefixes);
    if (!profiles.profiles[repository.build_profile]) {
      throw new ForgeError(
        "UNKNOWN_BUILD_PROFILE",
        `${alias} references unknown build profile "${repository.build_profile}".`,
      );
    }
    for (const dependency of repository.depends_on) {
      if (!workspace.repositories[dependency]) {
        throw new ForgeError("UNKNOWN_DEPENDENCY", `${alias} depends on unknown repository ${dependency}.`);
      }
    }
    if (repository.allow_submodules || repository.allow_lfs) {
      throw new ForgeError(
        "UNSUPPORTED_CHECKOUT",
        `${alias} requests submodules or LFS. The initial implementation does not fetch them.`,
      );
    }
  }
}

export function cloneUrl(repository: CatalogRepository, localRemote?: string): string {
  if (localRemote) {
    if (/^[a-z]+:\/\//i.test(localRemote) && !localRemote.startsWith("file://")) {
      throw new ForgeError(
        "UNSAFE_REMOTE",
        "Local remotes must be filesystem paths. Task metadata cannot supply clone URLs.",
      );
    }
    if (localRemote.includes("@") && localRemote.includes("://")) {
      throw new ForgeError("UNSAFE_REMOTE", "Local remotes must not embed credentials.");
    }
    return localRemote;
  }
  return `https://github.com/${repository.owner}/${repository.name}.git`;
}

export async function readLocalRemotes(
  repoRoot: string,
  workspace: WorkspaceFile,
  explicitPath?: string,
): Promise<Record<string, string>> {
  const filePath =
    explicitPath ??
    process.env.FORGE_LOCAL_REMOTES ??
    path.join(repoRoot, ".forge-runtime", "local-remotes.json");
  let text: string;
  try {
    text = await readFile(filePath, "utf8");
  } catch {
    return {};
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new ForgeError("INVALID_LOCAL_REMOTES", `Could not parse ${filePath}.`);
  }
  const parsed = LocalRemotesSchema.safeParse(json);
  if (!parsed.success) throw new ForgeError("INVALID_LOCAL_REMOTES", formatZod(parsed.error));
  const remotes: Record<string, string> = {};
  for (const [alias, remote] of Object.entries(parsed.data.remotes)) {
    if (!workspace.repositories[alias]) {
      throw new ForgeError(
        "UNLISTED_LOCAL_REMOTE",
        `Local remote "${alias}" is not in the trusted catalog and cannot add a repository.`,
      );
    }
    if (!path.isAbsolute(remote)) {
      throw new ForgeError("UNSAFE_REMOTE", `Local remote for ${alias} must be an absolute path.`);
    }
    remotes[alias] = remote;
  }
  return remotes;
}

export async function currentHead(repoRoot: string): Promise<string> {
  return resolveCommit(repoRoot, "HEAD");
}

export async function extractControlFiles(
  repoRoot: string,
  sha: string,
  destination: string,
): Promise<void> {
  const candidates = ["AGENTS.md", ".agents", "prompts", "catalog", "extensions"];
  const present: string[] = [];
  for (const candidate of candidates) {
    if (await pathExistsAt(repoRoot, sha, candidate)) present.push(candidate);
  }
  if (!present.includes("AGENTS.md") || !present.includes("catalog")) {
    throw new ForgeError(
      "CONTROL_TREE_INCOMPLETE",
      `Control SHA ${sha} is missing AGENTS.md or catalog/.`,
    );
  }
  const archive = await execa("git", ["archive", "--format=tar", sha, ...present], {
    cwd: repoRoot,
    reject: false,
    encoding: "buffer",
  });
  if (archive.exitCode !== 0) {
    const stderr = Buffer.isBuffer(archive.stderr) ? archive.stderr.toString("utf8") : String(archive.stderr);
    throw new ForgeError("ARCHIVE_FAILED", `git archive failed: ${stderr.trim()}`);
  }
  const extracted = await execa("tar", ["-x", "-C", destination], {
    input: archive.stdout,
    reject: false,
  });
  if (extracted.exitCode !== 0) {
    throw new ForgeError("ARCHIVE_FAILED", "Could not extract the trusted control tree.");
  }
}

export function formatZod(error: ZodError): string {
  return error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`).join("; ");
}

function assertDefaultBranch(branch: string, prefixes: string[]): void {
  const safe = assertCleanRef(branch);
  if (safe === "main" || safe === "master") return;
  assertPermittedBranch(safe, prefixes);
}
