import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { ForgeError } from "../lib/errors.js";
import { normalizePiEvents, parsePiJsonl } from "./pi-events.js";
import type { CodingHarness, EventSink, HarnessRunInput, HarnessRunResult } from "./types.js";

const PlanSchema = z
  .object({
    edits: z
      .array(
        z
          .object({
            path: z.string().min(1),
            content: z.string().optional(),
            delete: z.boolean().optional(),
          })
          .strict(),
      )
      .default([]),
    final_state: z.enum(["completed", "failed", "aborted", "timed_out"]).default("completed"),
    exit_code: z.number().int().nullable().default(0),
    settle_aborted: z.boolean().default(false),
    assistant_stop_reason: z.string().default("stop"),
    assistant_error: z.string().optional(),
    omit_settled: z.boolean().default(false),
    truncated: z.boolean().default(false),
    usage: z
      .object({
        input: z.number().nonnegative().default(12),
        output: z.number().nonnegative().default(4),
        cacheRead: z.number().nonnegative().default(0),
        costTotal: z.number().nullable().default(null),
      })
      .default({ input: 12, output: 4, cacheRead: 0, costTotal: null }),
  })
  .strict();

export type FakeHarnessPlan = z.infer<typeof PlanSchema>;

export class FakeHarness implements CodingHarness {
  readonly name = "fake";

  constructor(private readonly plan: FakeHarnessPlan) {}

  async run(input: HarnessRunInput, sink: EventSink): Promise<HarnessRunResult> {
    await mkdir(input.outputDirectory, { recursive: true });
    await mkdir(input.sessionDirectory, { recursive: true });
    for (const edit of this.plan.edits) {
      const destination = path.resolve(input.workingDirectory, edit.path);
      if (edit.delete) {
        const { rm } = await import("node:fs/promises");
        await rm(destination, { force: true });
      } else {
        await mkdir(path.dirname(destination), { recursive: true });
        await writeFile(destination, edit.content ?? "", "utf8");
      }
    }
    const usage = this.plan.usage;
    const cost =
      usage.costTotal === null
        ? undefined
        : { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: usage.costTotal };
    const records: unknown[] = [
      { type: "agent_start" },
      { type: "turn_start" },
      {
        type: "message_update",
        usage: { input: usage.input, output: 1, cacheRead: usage.cacheRead, totalTokens: usage.input + 1 },
      },
      {
        type: "message_end",
        message: {
          role: "assistant",
          stopReason: this.plan.assistant_stop_reason,
          error: this.plan.assistant_error,
          usage: {
            input: usage.input,
            output: usage.output,
            cacheRead: usage.cacheRead,
            ...(cost ? { cost } : {}),
          },
        },
      },
      { type: "turn_end", message: { role: "assistant" }, toolResults: [] },
      { type: "agent_end", willRetry: false },
    ];
    if (!this.plan.omit_settled) {
      records.push({ type: "agent_settled", aborted: this.plan.settle_aborted });
    }
    let raw = records.map((record) => JSON.stringify(record)).join("\n") + "\n";
    if (this.plan.truncated) raw += "{\"type\":\"agent_set";
    const rawEventFile = path.join(input.outputDirectory, "pi-events.jsonl");
    const normalizedEventFile = path.join(input.outputDirectory, "events.normalized.jsonl");
    await writeFile(rawEventFile, raw, "utf8");
    const parsed = parsePiJsonl(raw);
    const normalized = normalizePiEvents({
      events: parsed.events,
      taskId: input.taskId,
      runId: input.runId,
      attempt: input.attempt,
      timestamp: new Date().toISOString(),
    });
    for (const event of normalized) sink.normalized(event);
    await writeFile(
      normalizedEventFile,
      normalized.map((event) => JSON.stringify(event)).join("\n") + (normalized.length ? "\n" : ""),
    );
    const state =
      this.plan.final_state === "timed_out"
        ? "timed_out"
        : parsed.aborted
          ? "aborted"
          : parsed.failed
            ? "failed"
            : "completed";
    return {
      state,
      exitCode: this.plan.exit_code,
      sessionFiles: [rawEventFile],
      rawEventFile,
      normalizedEventFile,
      usage: parsed.usage,
      errors: parsed.errors,
    };
  }
}

export async function loadFakePlan(env: NodeJS.ProcessEnv = process.env): Promise<FakeHarnessPlan> {
  const file = env.FORGE_FAKE_HARNESS_PLAN;
  if (!file) return PlanSchema.parse({});
  const parsed = PlanSchema.safeParse(JSON.parse(await readFile(file, "utf8")));
  if (!parsed.success) {
    throw new ForgeError("INVALID_FAKE_PLAN", "FORGE_FAKE_HARNESS_PLAN is not a valid fake harness plan.");
  }
  return parsed.data;
}
