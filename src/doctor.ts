import { execa } from "execa";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { loadWorkingTreeConfig } from "./config/load.js";
import { errorMessage } from "./lib/errors.js";
import { resolvePiBinary } from "./harness/pi-adapter.js";

export interface DoctorCheck {
  name: string;
  ok: boolean;
  required: boolean;
  detail: string;
}

export async function runDoctor(options: {
  repoRoot: string;
  requireDurableHistory?: boolean;
  env?: NodeJS.ProcessEnv;
}): Promise<{ ok: boolean; checks: DoctorCheck[] }> {
  const env = options.env ?? process.env;
  const checks: DoctorCheck[] = [];
  const nodeMajor = Number(process.versions.node.split(".")[0] ?? "0");
  checks.push({
    name: "node",
    ok: nodeMajor >= 22,
    required: true,
    detail: `v${process.versions.node}`,
  });
  checks.push(await commandCheck("git", ["--version"], true));
  checks.push(await commandCheck("pnpm", ["--version"], false));
  try {
    const config = await loadWorkingTreeConfig(options.repoRoot);
    checks.push({
      name: "catalog",
      ok: true,
      required: true,
      detail: `${Object.keys(config.workspace.repositories).length} repositories, history backend ${config.workspace.history.backend}`,
    });
  } catch (error) {
    checks.push({ name: "catalog", ok: false, required: true, detail: errorMessage(error) });
  }
  const bucket = env.FORGE_HISTORY_BUCKET;
  const durableRequired = options.requireDurableHistory === true;
  checks.push({
    name: "s3_history",
    ok: durableRequired ? Boolean(bucket && (env.AWS_REGION || env.AWS_DEFAULT_REGION)) : true,
    required: durableRequired,
    detail: bucket
      ? `Bucket configured via FORGE_HISTORY_BUCKET. Prefix ${env.FORGE_HISTORY_PREFIX ?? "telecom-forge/v1"}.`
      : "Optional for local mode. FORGE_HISTORY_BUCKET is not set, so GitHub Actions must not claim durable history or publish.",
  });
  const githubReady = Boolean(env.FORGE_GITHUB_TOKEN || (env.FORGE_GITHUB_APP_ID && env.FORGE_GITHUB_APP_PRIVATE_KEY));
  checks.push({
    name: "github_app",
    ok: true,
    required: false,
    detail: githubReady
      ? "GitHub credentials are present in the environment. Live publish still requires FORGE_ALLOW_LIVE_PUBLISH=1."
      : "GitHub App credentials are not configured. Local publishing uses filesystem remotes and the mock pull-request store.",
  });
  const pi = env.FORGE_PI_BIN ?? resolvePiBinary(options.repoRoot);
  try {
    await access(pi);
    const version = await execa(pi, ["--version"], { reject: false, timeout: 10_000 });
    checks.push({
      name: "pi",
      ok: version.exitCode === 0,
      required: false,
      detail: version.exitCode === 0 ? version.stdout.trim() : "Pi binary exists but --version failed. The fake harness still runs offline.",
    });
  } catch {
    checks.push({
      name: "pi",
      ok: false,
      required: false,
      detail: "Pi binary is not installed. pnpm install should provide it. Offline tests use the fake harness.",
    });
  }
  checks.push({
    name: "model",
    ok: true,
    required: false,
    detail:
      env.FORGE_MODEL_PROVIDER && env.FORGE_MODEL_ID
        ? `Provider ${env.FORGE_MODEL_PROVIDER}, model ${env.FORGE_MODEL_ID}.`
        : "FORGE_MODEL_PROVIDER and FORGE_MODEL_ID are unset. Required only for a real Pi run, not for forge doctor or the fake harness.",
  });
  try {
    await readFile(path.join(options.repoRoot, "AGENTS.md"));
    checks.push({ name: "agents_charter", ok: true, required: true, detail: "AGENTS.md is present." });
  } catch {
    checks.push({ name: "agents_charter", ok: false, required: true, detail: "AGENTS.md is missing." });
  }
  const ok = checks.filter((check) => check.required).every((check) => check.ok);
  return { ok, checks };
}

async function commandCheck(name: string, args: string[], required: boolean): Promise<DoctorCheck> {
  const result = await execa(name, args, { reject: false });
  return {
    name,
    ok: result.exitCode === 0,
    required,
    detail: result.exitCode === 0 ? `${result.stdout}`.trim() : `${name} is not available.`,
  };
}
