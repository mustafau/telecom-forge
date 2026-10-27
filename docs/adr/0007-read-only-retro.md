# ADR 0007: Read-only retrospective

## Status

Accepted

## Decision

The weekly analyzer computes metrics in TypeScript and may call Pi with read-only tools. It has no metarepository write token. A separate publisher job can open a draft pull request. Findings that cite unknown run ids are rejected. `--propose` writes report and proposal files and does not change `.agents/skills/`.

## Consequences

An improvement becomes authoritative only after a person merges it. The next retrospective can measure that change; this one does not apply it.
