import type { GitHubClient, PullRequestRecord } from "../github/types.js";
import type { HistoryStore } from "../history/storage.js";
import { sha256 } from "../lib/hash.js";
import { HistoryConflictError } from "../history/storage.js";
import type { PrState, TaskState } from "../tasks/states.js";
import type { PublishResult } from "../publisher/publish.js";

export interface TaskOutcome {
  schema_version: "1.0";
  task_id: string;
  state: TaskState;
  pull_requests: Array<{
    repository: string;
    number: number;
    url: string;
    head_sha: string;
    observational_state: PrState;
    human_edited: boolean;
    ci_status: string | null;
  }>;
  last_reconciled_at: string;
  source_updated_at: string;
}

export function observePullRequest(pull: PullRequestRecord): { state: PrState; humanEdited: boolean; ci: string | null } {
  const humanEdited = pull.commits.some((commit) => !commit.bot);
  if (pull.merged) return { state: "MERGED", humanEdited, ci: ciStatus(pull) };
  if (pull.state === "closed") return { state: "CLOSED_UNMERGED", humanEdited, ci: ciStatus(pull) };
  const humanReviews = pull.reviews.filter((review) => !review.bot);
  if (humanReviews.some((review) => review.state === "CHANGES_REQUESTED")) {
    return { state: "CHANGES_REQUESTED", humanEdited, ci: ciStatus(pull) };
  }
  if (humanReviews.some((review) => review.state === "APPROVED")) {
    return { state: "APPROVED", humanEdited, ci: ciStatus(pull) };
  }
  if (pull.draft) return { state: "DRAFT", humanEdited, ci: ciStatus(pull) };
  return { state: "OPEN", humanEdited, ci: ciStatus(pull) };
}

export function deriveTaskState(states: PrState[]): TaskState {
  if (states.length === 0) return "RUNNING";
  if (states.every((state) => state === "MERGED")) return "ACCEPTED";
  if (states.some((state) => state === "MERGED" || state === "DRAFT" || state === "OPEN" || state === "APPROVED" || state === "CHANGES_REQUESTED") && states.some((state) => state !== "MERGED" && state !== "CLOSED_UNMERGED")) {
    return "REVIEW_PENDING";
  }
  if (states.every((state) => state === "MERGED" || state === "CLOSED_UNMERGED") && states.some((state) => state === "CLOSED_UNMERGED")) {
    return "REJECTED";
  }
  return "REVIEW_PENDING";
}

export async function reconcilePublications(options: {
  publications: Array<{ taskId: string; publication: PublishResult }>;
  github: GitHubClient;
  store: HistoryStore;
  now?: Date;
}): Promise<TaskOutcome[]> {
  const now = options.now ?? new Date();
  const outcomes: TaskOutcome[] = [];
  for (const item of options.publications) {
    const pullRequests = [];
    for (const repository of item.publication.repositories) {
      if (!repository.pull_request_url) continue;
      const parsed = parseMockUrl(repository.pull_request_url);
      if (!parsed) continue;
      const pull = await options.github.getPullRequest(parsed.owner, parsed.repo, parsed.number);
      if (!pull) continue;
      const observed = observePullRequest(pull);
      pullRequests.push({
        repository: repository.repository,
        number: pull.number,
        url: pull.html_url,
        head_sha: pull.headSha,
        observational_state: observed.state,
        human_edited: observed.humanEdited,
        ci_status: observed.ci,
      });
    }
    const outcome: TaskOutcome = {
      schema_version: "1.0",
      task_id: item.taskId,
      state: deriveTaskState(pullRequests.map((pull) => pull.observational_state)),
      pull_requests: pullRequests,
      last_reconciled_at: now.toISOString(),
      source_updated_at: now.toISOString(),
    };
    const key = `outcomes/tasks/${item.taskId}/current.json`;
    const body = Buffer.from(JSON.stringify(outcome, null, 2));
    try {
      await options.store.putMutableSnapshot(key, body);
    } catch (error) {
      if (!(error instanceof HistoryConflictError)) throw error;
      const current = await options.store.get(key);
      await options.store.putMutableSnapshot(key, body, sha256(current));
    }
    const observationKey = `outcomes/snapshots/${now.toISOString().slice(0, 10).replaceAll("-", "/")}/${item.taskId}-${now.getTime()}.json`;
    if (!(await options.store.exists(observationKey))) {
      await options.store.putImmutable(observationKey, body, "application/json");
    }
    outcomes.push(outcome);
  }
  return outcomes;
}

function ciStatus(pull: PullRequestRecord): string | null {
  if (pull.checks.length === 0) return null;
  return pull.checks.map((check) => `${check.name}:${check.conclusion ?? "pending"}`).join(",");
}

function parseMockUrl(url: string): { owner: string; repo: string; number: number } | null {
  const mock = /^mock:\/\/github\/([^/]+)\/([^/]+)\/pull\/(\d+)$/.exec(url);
  if (mock?.[1] && mock[2] && mock[3]) return { owner: mock[1], repo: mock[2], number: Number(mock[3]) };
  const live = /^https:\/\/github.com\/([^/]+)\/([^/]+)\/pull\/(\d+)$/.exec(url);
  if (live?.[1] && live[2] && live[3]) return { owner: live[1], repo: live[2], number: Number(live[3]) };
  return null;
}
