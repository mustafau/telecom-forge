export interface PullRequestRecord {
  owner: string;
  repo: string;
  number: number;
  url: string;
  title: string;
  body: string;
  head: string;
  base: string;
  draft: boolean;
  state: "open" | "closed";
  merged: boolean;
  headSha: string;
  html_url: string;
  reviews: Array<{
    author: string;
    state: "APPROVED" | "CHANGES_REQUESTED" | "COMMENTED";
    submitted_at: string;
    bot: boolean;
  }>;
  checks: Array<{ name: string; conclusion: string | null }>;
  commits: Array<{ sha: string; bot: boolean; message: string }>;
  createdAt: string;
  updatedAt: string;
}

export interface DraftPullRequestInput {
  owner: string;
  repo: string;
  title: string;
  body: string;
  head: string;
  base: string;
  headSha: string;
  draft: true;
}

export interface GitHubClient {
  createOrUpdateDraftPr(input: DraftPullRequestInput): Promise<PullRequestRecord & { created: boolean }>;
  getPullRequest(owner: string, repo: string, number: number): Promise<PullRequestRecord | null>;
  listOpenPullRequests(owner: string, repo: string, head: string): Promise<PullRequestRecord[]>;
}
