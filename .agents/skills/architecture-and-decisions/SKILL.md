---
name: architecture-and-decisions
description: Follow recorded architecture decisions and boundaries before changing a telecom service.
---

# Architecture and decisions

Approved decisions live in `docs/adr/`. The catalog describes which repository owns which service.

- The metarepository is the control plane. Source repositories remain the code source of truth.
- Agents propose changes. Deterministic commands verify them. A separate publisher writes draft pull requests.
- Do not introduce a new service boundary, a shared database, or a deployment step from a task.
- If an ADR and the code disagree, report the disagreement and follow the code's current behavior unless the task says to change it.

Last verified: 2026-10-27 against `docs/adr/`.
