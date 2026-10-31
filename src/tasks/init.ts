import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { ForgeError } from "../lib/errors.js";
import { assertPermittedBranch } from "../security/refs.js";

export async function initTask(options: {
  repoRoot: string;
  id: string;
  branch: string;
  title?: string;
}): Promise<{ directory: string; created: string[] }> {
  if (!/^TF-[0-9]{4,8}$/.test(options.id)) {
    throw new ForgeError("INVALID_TASK", "Task id must look like TF-0001.");
  }
  assertPermittedBranch(options.branch);
  if (!options.branch.startsWith("task/")) {
    throw new ForgeError(
      "UNSAFE_BRANCH",
      `init-task --branch must be the metarepo task branch and start with "task/" (got "${options.branch}"). Publish branches use feature/<id>.`,
    );
  }
  const featureBranch = `feature/${options.id}`;
  const directory = path.join(options.repoRoot, "tasks", options.id);
  await mkdir(directory, { recursive: false }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "EEXIST") {
      throw new ForgeError("TASK_EXISTS", `${directory} already exists.`);
    }
    throw error;
  });
  const templateDir = path.join(options.repoRoot, "tasks", "_template");
  const yaml = (await readFile(path.join(templateDir, "task.yaml"), "utf8"))
    .replaceAll("task/TF-0000", options.branch)
    .replaceAll("feature/TF-0000", featureBranch)
    .replaceAll("TF-0000", options.id)
    .replaceAll("Replace this title", options.title ?? "Replace this title");
  const markdown = (await readFile(path.join(templateDir, "task.md"), "utf8")).replaceAll("TF-0000", options.id);
  await writeFile(path.join(directory, "task.yaml"), yaml);
  await writeFile(path.join(directory, "task.md"), markdown);
  return {
    directory,
    created: [path.join(directory, "task.yaml"), path.join(directory, "task.md")],
  };
}
