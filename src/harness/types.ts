export interface EventSink {
  normalized(event: NormalizedEvent): void;
}

export interface NormalizedEvent {
  schema_version: "1.0";
  event_id: string;
  timestamp: string;
  task_id: string;
  run_id: string;
  attempt: number;
  type: string;
  phase: string;
  repository?: string;
  severity: "info" | "warning" | "error";
  data: Record<string, unknown>;
}

export interface HarnessRunInput {
  runId: string;
  taskId: string;
  attempt: number;
  workingDirectory: string;
  taskMarkdownPath: string;
  trustedInstructionsPath: string;
  implementPromptPath: string;
  trustedSkillsDirectory: string;
  sessionDirectory: string;
  outputDirectory: string;
  modelProvider: string;
  modelId: string;
  timeoutMs: number;
  mode: "implement" | "retro";
  extensionPath?: string;
}

export interface HarnessUsage {
  inputTokens?: number;
  outputTokens?: number;
  cachedTokens?: number;
  estimatedUsd?: number | null;
}

export interface HarnessRunResult {
  state: "completed" | "failed" | "aborted" | "timed_out";
  exitCode: number | null;
  sessionFiles: string[];
  rawEventFile: string;
  normalizedEventFile: string;
  usage: HarnessUsage;
  errors: string[];
}

export interface CodingHarness {
  readonly name: string;
  run(input: HarnessRunInput, sink: EventSink): Promise<HarnessRunResult>;
}
