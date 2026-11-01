import { describe, expect, it } from "vitest";
import { parseYaml } from "../../src/lib/yaml.js";
import { assertSafeRelativePath } from "../../src/lib/paths.js";
import { ForgeError } from "../../src/lib/errors.js";
import { parsePiJsonl, usageFromCompletedMessages } from "../../src/harness/pi-events.js";
import { assertRunTransition, assertTaskTransition } from "../../src/tasks/states.js";
import { assertPatchText } from "../../src/patch/scan.js";
import { withRetry, RateLimitError } from "../../src/lib/retry.js";
import { parseWeek, percentile, previousCompletedWeek } from "../../src/metrics/week.js";
import { computeMetrics, type RunSummary } from "../../src/metrics/compute.js";
import { validateFindings } from "../../src/retrospective/analyze.js";
import { redactSecrets } from "../../src/security/redact.js";
import { buildAgentEnvironment, assertAgentEnvironment } from "../../src/security/agent-env.js";
import { materializePiAgentDir, PI_FREE_TIER_RETRY_SETTINGS } from "../../src/harness/pi-settings.js";
import { extractProviderRetryAfterMs } from "../../src/harness/provider-retry.js";
import { buildPiArgs } from "../../src/harness/pi-adapter.js";
import { FilesystemHistoryStore } from "../../src/history/filesystem-store.js";
import { HistoryConflictError } from "../../src/history/storage.js";
import { S3HistoryStore, type ObjectClient } from "../../src/history/s3-store.js";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadWorkingTreeConfig } from "../../src/config/load.js";
import { TaskFileSchema } from "../../src/tasks/schema.js";
import Ajv from "ajv";

describe("catalog and task schemas", () => {
  it("accepts the committed catalog and sample task", async () => {
    const config = await loadWorkingTreeConfig(path.resolve("."));
    expect(config.workspace.repositories["telecom-api-sandbox"]?.access).toBe("read-write");
    expect(config.workspace.repositories["shared-contracts"]?.access).toBe("read-only");
    const task = TaskFileSchema.parse(parseYaml(await readFile("tasks/TF-0001/task.yaml", "utf8"), "task"));
    expect(task.id).toBe("TF-0001");
    const ajv = new Ajv({ allErrors: true, strict: false, validateSchema: false });
    const schema = JSON.parse(await readFile("schemas/task.schema.json", "utf8")) as {
      $schema?: string;
    };
    delete schema.$schema;
    const validate = ajv.compile(schema);
    expect(validate(task)).toBe(true);
  });

  it("rejects traversal, duplicate keys, and unknown repositories later at validation", () => {
    expect(() => assertSafeRelativePath("../secret")).toThrow(ForgeError);
    expect(() => assertSafeRelativePath("/tmp/repo")).toThrow(ForgeError);
    expect(() => parseYaml("a: 1\na: 2\n", "duplicate")).toThrow(/duplicate/i);
  });
});

describe("Pi JSONL", () => {
  it("keeps unicode line separators inside a record and counts message_end usage once", () => {
    const stream = [
      JSON.stringify({ type: "agent_start" }),
      JSON.stringify({
        type: "message_update",
        usage: { input: 100, output: 1, cacheRead: 0, cost: { total: 1 } },
      }),
      JSON.stringify({
        type: "message_end",
        message: {
          role: "assistant",
          stopReason: "stop",
          content: "line\u2028sep",
          usage: { input: 100, output: 20, cacheRead: 5, cost: { total: 0.25 } },
        },
      }),
      JSON.stringify({
        type: "message_end",
        message: { role: "assistant", stopReason: "stop", usage: { input: 10, output: 2, cacheRead: 1 } },
      }),
      JSON.stringify({ type: "agent_settled", aborted: false }),
      "",
    ].join("\n");
    const parsed = parsePiJsonl(stream);
    expect(parsed.truncated).toBe(false);
    expect(parsed.failed).toBe(false);
    expect(parsed.usage).toEqual({ inputTokens: 110, outputTokens: 22, cachedTokens: 6, estimatedUsd: 0.25 });
    expect(usageFromCompletedMessages(parsed.events).inputTokens).toBe(110);
  });

  it("classifies a truncated stream and an exit-zero error turn as failed", () => {
    const truncated = parsePiJsonl('{"type":"agent_start"}\n{"type":"agent_set');
    expect(truncated.truncated).toBe(true);
    expect(truncated.failed).toBe(true);
    const errored = parsePiJsonl(
      `${JSON.stringify({
        type: "message_end",
        message: { role: "assistant", stopReason: "error", usage: { input: 1, output: 1, cacheRead: 0 } },
      })}\n${JSON.stringify({ type: "agent_settled", aborted: false })}\n`,
    );
    expect(errored.failed).toBe(true);
    expect(errored.usage.estimatedUsd).toBeNull();
    const aborted = parsePiJsonl(`${JSON.stringify({ type: "agent_settled", aborted: true })}\n`);
    expect(aborted.aborted).toBe(true);
  });
});

