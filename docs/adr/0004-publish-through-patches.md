# ADR 0004: Publish through patches

## Status

Accepted

## Context

The process that edits code must not be the process that can push it.

## Decision

The agent job produces a hashed patch bundle. A different publisher job checks the bundle hash, the task SHA, and the policy SHA, applies the patch with `git apply`, and fast-forwards a feature branch. It does not invoke Pi and does not execute scripts from the patched tree. Empty diffs are `NO_CHANGE` and do not open a pull request. A partial multi-repository publish is recorded and can be resumed.

## Consequences

The publisher can reject a hostile patch even if the agent produced it. There is no cross-repository transaction; `PARTIAL_PUBLISH` is an explicit state.
