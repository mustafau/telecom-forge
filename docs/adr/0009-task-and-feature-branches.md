# ADR 0009: Separate task and feature branches

## Status

Accepted

## Context

The metarepo task revision and the branches Forge publishes on target repositories used the same name (`feature/<id>`). That collides when this metarepository is itself a writable target: publishing would overwrite the branch that still holds `tasks/`.

## Decision

A task declares two branches:

- `task_branch` (`task/<id>`): metarepo branch that carries the task files; `--task-ref` / workflow `task_branch` must match it.
- `feature_branch` (`feature/<id>`): branch Forge fast-forwards and opens as a draft PR on each writable target repository.

They must differ. `init-task --branch` sets the metarepo `task_branch` and fills `feature_branch` as `feature/<id>`.

## Consequences

App and self-targeted PRs keep the familiar `feature/` prefix. Metarepo task work uses `task/`. Policy permits `task/`, `feature/`, and `agent/`.
