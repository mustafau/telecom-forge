import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Pi retry policy sized for Gemini free-tier RPM waits (~15 req/min, Retry-After
 * typically under a minute). Caps stay at 60s so multi-hour daily-quota resets
 * fail fast instead of hanging the Actions job.
 *
 * Google's adapter only retries initial 429/5xx when provider.maxRetries > 0;
 * agent-level auto_retry alone has not been firing on nested Gemini 429s.
 */
export const PI_FREE_TIER_RETRY_SETTINGS = {
  cacheWarming: "off",
  retry: {
    enabled: true,
    maxRetries: 5,
    baseDelayMs: 5_000,
    maxAgentDelayMs: 60_000,
    provider: {
      maxRetries: 3,
      maxRetryDelayMs: 60_000,
    },
  },
} as const;

export async function materializePiAgentDir(agentDir: string): Promise<string> {
  await mkdir(agentDir, { recursive: true });
  await writeFile(
    path.join(agentDir, "settings.json"),
    `${JSON.stringify(PI_FREE_TIER_RETRY_SETTINGS, null, 2)}\n`,
    "utf8",
  );
  return agentDir;
}
