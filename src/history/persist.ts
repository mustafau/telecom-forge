import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { ForgeError } from "../lib/errors.js";
import { sha256 } from "../lib/hash.js";
import { redactSecrets } from "../security/redact.js";
import { HistoryConflictError, type HistoryStore } from "./storage.js";
import { readManifest } from "../verify/verify.js";
import type { BundleManifest } from "../patch/bundle.js";
import type { VerificationReport } from "../verify/verify.js";

export interface EvidenceReceipt {
  schema_version: "1.0";
  run_id: string;
  durable: boolean;
  backend: "filesystem" | "s3" | "nondurable";
  keys: string[];
  bundle_sha256: string | null;
  persisted_at: string;
}

export async function persistRunEvidence(options: {
  runDir: string;
  store?: HistoryStore;
  backend: "filesystem" | "s3" | "nondurable";
  now?: Date;
}): Promise<EvidenceReceipt> {
  const now = options.now ?? new Date();
  const manifest = await readManifest(options.runDir);
  const day = now.toISOString().slice(0, 10).split("-");
  const prefix = `runs/${day[0]}/${day[1]}/${day[2]}/${manifest.run_id}`;
  const keys: string[] = [];
  const put = async (name: string, content: Buffer, contentType: string) => {
    if (!options.store || options.backend === "nondurable") return;
    const key = `${prefix}/${name}`;
    try {
      await options.store.putImmutable(key, content, contentType);
    } catch (error) {
      if (!(error instanceof HistoryConflictError)) throw error;
    }
    keys.push(key);
  };
  const summary = await buildSummary(options.runDir, manifest.run_id, now);
  try {
    await put("manifest.json", Buffer.from(JSON.stringify(manifest, null, 2)), "application/json");
    const normalized = await readOptional(path.join(options.runDir, "harness", "events.normalized.jsonl"));
    if (normalized) await put("events.normalized.jsonl", Buffer.from(redactSecrets(normalized.toString("utf8")).text), "application/x-ndjson");
    const raw = await readOptional(path.join(options.runDir, "harness", "pi-events.jsonl"));
    if (raw) await put("pi-events.raw.jsonl", raw, "application/x-ndjson");
    const verification = await readOptional(path.join(options.runDir, "verification.json"));
    if (verification) await put("verification.json", verification, "application/json");
    const bundle = await readOptional(path.join(options.runDir, "bundle-manifest.json"));
    if (bundle) await put("bundle-manifest.json", bundle, "application/json");
    await put("run-summary.json", Buffer.from(JSON.stringify(summary, null, 2)), "application/json");
    const snapshotKey = `tasks/${manifest.task_id}/revisions/${manifest.task_sha}/snapshot.json`;
    if (options.store && options.backend !== "nondurable" && !(await options.store.exists(snapshotKey))) {
      await options.store.putImmutable(
        snapshotKey,
        Buffer.from(JSON.stringify({ task_sha: manifest.task_sha, task_snapshot_sha256: manifest.task_snapshot_sha256 })),
        "application/json",
      );
      keys.push(snapshotKey);
    }
  } catch (error) {
    const receipt = receiptFor(manifest.run_id, options.backend, keys, null, now, false);
    await writeFile(path.join(options.runDir, "evidence-receipt.json"), `${JSON.stringify(receipt, null, 2)}\n`);
    throw new ForgeError("HISTORY_PERSISTENCE_FAILED", `Durable history write failed: ${(error as Error).message}`, {
      cause: error,
    });
  }
  const bundleSha = summary.artifact_manifest_sha256;
  const durable = options.backend !== "nondurable" && Boolean(options.store);
  const receipt = receiptFor(manifest.run_id, options.backend, keys, bundleSha, now, durable);
  await writeFile(path.join(options.runDir, "evidence-receipt.json"), `${JSON.stringify(receipt, null, 2)}\n`);
  if (options.store && durable) {
    const stored = await options.store.get(`${prefix}/run-summary.json`);
    if (sha256(stored) !== sha256(Buffer.from(JSON.stringify(summary, null, 2)))) {
      throw new ForgeError("HISTORY_PERSISTENCE_FAILED", "Stored run summary checksum did not match.");
    }
  }
  return receipt;
}

function receiptFor(
  runId: string,
  backend: EvidenceReceipt["backend"],
  keys: string[],
  bundleSha: string | null,
  now: Date,
  durable: boolean,
): EvidenceReceipt {
  return {
    schema_version: "1.0",
    run_id: runId,
    durable,
    backend,
    keys,
    bundle_sha256: bundleSha,
    persisted_at: now.toISOString(),
  };
}

async function buildSummary(runDir: string, runId: string, now: Date) {
  const manifest = await readManifest(runDir);
  const verification = JSON.parse(await readFile(path.join(runDir, "verification.json"), "utf8")) as VerificationReport;
  const bundleText = await readOptional(path.join(runDir, "bundle-manifest.json"));
  const bundle = bundleText ? (JSON.parse(bundleText.toString("utf8")) as BundleManifest) : null;
  const harness = JSON.parse(await readFile(path.join(runDir, "harness-result.json"), "utf8")) as {
    state: string;
    usage?: { inputTokens?: number; outputTokens?: number; cachedTokens?: number; estimatedUsd?: number | null };
  };
  const status = bundle?.outcome === "NO_CHANGE" ? "NO_CHANGE" : verification.status === "VERIFYING" ? "BUNDLING" : verification.status;
  return {
    schema_version: "1.0",
    task_id: manifest.task_id,
    task_sha: manifest.task_sha,
    run_id: runId,
    attempt: manifest.attempt,
    control_sha: manifest.control_sha,
    skills_sha: manifest.skills_sha,
    harness: { name: manifest.harness.adapter, version: "pinned", provider: null, model: null },
    started_at: manifest.prepared_at,
    finished_at: now.toISOString(),
    status,
    source_revisions: manifest.repositories.map((repository) => ({
      repository: repository.alias,
      base_sha: repository.base_sha,
      result_sha: null,
      pull_request_url: null,
    })),
    metrics: {
      wall_time_seconds: Math.max(0, Math.round((now.getTime() - Date.parse(manifest.prepared_at)) / 1000)),
      agent_duration_seconds: null,
      test_duration_seconds: Math.round(verification.checks.reduce((sum, check) => sum + check.duration_ms, 0) / 1000),
      tool_calls: null,
      failed_tool_calls: null,
      test_failures_observed: verification.checks.filter((check) => check.status === "failed").length,
      input_tokens: harness.usage?.inputTokens ?? null,
      output_tokens: harness.usage?.outputTokens ?? null,
      estimated_cost_usd: harness.usage?.estimatedUsd ?? null,
    },
    verification: {
      status: verification.checks.every((check) => check.status === "passed") && verification.failure_category === null ? "PASSED" : "FAILED",
      checks: verification.checks.map((check) => check.id),
    },
    failure_category: verification.failure_category,
    failure_details: verification.failure_details,
    artifact_manifest_sha256: bundle?.bundle_sha256 ?? null,
    evidence_links: [],
  };
}

async function readOptional(file: string): Promise<Buffer | null> {
  try {
    return await readFile(file);
  } catch {
    return null;
  }
}
