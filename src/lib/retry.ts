import { errorMessage } from "./errors.js";

export interface RetryOptions {
  attempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  retryOn: (error: unknown) => boolean;
  sleep?: (ms: number) => Promise<void>;
}

export async function withRetry<T>(operation: () => Promise<T>, options: RetryOptions): Promise<T> {
  const sleep = options.sleep ?? delay;
  let lastError: unknown;
  for (let attempt = 1; attempt <= options.attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      const retryable = options.retryOn(error);
      if (!retryable || attempt === options.attempts) break;
      const backoff = Math.min(options.maxDelayMs, options.baseDelayMs * 2 ** (attempt - 1));
      await sleep(backoff);
    }
  }
  if (lastError instanceof Error) throw lastError;
  throw new Error(errorMessage(lastError));
}

export class RateLimitError extends Error {
  readonly retryAfterMs: number | undefined;
  constructor(message: string, retryAfterMs?: number) {
    super(message);
    this.name = "RateLimitError";
    this.retryAfterMs = retryAfterMs;
  }
}

export function isRateLimitError(error: unknown): boolean {
  return error instanceof RateLimitError;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
