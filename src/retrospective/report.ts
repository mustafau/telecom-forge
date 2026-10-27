import type { MetricReport } from "../metrics/compute.js";
import type { WeekWindow } from "../metrics/week.js";
import type { Finding } from "./analyze.js";

export function renderReport(options: {
  week: WeekWindow;
  metrics: MetricReport;
  findings: Finding[];
  rejected: Array<{ id: string; reason: string }>;
  priorWeeks: number;
  runIds: string[];
}): string {
  const metric = options.metrics;
  const lines = [
    `# Telecom Forge Retrospective — ${options.week.id}`,
    "",
    "## Window and evidence coverage",
    `- Local start: ${options.week.startLocal}`,
    `- Local end (exclusive): ${options.week.endLocal}`,
    `- UTC start: ${options.week.startUtc}`,
    `- UTC end (exclusive): ${options.week.endUtc}`,
    `- Tasks attempted: ${metric.tasks_attempted}`,
    `- Runs sampled: ${options.runIds.length}`,
    `- Prior weeks in the baseline: ${options.priorWeeks}`,
    ...(metric.missing.length ? metric.missing.map((item) => `- Missing data: ${item}`) : ["- Missing data: none recorded."]),
    "",
    "## Executive summary",
    `- ${metric.tasks_attempted} distinct tasks were attempted and ${metric.runs_completed} runs reached a completed agent, verification, and publish outcome.`,
    `- Agent execution failures: ${metric.agent_execution_failures}.`,
    `- Context-related incidents: ${metric.context_related_incidents}. Cross-repo coordination issues: ${metric.cross_repo_coordination_issues}.`,
    `- Accepted improvement proposals: ${options.findings.filter((finding) => finding.proposal).length}. Rejected unsupported findings: ${options.rejected.length}.`,
    "",
    "## Metrics",
    `- Verification pass rate: ${formatRate(metric.verification_pass_rate.rate)} (${metric.verification_pass_rate.passed}/${metric.verification_pass_rate.denominator}).`,
    `- Publication success rate: ${formatRate(metric.publication_success_rate.rate)} (${metric.publication_success_rate.published}/${metric.publication_success_rate.denominator}).`,
    `- Agent runtime p50/p90 seconds: ${metric.agent_runtime_seconds.p50 ?? "n/a"} / ${metric.agent_runtime_seconds.p90 ?? "n/a"} (n=${metric.agent_runtime_seconds.sample_count}).`,
    `- Verification runtime p50/p90 seconds: ${metric.verification_runtime_seconds.p50 ?? "n/a"} / ${metric.verification_runtime_seconds.p90 ?? "n/a"} (n=${metric.verification_runtime_seconds.sample_count}).`,
    `- Median output tokens: ${metric.median_output_tokens.value ?? "n/a"} (n=${metric.median_output_tokens.sample_count}).`,
    `- Estimated cost per task with cost coverage: ${metric.estimated_cost_per_task.value ?? "n/a"} (${metric.estimated_cost_per_task.tasks_with_cost}/${metric.estimated_cost_per_task.tasks_attempted} tasks reported cost).`,
    `- Human review latency p50 seconds: ${metric.human_review_latency_seconds.p50 ?? "n/a"} (n=${metric.human_review_latency_seconds.sample_count}).`,
    `- Rework rate: ${formatRate(metric.rework_rate.rate)} (${metric.rework_rate.changes_requested}/${metric.rework_rate.reviewed}).`,
    `- Merge rate among final outcomes: ${formatRate(metric.merge_rate.rate)} (${metric.merge_rate.merged}/${metric.merge_rate.final}). Open pull requests are not counted as failures.`,
    "",
    "## Repeated bottlenecks",
    ...(options.findings.length
      ? options.findings.map(
          (finding) =>
            `- ${finding.id} ${finding.category} (${finding.confidence}): ${finding.observation} Evidence: ${finding.evidence.join(", ")}.`,
        )
      : ["- No classified bottlenecks in this window."]),
    "",
    "## Review and quality findings",
    "- Review state is observational. A published draft is not an accepted change.",
    "",
    "## Proposed improvements",
    ...(options.findings.filter((finding) => finding.proposal).length
      ? options.findings
          .filter((finding) => finding.proposal)
          .map(
            (finding) =>
              `- ${finding.id}: ${finding.proposal?.change_summary} Target: \`${finding.proposal?.path}\`. Owner: ${finding.proposal?.owner}. Verification: ${finding.verification.success_criterion}`,
          )
      : ["- None. No recurring, evidence-backed change met the proposal rule."]),
    "",
    "## Previous improvement follow-up",
    "- No previously accepted improvement is marked effective by this run unless a merged proposal and a later measurement both exist.",
    "",
    "## Open questions and manual review needs",
    ...(options.rejected.length
      ? options.rejected.map((item) => `- Rejected ${item.id}: ${item.reason}`)
      : ["- No unsupported findings were produced."]),
    "",
    "## Evidence index",
    ...options.runIds.map((runId) => `- Run ${runId}`),
    "",
    "This report does not modify skills, merge pull requests, or treat model inference as a verified root cause.",
    "",
  ];
  return lines.join("\n");
}

function formatRate(value: number | null): string {
  if (value === null) return "n/a";
  return `${Math.round(value * 1000) / 10}%`;
}
