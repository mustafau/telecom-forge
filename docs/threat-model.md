# Threat model

The coding agent is allowed to read the checked-out source and run its tools. It is not allowed to hold the credentials that publish or that write history. Prompts are not the boundary that enforces that.

| Threat | Mitigation in this repository |
|---|---|
| Task text asks for more repositories or secrets | Scope is the intersection of the task and the trusted catalog. Secrets are redacted from normalized evidence. The publisher re-checks the patch. |
| Task branch edits workflows, catalog, or skills | `workflow_dispatch` uses the trusted revision. Prepare archives skills from the control SHA. |
| Symlink, `.git` hook, workflow file, or path traversal in a patch | `assertPatchText` rejects them before `git apply`. |
| Branch moves between prepare and publish | Fast-forward push only. A different head returns `BLOCKED_STALE_BASE`. |
| Agent job receives a write token | The agent job has `contents: read`, unsets `GITHUB_TOKEN`, and does not mint an app token or assume AWS. |
| History write fails | Publish requires a durable receipt and checks that each listed object exists. |
| Retrospective edits its own skills | The analyzer has no write token. `--propose` writes `retrospectives/` and `improvements/proposals/` only. Findings with unknown run ids are dropped. |
| Live publish by accident | Default is dry-run. GitHub remotes also require `FORGE_ALLOW_LIVE_PUBLISH=1`. Placeholder owner `YOUR_GITHUB_OWNER` is not cloned unless a local remote is configured. |

Hosted runners are not a complete sandbox. The model API key, when present, is visible to a shell the agent runs. Do not describe that key as unreachable. Do not put GitHub App private keys or AWS credentials in the agent job.

Raw sessions are private history objects. Normalized events store command categories such as `test` or `git`, not full command lines. Retention defaults are 120 days for raw objects and 400 days for metadata, and production must set those on the bucket. This repository does not create the bucket.

## Emergency stop

Cancel the GitHub Actions run. In-progress work is not cancelled by a newer dispatch of the same task. To stop local work, interrupt the process; do not delete `.forge-runtime/history` if you still need the attempt. Published drafts remain open until a person closes them. Nothing in this system merges them.

## Incident notes

Record the run id, task SHA, control SHA, and publication status. Do not paste raw session files into a public issue. A missing history receipt means the run must not be described as published.
