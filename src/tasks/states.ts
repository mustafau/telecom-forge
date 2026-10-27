export const BOTTLENECKS = [
  "MISSING_OR_STALE_CONTEXT",
  "REPOSITORY_DISCOVERY",
  "ARCHITECTURE_AMBIGUITY",
  "CROSS_REPOSITORY_DEPENDENCY",
  "BUILD_CONFIGURATION",
  "FLAKY_TEST",
  "ACTUAL_TEST_FAILURE",
  "MODEL_OR_PROVIDER_FAILURE",
  "TOOLING_OR_HARNESS_FAILURE",
  "RESOURCE_OR_TIMEOUT",
  "GITHUB_AUTH_OR_PERMISSIONS",
  "PUBLISH_CONFLICT",
  "REVIEW_REWORK",
  "TASK_SPEC_AMBIGUITY",
  "SECURITY_POLICY_BLOCK",
  "UNKNOWN",
] as const;

export type Bottleneck = (typeof BOTTLENECKS)[number];

export const RUN_STATUSES = [
  "CREATED",
  "VALIDATING",
  "PREPARING",
  "AGENT_RUNNING",
  "VERIFYING",
  "BUNDLING",
  "PUBLISHING",
  "PUBLISHED",
  "NO_CHANGE",
  "VALIDATION_FAILED",
  "AGENT_FAILED",
  "VERIFICATION_FAILED",
  "PUBLISH_FAILED",
  "PARTIAL_PUBLISH",
  "CANCELLED",
  "TIMED_OUT",
  "BLOCKED_STALE_BASE",
  "HISTORY_PERSISTENCE_FAILED",
] as const;

export type RunStatus = (typeof RUN_STATUSES)[number];

export const TASK_STATES = [
  "DEFINED",
  "READY",
  "RUNNING",
  "REVIEW_PENDING",
  "ACCEPTED",
  "REJECTED",
  "ABANDONED",
] as const;

export type TaskState = (typeof TASK_STATES)[number];

export const PR_STATES = [
  "DRAFT",
  "OPEN",
  "CHANGES_REQUESTED",
  "APPROVED",
  "MERGED",
  "CLOSED_UNMERGED",
] as const;

export type PrState = (typeof PR_STATES)[number];

export const IMPROVEMENT_STATES = [
  "PROPOSED",
  "TRIAGED",
  "APPROVED",
  "IMPLEMENTED",
  "MEASURING",
  "EFFECTIVE",
  "INEFFECTIVE",
  "INCONCLUSIVE",
  "REJECTED",
  "SUPERSEDED",
] as const;

export type ImprovementState = (typeof IMPROVEMENT_STATES)[number];

const RUN_TRANSITIONS: Record<RunStatus, readonly RunStatus[]> = {
  CREATED: ["VALIDATING", "CANCELLED"],
  VALIDATING: ["PREPARING", "VALIDATION_FAILED", "CANCELLED"],
  PREPARING: ["AGENT_RUNNING", "VALIDATION_FAILED", "CANCELLED"],
  AGENT_RUNNING: ["VERIFYING", "AGENT_FAILED", "TIMED_OUT", "CANCELLED"],
  VERIFYING: ["BUNDLING", "VERIFICATION_FAILED", "AGENT_FAILED", "CANCELLED"],
  BUNDLING: ["PUBLISHING", "NO_CHANGE", "VERIFICATION_FAILED", "CANCELLED"],
  PUBLISHING: ["PUBLISHED", "PARTIAL_PUBLISH", "PUBLISH_FAILED", "BLOCKED_STALE_BASE", "CANCELLED"],
  PUBLISHED: [],
  NO_CHANGE: [],
  VALIDATION_FAILED: [],
  AGENT_FAILED: [],
  VERIFICATION_FAILED: [],
  PUBLISH_FAILED: [],
  PARTIAL_PUBLISH: ["PUBLISHING"],
  CANCELLED: [],
  TIMED_OUT: [],
  BLOCKED_STALE_BASE: ["PUBLISHING"],
  HISTORY_PERSISTENCE_FAILED: [],
};

const TASK_TRANSITIONS: Record<TaskState, readonly TaskState[]> = {
  DEFINED: ["READY", "ABANDONED"],
  READY: ["RUNNING", "ABANDONED"],
  RUNNING: ["REVIEW_PENDING", "ABANDONED"],
  REVIEW_PENDING: ["ACCEPTED", "REJECTED", "ABANDONED", "RUNNING"],
  ACCEPTED: [],
  REJECTED: [],
  ABANDONED: [],
};

const IMPROVEMENT_TRANSITIONS: Record<ImprovementState, readonly ImprovementState[]> = {
  PROPOSED: ["TRIAGED", "REJECTED", "SUPERSEDED"],
  TRIAGED: ["APPROVED", "REJECTED", "SUPERSEDED"],
  APPROVED: ["IMPLEMENTED", "REJECTED", "SUPERSEDED"],
  IMPLEMENTED: ["MEASURING", "SUPERSEDED"],
  MEASURING: ["EFFECTIVE", "INEFFECTIVE", "INCONCLUSIVE"],
  EFFECTIVE: [],
  INEFFECTIVE: ["SUPERSEDED"],
  INCONCLUSIVE: ["MEASURING", "SUPERSEDED"],
  REJECTED: [],
  SUPERSEDED: [],
};

export function assertRunTransition(from: RunStatus, to: RunStatus): void {
  assertTransition("run", RUN_TRANSITIONS, from, to);
}

export function assertTaskTransition(from: TaskState, to: TaskState): void {
  assertTransition("task", TASK_TRANSITIONS, from, to);
}

export function assertImprovementTransition(from: ImprovementState, to: ImprovementState): void {
  assertTransition("improvement", IMPROVEMENT_TRANSITIONS, from, to);
}

export function isTerminalRun(status: RunStatus): boolean {
  return RUN_TRANSITIONS[status].length === 0;
}

function assertTransition<T extends string>(
  kind: string,
  table: Record<T, readonly T[]>,
  from: T,
  to: T,
): void {
  if (from === to) return;
  const allowed = table[from];
  if (!allowed.includes(to)) {
    throw new Error(`Illegal ${kind} transition ${from} -> ${to}.`);
  }
}
