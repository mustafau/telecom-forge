# Architecture

Telecom Forge is one Git repository. Each telecom service repository keeps its own history, default branch, CI, and review rules. `repos/` is a gitignored checkout directory.

The original proposal is `docs/original-proposal.md`. This page describes the implementation.

```text
Developer task branch
        |
        v
Trusted default-branch workflow
        |
        +-- validate and prepare (read-only token)
        +-- agent and verify (no GitHub or cloud write credentials)
        +-- persist evidence (history-writer role only)
        +-- publish (GitHub App write token, draft pull requests)
        +-- finalize (summary; no merge)
```

The coding harness implements `CodingHarness` in `src/harness/types.ts`. Pi is the first adapter. Tests use a fake adapter that emits the same JSONL events. Publisher, history, and retrospective code do not parse Pi flags.

Trusted files come from the control SHA: workflows, `catalog/`, `.agents/skills/`, prompts, and this program. Task files come from the task SHA. A task branch cannot replace the workflow that runs it, because `implement-task.yml` is `workflow_dispatch` on the trusted revision.

The agent may edit the writable checkouts. The verifier and publisher reject every other change, including workflow files, `.git`, symlinks, binaries, and secret-like content. Those checks are separate from the prompt.

History has three layers:

1. Raw evidence in the private history store.
2. Normalized events and run summaries.
3. Reviewed retrospectives and skills in Git.

A run status of `PUBLISHED` means draft pull requests exist. `ACCEPTED` is recorded later, when every required pull request is merged.
