import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export async function writeAtomic(filePath: string, content: string | Buffer): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.tmp`;
  await writeFile(temporary, content);
  await rename(temporary, filePath);
}

export async function ensureDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
}
