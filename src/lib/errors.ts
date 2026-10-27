export class ForgeError extends Error {
  readonly code: string;
  readonly exitCode: number;
  readonly details: Record<string, unknown> | undefined;

  constructor(
    code: string,
    message: string,
    options?: { exitCode?: number; details?: Record<string, unknown>; cause?: unknown },
  ) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = "ForgeError";
    this.code = code;
    this.exitCode = options?.exitCode ?? 1;
    this.details = options?.details;
  }
}

export function isForgeError(error: unknown): error is ForgeError {
  return error instanceof ForgeError;
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
