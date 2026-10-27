import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { sha256 } from "../lib/hash.js";
import { assertHistoryKey, HistoryConflictError, type HistoryStore } from "./storage.js";

export class FilesystemHistoryStore implements HistoryStore {
  constructor(private readonly root: string) {}

  async putImmutable(key: string, content: Buffer, contentType: string): Promise<void> {
    const file = this.file(key);
    if (await this.exists(key)) {
      throw new HistoryConflictError(key);
    }
    await mkdir(path.dirname(file), { recursive: true });
    const temporary = `${file}.${process.pid}.tmp`;
    await writeFile(temporary, content);
    await writeFile(`${temporary}.sha256`, sha256(content));
    await writeFile(`${temporary}.content-type`, contentType);
    try {
      await rename(temporary, file);
      await rename(`${temporary}.sha256`, `${file}.sha256`);
      await rename(`${temporary}.content-type`, `${file}.content-type`);
    } catch (error) {
      await rm(temporary, { force: true });
      await rm(`${temporary}.sha256`, { force: true });
      await rm(`${temporary}.content-type`, { force: true });
      if (await this.exists(key)) throw new HistoryConflictError(key);
      throw error;
    }
  }

  async get(key: string): Promise<Buffer> {
    const file = this.file(key);
    const content = await readFile(file);
    const recorded = (await readFile(`${file}.sha256`, "utf8")).trim();
    if (recorded !== sha256(content)) {
      throw new Error(`Checksum mismatch for history object ${key}.`);
    }
    return content;
  }

  async exists(key: string): Promise<boolean> {
    try {
      const info = await stat(this.file(key));
      return info.isFile();
    } catch {
      return false;
    }
  }

  async *list(prefix: string): AsyncIterable<string> {
    const safe = prefix.length === 0 ? "" : assertHistoryKey(prefix.replace(/\/$/, ""));
    const start = safe.length === 0 ? this.root : this.file(safe);
    yield* walk(this.root, start);
  }

  async putMutableSnapshot(key: string, content: Buffer, expectedVersion?: string): Promise<string> {
    const file = this.file(key);
    const versionFile = `${file}.version`;
    let current: string | undefined;
    if (await this.exists(key)) current = (await readFile(versionFile, "utf8")).trim();
    if (expectedVersion === undefined && current !== undefined) {
      throw new HistoryConflictError(key);
    }
    if (expectedVersion !== undefined && current !== expectedVersion) {
      throw new HistoryConflictError(key);
    }
    const next = sha256(content);
    await mkdir(path.dirname(file), { recursive: true });
    const temporary = `${file}.${process.pid}.tmp`;
    await writeFile(temporary, content);
    await writeFile(`${temporary}.sha256`, next);
    await writeFile(`${temporary}.version`, next);
    await rename(temporary, file);
    await rename(`${temporary}.sha256`, `${file}.sha256`);
    await rename(`${temporary}.version`, versionFile);
    return next;
  }

  private file(key: string): string {
    const safe = assertHistoryKey(key);
    const resolved = path.resolve(this.root, safe);
    if (!resolved.startsWith(path.resolve(this.root) + path.sep)) {
      throw new Error(`History key escapes the store: ${key}`);
    }
    return resolved;
  }
}

async function* walk(root: string, current: string): AsyncIterable<string> {
  let info;
  try {
    info = await stat(current);
  } catch {
    return;
  }
  if (info.isFile()) {
    if (current.endsWith(".sha256") || current.endsWith(".content-type") || current.endsWith(".version")) return;
    yield path.relative(root, current).split(path.sep).join("/");
    return;
  }
  if (!info.isDirectory()) return;
  for (const entry of await readdir(current)) {
    yield* walk(root, path.join(current, entry));
  }
}
