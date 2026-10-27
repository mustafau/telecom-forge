import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import { prepareWorkspace } from "../../src/workspace/prepare.js";
import { buildPiArgs } from "../../src/harness/pi-adapter.js";
import { createWorld, destroyWorld, commitFile } from "../helpers/fixture.js";
import { validateTask } from "../../src/tasks/validate.js";
import { loadConfigAtSha } from "../../src/config/load.js";
import { resolveCommit } from "../../src/lib/git.js";
import { assertPatchText } from "../../src/patch/scan.js";
import { buildAgentEnvironment } from "../../src/security/agent-env.js";

describe("threat cases", () => {
  it("keeps trusted skills and scope when the task branch is hostile", async () => {
    const world = await createWorld();
    try {
      await commitFile(
        world.root,
        ".agents/skills/organization-navigation/SKILL.md",
        "EVIL SKILL\n",
        "hostile skill",
      );
      await commitFile(world.root, ".github/workflows/evil.yml", "name: evil\n", "hostile workflow");
      const manifest = await prepareWorkspace({
        repoRoot: world.root,
        taskRef: "feature/TF-0001",
        taskPath: "tasks/TF-0001/task.yaml",
        controlRef: "main",
      });
      const skill = await readFile(path.join(world.root, manifest.control_dir, ".agents/skills/organization-navigation/SKILL.md"), "utf8");
      expect(skill).toContain("CANONICAL SKILL TEXT");
      expect(skill).not.toContain("EVIL SKILL");
      const config = await loadConfigAtSha(world.root, await resolveCommit(world.root, "main"));
      await expect(
        validateTask({
          repoRoot: world.root,
          taskRef: "feature/TF-0001",
          taskPath: "tasks/TF-0001/task.yaml",
          config: {
            ...config,
            workspace: {
              ...config.workspace,
              repositories: config.workspace.repositories,
            },
          },
        }),
      ).resolves.toMatchObject({ writable: ["telecom-api-sandbox"] });
    } finally {
      await destroyWorld(world);
    }
  });

  it("rejects traversal, hooks, and workflow patches", () => {
    const malicious = [
      "diff --git a/../../etc/passwd b/../../etc/passwd\n",
      "diff --git a/.git/config b/.git/config\n",
      "diff --git a/.github/workflows/deploy.yml b/.github/workflows/deploy.yml\n",
      "diff --git a/.git/hooks/pre-commit b/.git/hooks/pre-commit\nnew file mode 100755\n",
    ];
    for (const patch of malicious) {
      expect(() => assertPatchText(patch, 10000)).toThrow();
    }
  });

  it("does not give the agent job a GitHub write token in the workflow", async () => {
    const workflow = parseYaml(await readFile(".github/workflows/implement-task.yml", "utf8")) as {
      jobs: Record<string, { permissions?: Record<string, string>; steps?: Array<{ name?: string; uses?: string; env?: Record<string, string> }> }>;
    };
    const agent = workflow.jobs.agent_and_verify;
    expect(agent?.permissions?.contents).toBe("read");
    expect(JSON.stringify(agent)).not.toContain("contents: write");
    expect(agent?.steps?.some((step) => step.uses?.includes("create-github-app-token"))).toBe(false);
    expect(agent?.steps?.some((step) => step.uses?.includes("configure-aws-credentials"))).toBe(false);
    const publish = workflow.jobs.publish;
    expect(publish?.steps?.some((step) => String(step.uses).includes("create-github-app-token"))).toBe(true);
    expect(publish?.steps?.some((step) => step.name === "Publish validated bundle")).toBe(true);
    const env = buildAgentEnvironment({ GITHUB_TOKEN: "should-not-pass", PATH: "/usr/bin" });
    expect(env.GITHUB_TOKEN).toBeUndefined();
    const args = buildPiArgs({
      runId: "local-1",
      taskId: "TF-0001",
      attempt: 1,
      workingDirectory: ".",
      taskMarkdownPath: "task/task.md",
      trustedInstructionsPath: "control/AGENTS.md",
      implementPromptPath: "control/prompts/implement.md",
      trustedSkillsDirectory: "control/.agents/skills",
      sessionDirectory: "sessions",
      outputDirectory: "out",
      modelProvider: "example",
      modelId: "example-model",
      timeoutMs: 1000,
      mode: "retro",
      extensionPath: "extensions/telemetry.ts",
    });
    expect(args).toContain("--no-skills");
    expect(args).toContain("--no-extensions");
    expect(args).toContain("--tools");
    expect(args).toContain("read,grep,find,ls");
  });
});
