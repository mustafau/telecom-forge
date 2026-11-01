/** Cap waits at free-tier RPM scale; longer delays are treated as hard quota. */
export const PROVIDER_RETRY_AFTER_CAP_MS = 60_000;
export const PROVIDER_RATE_LIMIT_CONTINUES = 3;

/**
 * Read Gemini/OpenAI-style retry hints from Pi JSONL (nested error JSON is common).
 * Returns null when no short retry is advertised.
 */
export function extractProviderRetryAfterMs(rawJsonl: string): number | null {
  let lastError = "";
  for (const line of rawJsonl.split("\n")) {
    if (line.length === 0) continue;
    try {
      const event = JSON.parse(line) as { type?: string; message?: { stopReason?: string; errorMessage?: string } };
      if (event.type === "message_end" && event.message?.stopReason === "error" && event.message.errorMessage) {
        lastError = event.message.errorMessage;
      }
    } catch {
      // ignore non-JSON noise
    }
  }
  if (!lastError) return null;
  if (!/\b429\b|RESOURCE_EXHAUSTED|Too Many Requests|rate[_ ]limit|quota exceeded/i.test(lastError)) {
    return null;
  }
  const pleaseRetry = lastError.match(/Please retry in\s+([0-9]+(?:\.[0-9]+)?)\s*s/i);
  if (pleaseRetry) {
    return clampRetryMs(Math.ceil(Number(pleaseRetry[1]) * 1000));
  }
  const retryDelay = lastError.match(/retryDelay(?:\\")?(?:")?\s*:\s*(?:\\")?(?:")?([0-9]+(?:\.[0-9]+)?)s/i);
  if (retryDelay) {
    return clampRetryMs(Math.ceil(Number(retryDelay[1]) * 1000));
  }
  // Rate-limit shaped error without a hint: wait a conservative free-tier window.
  return clampRetryMs(15_000);
}

function clampRetryMs(ms: number): number | null {
  if (!Number.isFinite(ms) || ms <= 0) return null;
  if (ms > PROVIDER_RETRY_AFTER_CAP_MS) return null;
  return ms;
}
