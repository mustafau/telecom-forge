import { createAppAuth } from "@octokit/auth-app";
import { Octokit } from "@octokit/rest";
import { ForgeError } from "../lib/errors.js";
import { withRetry, RateLimitError } from "../lib/retry.js";
import type { DraftPullRequestInput, GitHubClient, PullRequestRecord } from "./types.js";

export function requireLivePublishOptIn(env: NodeJS.ProcessEnv = process.env): void {
  if (env.FORGE_ALLOW_LIVE_PUBLISH !== "1") {
    throw new ForgeError(
      "LIVE_PUBLISH_DISABLED",
      "Live GitHub publication is disabled. Set FORGE_ALLOW_LIVE_PUBLISH=1 only after the GitHub App and protected environment are configured.",
      { exitCode: 3 },
    );
  }
}

export async function mintInstallationToken(env: NodeJS.ProcessEnv = process.env): Promise<string> {
  if (env.FORGE_GITHUB_TOKEN) return env.FORGE_GITHUB_TOKEN;
  const appId = env.FORGE_GITHUB_APP_ID;
  const privateKey = env.FORGE_GITHUB_APP_PRIVATE_KEY;
  const installationId = env.FORGE_GITHUB_APP_INSTALLATION_ID;
  if (!appId || !privateKey || !installationId) {
    throw new ForgeError(
      "GITHUB_AUTH_MISSING",
      "Live GitHub access needs FORGE_GITHUB_TOKEN or FORGE_GITHUB_APP_ID, FORGE_GITHUB_APP_PRIVATE_KEY, and FORGE_GITHUB_APP_INSTALLATION_ID.",
    );
  }
  const auth = createAppAuth({
    appId,
    privateKey: privateKey.replace(/\\n/g, "\n"),
    installationId,
  });
  const result = await auth({ type: "installation" });
  return result.token;
}

export function createLiveGitHubClient(token: string): GitHubClient {
  const octokit = new Octokit({ auth: token });
  return {
    async createOrUpdateDraftPr(input: DraftPullRequestInput) {
      const existing = await this.listOpenPullRequests(input.owner, input.repo, input.head);
      const current = existing[0];
      if (current) {
        await githubRetry(() =>
          octokit.rest.pulls.update({
            owner: input.owner,
            repo: input.repo,
            pull_number: current.number,
            title: input.title,
            body: input.body,
            base: input.base,
          }),
        );
        const updated = await this.getPullRequest(input.owner, input.repo, current.number);
        if (!updated) throw new ForgeError("GITHUB_FAILED", "Updated pull request could not be reloaded.");
        return { ...updated, created: false };
      }
      const created = await githubRetry(() =>
        octokit.rest.pulls.create({
          owner: input.owner,
          repo: input.repo,
          title: input.title,
          body: input.body,
          head: input.head,
          base: input.base,
          draft: true,
        }),
      );
      return {
        ...(await pullFromApi(input.owner, input.repo, created.data)),
        created: true,
      };
    },
    async getPullRequest(owner: string, repo: string, number: number) {
      try {
        const response = await githubRetry(() =>
          octokit.rest.pulls.get({ owner, repo, pull_number: number }),
        );
        return pullFromApi(owner, repo, response.data);
      } catch (error) {
        if (isNotFound(error)) return null;
        throw error;
      }
    },
    async listOpenPullRequests(owner: string, repo: string, head: string) {
      const response = await githubRetry(() =>
        octokit.rest.pulls.list({ owner, repo, state: "open", head: `${owner}:${head}` }),
      );
      return response.data.map((pull) => pullFromApi(owner, repo, pull));
    },
  };
}

async function githubRetry<T>(operation: () => Promise<T>): Promise<T> {
  return withRetry(operation, {
    attempts: 4,
    baseDelayMs: 500,
    maxDelayMs: 8_000,
    retryOn: (error) => error instanceof RateLimitError || isTransient(error),
  });
}

function pullFromApi(
  owner: string,
  repo: string,
  pull: {
    number: number;
    title: string | null;
    body?: string | null;
    head: { ref: string; sha: string };
    base: { ref: string };
    draft?: boolean | null;
    state: string;
    merged_at?: string | null;
    html_url: string;
    created_at: string;
    updated_at: string;
  },
): PullRequestRecord {
  return {
    owner,
    repo,
    number: pull.number,
    url: pull.html_url,
    html_url: pull.html_url,
    title: pull.title ?? "",
    body: pull.body ?? "",
    head: pull.head.ref,
    base: pull.base.ref,
    draft: Boolean(pull.draft),
    state: pull.state === "closed" ? "closed" : "open",
    merged: Boolean(pull.merged_at),
    headSha: pull.head.sha,
    reviews: [],
    checks: [],
    commits: [],
    createdAt: pull.created_at,
    updatedAt: pull.updated_at,
  };
}

function isNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && "status" in error && error.status === 404;
}

function isTransient(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("status" in error)) return false;
  const status = error.status;
  return status === 429 || status === 502 || status === 503 || status === 504;
}