describe("state, patches, retry, and weeks", () => {
  it("rejects illegal transitions and protected patch paths", () => {
    expect(() => assertRunTransition("PUBLISHED", "AGENT_RUNNING")).toThrow(/Illegal/);
    expect(() => assertTaskTransition("DEFINED", "READY")).not.toThrow();
    expect(() => assertPatchText("diff --git a/../x b/../x\n", 1000)).toThrow(ForgeError);
    expect(() =>
      assertPatchText("diff --git a/.github/workflows/x.yml b/.github/workflows/x.yml\n", 1000),
    ).toThrow(/workflow/);
    expect(() => assertPatchText("diff --git a/.git/hooks/pre-commit b/.git/hooks/pre-commit\nnew file mode 100755\n", 1000)).toThrow(
      ForgeError,
    );
  });

  it("retries rate limits and computes Pacific weeks across DST", async () => {
    let calls = 0;
    const value = await withRetry(
      async () => {
        calls += 1;
        if (calls < 3) throw new RateLimitError("slow");
        return "ok";
      },
      { attempts: 3, baseDelayMs: 1, maxDelayMs: 2, retryOn: (error) => error instanceof RateLimitError, sleep: async () => {} },
    );
    expect(value).toBe("ok");
    const spring = parseWeek("2026-W10");
    expect(spring.end.getTime() - spring.start.getTime()).toBe(167 * 60 * 60 * 1000);
    const fall = parseWeek("2026-W44");
    expect(fall.end.getTime() - fall.start.getTime()).toBe(169 * 60 * 60 * 1000);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 50)).toBe(5);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 90)).toBe(9);
    expect(previousCompletedWeek(new Date("2026-10-27T15:00:00Z"))).toMatch(/^2026-W/);
  });
});

describe("metrics and proposals", () => {
  it("uses denominators and rejects unknown evidence", () => {
    const runs: RunSummary[] = [
      summary("r1", "TF-1", "PUBLISHED", null, 10),
      summary("r2", "TF-2", "VERIFICATION_FAILED", "ACTUAL_TEST_FAILURE", 30),
      summary("r3", "TF-2", "AGENT_FAILED", "MODEL_OR_PROVIDER_FAILURE", null),
    ];
    const metrics = computeMetrics(runs, [
      { ready_at: "2026-10-20T00:00:00Z", first_human_review_at: "2026-10-20T01:00:00Z", changes_requested: true, reviewed: true, merged: false, final: false },
      { ready_at: "2026-10-20T00:00:00Z", first_human_review_at: null, changes_requested: false, reviewed: false, merged: true, final: true },
    ]);
    expect(metrics.tasks_attempted).toBe(2);
    expect(metrics.verification_pass_rate.denominator).toBeGreaterThan(0);
    expect(metrics.merge_rate.final).toBe(1);
    expect(metrics.estimated_cost_per_task.value).toBeNull();
    const bad = validateFindings(
      [
        {
          id: "retro-2026-W44-01",
          category: "MISSING_OR_STALE_CONTEXT",
          title: "Missing contract path",
          observation: "Runs looked in the wrong directory.",
          evidence: ["missing-run"],
          confidence: "low",
          hypothesis: "The skill does not name the directory.",
          proposal: null,
          verification: { metric: "context_related_incidents", lookback_weeks: 4, success_criterion: "Fewer misses on similar tasks." },
        },
      ],
      new Set(["r1"]),
    );
    expect(bad.accepted).toHaveLength(0);
    expect(bad.rejected[0]?.reason).toMatch(/Unsupported/);
  });
});

