import { randomBytes } from "node:crypto";
import { sha256 } from "./hash.js";

export function uuidv7(now = Date.now()): string {
  const bytes = randomBytes(16);
  const timestamp = BigInt(now);
  bytes[0] = Number((timestamp >> 40n) & 0xffn);
  bytes[1] = Number((timestamp >> 32n) & 0xffn);
  bytes[2] = Number((timestamp >> 24n) & 0xffn);
  bytes[3] = Number((timestamp >> 16n) & 0xffn);
  bytes[4] = Number((timestamp >> 8n) & 0xffn);
  bytes[5] = Number(timestamp & 0xffn);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x70;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = Buffer.from(bytes).toString("hex");
  return formatUuid(hex);
}

/** Stable id for derived events so a replay does not invent a second identity. */
export function deterministicUuid(material: string): string {
  const hex = sha256(material).slice(0, 32);
  const bytes = Buffer.from(hex, "hex");
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x80;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  return formatUuid(bytes.toString("hex"));
}

export function createRunId(env: NodeJS.ProcessEnv = process.env, now = new Date()): string {
  const githubRunId = env.GITHUB_RUN_ID;
  if (githubRunId && /^[0-9]+$/.test(githubRunId)) {
    const attempt = env.GITHUB_RUN_ATTEMPT && /^[0-9]+$/.test(env.GITHUB_RUN_ATTEMPT)
      ? env.GITHUB_RUN_ATTEMPT
      : "1";
    return `gh-${githubRunId}-${attempt}`;
  }
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  return `local-${stamp}-${uuidv7(now.getTime()).slice(0, 8)}`;
}

function formatUuid(hex: string): string {
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}
