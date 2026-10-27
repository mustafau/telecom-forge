# History and retrospectives

## Stores

`HistoryStore` has `putImmutable`, `get`, `exists`, `list`, and `putMutableSnapshot`.

`FilesystemHistoryStore` writes `.forge-runtime/history`. Immutable puts fail if the key exists. Mutable task outcomes require the previous SHA-256. `get` checks the sidecar checksum.

`S3HistoryStore` uses `If-None-Match: *` for immutable objects and `If-Match` for outcome snapshots. It is constructed only when `FORGE_HISTORY_BUCKET` is set. This repository does not create a bucket, a KMS key, or an IAM role.

Suggested production settings, to be applied by a person in AWS:

- Block public access.
- Default encryption, preferably SSE-KMS.
- Versioning on.
- Lifecycle: raw run objects expire after `raw_retention_days` (default 120). Structured metadata expires after `metadata_retention_days` (default 400).
- The GitHub OIDC role can write only `telecom-forge/v1/` in that bucket.

Object keys:

```text
tasks/<id>/revisions/<task-sha>/snapshot.json
runs/<yyyy>/<mm>/<dd>/<run-id>/run-summary.json
runs/<yyyy>/<mm>/<dd>/<run-id>/events.normalized.jsonl
outcomes/tasks/<id>/current.json
outcomes/snapshots/<yyyy>/<mm>/<dd>/<id>-<time>.json
```

GitHub Actions artifacts are uploaded with `retention-days: 7`. They are a recovery copy, not the system of record. A nondurable demo fails the evidence job so publish does not run.

## Reconciliation

`forge reconcile --since YYYY-MM-DD` reads publication records and the GitHub client. Locally that client is the mock store at `.forge-runtime/github-mock/prs.json`. A merged set of required pull requests becomes task state `ACCEPTED`. A closed unmerged set becomes `REJECTED`. Anything still open stays `REVIEW_PENDING`. Commits that are not from the bot are marked `human_edited`.

The daily workflow is 11:17 UTC. It fails closed when the history bucket is unset.

## Retrospective

`forge retro --week 2026-W43` computes metrics and prints a report. `--propose` writes `retrospectives/<year>/<week>.md` and `improvements/proposals/<id>.json` with state `PROPOSED`.

Week boundaries are Monday 00:00 inclusive through the next Monday 00:00 exclusive in `America/Los_Angeles`. The scheduled cron is 15:17 UTC Monday so the previous week is already complete in both PST and PDT. If GitHub drops the schedule, dispatch the workflow with the `week` input.

Recurring bottlenecks are categories that appear in at least two runs. `MISSING_OR_STALE_CONTEXT` proposes a documentation change to `organization-navigation`. The proposal is a file. It is not applied to the skill. A Pi retrospective can be added behind the same finding schema; unknown evidence ids are rejected either way.

Improvement states are `PROPOSED -> TRIAGED -> APPROVED -> IMPLEMENTED -> MEASURING -> EFFECTIVE | INEFFECTIVE | INCONCLUSIVE`, plus `REJECTED` and `SUPERSEDED`. Moving those states is a human edit to the proposal file.
