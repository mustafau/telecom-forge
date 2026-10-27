#!/usr/bin/env node
import { appendFile } from "node:fs/promises";
import path from "node:path";
import { runDoctor } from "./doctor.js";
import { findRepoRoot, loadConfigAtSha, loadWorkingTreeConfig } from "./config/load.js";
import { initTask } from "./tasks/init.js";
import { validateTask } from "./tasks/validate.js";
import { prepareWorkspace } from "./workspace/prepare.js";
import { executeHarness } from "./workspace/run.js";
import { verifyRun, readManifest } from "./verify/verify.js";
import { createBundle } from "./patch/bundle.js";
import { publishBundle } from "./publisher/publish.js";
import { FilesystemHistoryStore } from "./history/filesystem-store.js";
import type { HistoryStore } from "./history/storage.js";
import { createS3HistoryStore } from "./history/s3-store.js";
import { persistRunEvidence } from "./history/persist.js";
import { reconcilePublications } from "./history/reconcile.js";
import { MockGitHubClient } from "./github/mock-client.js";
import { createLiveGitHubClient, mintInstallationToken, requireLivePublishOptIn } from "./github/live-client.js";
import { buildRetro } from "./retrospective/retro.js";
import { previousCompletedWeek } from "./metrics/week.js";
import type { RunSummary } from "./metrics/compute.js";
import { ForgeError, isForgeError, errorMessage } from "./lib/errors.js";
import { resolveCommit } from "./lib/git.js";
import type { PublishResult } from "./publisher/publish.js";
import { readFile, readdir } from "node:fs/promises";

interface ParsedArgs {
  command: string[];
  flags: Map<string, string | boolean>;
  json: boolean;
  help: boolean;
}

