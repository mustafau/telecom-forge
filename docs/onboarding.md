# Onboarding

About ten minutes, with Node, pnpm, and Git. No cloud account.

1. `pnpm install --frozen-lockfile`
2. `pnpm forge doctor`  
   Confirm the catalog check passes and that S3 and the GitHub App are described as optional.
3. `pnpm test`  
   This builds fixture repositories, runs the fake harness, and publishes to local bare repos plus a mock pull-request store.
4. Read `tasks/TF-0001/task.yaml`.  
   `telecom-api-sandbox` is writable. `shared-contracts` is context. Both owners are `YOUR_GITHUB_OWNER` until a reviewed catalog change replaces them.
5. Read `.agents/skills/organization-navigation/SKILL.md` and `catalog/repositories.md`.
6. `bash scripts/local-setup.sh` if you want those fixtures left on disk for a manual CLI run.

A task you add has to be committed before `validate-task` can see it. The implementation workflow is started manually from the default branch so a feature branch cannot supply its own workflow file.

When you are ready to point this at real repositories, change only the catalog in a pull request, register the GitHub App described in `docs/adr/0002-github-app-tokens.md`, set repository variable `FORGE_APP_CLIENT_ID` and secret `FORGE_APP_PRIVATE_KEY`, and set the history bucket variables. Leave `dry_run` true for the first dispatch.
