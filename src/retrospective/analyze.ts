import { z } from "zod";
import { BOTTLENECKS, type Bottleneck } from "../tasks/states.js";
import type { MetricReport, RunSummary } from "../metrics/compute.js";

export const FindingSchema = z
  .object({
    id: z.string().regex(/^retro-\d{4}-W\d{2}-\d{2}$/),
    category: z.enum(BOTTLENECKS),
    title: z.string().min(8).max(160),
    observation: z.string().min(8),
    evidence: z.array(z.string().min(1)).min(1),
    confidence: z.enum(["low", "medium", "high"]),
    hypothesis: z.string().min(8),
    proposal: z
      .object({
        type: z.enum(["skill_update", "documentation", "tooling", "none"]),
        path: z.string().min(1),
        change_summary: z.string().min(8),
        owner: z.string().min(1),
      })
      .strict()
      .nullable(),
    verification: z
      .object({
        metric: z.string().min(1),
        lookback_weeks: z.number().int().positive().max(12),
        success_criterion: z.string().min(8),
      })
      .strict(),
  })
  .strict();

export type Finding = z.infer<typeof FindingSchema>;

export interface FindingValidation {
  accepted: Finding[];
  rejected: Array<{ id: string; reason: string }>;
}

export function validateFindings(candidates: unknown[], knownRunIds: ReadonlySet<string>): FindingValidation {
  const accepted: Finding[] = [];
  const rejected: Array<{ id: string; reason: string }> = [];
  candidates.forEach((candidate, index) => {
    const parsed = FindingSchema.safeParse(candidate);
    const id = parsed.success ? parsed.data.id : `index-${index}`;
    if (!parsed.success) {
      rejected.push({ id, reason: parsed.error.issues.map((issue) => issue.message).join("; ") });
      return;
    }
    const missing = parsed.data.evidence.filter((runId) => !knownRunIds.has(runId));
    if (missing.length > 0) {
      rejected.push({ id, reason: `Unsupported evidence: ${missing.join(", ")}` });
      return;
    }
    if (parsed.data.proposal && parsed.data.proposal.path.startsWith(".agents/skills/") === false && parsed.data.proposal.type === "skill_update") {
      rejected.push({ id, reason: "Skill proposals must target .agents/skills/." });
      return;
    }
    accepted.push(parsed.data);
  });
  return { accepted, rejected };
}

export function analyzeRuns(weekId: string, runs: RunSummary[], _metrics: MetricReport): unknown[] {
  const groups = new Map<Bottleneck, RunSummary[]>();
  for (const run of runs) {
    if (!run.failure_category) continue;
    const list = groups.get(run.failure_category) ?? [];
    list.push(run);
    groups.set(run.failure_category, list);
  }
  const findings: unknown[] = [];
  let sequence = 1;
  for (const [category, grouped] of groups) {
    const recurring = new Set(grouped.map((run) => run.run_id)).size >= 2;
    const id = `${weekId}-${String(sequence).padStart(2, "0")}`.replace(weekId, `retro-${weekId}`);
    sequence += 1;
    const evidence = [...new Set(grouped.map((run) => run.run_id))];
    findings.push({
      id,
      category,
      title: recurring ? `Repeated ${category}` : `Isolated ${category}`,
      observation: `${evidence.length} run(s) recorded ${category}.`,
      evidence,
      confidence: recurring ? "medium" : "low",
      hypothesis: recurring
        ? "The same bottleneck appears in more than one run, so a reviewed playbook change is worth proposing."
        : "A single occurrence is not enough to treat this as a recurring defect.",
      proposal: recurring && category === "MISSING_OR_STALE_CONTEXT"
        ? {
            type: "skill_update",
            path: ".agents/skills/organization-navigation/SKILL.md",
            change_summary: "Document where shared contract tests live and how to find the owning repository.",
            owner: "telecom-platform",
          }
        : null,
      verification: {
        metric: category === "MISSING_OR_STALE_CONTEXT" ? "context_related_incidents" : "runs_completed",
        lookback_weeks: 4,
        success_criterion: "The cited bottleneck count falls on a comparable task mix without raising verification failures.",
      },
    });
  }
  return findings;
}
