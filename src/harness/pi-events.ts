import { deterministicUuid } from "../lib/ids.js";
import type { HarnessUsage, NormalizedEvent } from "./types.js";

export interface PiParseResult {
  events: PiRecord[];
  truncated: boolean;
  settled: boolean;
  aborted: boolean;
  failed: boolean;
  errors: string[];
  usage: Required<Pick<HarnessUsage, "inputTokens" | "outputTokens" | "cachedTokens">> & {
    estimatedUsd: number | null;
  };
}

export type PiRecord = Record<string, unknown> & { type?: string };

export function parsePiJsonl(text: string): PiParseResult {
  const events: PiRecord[] = [];
  const errors: string[] = [];
  let truncated = false;
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (normalized.length > 0 && !normalized.endsWith("\n")) {
    const tail = normalized.slice(normalized.lastIndexOf("\n") + 1);
    if (!isCompleteJson(tail)) truncated = true;
  }
  const lines = normalized.split("\n");
  if (normalized.endsWith("\n")) lines.pop();
  for (const line of lines) {
    if (line.length === 0) continue;
    if (!isCompleteJson(line)) {
      truncated = true;
      errors.push("Truncated JSONL record.");
      break;
    }
    const value = JSON.parse(line) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      errors.push("JSONL record was not an object.");
      truncated = true;
      break;
    }
    events.push(value as PiRecord);
  }

  const settled = events.filter((event) => event.type === "agent_settled");
  const settledEvent = settled.at(-1);
  const aborted = settledEvent?.aborted === true;
  const assistantEnds = events.filter(
    (event) => event.type === "message_end" && messageRole(event) === "assistant",
  );
  const lastAssistant = assistantEnds.at(-1);
  const stopReason = lastAssistant ? stringField(messageOf(lastAssistant), "stopReason") : undefined;
  const assistantError = lastAssistant ? messageOf(lastAssistant).error ?? messageOf(lastAssistant).errorMessage : undefined;
  const failedStop = stopReason === "error" || stopReason === "aborted";
  const failed =
    truncated ||
    settled.length === 0 ||
    aborted ||
    failedStop ||
    (typeof assistantError === "string" && assistantError.length > 0) ||
    events.some((event) => event.type === "auto_retry_end" && event.success === false && settled.length === 0);

  if (truncated) errors.push("Pi event stream is incomplete.");
  if (settled.length === 0) errors.push("Pi stream is missing agent_settled.");
  if (aborted) errors.push("Pi reported agent_settled aborted=true.");
  if (failedStop || (typeof assistantError === "string" && assistantError.length > 0)) {
    errors.push(`Final assistant turn failed (${stopReason ?? "error"}).`);
  }

  return {
    events,
    truncated,
    settled: settled.length > 0,
    aborted,
    failed,
    errors,
    usage: usageFromCompletedMessages(events),
  };
}

export function usageFromCompletedMessages(events: PiRecord[]): PiParseResult["usage"] {
  let inputTokens = 0;
  let outputTokens = 0;
  let cachedTokens = 0;
  let estimatedUsd: number | null = null;
  let sawCost = false;
  for (const event of events) {
    if (event.type !== "message_end") continue;
    if (messageRole(event) !== "assistant") continue;
    const usage = messageOf(event).usage;
    if (!usage || typeof usage !== "object") continue;
    const record = usage as Record<string, unknown>;
    inputTokens += numberField(record, "input") ?? numberField(record, "inputTokens") ?? 0;
    outputTokens += numberField(record, "output") ?? numberField(record, "outputTokens") ?? 0;
    cachedTokens += numberField(record, "cacheRead") ?? numberField(record, "cachedTokens") ?? 0;
    const cost = record.cost;
    if (cost && typeof cost === "object") {
      const total = numberField(cost as Record<string, unknown>, "total");
      if (total !== undefined) {
        sawCost = true;
        estimatedUsd = (estimatedUsd ?? 0) + total;
      }
    }
  }
  return {
    inputTokens,
    outputTokens,
    cachedTokens,
    estimatedUsd: sawCost ? estimatedUsd : null,
  };
}

export function normalizePiEvents(options: {
  events: PiRecord[];
  taskId: string;
  runId: string;
  attempt: number;
  timestamp: string;
}): NormalizedEvent[] {
  const normalized: NormalizedEvent[] = [];
  options.events.forEach((event, index) => {
    const mapped = mapPiEvent(event);
    if (!mapped) return;
    normalized.push({
      schema_version: "1.0",
      event_id: deterministicUuid(`${options.runId}|${index}|${event.type ?? ""}|${mapped.type}`),
      timestamp: options.timestamp,
      task_id: options.taskId,
      run_id: options.runId,
      attempt: options.attempt,
      type: mapped.type,
      phase: "agent_running",
      severity: mapped.severity,
      data: mapped.data,
    });
  });
  return normalized;
}

export function commandCategory(command: string): string {
  const value = command.toLowerCase();
  if (value.startsWith("git ") || value === "git") return "git";
  if (/\b(test|pytest|jest|vitest)\b/.test(value)) return "test";
  if (/\b(pnpm|npm|yarn|gradle|mvn|cargo|make|build)\b/.test(value)) return "build";
  if (/\b(grep|rg|find|ls|cat|sed)\b/.test(value)) return "search";
  return "other";
}

function mapPiEvent(event: PiRecord): { type: string; severity: NormalizedEvent["severity"]; data: Record<string, unknown> } | null {
  switch (event.type) {
    case "agent_start":
      return { type: "agent.started", severity: "info", data: {} };
    case "turn_end":
      return { type: "agent.turn.completed", severity: "info", data: {} };
    case "tool_execution_start":
      return {
        type: "agent.tool.started",
        severity: "info",
        data: { tool_name: event.toolName ?? "unknown", command_category: toolCategory(event) },
      };
    case "tool_execution_end":
      return {
        type: "agent.tool.completed",
        severity: event.isError === true ? "error" : "info",
        data: {
          tool_name: event.toolName ?? "unknown",
          duration_ms: typeof event.durationMs === "number" ? event.durationMs : undefined,
          is_error: event.isError === true,
          command_category: toolCategory(event),
        },
      };
    case "auto_retry_start":
      return { type: "agent.model.retry", severity: "warning", data: { attempt: event.attempt ?? null } };
    case "compaction_end":
      return { type: "agent.context.compacted", severity: "info", data: { reason: event.reason ?? null } };
    case "agent_settled":
      return event.aborted === true
        ? { type: "agent.aborted", severity: "error", data: {} }
        : { type: "agent.completed", severity: "info", data: {} };
    default:
      return null;
  }
}

function toolCategory(event: PiRecord): string {
  const tool = String(event.toolName ?? "");
  if (tool === "bash") {
    const args = event.args;
    if (args && typeof args === "object" && typeof (args as { command?: unknown }).command === "string") {
      return commandCategory((args as { command: string }).command);
    }
    return "other";
  }
  if (tool === "write" || tool === "edit") return "file_edit";
  if (tool === "read" || tool === "grep" || tool === "find" || tool === "ls") return "search";
  return "other";
}

function messageOf(event: PiRecord): Record<string, unknown> {
  const message = event.message;
  return message && typeof message === "object" ? (message as Record<string, unknown>) : {};
}

function messageRole(event: PiRecord): string | undefined {
  const role = messageOf(event).role;
  return typeof role === "string" ? role : undefined;
}

function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}

function numberField(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function isCompleteJson(line: string): boolean {
  try {
    JSON.parse(line);
    return true;
  } catch {
    return false;
  }
}
