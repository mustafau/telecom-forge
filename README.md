# Telecom Forge

Telecom Forge is the control-plane repository for AI-assisted engineering across independent telecom source repositories. It does not replace GitHub, code review, CI, or deployment, and it does not merge those repositories into a monorepo.

A developer commits a task on a `task/<id>` branch. A trusted workflow on the default branch reads that task at a pinned commit, checks out only the approved repositories, runs one coding harness, verifies the result with trusted commands, and — only when explicitly enabled — publishes draft pull requests on `feature/<id>` in each target repository. Humans review and merge those pull requests. A weekly retrospective reads the evidence and proposes improvements. It does not edit trusted skills by itself.

The names in `catalog/workspace.yaml` are placeholders. Nothing in this repository assumes a real GitHub organization, a real source repository, or a provisioned cloud account.

## What lives where

| Path | Role |
|---|---|
| `tasks/<id>/` | Untrusted task definition on a developer branch |
| `catalog/` | Trusted repository allowlist, build profiles, and service map |
| `.agents/skills/` | Trusted on-demand instructions |
| `repos/` | Gitignored ephemeral checkouts. Not submodules |
| `.forge-runtime/` | Gitignored local runs, history, and fixture remotes |
| `retrospectives/` | Human-reviewed weekly reports |
| `docs/adr/` | Decisions for this telecom workspace |

Source code stays in the independent repositories named by the catalog. Add a repository by editing `catalog/workspace.yaml` in a reviewed pull request. A task file cannot add one.

## Local quick start

Requirements: Node.js 22 or newer, pnpm 10, and Git. No GitHub token and no AWS account are required.

```bash
pnpm install --frozen-lockfile
pnpm forge doctor
pnpm test
bash scripts/local-setup.sh
bash scripts/smoke-test.sh
```

`pnpm forge doctor` checks the catalog and explains which optional credentials are absent. Local history is stored under `.forge-runtime/history`.

Create a task:

```bash
git checkout -b task/TF-0002
pnpm forge init-task --id TF-0002 --branch task/TF-0002
# edit tasks/TF-0002/task.yaml and task.md, then commit
pnpm forge validate-task --task-ref task/TF-0002 --task-path tasks/TF-0002/task.yaml
```

`validate-task` reads the committed revision. Uncommitted edits are ignored on purpose. See `docs/adr/0009-task-and-feature-branches.md`.

A writable repository is listed under `scope.writable_repositories` and must already be `read-write` in the catalog. A context repository is checked out read-only. The sample task `tasks/TF-0001` writes `telecom-api-sandbox` and reads `shared-contracts`.

## How a change is published

The publisher does not run the coding agent. It applies a hashed patch, commits it on `feature/<task-id>` inside each source repository, and opens or updates one draft pull request per repository. The commits use trailers `Task-ID` and `Forge-Run-ID`. A push is a fast-forward. If the branch moved, the publisher stops with `BLOCKED_STALE_BASE` and does not force-push.

Several repositories produce several draft pull requests that share the task id. If one repository publishes and another fails, the run is `PARTIAL_PUBLISH`. The successful draft stays open. Run `forge publish --bundle <run-dir> --apply` again to resume the missing repository.

Publication is dry-run unless `--apply` is passed. `--apply` also requires a durable evidence receipt. Live GitHub remotes additionally require `FORGE_ALLOW_LIVE_PUBLISH=1`. The default GitHub Actions input `dry_run` is `true`.

## History and the weekly retrospective

Each run writes a summary and normalized events. Raw Pi output stays in the history store, not in Git. Filesystem history is the local backend. Production GitHub Actions refuses to start the agent until `FORGE_HISTORY_BUCKET` and `FORGE_HISTORY_WRITER_ROLE_ARN` are configured, because publication is blocked without durable evidence.

The weekly workflow runs Monday at 15:17 UTC, which is 08:17 PDT and 07:17 PST, and selects the previous completed week in `America/Los_Angeles`. Metrics are computed in TypeScript. Proposals cite run ids. Unsupported citations are rejected. The report is written under `retrospectives/` only when `--propose` is set, and skills are not modified.

## Reproduce a run

A prepared manifest records `task_sha`, `control_sha`, source `base_sha` values, the policy hash, and the harness name. Re-run preparation with the same `--task-ref` and `--control-ref`. The task revision does not move to a newer commit unless you pass that newer ref.

## Permissions

| Use | Configuration | Present in the agent job |
|---|---|---|
| Read source repositories | GitHub App, contents read | No |
| Publish draft pull requests | GitHub App, contents and pull requests write, environment `forge-publish` | No |
| Retrospective draft pull request | GitHub App write on this metarepository only | No |
| Durable history | AWS OIDC role limited to the history bucket prefix | No |

See `docs/local-development.md` for the command list and `docs/workflow.md` for recovery. `docs/implementation-status.md` records what is implemented and what still needs real credentials.
