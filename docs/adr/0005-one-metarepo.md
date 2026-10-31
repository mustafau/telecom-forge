# ADR 0005: One metarepository

## Status

Accepted

## Context

The telecom services are already separate repositories with their own review rules. Moving them into a monorepo or a submodule tree is not the goal.

## Decision

This repository is the control plane for this team's telecom work: tasks, catalog, skills, workflows, and retrospectives. Source repositories stay independent. `repos/` is a gitignored checkout, not a submodule.

## Consequences

A task id is the logical work identifier. The metarepo uses `task/<id>`; each source repository gets its own `feature/<id>` commit and draft pull request (ADR 0009). The catalog is telecom-specific and is not a multi-tenant product configuration.
