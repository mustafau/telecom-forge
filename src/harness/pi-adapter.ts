import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { assertAgentEnvironment, buildAgentEnvironment } from "../security/agent-env.js";
import { normalizePiEvents, parsePiJsonl } from "./pi-events.js";
import {
  extractProviderRetryAfterMs,
  PROVIDER_RATE_LIMIT_CONTINUES,
} from "./provider-retry.js";
import { materializePiAgentDir } from "./pi-settings.js";
import type { CodingHarness, EventSink, HarnessRunInput, HarnessRunResult, HarnessUsage } from "./types.js";

const MAX_STREAM_BYTES = 20_000_000;

export function buildPiArgs(
  input: HarnessRunInput,
  options: { continueSession?: boolean } = {},
): string[] {
  const args = [
    "--mode",
    "json",
    "--provider",
    input.modelProvider,
    "--model",
    input.modelId,
    "--session-dir",
    input.sessionDirectory,
    "--no-extensions",
  ];
  if (input.extensionPath) {
    args.push("--extension", input.extensionPath);
  }
  args.push(
    "--no-skills",
    "--skill",
    input.trustedSkillsDirectory,
    "--no-context-files",
    "--no-mcp",
    "--append-system-prompt",
    input.trustedInstructionsPath,
    "--append-system-prompt",
    input.implementPromptPath,
  );
  if (input.mode === "retro") {
    args.push("--tools", "read,grep,find,ls");
  }
  if (options.continueSession) {
    args.push("--continue", continuePrompt(input.mode));
    return args;
  }
  args.push(`@${input.taskMarkdownPath}`, input.mode === "retro" ? retroPrompt() : implementPrompt());
  return args;
}

export class PiHarness implements CodingHarness {
  readonly name = "pi";

  constructor(private readonly binary: string) {}

  async run(input: HarnessRunInput, sink: EventSink): Promise<HarnessRunResult> {
    await mkdir(input.outputDirectory, { recursive: true });
    await mkdir(input.sessionDirectory, { recursive: true });
    const rawEventFile = path.join(input.outputDirectory, "pi-events.jsonl");
    const stderrFile = path.join(input.outputDirectory, "pi-stderr.log");
    const normalizedEventFile = path.join(input.outputDirectory, "events.normalized.jsonl");
    const agentDir = await materializePiAgentDir(path.join(input.outputDirectory, "pi-agent"));
    const env = buildAgentEnvironment({
      ...process.env,
      FORGE_RUN_ID: input.runId,
      FORGE_TASK_ID: input.taskId,
      FORGE_MODEL_PROVIDER: input.modelProvider,
      FORGE_MODEL_ID: input.modelId,
    });
    // Inject after the allowlist filter so operator ~/.pi is never used.
    env.PI_CODING_AGENT_DIR = agentDir;
    assertAgentEnvironment(env);

    const started = Date.now();
    let continues = 0;
    let combinedRaw = "";
    let combinedStderr = "";
    let usage: HarnessUsage = {};
    let exitCode: number | null = 0;
    let lastFailed = false;

    while (true) {
      const remainingMs = input.timeoutMs - (Date.now() - started);
      if (remainingMs <= 1_000) {
        exitCode = null;
        break;
      }
      const attemptIndex = continues;
      const attemptFile = path.join(input.outputDirectory, `pi-events.attempt-${attemptIndex}.jsonl`);
      const attemptStderr = path.join(input.outputDirectory, `pi-stderr.attempt-${attemptIndex}.log`);
      const args = buildPiArgs(input, { continueSession: attemptIndex > 0 });
      exitCode = await spawnPi({
        binary: this.binary,
        args,
        cwd: input.workingDirectory,
        env,
        stdoutFile: attemptFile,
        stderrFile: attemptStderr,
        timeoutMs: remainingMs,
      });
      const rawChunk = await readText(attemptFile);
      const stderrChunk = await readText(attemptStderr);
      combinedRaw = combinedRaw.length === 0 ? rawChunk : `${combinedRaw}\n${rawChunk}`;
      combinedStderr = combinedStderr.length === 0 ? stderrChunk : `${combinedStderr}\n${stderrChunk}`;
      const attemptParsed = parsePiJsonl(rawChunk);
      usage = mergeUsage(usage, attemptParsed.usage);
      lastFailed = attemptParsed.failed || (exitCode !== null && exitCode !== 0);

      if (!lastFailed || exitCode === null) break;
      if (continues >= PROVIDER_RATE_LIMIT_CONTINUES) break;
      const retryAfterMs = extractProviderRetryAfterMs(rawChunk);
      if (retryAfterMs === null) break;
      if (Date.now() - started + retryAfterMs + 1_000 >= input.timeoutMs) break;
      continues += 1;
      await appendFile(
        path.join(input.outputDirectory, "rate-limit-continues.log"),
        `continue=${continues} sleep_ms=${retryAfterMs}\n`,
      );
      await sleep(retryAfterMs);
    }

    await writeFile(rawEventFile, combinedRaw.endsWith("\n") ? combinedRaw : `${combinedRaw}\n`);
    await writeFile(stderrFile, combinedStderr);
    const parsed = parsePiJsonl(combinedRaw);
    const aggregatedUsage = {
      inputTokens: usage.inputTokens ?? parsed.usage.inputTokens,
      outputTokens: usage.outputTokens ?? parsed.usage.outputTokens,
      cachedTokens: usage.cachedTokens ?? parsed.usage.cachedTokens,
      estimatedUsd: usage.estimatedUsd ?? parsed.usage.estimatedUsd,
    };
    const normalized = normalizePiEvents({
      events: parsed.events,
      taskId: input.taskId,
      runId: input.runId,
      attempt: input.attempt,
      timestamp: new Date().toISOString(),
    });
    if (continues > 0) {
      normalized.push({
        schema_version: "1.0",
        event_id: `${input.runId}-rate-limit-continues`,
        timestamp: new Date().toISOString(),
        task_id: input.taskId,
        run_id: input.runId,
        attempt: input.attempt,
        type: "agent.model.retry",
        phase: "agent_running",
        severity: "warning",
        data: { forge_continues: continues },
      });
    }
    if (parsed.failed && !normalized.some((event) => event.type === "agent.failed")) {
      normalized.push({
        schema_version: "1.0",
        event_id: `${input.runId}-agent-failed`,
        timestamp: new Date().toISOString(),
        task_id: input.taskId,
        run_id: input.runId,
        attempt: input.attempt,
        type: "agent.failed",
        phase: "agent_running",
        severity: "error",
        data: { errors: parsed.errors },
      });
    }
    for (const event of normalized) sink.normalized(event);
    await writeFile(normalizedEventFile, normalized.map((event) => JSON.stringify(event)).join("\n") + "\n");
    const state = exitCode === null && parsed.settled === false
      ? "timed_out"
      : parsed.aborted
        ? "aborted"
        : lastFailed || parsed.failed || (exitCode !== null && exitCode !== 0)
          ? "failed"
          : "completed";
    return {
      state,
      exitCode,
      sessionFiles: [rawEventFile],
      rawEventFile,
      normalizedEventFile,
      usage: aggregatedUsage,
      errors: parsed.errors,
    };
  }
}

