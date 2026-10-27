import path from "node:path";
import { access } from "node:fs/promises";
import { ForgeError } from "../lib/errors.js";
import { FakeHarness, loadFakePlan } from "./fake-adapter.js";
import { PiHarness, resolvePiBinary } from "./pi-adapter.js";
import type { CodingHarness } from "./types.js";

export async function createHarness(name: string, repoRoot: string, env: NodeJS.ProcessEnv = process.env): Promise<CodingHarness> {
  if (name === "fake") return new FakeHarness(await loadFakePlan(env));
  if (name === "pi") {
    const binary = env.FORGE_PI_BIN ?? resolvePiBinary(repoRoot);
    try {
      await access(binary);
    } catch {
      throw new ForgeError(
        "HARNESS_UNAVAILABLE",
        `Pi binary was not found at ${binary}. Install dependencies or set FORGE_PI_BIN.`,
      );
    }
    return new PiHarness(binary);
  }
  throw new ForgeError("UNKNOWN_HARNESS", `Harness "${name}" is not registered. Available: pi, fake.`);
}

export function defaultExtensionPath(repoRoot: string): string {
  return path.join(repoRoot, "extensions", "telemetry.ts");
}
