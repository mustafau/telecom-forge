import { writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { prepareWorkspace } from "../../src/workspace/prepare.js";
import { executeHarness } from "../../src/workspace/run.js";
import { verifyRun } from "../../src/verify/verify.js";
import { createBundle } from "../../src/patch/bundle.js";
import { publishBundle } from "../../src/publisher/publish.js";
import { LocalGitPublisher, type PublishGit } from "../../src/publisher/git.js";
import { FilesystemHistoryStore } from "../../src/history/filesystem-store.js";
import { persistRunEvidence } from "../../src/history/persist.js";
import { MockGitHubClient } from "../../src/github/mock-client.js";
import { reconcilePublications } from "../../src/history/reconcile.js";
import { buildRetro } from "../../src/retrospective/retro.js";
import { gitOk } from "../../src/lib/git.js";
import { ForgeError } from "../../src/lib/errors.js";
import { createWorld, destroyWorld, editedPagination, type FixtureWorld } from "../helpers/fixture.js";
import type { RunSummary } from "../../src/metrics/compute.js";

const worlds: FixtureWorld[] = [];

afterEach(async () => {
  while (worlds.length > 0) {
    const world = worlds.pop();
    if (world) await destroyWorld(world);
  }
});

describe("local fixture flow", () => {
  it("prepares pinned repositories, publishes one draft, and is idempotent", async () => {
    const world = await track();
    const first = await runFlow(world, {
      edits: [{ path: "repos/telecom-api-sandbox/src/pagination.js", content: editedPagination }],
    });
    expect(first.bundle.publishable).toBe(true);
    expect(first.bundle.patches).toHaveLength(1);
    expect(first.publication.status).toBe("PUBLISHED");
    expect(first.publication.repositories[0]?.pull_request_url).toMatch(/mock:\/\/github/);
    const commitsAfterFirst = await gitOk(["--git-dir", world.remotes["telecom-api-sandbox"] ?? "", "rev-list", "--count", "refs/heads/feature/TF-0001"]);
    const second = await publishBundle({
      runDir: first.runDir,
      apply: true,
      github: first.github,
      store: first.store,
    });
    const commitsAfterSecond = await gitOk(["--git-dir", world.remotes["telecom-api-sandbox"] ?? "", "rev-list", "--count", "refs/heads/feature/TF-0001"]);
    expect(second.repositories[0]?.status).toBe("skipped");
    expect(commitsAfterSecond).toBe(commitsAfterFirst);
    const pulls = await first.github.listOpenPullRequests("YOUR_GITHUB_OWNER", "telecom-api-sandbox", "feature/TF-0001");
    expect(pulls).toHaveLength(1);
    const reloaded = new FilesystemHistoryStore(path.join(world.root, ".forge-runtime", "history"));
    const stored = await reloaded.get(first.receipt.keys.find((key) => key.endsWith("run-summary.json")) ?? "");
    expect(stored.length).toBeGreaterThan(10);
  });

  it("refuses to publish when the source branch moved and when evidence is missing", async () => {
    const world = await track();
    const prepared = await prepareOnly(world);
    await advanceFeatureBranch(world.remotes["telecom-api-sandbox"] ?? "", "someone else");
    const flow = await finishFlow(world, prepared.runDir, {
      edits: [{ path: "repos/telecom-api-sandbox/src/pagination.js", content: editedPagination }],
    }, { publish: false });
    await expect(publishBundle({ runDir: flow.runDir, apply: true, github: flow.github, store: flow.store })).rejects.toThrow(
      /durable evidence/i,
    );
    await persistRunEvidence({ runDir: flow.runDir, store: flow.store, backend: "filesystem" });
    const blocked = await publishBundle({ runDir: flow.runDir, apply: true, github: flow.github, store: flow.store });
    expect(blocked.status).toBe("BLOCKED_STALE_BASE");
    const head = await gitOk(["--git-dir", world.remotes["telecom-api-sandbox"] ?? "", "rev-parse", "refs/heads/feature/TF-0001"]);
    const message = await gitOk(["--git-dir", world.remotes["telecom-api-sandbox"] ?? "", "log", "-1", "--format=%B", head]);
    expect(message).toContain("someone else");
    expect(message).not.toContain("Forge-Run-ID");
  });

  it("rejects a read-only edit and an agent that exits zero with a failed turn", async () => {
    const world = await track();
    const readOnly = await runFlow(world, {
      edits: [{ path: "repos/shared-contracts/README.md", content: "# overwritten\n" }],
    });
    expect(readOnly.verification.status).toBe("VERIFICATION_FAILED");
    expect(readOnly.publication.status).toBe("VERIFICATION_FAILED");
    await expect(gitOk(["--git-dir", world.remotes["shared-contracts"] ?? "", "rev-parse", "refs/heads/feature/TF-0001"])).rejects.toThrow();

    const failed = await track();
    const agentFailed = await runFlow(failed, {
      edits: [{ path: "repos/telecom-api-sandbox/src/pagination.js", content: editedPagination }],
      assistant_stop_reason: "error",
      assistant_error: "provider failed after a zero exit",
      exit_code: 0,
    });
    expect(agentFailed.verification.status).toBe("AGENT_FAILED");
    expect(agentFailed.publication.repositories).toHaveLength(0);
    await expect(gitOk(["--git-dir", failed.remotes["telecom-api-sandbox"] ?? "", "rev-parse", "refs/heads/feature/TF-0001"])).rejects.toThrow();
  });

  it("resumes a partial publication and reconciles a later merge", async () => {
    const world = await track(["telecom-api-sandbox", "telecom-inventory"]);
    const inner = new LocalGitPublisher();
    const inventory = world.remotes["telecom-inventory"] ?? "";
    const flaky = new FlakyGit(inner, new Map([[inventory, 1]]));
    const flow = await runFlow(
      world,
      {
        edits: [
          { path: "repos/telecom-api-sandbox/src/pagination.js", content: editedPagination },
          { path: "repos/telecom-inventory/src/pagination.js", content: editedPagination },
        ],
      },
      flaky,
    );
    expect(flow.publication.status).toBe("PARTIAL_PUBLISH");
    const resumed = await publishBundle({ runDir: flow.runDir, apply: true, github: flow.github, store: flow.store, git: flaky });
    expect(resumed.status).toBe("PUBLISHED");
    await flow.github.seedReview({
      owner: "YOUR_GITHUB_OWNER",
      repo: "telecom-api-sandbox",
      number: 1,
      review: { author: "reviewer", state: "APPROVED", submitted_at: "2026-10-21T00:00:00Z", bot: false },
      merged: true,
    });
    await flow.github.seedReview({
      owner: "YOUR_GITHUB_OWNER",
      repo: "telecom-inventory",
      number: 1,
      review: { author: "reviewer", state: "APPROVED", submitted_at: "2026-10-21T00:00:00Z", bot: false },
      merged: true,
    });
    const outcomes = await reconcilePublications({
      publications: [{ taskId: "TF-0001", publication: resumed }],
      github: flow.github,
      store: flow.store,
    });
    expect(outcomes[0]?.state).toBe("ACCEPTED");
    expect(outcomes[0]?.pull_requests.every((pull) => pull.observational_state === "MERGED")).toBe(true);
  });

  it("builds a retrospective that cites repeated runs and leaves skills unchanged", async () => {
    const world = await track();
    const skillPath = path.join(world.root, ".agents", "skills", "organization-navigation", "SKILL.md");
    const before = await readFile(skillPath, "utf8");
    const runs: RunSummary[] = [1, 2, 3].map((index) => ({
      schema_version: "1.0",
      task_id: `TF-000${index}`,
      task_sha: "c".repeat(40),
      run_id: `local-repeat-${index}`,
      attempt: 1,
      control_sha: "d".repeat(40),
      skills_sha: "d".repeat(40),
      started_at: "2026-10-20T12:00:00Z",
      finished_at: "2026-10-20T13:00:00Z",
      status: index === 3 ? "PUBLISHED" : "AGENT_FAILED",
      failure_category: index === 3 ? "FLAKY_TEST" : "MISSING_OR_STALE_CONTEXT",
      metrics: {
        wall_time_seconds: 100,
        agent_duration_seconds: 40 + index,
        test_duration_seconds: 10,
        input_tokens: 20,
        output_tokens: 5,
        estimated_cost_usd: null,
      },
      source_revisions: [],
    }));
    const retro = await buildRetro({
      weekId: "2026-W43",
      runs,
      priorRuns: [],
      reviews: [],
      repoRoot: world.root,
      write: true,
    });
    expect(retro.metrics.context_related_incidents).toBe(2);
    expect(retro.findings.some((finding) => finding.evidence.includes("local-repeat-1") && finding.proposal?.path.endsWith("SKILL.md"))).toBe(true);
    expect(retro.findings.some((finding) => finding.category === "FLAKY_TEST" && finding.proposal === null)).toBe(true);
    expect(await readFile(skillPath, "utf8")).toBe(before);
    expect(retro.wrote.some((file) => file.includes(`${path.sep}.agents${path.sep}skills${path.sep}`))).toBe(false);
  });
});

async function track(writable?: string[]): Promise<FixtureWorld> {
  const world = await createWorld(writable ? { writable } : {});
  worlds.push(world);
  return world;
}

async function runFlow(world: FixtureWorld, plan: Record<string, unknown>, git?: PublishGit) {
  const prepared = await prepareOnly(world);
  return finishFlow(world, prepared.runDir, plan, { publish: true, git });
}

async function prepareOnly(world: FixtureWorld) {
  const manifest = await prepareWorkspace({
    repoRoot: world.root,
    taskRef: "task/TF-0001",
    taskPath: "tasks/TF-0001/task.yaml",
    controlRef: "main",
  });
  return { manifest, runDir: path.join(world.root, ".forge-runtime", "runs", manifest.run_id) };
}

async function finishFlow(
  world: FixtureWorld,
  runDir: string,
  plan: Record<string, unknown>,
  options: { publish: boolean; git?: PublishGit },
) {
  const planPath = path.join(world.root, ".forge-runtime", "fake-plan.json");
  await writeFile(planPath, JSON.stringify(plan));
  await executeHarness({
    runDir,
    harnessName: "fake",
    repoRoot: world.root,
    env: { ...process.env, FORGE_FAKE_HARNESS_PLAN: planPath, FORGE_MODEL_PROVIDER: "fake", FORGE_MODEL_ID: "fake" },
  });
  const verification = await verifyRun(runDir);
  const bundle = await createBundle(runDir);
  const store = new FilesystemHistoryStore(path.join(world.root, ".forge-runtime", "history"));
  const github = new MockGitHubClient(path.join(world.root, ".forge-runtime", "github-mock", "prs.json"));
  let receipt = null;
  if (options.publish && bundle.publishable) {
    receipt = await persistRunEvidence({ runDir, store, backend: "filesystem" });
  }
  const publication = await publishBundle({
    runDir,
    apply: options.publish && bundle.publishable,
    github,
    store,
    ...(options.git ? { git: options.git } : {}),
  });
  return { runDir, verification, bundle, receipt: receipt ?? { keys: [] }, publication, github, store };
}

async function advanceFeatureBranch(remote: string, message: string): Promise<void> {
  const work = path.join(path.dirname(remote), "racer");
  await gitOk(["clone", remote, work]);
  await gitOk(["checkout", "-b", "feature/TF-0001"], { cwd: work });
  await writeFile(path.join(work, "src", "pagination.js"), `${editedPagination}\n// ${message}\n`);
  await gitOk(["add", "-A"], { cwd: work });
  await gitOk(["commit", "-m", message], { cwd: work, identity: true });
  await gitOk(["push", "origin", "HEAD:refs/heads/feature/TF-0001"], { cwd: work });
}

class FlakyGit implements PublishGit {
  constructor(
    private readonly inner: LocalGitPublisher,
    private readonly failures: Map<string, number>,
  ) {}

  branchHead(remote: string, branch: string) {
    return this.inner.branchHead(remote, branch);
  }

  commitMessage(remote: string, sha: string) {
    return this.inner.commitMessage(remote, sha);
  }

  applyAndCommit(input: Parameters<PublishGit["applyAndCommit"]>[0]) {
    return this.inner.applyAndCommit(input);
  }

  async pushFastForward(remote: string, branch: string, worktree: string) {
    const remaining = this.failures.get(remote) ?? 0;
    if (remaining > 0) {
      this.failures.set(remote, remaining - 1);
      throw new ForgeError("PUSH_REJECTED", "simulated push failure");
    }
    await this.inner.pushFastForward(remote, branch, worktree);
  }
}