const HELP: Record<string, string> = {
  doctor: "forge doctor [--require-durable-history] [--json]\nCheck local tools, catalog, and optional cloud or GitHub credentials.",
  "init-task": "forge init-task --id TF-0001 --branch feature/TF-0001 [--title text]\nCreate tasks/<id>/ from the template. Does not commit.",
  "validate-task": "forge validate-task --task-ref <ref> --task-path tasks/<id>/task.yaml [--json]\nValidate a committed task revision against the trusted catalog.",
  prepare: "forge prepare --task-ref <ref> --task-path <path> [--control-ref main] [--output dir] [--json]\nResolve pinned SHAs and check out approved repositories.",
  run: "forge run --prepared <dir> --harness pi|fake [--json]\nRun the coding harness. The fake harness is for offline rehearsal.",
  verify: "forge verify --run-id <id> | --run-dir <dir> [--json]\nRun trusted build profiles and policy checks. Does not publish.",
  bundle: "forge bundle --run-id <id> | --run-dir <dir> [--json]\nCreate a hashed patch bundle. Failed runs are diagnostic only.",
  publish: "forge publish --bundle <run-dir> [--dry-run] [--apply] [--json]\nDry-run is the default. --apply publishes only with a durable evidence receipt.",
  reconcile: "forge reconcile --since YYYY-MM-DD [--json]\nRecord later review and merge observations for published tasks.",
  retro: "forge retro --week YYYY-Www [--dry-run] [--propose] [--json]\nCompute metrics and a report. --propose writes files and does not edit skills.",
  history: "forge history show --run-id <id> [--json]\nShow a stored run summary.",
  "history persist":
    "forge history persist --run-dir <dir> [--nondurable] [--json]\nWrite immutable evidence and a receipt. Publication requires a durable receipt.",
  "history show": "forge history show --run-id <id> [--json]\nShow a stored run summary.",
};

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));
  const command = parsed.command.join(" ");
  if (parsed.help || command === "" || command === "help") {
    emit(0, { commands: HELP }, parsed.json, Object.entries(HELP).map(([name, text]) => `${name}\n  ${text}`).join("\n\n"));
    return;
  }
  if (!HELP[command] && !(parsed.command[0] === "history" && parsed.command[1] === "show")) {
    throw new ForgeError("USAGE", HELP[parsed.command[0] ?? ""] ?? `Unknown command ${command}.`);
  }
  if (parsed.help) return;
  const repoRoot = await findRepoRoot(process.cwd());
  if (command === "doctor") {
    const result = await runDoctor({ repoRoot, requireDurableHistory: flag(parsed, "require-durable-history") });
    await summarize(result.ok ? "doctor" : "doctor failed", JSON.stringify(result, null, 2));
    emit(result.ok ? 0 : 1, result, parsed.json, renderChecks(result.checks));
    return;
  }
  if (command === "init-task") {
    const created = await initTask({
      repoRoot,
      id: required(parsed, "id"),
      branch: required(parsed, "branch"),
      ...(typeof parsed.flags.get("title") === "string" ? { title: String(parsed.flags.get("title")) } : {}),
    });
    emit(0, created, parsed.json, `Created ${created.created.join(", ")}`);
    return;
  }
  if (command === "validate-task") {
    const config = await loadConfigAtSha(repoRoot, await resolveCommit(repoRoot, flagValue(parsed, "control-ref") ?? "HEAD"));
    const snapshot = await validateTask({
      repoRoot,
      taskRef: required(parsed, "task-ref"),
      taskPath: required(parsed, "task-path"),
      config,
    });
    emit(0, snapshot, parsed.json, `${snapshot.task.id} at ${snapshot.task_sha} is valid.`);
    return;
  }
  if (command === "prepare") {
    const manifest = await prepareWorkspace({
      repoRoot,
      taskRef: required(parsed, "task-ref"),
      taskPath: required(parsed, "task-path"),
      ...(flagValue(parsed, "control-ref") ? { controlRef: flagValue(parsed, "control-ref") } : {}),
      ...(flagValue(parsed, "output") ? { outputDir: path.resolve(flagValue(parsed, "output") ?? "") } : {}),
    });
    await summarize("prepare", `Run ${manifest.run_id} task ${manifest.task_id} @ ${manifest.task_sha}`);
    emit(0, manifest, parsed.json, `Prepared ${manifest.run_id} for ${manifest.task_id}.`);
    return;
  }
  if (command === "run") {
    const runDir = path.resolve(required(parsed, "prepared"));
    const harnessName = required(parsed, "harness");
    const result = await executeHarness({ runDir, harnessName, repoRoot });
    emit(result.state === "completed" ? 0 : 2, result, parsed.json, `Harness ${harnessName} finished ${result.state}.`);
    return;
  }
  if (command === "verify") {
    const report = await verifyRun(await resolveRunDir(repoRoot, parsed));
    emit(report.publishable || report.status === "VERIFYING" ? 0 : 2, report, parsed.json, `Verification ${report.status}.`);
    return;
  }
  if (command === "bundle") {
    const bundle = await createBundle(await resolveRunDir(repoRoot, parsed));
    emit(0, bundle, parsed.json, `Bundle ${bundle.outcome} publishable=${bundle.publishable}.`);
    return;
  }
  if (command === "history persist") {
    const runDir = path.resolve(required(parsed, "run-dir"));
    const config = await loadWorkingTreeConfig(repoRoot);
    const nondurable = flag(parsed, "nondurable");
    const backend = nondurable ? "nondurable" : process.env.FORGE_HISTORY_BACKEND === "s3" ? "s3" : config.workspace.history.backend;
    const store = nondurable ? undefined : await historyStore(repoRoot, backend === "s3" ? "s3" : "filesystem");
    const receipt = await persistRunEvidence({ runDir, ...(store ? { store } : {}), backend });
    emit(receipt.durable ? 0 : 2, receipt, parsed.json, `Evidence receipt durable=${receipt.durable}.`);
    return;
  }
  if (command === "publish") {
    const runDir = path.resolve(flagValue(parsed, "bundle") ?? required(parsed, "run-dir"));
    const apply = flag(parsed, "apply");
    if (flag(parsed, "dry-run") && apply) throw new ForgeError("USAGE", "Choose either --dry-run or --apply.");
    const manifest = await readManifest(runDir);
    const config = await loadWorkingTreeConfig(repoRoot);
    const github = await githubClient(
      repoRoot,
      apply && manifest.repositories.some((repository) => repository.remote.startsWith("https://github.com/")),
    );
    const store = await historyStore(repoRoot, process.env.FORGE_HISTORY_BACKEND === "s3" ? "s3" : config.workspace.history.backend);
    if (apply) await ensureDurableReceipt(runDir, store, process.env.FORGE_HISTORY_BACKEND === "s3" ? "s3" : "filesystem");
    const publication = await publishBundle({ runDir, apply, github, store });
    await summarize("publish", `${publication.status} dry_run=${publication.dry_run}`);
    emit(publication.status === "PUBLISH_FAILED" ? 2 : 0, publication, parsed.json, `Publish ${publication.status}.`);
    return;
  }
  if (command === "reconcile") {
    const since = required(parsed, "since");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(since)) throw new ForgeError("USAGE", "--since must be YYYY-MM-DD.");
    const config = await loadWorkingTreeConfig(repoRoot);
    const store = await historyStore(repoRoot, config.workspace.history.backend);
    const publications = await loadPublications(repoRoot);
    const github = new MockGitHubClient(path.join(repoRoot, ".forge-runtime", "github-mock", "prs.json"));
    const outcomes = await reconcilePublications({ publications, github, store, now: new Date() });
    emit(0, { since, outcomes }, parsed.json, `Reconciled ${outcomes.length} task outcome(s) since ${since}.`);
    return;
  }
  if (command === "retro") {
    const week = flagValue(parsed, "week") ?? previousCompletedWeek(new Date());
    const propose = flag(parsed, "propose");
    if (flag(parsed, "dry-run") && propose) throw new ForgeError("USAGE", "Choose either --dry-run or --propose.");
    const config = await loadWorkingTreeConfig(repoRoot);
    const store = await historyStore(repoRoot, config.workspace.history.backend);
    const runs = await loadSummaries(store);
    const result = await buildRetro({ weekId: week, runs, repoRoot, write: propose });
    emit(0, { week: result.week.id, metrics: result.metrics, findings: result.findings, rejected: result.rejected, wrote: result.wrote, report: result.report }, parsed.json, result.report);
    return;
  }
  if (command === "history show") {
    const runId = required(parsed, "run-id");
    const config = await loadWorkingTreeConfig(repoRoot);
    const store = await historyStore(repoRoot, config.workspace.history.backend);
    const summaries = await loadSummaries(store);
    const summary = summaries.find((item) => item.run_id === runId);
    if (!summary) throw new ForgeError("NOT_FOUND", `No run summary for ${runId}.`);
    emit(0, summary, parsed.json, JSON.stringify(summary, null, 2));
    return;
  }
  throw new ForgeError("USAGE", `No handler for ${command}.`);
}

