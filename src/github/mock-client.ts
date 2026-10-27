import { readFile } from "node:fs/promises";
import path from "node:path";
import { ensureDir, writeAtomic } from "../lib/fs.js";
import type { DraftPullRequestInput, GitHubClient, PullRequestRecord } from "./types.js";

interface MockDatabase {
  schema_version: 1;
  pull_requests: PullRequestRecord[];
}

export class MockGitHubClient implements GitHubClient {
  constructor(private readonly filePath: string) {}

  async createOrUpdateDraftPr(input: DraftPullRequestInput): Promise<PullRequestRecord & { created: boolean }> {
    const database = await this.read();
    const existing = database.pull_requests.find(
      (pull) => pull.owner === input.owner && pull.repo === input.repo && pull.head === input.head && pull.state === "open",
    );
    const now = new Date().toISOString();
    if (existing) {
      existing.title = input.title;
      existing.body = input.body;
      existing.base = input.base;
      existing.headSha = input.headSha;
      existing.draft = true;
      existing.updatedAt = now;
      if (!existing.commits.some((commit) => commit.sha === input.headSha)) {
        existing.commits.push({ sha: input.headSha, bot: true, message: input.title });
      }
      await this.write(database);
      return { ...existing, created: false };
    }
    const number = database.pull_requests.filter((pull) => pull.owner === input.owner && pull.repo === input.repo).length + 1;
    const created: PullRequestRecord = {
      owner: input.owner,
      repo: input.repo,
      number,
      url: `mock://github/${input.owner}/${input.repo}/pull/${number}`,
      html_url: `mock://github/${input.owner}/${input.repo}/pull/${number}`,
      title: input.title,
      body: input.body,
      head: input.head,
      base: input.base,
      draft: true,
      state: "open",
      merged: false,
      headSha: input.headSha,
      reviews: [],
      checks: [],
      commits: [{ sha: input.headSha, bot: true, message: input.title }],
      createdAt: now,
      updatedAt: now,
    };
    database.pull_requests.push(created);
    await this.write(database);
    return { ...created, created: true };
  }

  async getPullRequest(owner: string, repo: string, number: number): Promise<PullRequestRecord | null> {
    const database = await this.read();
    return database.pull_requests.find((pull) => pull.owner === owner && pull.repo === repo && pull.number === number) ?? null;
  }

  async listOpenPullRequests(owner: string, repo: string, head: string): Promise<PullRequestRecord[]> {
    const database = await this.read();
    return database.pull_requests.filter(
      (pull) => pull.owner === owner && pull.repo === repo && pull.head === head && pull.state === "open",
    );
  }

  async seedReview(input: {
    owner: string;
    repo: string;
    number: number;
    review?: PullRequestRecord["reviews"][number];
    check?: PullRequestRecord["checks"][number];
    merged?: boolean;
    closed?: boolean;
    humanCommit?: { sha: string; message: string };
  }): Promise<void> {
    const database = await this.read();
    const pull = database.pull_requests.find(
      (item) => item.owner === input.owner && item.repo === input.repo && item.number === input.number,
    );
    if (!pull) throw new Error(`Mock PR ${input.owner}/${input.repo}#${input.number} does not exist.`);
    if (input.review) pull.reviews.push(input.review);
    if (input.check) pull.checks.push(input.check);
    if (input.humanCommit) pull.commits.push({ ...input.humanCommit, bot: false });
    if (input.merged) {
      pull.merged = true;
      pull.state = "closed";
      pull.draft = false;
    } else if (input.closed) {
      pull.state = "closed";
      pull.merged = false;
    }
    pull.updatedAt = new Date().toISOString();
    await this.write(database);
  }

  private async read(): Promise<MockDatabase> {
    try {
      return JSON.parse(await readFile(this.filePath, "utf8")) as MockDatabase;
    } catch {
      return { schema_version: 1, pull_requests: [] };
    }
  }

  private async write(database: MockDatabase): Promise<void> {
    await ensureDir(path.dirname(this.filePath));
    await writeAtomic(this.filePath, `${JSON.stringify(database, null, 2)}\n`);
  }
}
