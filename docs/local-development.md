# Local development

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm test
pnpm forge doctor
```

Node.js 22 or newer is required. This workspace was developed on Node 22.9. TypeScript is pinned to 5.9 because typescript-eslint does not yet lint TypeScript 7. `engine-strict` is off because some current lint packages declare a newer Node minimum; the project itself runs on the installed Node 22.

## Optional environment

| Variable | Required for |
|---|---|
| `FORGE_MODEL_PROVIDER`, `FORGE_MODEL_ID` | A real Pi run (Gemini: `google` / `gemini-3.5-flash-lite`) |
| `GEMINI_API_KEY` | Pi → Google Gemini (https://aistudio.google.com/apikey) |
| `FORGE_PI_BIN` | Override the `pi` binary from `node_modules/.bin/pi` |
| `FORGE_FAKE_HARNESS_PLAN` | Offline fake harness edits |
| `FORGE_LOCAL_REMOTES` | Alternate path to the local remote map |
| `FORGE_HISTORY_BUCKET`, `AWS_REGION` | S3 history |
| `FORGE_HISTORY_BACKEND=s3` | Force the S3 store |
| `FORGE_GITHUB_TOKEN` or the `FORGE_GITHUB_APP_*` trio | Live GitHub calls |
| `FORGE_ALLOW_LIVE_PUBLISH=1` | Push to a GitHub remote |

Copy nothing into a committed `.env`. `.env.example` lists the names with empty values.

## Fixture repositories

`bash scripts/local-setup.sh` creates bare repositories under `.forge-runtime/fixtures` for `telecom-api-sandbox` and `shared-contracts`, then writes `.forge-runtime/local-remotes.json`. Both directories are gitignored.

The sandbox build profile is `node-script` (`node --test` and a no-op build). `node-example` remains in the catalog as the pnpm-shaped profile from the design and is not used by the sandbox, so local tests do not download packages.

## Tests

- `tests/unit` covers schemas, the Pi parser, token totals, state transitions, patch rejection, retries, week math including DST, metrics, proposals, redaction, and both history stores.
- `tests/integration/local-flow.test.ts` runs prepare, the fake harness, verification, publish, idempotency, a moved branch, a read-only edit, a zero-exit agent failure, partial publish, reconciliation, and a retrospective.
- `tests/security` checks control SHA versus task-branch skills, malicious patches, and the agent job's workflow permissions.
- `tests/e2e/doctor.test.ts` runs the CLI.

Pi is pinned at `@earendil-works/pi-coding-agent` 1.4.0. The adapter passes `--mode json`, `--no-extensions` plus an explicit extension, `--no-skills` plus an explicit skill directory, `--no-context-files`, and `--no-mcp`. Retro mode adds `--tools read,grep,find,ls`. Each run gets a local `PI_CODING_AGENT_DIR` with free-tier-sized retry delays (≤60s). On Node 22.9 the published `pi` binary exits with `ERR_REQUIRE_ESM` before printing help. `forge doctor` reports that as an optional failure. The fake harness is the verified offline execution path until the CLI runs on the installed Node.