function parseArgs(argv: string[]): ParsedArgs {
  const flags = new Map<string, string | boolean>();
  const command: string[] = [];
  let json = false;
  let help = false;
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index] ?? "";
    if (token === "--json") {
      json = true;
      continue;
    }
    if (token === "--help" || token === "-h") {
      help = true;
      continue;
    }
    if (token.startsWith("--")) {
      const body = token.slice(2);
      const equals = body.indexOf("=");
      if (equals >= 0) {
        flags.set(body.slice(0, equals), body.slice(equals + 1));
      } else {
        const next = argv[index + 1];
        if (next && !next.startsWith("--")) {
          flags.set(body, next);
          index += 1;
        } else {
          flags.set(body, true);
        }
      }
      continue;
    }
    command.push(token);
  }
  return { command, flags, json, help };
}

function flag(parsed: ParsedArgs, name: string): boolean {
  return parsed.flags.get(name) === true || parsed.flags.get(name) === "true";
}

function flagValue(parsed: ParsedArgs, name: string): string | undefined {
  const value = parsed.flags.get(name);
  return typeof value === "string" ? value : undefined;
}

function required(parsed: ParsedArgs, name: string): string {
  const value = flagValue(parsed, name);
  if (!value) throw new ForgeError("USAGE", `--${name} is required.\n${HELP[parsed.command.join(" ")] ?? ""}`);
  return value;
}

async function resolveRunDir(repoRoot: string, parsed: ParsedArgs): Promise<string> {
  const explicit = flagValue(parsed, "run-dir");
  if (explicit) return path.resolve(explicit);
  const runId = required(parsed, "run-id");
  const pointer = JSON.parse(await readFile(path.join(repoRoot, ".forge-runtime", "runs", `${runId}.json`), "utf8")) as { dir: string };
  return pointer.dir;
}

