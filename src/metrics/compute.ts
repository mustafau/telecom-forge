import type { Bottleneck } from "../tasks/states.js";
import { percentile } from "./week.js";

export interface RunSummary {
  schema_version: "1.0";
  task_id: string;
  task_sha: string;
  run_id: string;
  attempt: number;
  control_sha: string;
  skills_sha: string;
  started_at: string;
  finished_at: string;
  status: string;
  failure_category: Bottleneck | null;
  metrics: {
    wall_time_seconds: number | null;
    agent_duration_seconds: number | null;
    test_duration_seconds: number | null;
    input_tokens: number | null;
    output_tokens: number | null;
    estimated_cost_usd: number | null;
  };
  source_revisions: Array<{ repository: string; pull_request_url: string | null }>;
}

export interface ReviewSample {
  ready_at: string;
  first_human_review_at: string | null;
  changes_requested: boolean;
  reviewed: boolean;
  merged: boolean;
  final: boolean;
}

export interface MetricReport {
  tasks_attempted: number;
  runs_completed: number;
  agent_execution_failures: number;
  verification_pass_rate: { rate: number | null; passed: number; denominator: number };
  publication_success_rate: { rate: number | null; published: number; denominator: number };
  agent_runtime_seconds: { p50: number | null; p90: number | null; sample_count: number };
  verification_runtime_seconds: { p50: number | null; p90: number | null; sample_count: number };
  median_output_tokens: { value: number | null; sample_count: number };
  estimated_cost_per_task: { value: number | null; tasks_with_cost: number; tasks_attempted: number };
  human_review_latency_seconds: { p50: number | null; sample_count: number };
  rework_rate: { rate: number | null; changes_requested: number; reviewed: number };
  merge_rate: { rate: number | null; merged: number; final: number };
  context_related_incidents: number;
  cross_repo_coordination_issues: number;
  missing: string[];
}

const COMPLETED = new Set(["PUBLISHED", "NO_CHANGE"]);
const AGENT_FAILURE = new Set(["AGENT_FAILED", "TIMED_OUT", "CANCELLED"]);
const VERIFY_REACHED = new Set(["VERIFYING", "BUNDLING", "PUBLISHING", "PUBLISHED", "NO_CHANGE", "VERIFICATION_FAILED", "PARTIAL_PUBLISH", "PUBLISH_FAILED", "BLOCKED_STALE_BASE"]);
const PUBLISH_ATTEMPT = new Set(["PUBLISHING", "PUBLISHED", "PARTIAL_PUBLISH", "PUBLISH_FAILED", "BLOCKED_STALE_BASE"]);

export function computeMetrics(runs: RunSummary[], reviews: ReviewSample[]): MetricReport {
  const missing: string[] = [];
  const tasks = new Set(runs.map((run) => run.task_id));
  const completed = runs.filter((run) => COMPLETED.has(run.status));
  const agentFailures = runs.filter((run) => AGENT_FAILURE.has(run.status));
  const verified = runs.filter((run) => VERIFY_REACHED.has(run.status) || run.metrics.test_duration_seconds !== null);
  const verificationPassed = verified.filter((run) => run.failure_category !== "ACTUAL_TEST_FAILURE" && run.status !== "VERIFICATION_FAILED");
  const publishAttempts = runs.filter((run) => PUBLISH_ATTEMPT.has(run.status));
  const published = publishAttempts.filter((run) => run.status === "PUBLISHED");
  const agentDurations = numbers(runs.map((run) => run.metrics.agent_duration_seconds));
  const testDurations = numbers(runs.map((run) => run.metrics.test_duration_seconds));
  const outputTokens = numbers(runs.map((run) => run.metrics.output_tokens));
  const costs = runs.filter((run) => run.metrics.estimated_cost_usd !== null);
  const costSum = costs.reduce((sum, run) => sum + (run.metrics.estimated_cost_usd ?? 0), 0);
  const latencies = reviews
    .filter((review) => review.first_human_review_at)
    .map((review) => (Date.parse(review.first_human_review_at ?? "") - Date.parse(review.ready_at)) / 1000)
    .filter((value) => Number.isFinite(value) && value >= 0);
  const reviewed = reviews.filter((review) => review.reviewed);
  const finalReviews = reviews.filter((review) => review.final);
  if (runs.some((run) => run.metrics.estimated_cost_usd === null)) {
    missing.push("estimated_cost_usd is null when the provider did not report a cost.");
  }
  if (reviews.some((review) => !review.first_human_review_at)) {
    missing.push("Human review latency excludes pull requests with no human review.");
  }
  return {
    tasks_attempted: tasks.size,
    runs_completed: completed.length,
    agent_execution_failures: agentFailures.length,
    verification_pass_rate: {
      rate: ratio(verificationPassed.length, verified.length),
      passed: verificationPassed.length,
      denominator: verified.length,
    },
    publication_success_rate: {
      rate: ratio(published.length, publishAttempts.length),
      published: published.length,
      denominator: publishAttempts.length,
    },
    agent_runtime_seconds: {
      p50: percentile(agentDurations, 50),
      p90: percentile(agentDurations, 90),
      sample_count: agentDurations.length,
    },
    verification_runtime_seconds: {
      p50: percentile(testDurations, 50),
      p90: percentile(testDurations, 90),
      sample_count: testDurations.length,
    },
    median_output_tokens: { value: percentile(outputTokens, 50), sample_count: outputTokens.length },
    estimated_cost_per_task: {
      value: costs.length === 0 || tasks.size === 0 ? null : costSum / new Set(costs.map((run) => run.task_id)).size,
      tasks_with_cost: new Set(costs.map((run) => run.task_id)).size,
      tasks_attempted: tasks.size,
    },
    human_review_latency_seconds: { p50: percentile(latencies, 50), sample_count: latencies.length },
    rework_rate: {
      rate: ratio(reviewed.filter((review) => review.changes_requested).length, reviewed.length),
      changes_requested: reviewed.filter((review) => review.changes_requested).length,
      reviewed: reviewed.length,
    },
    merge_rate: {
      rate: ratio(finalReviews.filter((review) => review.merged).length, finalReviews.length),
      merged: finalReviews.filter((review) => review.merged).length,
      final: finalReviews.length,
    },
    context_related_incidents: runs.filter((run) => run.failure_category === "MISSING_OR_STALE_CONTEXT").length,
    cross_repo_coordination_issues: runs.filter((run) => run.status === "PARTIAL_PUBLISH" || run.failure_category === "CROSS_REPOSITORY_DEPENDENCY").length,
    missing,
  };
}

function numbers(values: Array<number | null>): number[] {
  return values.filter((value): value is number => value !== null && Number.isFinite(value));
}

function ratio(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}
