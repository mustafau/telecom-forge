import { DateTime } from "luxon";
import { ForgeError } from "../lib/errors.js";

export const RETRO_ZONE = "America/Los_Angeles";

export interface WeekWindow {
  id: string;
  start: Date;
  end: Date;
  startLocal: string;
  endLocal: string;
  startUtc: string;
  endUtc: string;
}

export function parseWeek(weekId: string): WeekWindow {
  const match = /^(\d{4})-W(\d{2})$/.exec(weekId);
  if (!match?.[1] || !match[2]) {
    throw new ForgeError("INVALID_WEEK", "Week must look like 2026-W43.");
  }
  const start = DateTime.fromObject(
    { weekYear: Number(match[1]), weekNumber: Number(match[2]), weekday: 1 },
    { zone: RETRO_ZONE },
  ).startOf("day");
  if (!start.isValid) throw new ForgeError("INVALID_WEEK", `Could not resolve ${weekId} in ${RETRO_ZONE}.`);
  const end = start.plus({ weeks: 1 });
  return {
    id: `${start.weekYear}-W${String(start.weekNumber).padStart(2, "0")}`,
    start: start.toUTC().toJSDate(),
    end: end.toUTC().toJSDate(),
    startLocal: start.toISO() ?? "",
    endLocal: end.toISO() ?? "",
    startUtc: start.toUTC().toISO() ?? "",
    endUtc: end.toUTC().toISO() ?? "",
  };
}

export function previousCompletedWeek(now: Date): string {
  const local = DateTime.fromJSDate(now, { zone: RETRO_ZONE });
  const previous = local.set({ weekday: 1 }).startOf("day").minus({ weeks: 1 });
  return `${previous.weekYear}-W${String(previous.weekNumber).padStart(2, "0")}`;
}

export function percentile(values: number[], percentileValue: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const rank = Math.ceil((percentileValue / 100) * sorted.length);
  const index = Math.min(sorted.length - 1, Math.max(0, rank - 1));
  return sorted[index] ?? null;
}
