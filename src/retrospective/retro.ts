import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { ForgeError } from "../lib/errors.js";
import { computeMetrics, type ReviewSample, type RunSummary } from "../metrics/compute.js";
import { parseWeek, type WeekWindow } from "../metrics/week.js";
import { analyzeRuns, validateFindings, type Finding } from "./analyze.js";
import { renderReport } from "./report.js";

export interface RetroResult {
  week: WeekWindow;
  metrics: ReturnType<typeof computeMetrics>;
  findings: Finding[];
  rejected: Array<{ id: string; reason: string }>;
  report: string;
  wrote: string[];
}

export async function buildRetro(options: {
  weekId: string;
  runs: RunSummary[];
  priorRuns?: RunSummary[];
  reviews?: ReviewSample[];
  repoRoot?: string;
  write: boolean;
}): Promise<RetroResult> {
  const week = parseWeek(options.weekId);
  const inWindow = options.runs.filter((run) => {
    const started = Date.parse(run.started_at);
    return started >= week.start.getTime() && started < week.end.getTime();
  });
  const metrics = computeMetrics(inWindow, options.reviews ?? []);
  const known = new Set(inWindow.map((run) => run.run_id));
  const validation = validateFindings(analyzeRuns(week.id, inWindow, metrics), known);
  const report = renderReport({
    week,
    metrics,
    findings: validation.accepted,
    rejected: validation.rejected,
    priorWeeks: countPriorWeeks(options.priorRuns ?? [], week),
    runIds: inWindow.map((run) => run.run_id),
  });
  const wrote: string[] = [];
  if (options.write) {
    if (!options.repoRoot) throw new ForgeError("RETRO_PATH", "A repository root is required to write a retrospective.");
    const year = week.id.slice(0, 4);
    const reportPath = path.join(options.repoRoot, "retrospectives", year, `${week.id}.md`);
    await mkdir(path.dirname(reportPath), { recursive: true });
    await writeFile(reportPath, report);
    wrote.push(reportPath);
    for (const finding of validation.accepted.filter((item) => item.proposal)) {
      const proposalPath = path.join(options.repoRoot, "improvements", "proposals", `${finding.id}.json`);
      await mkdir(path.dirname(proposalPath), { recursive: true });
      await writeFile(
        proposalPath,
        `${JSON.stringify({ schema_version: 1, state: "PROPOSED", finding }, null, 2)}\n`,
      );
      wrote.push(proposalPath);
      if (proposalPath.includes(`${path.sep}.agents${path.sep}skills${path.sep}`)) {
        throw new ForgeError("RETRO_PRIVILEGE", "Retrospective publication attempted to write a trusted skill.");
      }
    }
  }
  return { week, metrics, findings: validation.accepted, rejected: validation.rejected, report, wrote };
}

export async function assertSkillsUnchanged(repoRoot: string, before: Map<string, string>): Promise<void> {
  for (const [file, hash] of before) {
    const current = await readFile(file, "utf8").catch(() => "");
    if (current !== hash) {
      throw new ForgeError("RETRO_PRIVILEGE", `Retrospective changed trusted skill ${path.relative(repoRoot, file)}.`);
    }
  }
}

function countPriorWeeks(runs: RunSummary[], week: WeekWindow): number {
  const weeks = new Set<string>();
  for (const run of runs) {
    const started = Date.parse(run.started_at);
    if (started < week.start.getTime()) weeks.add(run.started_at.slice(0, 10));
  }
  return Math.min(4, weeks.size);
}
