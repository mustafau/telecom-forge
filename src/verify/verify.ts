import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { execa } from "execa";
import { ForgeError, errorMessage } from "../lib/errors.js";
import { ensureDir } from "../lib/fs.js";
import { redactSecrets } from "../security/redact.js";
import { forbiddenAgentVariables } from "../security/agent-env.js";
import { findRepoRoot, loadConfigAtSha, type LoadedConfig } from "../config/load.js";
import { parsePiJsonl } from "../harness/pi-events.js";
import type { PreparedManifest } from "../workspace/prepare.js";
import type { Bottleneck, RunStatus } from "../tasks/states.js";
import { assertChangesAllowed, inspectWorktree } from "../patch/scan.js";

export interface VerificationReport {
  schema_version: "1.0";
  run_id: string;
  status: RunStatus;
  publishable: boolean;
  failure_category: Bottleneck | null;
  failure_details: string | null;
  agent_state: string;
  checks: Array<{
    id: string;
    repository: string;
    status: "passed" | "failed" | "skipped";
    duration_ms: number;
    output_excerpt: string;
  }>;
  changes: Array<{ repository: string; path: string; deletion: boolean }>;
}

export async function verifyRun(runDir: string): Promise<VerificationReport> {
  const manifest = await readManifest(runDir);
  const workspace = await findRepoRoot(runDir);
  const config = await loadConfigAtSha(workspace, manifest.control_sha);
  const harnessResult = JSON.parse(await readFile(path.join(runDir, "harness-result.json"), "utf8")) as {
    state: string;
    rawEventFile: string;
    exitCode: number | null;
    errors: string[];
  };
  const raw = await readFile(harnessResult.rawEventFile, "utf8");
  const parsed = parsePiJsonl(raw);
  const agentFailed = harnessResult.state !== "completed" || parsed.failed || harnessResult.exitCode !== 0;
  if (agentFailed) {
    const report: VerificationReport = {
      schema_version: "1.0",
      run_id: manifest.run_id,
      status: harnessResult.state === "timed_out" ? "TIMED_OUT" : "AGENT_FAILED",
      publishable: false,
      failure_category: harnessResult.state === "timed_out" ? "RESOURCE_OR_TIMEOUT" : "TOOLING_OR_HARNESS_FAILURE",
      failure_details: [...parsed.errors, ...harnessResult.errors].join("; ") || "Agent run did not settle successfully.",
      agent_state: harnessResult.state,
      checks: [],
      changes: [],
    };
    await writeReport(runDir, report);
    return report;
  }

  const changes: VerificationReport["changes"] = [];
  try {
    for (const repository of manifest.repositories) {
      const checkout = path.join(workspace, repository.checkout_path);
      const found = await inspectWorktree(checkout);
      if (found.length === 0) continue;
      if (repository.access !== "read-write" || repository.role !== "writable") {
        throw new ForgeError(
          "SCOPE_VIOLATION",
          `Changes in ${repository.alias} are not allowed. Access is ${repository.access} and role is ${repository.role}.`,
          { exitCode: 3, details: { paths: found.map((change) => change.path) } },
        );
      }
      assertChangesAllowed(found, {
        maxChangedFiles: config.workspace.policy.max_changed_files,
        maxDeletions: config.workspace.policy.max_deletions,
      });
      for (const change of found) {
        changes.push({ repository: repository.alias, path: change.path, deletion: change.deletion });
      }
    }
  } catch (error) {
    const report: VerificationReport = {
      schema_version: "1.0",
      run_id: manifest.run_id,
      status: "VERIFICATION_FAILED",
      publishable: false,
      failure_category: "SECURITY_POLICY_BLOCK",
      failure_details: errorMessage(error),
      agent_state: harnessResult.state,
      checks: [],
      changes,
    };
    await writeReport(runDir, report);
    return report;
  }

  const checks: VerificationReport["checks"] = [];
  const writable = manifest.repositories.filter((repository) => repository.role === "writable");
  for (const repository of writable) {
    const profile = config.profiles.profiles[repository.build_profile];
    if (!profile) {
      checks.push({
        id: "missing-profile",
        repository: repository.alias,
        status: "failed",
        duration_ms: 0,
        output_excerpt: "Build profile missing from the trusted control revision.",
      });
      continue;
    }
    for (const command of profile.commands) {
      const started = Date.now();
      const cwd = path.join(workspace, repository.checkout_path, command.working_directory ?? "");
      const [executable, ...args] = command.argv;
      if (!executable) {
        checks.push({
          id: command.id,
          repository: repository.alias,
          status: "failed",
          duration_ms: 0,
          output_excerpt: "Command argv is empty.",
        });
        continue;
      }
      const result = await execa(executable, args, {
        cwd,
        timeout: command.timeout_seconds * 1000,
        reject: false,
        stdin: "ignore",
        env: verificationEnv(command.env_allowlist),
        windowsHide: true,
      });
      const combined = redactSecrets(`${result.stdout ?? ""}\n${result.stderr ?? ""}`).text.slice(
        0,
        command.max_output_bytes,
      );
      checks.push({
        id: command.id,
        repository: repository.alias,
        status: result.exitCode === 0 ? "passed" : "failed",
        duration_ms: Date.now() - started,
        output_excerpt: combined,
      });
    }
  }
  const failedCheck = checks.some((check) => check.status === "failed");
  const report: VerificationReport = {
    schema_version: "1.0",
    run_id: manifest.run_id,
    status: failedCheck ? "VERIFICATION_FAILED" : "VERIFYING",
    publishable: false,
    failure_category: failedCheck ? "ACTUAL_TEST_FAILURE" : null,
    failure_details: failedCheck ? "One or more trusted verification commands failed." : null,
    agent_state: harnessResult.state,
    checks,
    changes,
  };
  await writeReport(runDir, report);
  return report;
}

export function verificationEnv(allowlist: string[]): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { GIT_TERMINAL_PROMPT: "0" };
  const allowed = new Set(["PATH", "HOME", "LANG", "LC_ALL", "TZ", "TMPDIR", ...allowlist]);
  for (const name of allowed) {
    if (forbiddenAgentVariables({ [name]: process.env[name] }).length > 0) continue;
    const value = process.env[name];
    if (typeof value === "string") env[name] = value;
  }
  return env;
}

export async function readManifest(runDir: string): Promise<PreparedManifest> {
  return JSON.parse(await readFile(path.join(runDir, "prepared-manifest.json"), "utf8")) as PreparedManifest;
}

async function writeReport(runDir: string, report: VerificationReport): Promise<void> {
  await ensureDir(runDir);
  await writeFile(path.join(runDir, "verification.json"), `${JSON.stringify(report, null, 2)}\n`);
}

export function configLimits(config: LoadedConfig): { maxPatchBytes: number } {
  return { maxPatchBytes: config.workspace.policy.max_patch_bytes_per_repository };
}