export function resolvePiBinary(repoRoot: string): string {
  return path.join(repoRoot, "node_modules", ".bin", "pi");
}

function implementPrompt(): string {
  return "Implement the task in approved repository paths. Prefer the fewest tool calls. Do not commit or push.";
}

function continuePrompt(mode: HarnessRunInput["mode"]): string {
  if (mode === "retro") {
    return "Continue after a provider rate limit. Finish the retrospective JSON. Do not edit files.";
  }
  return "Continue after a provider rate limit. Finish the assigned task without redoing completed work. Do not commit or push.";
}

function retroPrompt(): string {
  return "Analyze the retrospective dataset. Return only schema-valid JSON findings. Do not edit files.";
}

function mergeUsage(left: HarnessUsage, right: HarnessUsage): HarnessUsage {
  const estimated =
    left.estimatedUsd == null && right.estimatedUsd == null
      ? undefined
      : (left.estimatedUsd ?? 0) + (right.estimatedUsd ?? 0);
  return {
    inputTokens: (left.inputTokens ?? 0) + (right.inputTokens ?? 0),
    outputTokens: (left.outputTokens ?? 0) + (right.outputTokens ?? 0),
    cachedTokens: (left.cachedTokens ?? 0) + (right.cachedTokens ?? 0),
    ...(estimated === undefined ? {} : { estimatedUsd: estimated }),
  };
}

function spawnPi(options: {
  binary: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  stdoutFile: string;
  stderrFile: string;
  timeoutMs: number;
}): Promise<number | null> {
  return new Promise((resolve) => {
    const stdout = createWriteStream(options.stdoutFile);
    const stderr = createWriteStream(options.stderrFile);
    const child = spawn(options.binary, options.args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let bytes = 0;
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      resolve(null);
    }, options.timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > MAX_STREAM_BYTES) child.kill("SIGTERM");
    });
    child.stdout.pipe(stdout);
    child.stderr.pipe(stderr);
    child.on("error", () => {
      clearTimeout(timer);
      resolve(null);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      void Promise.all([finished(stdout), finished(stderr)]).then(() => resolve(code));
    });
  });
}

function finished(stream: { end: (cb: () => void) => void }): Promise<void> {
  return new Promise((resolve) => {
    stream.end(() => resolve());
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function readText(file: string): Promise<string> {
  const { readFile } = await import("node:fs/promises");
  try {
    return await readFile(file, "utf8");
  } catch {
    return "";
  }
}
