# ADR 0003: Execution history storage

## Status

Accepted

## Context

Run evidence is too large and too sensitive for the Git branch, and tests must run without AWS.

## Decision

`FilesystemHistoryStore` is the local and test backend. `S3HistoryStore` is the production backend. Immutable keys reject overwrites. Task outcome snapshots use compare-and-swap. The implement workflow stops before the agent when the bucket and writer role are unset, unless a nondurable demo is requested, and that demo cannot publish. GitHub Actions artifacts are retained for seven days as a recovery copy.

## Consequences

Weekly reports and approved skills stay in Git. Raw sessions do not. Creating the bucket, encryption, and lifecycle rules is an operator step documented in `docs/history-and-retro.md`, not something this program does.
