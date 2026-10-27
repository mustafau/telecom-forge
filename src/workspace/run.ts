import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { access } from "node:fs/promises";
import { createHarness } from "../harness/registry.js";
import type { HarnessRunResult } from "../harness/types.js";
import { findRepoRoot } from "../config/load.js";
import { readManifest } from "../verify/verify.js";
import { ForgeError } from "../lib/errors.js";

export async function executeHarness(options: {
  runDir: string;
  harnessName: string;
  repoRoot: string;
  mode?: "implement" | "retro";
  env?: NodeJS.ProcessEnv;
}): Promise<HarnessRunResult> {
  const manifest = await readManifest(options.runDir);
  const workspace = await findRepoRoot(options.runDir);
  const controlDir = path.resolve(workspace, manifest.control_dir);
  const taskDir = path.resolve(workspace, manifest.task_dir);
  const outputDirectory = path.join(options.runDir, "harness");
  const harness = await createHarness(options.harnessName, options.repoRoot, options.env);
  const env = options.env ?? process.env;
  const provider = env[manifest.harness.provider_env] ?? (options.harnessName === "fake" ? "fake" : "");
  const model = env[manifest.harness.model_env] ?? (options.harnessName === "fake" ? "fake" : "");
  if (!provider || !model) {
    throw new ForgeError(
      "MODEL_NOT_CONFIGURED",
      `Set ${manifest.harness.provider_env} and ${manifest.harness.model_env} before running the ${options.harnessName} harness.`,
    );
  }
  const extensionPath = path.join(controlDir, "extensions", "telemetry.ts");
  let extension: string | undefined;
  if (options.harnessName === "pi") {
    try {
      await access(extensionPath);
      extension = extensionPath;
    } catch {
      extension = undefined;
    }
  }
  const taskMarkdown = path.relative(workspace, path.join(taskDir, "task.md"));
  const result = await harness.run(
    {
      runId: manifest.run_id,
      taskId: manifest.task_id,
      attempt: manifest.attempt,
      workingDirectory: workspace,
      taskMarkdownPath: taskMarkdown,
      trustedInstructionsPath: path.join(controlDir, "AGENTS.md"),
      implementPromptPath: path.join(controlDir, "prompts", options.mode === "retro" ? "retrospective.md" : "implement.md"),
      trustedSkillsDirectory: path.join(controlDir, ".agents", "skills"),
      sessionDirectory: path.join(outputDirectory, "pi-sessions"),
      outputDirectory,
      modelProvider: provider,
      modelId: model,
      timeoutMs: manifest.harness.max_runtime_minutes * 60 * 1000,
      mode: options.mode ?? "implement",
      ...(extension ? { extensionPath: extension } : {}),
    },
    { normalized() {} },
  );
  await writeFile(path.join(options.runDir, "harness-result.json"), `${JSON.stringify(result, null, 2)}\n`);
  return result;
}

export async function readJsonFile<T>(file: string): Promise<T> {
  return JSON.parse(await readFile(file, "utf8")) as T;
}
