# Repository map

These entries are placeholders from `catalog/workspace.yaml`. They are not claims that a GitHub organization or source repository already exists.

| Alias | Access | Owner placeholder | Checkout | Build profile | Responsibility |
|---|---|---|---|---|---|
| `telecom-api-sandbox` | read-write | `YOUR_GITHUB_OWNER` | `repos/telecom-api-sandbox` | `node-script` | Telecom API sandbox; writable target |
| `shared-contracts` | read-only | `YOUR_GITHUB_OWNER` | `repos/shared-contracts` | `none` | Illustrative shared schemas a task may read |

Add a repository by a reviewed pull request to `catalog/workspace.yaml` and this map. A task file cannot add one.

Local rehearsal points these aliases at fixture Git remotes in `.forge-runtime/local-remotes.json`. That file is created by `scripts/local-setup.sh` and is gitignored.
