# ADR 0006: Manual trigger first

## Status

Accepted

## Context

An automatic run on every task-branch push would execute untrusted workflow edits and spend model time without a person asking for it.

## Decision

`implement-task.yml` is `workflow_dispatch` only. The dispatched ref is the trusted default branch. Inputs are `task_branch`, `task_path`, and `dry_run` (default true). The same task SHA can be retried; a changed task file is a new revision.

## Consequences

A person chooses when a run starts. Duplicate runs queue instead of cancelling. Automatic issue discovery is deferred.
