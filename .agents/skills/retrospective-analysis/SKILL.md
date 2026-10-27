---
name: retrospective-analysis
description: Separate repeated evidence-backed bottlenecks from one-off failures and propose reviewable skill or documentation changes.
---

# Retrospective analysis

Use the deterministic metrics and the run ids supplied in the dataset. Do not request raw transcripts.

1. Cite a run id for every finding. An unknown run id is unsupported.
2. Separate observation, hypothesized cause, proposed action, and how to measure it.
3. Treat two or more runs with the same bottleneck as a candidate pattern. Treat one run as an isolated incident.
4. Propose a skill or catalog change only when the evidence is in the dataset. Do not edit the skill yourself.
5. Say when a previous improvement has too little data to judge.
6. Do not claim that correlation is the root cause.

Last verified: 2026-10-27 against `src/retrospective/`.
