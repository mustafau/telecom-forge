# Architecture decision records

Significant decisions about **this metarepository** (control plane, harness, publish, history, security, workflows, catalog contracts) live here as numbered ADRs.

Service-repository product choices belong in that repository's own docs, not here.

## When to add an ADR

Write a new ADR when you change or introduce any of:

- Harness choice, adapter contract, or how skills/extensions are loaded
- Publish path (patches, tokens, dry-run / live gates)
- History storage or retention
- Trust boundaries (agent vs publisher, credentials, protected paths)
- Catalog or task contracts that other repos or workflows depend on
- Trigger model, retro loop, or anything that expands agent privilege
- A deliberate tradeoff that future agents would otherwise re-litigate

Skip an ADR for routine bugfixes, renames, test-only helpers, and doc wording that does not change behavior.

## Format

Next file: `NNNN-kebab-title.md` where `NNNN` is one more than the highest existing number.

```markdown
# ADR NNNN: Short title

## Status

Accepted | Proposed | Superseded by ADR NNNN

## Context

Why a decision is needed.

## Decision

What we chose, concretely enough to implement against.

## Consequences

What becomes easier, harder, or forbidden.
```

Keep each ADR short. Prefer linking to code or schemas over restating them.
