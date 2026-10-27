# ADR 0001: Pi as the first harness

## Status

Accepted

## Context

The control plane needs a headless coding agent with explicit skill loading and a structured event stream. The rest of the system must survive replacing that agent.

## Decision

Pi (`@earendil-works/pi-coding-agent` 1.4.0) is the first harness, behind `CodingHarness`. JSON mode is used. The adapter passes `--no-extensions`, `--no-skills`, `--no-context-files`, and `--no-mcp`, then adds only the trusted extension, skill directory, and prompts. A fake harness implements the same interface for offline tests.

## Consequences

Publisher, history, and retrospective code depend on normalized events, not Pi's CLI. A second harness can be added without changing task or pull-request contracts. Pi's raw transcript is stored as evidence and is not copied into the system prompt.
