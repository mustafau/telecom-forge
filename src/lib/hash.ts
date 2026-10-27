import { createHash } from "node:crypto";

export function sha256(content: Buffer | string): string {
  return createHash("sha256").update(content).digest("hex");
}

export function sha256Json(value: unknown): string {
  return sha256(canonicalJson(value));
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => sortValue(item));
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0,
    );
    return Object.fromEntries(entries.map(([key, item]) => [key, sortValue(item)]));
  }
  return value;
}
