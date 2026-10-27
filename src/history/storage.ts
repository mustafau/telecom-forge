export interface HistoryStore {
  putImmutable(key: string, content: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  exists(key: string): Promise<boolean>;
  list(prefix: string): AsyncIterable<string>;
  putMutableSnapshot(key: string, content: Buffer, expectedVersion?: string): Promise<string>;
}

export class HistoryConflictError extends Error {
  constructor(key: string) {
    super(`History object ${key} did not match the expected version.`);
    this.name = "HistoryConflictError";
  }
}

export function assertHistoryKey(key: string): string {
  if (key.length === 0 || key.startsWith("/") || key.includes("\\") || key.includes("\0")) {
    throw new Error(`Unsafe history key ${key}.`);
  }
  const parts = key.split("/");
  if (parts.some((part) => part === "" || part === "." || part === "..")) {
    throw new Error(`Unsafe history key ${key}.`);
  }
  return key;
}