async function historyStore(repoRoot: string, backend: "filesystem" | "s3") {
  if (process.env.FORGE_HISTORY_BACKEND === "s3" || backend === "s3") {
    if (!process.env.FORGE_HISTORY_BUCKET) {
      throw new ForgeError("HISTORY_NOT_CONFIGURED", "S3 history is selected but FORGE_HISTORY_BUCKET is unset.");
    }
    return createS3HistoryStore();
  }
  return new FilesystemHistoryStore(path.join(repoRoot, ".forge-runtime", "history"));
}

async function githubClient(repoRoot: string, live: boolean) {
  if (!live) return new MockGitHubClient(path.join(repoRoot, ".forge-runtime", "github-mock", "prs.json"));
  requireLivePublishOptIn();
  return createLiveGitHubClient(await mintInstallationToken());
}

async function loadPublications(repoRoot: string): Promise<Array<{ taskId: string; publication: PublishResult }>> {
  const runsDir = path.join(repoRoot, ".forge-runtime", "runs");
  let entries: string[] = [];
  try {
    entries = await readdir(runsDir);
  } catch {
    return [];
  }
  const publications = [];
  for (const entry of entries) {
    if (!entry.endsWith(".json")) continue;
    try {
      const pointer = JSON.parse(await readFile(path.join(runsDir, entry), "utf8")) as { dir?: string };
      if (!pointer.dir) continue;
      const manifest = await readManifest(pointer.dir);
      const publication = JSON.parse(await readFile(path.join(pointer.dir, "publication.json"), "utf8")) as PublishResult;
      publications.push({ taskId: manifest.task_id, publication });
    } catch {
      continue;
    }
  }
  return publications;
}

async function loadSummaries(store: { list(prefix: string): AsyncIterable<string>; get(key: string): Promise<Buffer> }): Promise<RunSummary[]> {
  const summaries: RunSummary[] = [];
  for await (const key of store.list("runs")) {
    if (!key.endsWith("/run-summary.json")) continue;
    summaries.push(JSON.parse((await store.get(key)).toString("utf8")) as RunSummary);
  }
  return summaries;
}

function emit(exitCode: number, data: unknown, json: boolean, text: string): void {
  if (json) process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
  else process.stdout.write(`${text}\n`);
  process.exitCode = exitCode;
}

function renderChecks(checks: Array<{ name: string; ok: boolean; required: boolean; detail: string }>): string {
  return checks
    .map((check) => `${check.ok ? "ok" : "missing"}  ${check.name}${check.required ? "" : " (optional)"}: ${check.detail}`)
    .join("\n");
}

async function ensureDurableReceipt(
  runDir: string,
  store: HistoryStore,
  backend: "filesystem" | "s3",
): Promise<void> {
  let receipt: { durable?: boolean; keys?: string[] } | null = null;
  try {
    receipt = JSON.parse(await readFile(path.join(runDir, "evidence-receipt.json"), "utf8")) as {
      durable?: boolean;
      keys?: string[];
    };
  } catch {
    receipt = null;
  }
  if (!receipt?.durable) {
    await persistRunEvidence({ runDir, store, backend });
    return;
  }
  for (const key of receipt.keys ?? []) {
    if (!(await store.exists(key))) {
      throw new ForgeError(
        "PUBLISH_BLOCKED_NO_EVIDENCE",
        `Durable receipt lists ${key}, but that object is not in the history store.`,
      );
    }
  }
}

async function summarize(title: string, body: string): Promise<void> {
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (!file) return;
  await appendFile(file, `## ${title}\n\n${body}\n`);
}

main().catch((error: unknown) => {
  const payload = isForgeError(error)
    ? { ok: false, code: error.code, message: error.message, details: error.details ?? null }
    : { ok: false, code: "UNEXPECTED", message: errorMessage(error) };
  const json = process.argv.includes("--json");
  if (json) process.stderr.write(`${JSON.stringify(payload, null, 2)}\n`);
  else process.stderr.write(`${payload.code}: ${payload.message}\n`);
  process.exitCode = isForgeError(error) ? error.exitCode : 1;
});
