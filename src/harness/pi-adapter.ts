import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { assertAgentEnvironment, buildAgentEnvironment } from "../security/agent-env.js";
import { normalizePiEvents, parsePiJsonl } from "./pi-events.js";
import { materializePiAgentDir } from "./pi-settings.js";
import type { CodingHarness, EventSink, HarnessRunInput, HarnessRunResult } from "./types.js";

const MAX_STREAM_BYTES = 20_000_000;

export function buildPiArgs(input: HarnessRunInput): string[] {
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
    const args = buildPiArgs(input);
    const stdout = createWriteStream(rawEventFile);
    const stderr = createWriteStream(stderrFile);
    const exitCode = await new Promise<number | null>((resolve) => {
      const child = spawn(this.binary, args, {
        cwd: input.workingDirectory,
        env,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let bytes = 0;
      const timer = setTimeout(() => {
        child.kill("SIGTERM");
        resolve(null);
      }, input.timeoutMs);
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
        resolve(code);
      });
    });
    await finished(stdout);
    await finished(stderr);
    const raw = await readText(rawEventFile);
    const parsed = parsePiJsonl(raw);
    const normalized = normalizePiEvents({
      events: parsed.events,
      taskId: input.taskId,
      runId: input.runId,
      attempt: input.attempt,
      timestamp: new Date().toISOString(),
    });
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
        : parsed.failed || exitCode !== 0
          ? "failed"
          : "completed";
    return {
      state,
      exitCode,
      sessionFiles: [rawEventFile],
      rawEventFile,
      normalizedEventFile,
      usage: parsed.usage,
      errors: parsed.errors,
    };
  }
}

export function resolvePiBinary(repoRoot: string): string {
  return path.join(repoRoot, "node_modules", ".bin", "pi");
}

function implementPrompt(): string {
  return "Implement the task in approved repository paths. Run relevant checks. Do not commit or push.";
}

function retroPrompt(): string {
  return "Analyze the retrospective dataset. Return only schema-valid JSON findings. Do not edit files.";
}

function finished(stream: { end: (cb: () => void) => void }): Promise<void> {
  return new Promise((resolve) => {
    stream.end(() => resolve());
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
