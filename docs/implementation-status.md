# Implementation status

Last updated: 2026-10-27.

## Completed milestones

| Milestone | State | Evidence |
|---|---|---|
| 0. Scaffold, catalog, schemas, charter, ADRs, `forge doctor` | Done | `pnpm exec tsc --noEmit` and `pnpm exec eslint .` pass. `tests/e2e/doctor.test.ts` passes. |
| 1. Task validation, catalog, fixture remotes, `forge prepare` | Done | `tests/integration/local-flow.test.ts` prepares two bare repositories at pinned SHAs. |
| 2. Harness interface, fake harness, Pi argv builder, verification, patch bundle | Done | Unit tests cover the JSONL parser, token totals, and patch rejection. The integration flow produces one publishable patch. |
| 3. Mock GitHub publisher, fast-forward push, idempotency, partial publish | Done | Integration tests publish one draft, skip a second publish, refuse a moved branch, and resume a partial publish. |
| 4. Filesystem and S3 history stores, implement/validate/reconcile workflows | Done for local history. Workflows are real YAML that call the CLI. S3 is implemented and unit-tested with a fake object client. It is not pointed at a bucket. |
| 5. Metrics, retrospective report, proposal files, weekly workflow | Done for the deterministic analyzer. `buildRetro` cites run ids, rejects unknown ids, and does not edit skills. |
| 6. Threat tests and operational docs | Done for the automated cases. Live GitHub App and AWS setup are documented and not provisioned. |

`pnpm exec vitest run` on 2026-10-27: 4 files, 19 tests, all passed.

## Decisions

- The sandbox build profile is `node-script` (`node --test`), not `node-example`. Local verification does not download packages. `node-example` remains in the catalog for a future pnpm repository.
- Metarepo tasks use `task/<id>`; target publish branches use `feature/<id>` (`docs/adr/0009-task-and-feature-branches.md`).
- Local remotes live in gitignored `.forge-runtime/local-remotes.json`. They can replace the clone URL of a catalog alias. They cannot add an alias or change `read-only` to `read-write`.
- Publication defaults to dry-run. `--apply` requires a durable evidence receipt. A GitHub remote also requires `FORGE_ALLOW_LIVE_PUBLISH=1`.
- The retrospective command is deterministic. It does not call Pi. The Pi adapter can build a read-only argv (`--tools read,grep,find,ls`), and the weekly analyzer job has no write token.
- TypeScript 5.9 is pinned so ESLint can run. TypeScript 7 is installed by neither the compiler nor the linter.
- `@earendil-works/pi-coding-agent` 1.4.0 is the pinned package. On Node 22.9 its `pi` binary exits with `ERR_REQUIRE_ESM`. Doctor reports that as optional. The fake harness is the executed path in tests.

## Remaining work

- Run `pi --help` on a Node build that can load the 1.4.0 CLI, and adjust argv if the flags differ. Do not treat the current binary failure as a successful Pi run.
- Configure a GitHub App, protected `main`, and the `forge-publish` environment before any live publish. Set `FORGE_APP_CLIENT_ID` (preferred) or legacy `FORGE_APP_ID`, plus `FORGE_APP_PRIVATE_KEY`. Workflows pass `client-id` to `actions/create-github-app-token` and skip minting when the id is unset.
- Create the private history bucket, OIDC role, encryption, and lifecycle rules outside this repository. Until `FORGE_HISTORY_BUCKET` and `FORGE_HISTORY_WRITER_ROLE_ARN` are set, the implement workflow stops before the agent.
- The retrospective publisher writes report files and mints a metarepo token when dispatched with `dry_run=false`. It does not yet push a branch or open the draft pull request. That step needs the same explicit GitHub App setup and must not edit `.agents/skills/`.
- Action SHAs were resolved from tag objects on 2026-10-27 (`actions/checkout` v7.0.1, `actions/setup-node` v7.1.0, `actions/upload-artifact` v7.0.2, `actions/download-artifact` v8.0.2, `actions/create-github-app-token` v3.3.0, `aws-actions/configure-aws-credentials` v6.3.0, `pnpm/action-setup` v6.1.0). Re-check them before relying on Actions in production.

## Not done, on purpose

Deferred items in section 22 of the design are not implemented: subagents, issue discovery, automatic merges, a dashboard, embeddings, and self-applying skill edits.
