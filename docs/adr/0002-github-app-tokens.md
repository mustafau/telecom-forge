# ADR 0002: GitHub App tokens

## Status

Accepted

## Context

`GITHUB_TOKEN` belongs to this metarepository. It cannot open pull requests in other private repositories, and it must not be available to the coding agent.

## Decision

A GitHub App installation token is minted inside the job that needs it. Prepare and reconcile request contents and pull-request read. Publish requests contents and pull-request write on the target repositories, in the `forge-publish` environment. The retrospective publisher requests write on this metarepository only. The agent job does not mint a token. Live publication also requires `FORGE_ALLOW_LIVE_PUBLISH=1`. Local runs use filesystem remotes and a mock pull-request store.

## Consequences

Tokens are short-lived and job-scoped. The workflow uses `actions/create-github-app-token` pinned to a commit. No organization id is hard-coded; `YOUR_GITHUB_OWNER` stays a placeholder until a person sets `FORGE_GITHUB_OWNER`.