describe("redaction, agent env, and history", () => {
  it("redacts test tokens and strips GitHub write variables", () => {
    const redacted = redactSecrets("token FORGE_TEST_SECRET_abc and ghp_abcdefghijklmnopqrstuvwxyz");
    expect(redacted.text).not.toContain("ghp_");
    expect(redacted.text).not.toContain("FORGE_TEST_SECRET_abc");
    const env = buildAgentEnvironment({ PATH: "/usr/bin", GITHUB_TOKEN: "ghp_abcdefghijklmnopqrstuvwxyz", OPENAI_API_KEY: "present" });
    expect(env.GITHUB_TOKEN).toBeUndefined();
    expect(env.OPENAI_API_KEY).toBe("present");
    expect(env.PI_CODING_AGENT_DIR).toBeUndefined();
    expect(() => assertAgentEnvironment({ GITHUB_TOKEN: "value" })).toThrow(/forbidden/);
  });

  it("materializes Pi settings with free-tier-sized retry delays", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "forge-pi-agent-"));
    const agentDir = await materializePiAgentDir(path.join(root, "pi-agent"));
    const settings = JSON.parse(await readFile(path.join(agentDir, "settings.json"), "utf8"));
    expect(settings).toEqual(PI_FREE_TIER_RETRY_SETTINGS);
    expect(settings.retry.maxAgentDelayMs).toBe(60_000);
    expect(settings.retry.provider.maxRetries).toBe(3);
    expect(settings.retry.provider.maxRetryDelayMs).toBe(60_000);
    expect(settings.retry.maxRetries).toBe(5);
    expect(settings.cacheWarming).toBe("off");
    expect(settings.defaultThinkingLevel).toBe("minimal");
  });

  it("extracts short Gemini retry-after hints and ignores multi-hour quotas", () => {
    const rpm = JSON.stringify({
      type: "message_end",
      message: {
        stopReason: "error",
        errorMessage: 'code":429,"message":"Please retry in 8.9s. Quota exceeded for generate_content_free_tier_requests"',
      },
    });
    expect(extractProviderRetryAfterMs(`${rpm}\n`)).toBe(8900);
    const hours = JSON.stringify({
      type: "message_end",
      message: {
        stopReason: "error",
        errorMessage: 'code":429, retryDelay": "18346s", "status": "RESOURCE_EXHAUSTED"',
      },
    });
    expect(extractProviderRetryAfterMs(`${hours}\n`)).toBeNull();
    const continueArgs = buildPiArgs(
      {
        runId: "local-1",
        taskId: "TF-0002",
        attempt: 1,
        workingDirectory: ".",
        taskMarkdownPath: "task/task.md",
        trustedInstructionsPath: "control/AGENTS.md",
        implementPromptPath: "control/prompts/implement.md",
        trustedSkillsDirectory: "control/.agents/skills",
        sessionDirectory: "sessions",
        outputDirectory: "out",
        modelProvider: "google",
        modelId: "gemini-3.5-flash-lite",
        timeoutMs: 1000,
        mode: "implement",
      },
      { continueSession: true },
    );
    expect(continueArgs).toContain("--continue");
    expect(continueArgs.some((arg) => arg.includes("@task/"))).toBe(false);
  });

  it("stores immutable objects and compare-and-swap snapshots", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "forge-history-"));
    const store = new FilesystemHistoryStore(root);
    await store.putImmutable("runs/2026/10/26/local-1/run-summary.json", Buffer.from("one"), "application/json");
    await expect(store.putImmutable("runs/2026/10/26/local-1/run-summary.json", Buffer.from("two"), "application/json")).rejects.toBeInstanceOf(
      HistoryConflictError,
    );
    const again = new FilesystemHistoryStore(root);
    expect((await again.get("runs/2026/10/26/local-1/run-summary.json")).toString()).toBe("one");
    const version = await store.putMutableSnapshot("outcomes/tasks/TF-0001/current.json", Buffer.from("v1"));
    await expect(store.putMutableSnapshot("outcomes/tasks/TF-0001/current.json", Buffer.from("v2"))).rejects.toBeInstanceOf(
      HistoryConflictError,
    );
    const next = await store.putMutableSnapshot("outcomes/tasks/TF-0001/current.json", Buffer.from("v2"), version);
    expect((await store.get("outcomes/tasks/TF-0001/current.json")).toString()).toBe("v2");
    expect(next).not.toBe(version);
  });

  it("rejects S3 overwrites through the object client", async () => {
    const objects = new Map<string, { body: Buffer; metadata: Record<string, string> }>();
    const client: ObjectClient = {
      async put(input) {
        const current = objects.get(input.key);
        if (input.ifNoneMatch === "*" && current) {
          const error = new Error("exists");
          error.name = "PreconditionFailed";
          throw error;
        }
        if (input.ifMatch && current && input.ifMatch !== current.metadata.etag) {
          const error = new Error("conflict");
          error.name = "PreconditionFailed";
          throw error;
        }
        objects.set(input.key, { body: input.body, metadata: { ...input.metadata, etag: "etag-1" } });
        return { etag: "etag-1" };
      },
      async get(key) {
        const found = objects.get(key);
        if (!found) throw new Error("missing");
        return found;
      },
      async head(key) {
        const found = objects.get(key);
        return found ? { etag: found.metadata.etag ?? "", metadata: found.metadata } : null;
      },
      async *list() {
        yield* objects.keys();
      },
    };
    const store = new S3HistoryStore(client, "telecom-forge/v1");
    await store.putImmutable("runs/a/run-summary.json", Buffer.from("body"), "application/json");
    await expect(store.putImmutable("runs/a/run-summary.json", Buffer.from("body"), "application/json")).rejects.toBeInstanceOf(
      HistoryConflictError,
    );
    expect((await store.get("runs/a/run-summary.json")).toString()).toBe("body");
  });
});

function summary(runId: string, taskId: string, status: string, failure: RunSummary["failure_category"], tokens: number | null): RunSummary {
  return {
    schema_version: "1.0",
    task_id: taskId,
    task_sha: "a".repeat(40),
    run_id: runId,
    attempt: 1,
    control_sha: "b".repeat(40),
    skills_sha: "b".repeat(40),
    started_at: "2026-10-20T00:00:00Z",
    finished_at: "2026-10-20T01:00:00Z",
    status,
    failure_category: failure,
    metrics: {
      wall_time_seconds: 10,
      agent_duration_seconds: tokens,
      test_duration_seconds: status === "AGENT_FAILED" ? null : 5,
      input_tokens: tokens,
      output_tokens: tokens,
      estimated_cost_usd: null,
    },
    source_revisions: [],
  };
}
