---
name: architecture-and-decisions
description: Follow recorded architecture decisions and record new metarepo decisions as ADRs before locking in control-plane changes.
---

# Architecture and decisions

Approved decisions live in `docs/adr/`. Index and template: `docs/adr/README.md`. The catalog describes which repository owns which service.

## Follow existing decisions

- The metarepository is the control plane. Source repositories remain the code source of truth.
- Agents propose changes. Deterministic commands verify them. A separate publisher writes draft pull requests.
- Do not introduce a new service boundary, a shared database, or a deployment step from a task.
- If an ADR and the code disagree, report the disagreement and follow the code's current behavior unless the task says to change it.

## Record new metarepo decisions

When work on **this** repository changes architecture, trust, or shared contracts, write an ADR in the same change:

1. Check `docs/adr/` for an existing decision. Update status if superseding; otherwise add the next numbered file.
2. Use Context / Decision / Consequences. Keep it short and concrete.
3. Required for: harness choice or adapter contract; publish / token / dry-run gates; history storage; agent vs publisher credentials or protected paths; catalog or task schema contracts; trigger or retro privilege model.
4. Not required for: routine bugfixes, renames, test helpers, or docs that do not change behavior.
5. Mention the ADR path in the change summary. Do not apply autonomous skill edits from a retrospective; proposals only.

Last verified: 2026-10-27 against `docs/adr/`.
