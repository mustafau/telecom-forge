# Workflow

## Developer path

1. Branch from the protected default branch: `task/TF-0001`.
2. `pnpm forge init-task --id TF-0001 --branch task/TF-0001`.
3. Edit the task and commit it.
4. `pnpm forge validate-task --task-ref task/TF-0001 --task-path tasks/TF-0001/task.yaml`.
5. Start **Implement task** from the Actions tab on the default branch, or:

```bash
gh workflow run implement-task.yml --ref main \
  -f task_branch=task/TF-0001 \
  -f task_path=tasks/TF-0001/task.yaml \
  -f dry_run=true
```

`dry_run` defaults to true. Set it to false only after the GitHub App and history bucket are configured. The workflow still will not merge.

The metarepo task branch is `task/<id>`. Forge publishes to `feature/<id>` on each writable target repository.

## Local rehearsal

`scripts/local-setup.sh` creates fixture bare repositories and `.forge-runtime/local-remotes.json`. Those remotes satisfy the catalog aliases without contacting GitHub.

```bash
pnpm forge prepare --task-ref task/TF-0001 --task-path tasks/TF-0001/task.yaml --control-ref main
pnpm forge run --prepared .forge-runtime/runs/<run-id> --harness fake
pnpm forge verify --run-id <run-id>
pnpm forge bundle --run-id <run-id>
pnpm forge history persist --run-dir .forge-runtime/runs/<run-id>
pnpm forge publish --bundle .forge-runtime/runs/<run-id> --apply
```

Outside CI, omit `--apply` for a dry run. The fake harness reads `FORGE_FAKE_HARNESS_PLAN`. That file is a test seam. Task YAML cannot select it.

## States

Task: `DEFINED -> READY -> RUNNING -> REVIEW_PENDING -> ACCEPTED | REJECTED | ABANDONED`.

Run: `CREATED -> VALIDATING -> PREPARING -> AGENT_RUNNING -> VERIFYING -> BUNDLING -> PUBLISHING -> PUBLISHED`, plus `NO_CHANGE`, `VALIDATION_FAILED`, `AGENT_FAILED`, `VERIFICATION_FAILED`, `PUBLISH_FAILED`, `PARTIAL_PUBLISH`, `CANCELLED`, `TIMED_OUT`, `BLOCKED_STALE_BASE`, and `HISTORY_PERSISTENCE_FAILED`.

Pull request observations: `DRAFT`, `OPEN`, `CHANGES_REQUESTED`, `APPROVED`, `MERGED`, `CLOSED_UNMERGED`. They are not assumed to move in a straight line.

## Recovery

| Failure | What you do |
|---|---|
| Invalid task or unknown repository | Fix the task commit and run again. The previous attempt keeps its SHA. |
| Missing read permission | Install the GitHub App on the source repository. The agent does not start. |
| Pi exits 0 but the final turn failed | The run is `AGENT_FAILED`. No pull request is opened. Inspect `harness/pi-events.jsonl` and rerun. |
| Tests fail | Evidence is stored. Source changes are not published. |
| Branch moved | `BLOCKED_STALE_BASE`. Re-prepare from the new head. Nothing is force-pushed. |
| One of two repositories fails | `PARTIAL_PUBLISH`. Re-run publish for the same bundle. The finished repository is skipped. |
| History store unavailable | `HISTORY_PERSISTENCE_FAILED`. Publication does not start. The Actions artifact is only a seven-day recovery copy. |
| Run cancelled | Partial evidence is kept when the job can still write it. Start a new attempt from the same task SHA. |

Concurrency key `forge-<task-branch>` does not cancel an in-progress run.

## Commands

`pnpm forge <command> --help` prints the arguments. `--json` prints the machine-readable result to stdout and errors to stderr.

`forge doctor`, `init-task`, `validate-task`, `prepare`, `run`, `verify`, `bundle`, `publish`, `history persist`, `history show`, `reconcile`, and `retro` are implemented. `retro --propose` writes a report and proposal files. It does not modify `.agents/skills/`.
