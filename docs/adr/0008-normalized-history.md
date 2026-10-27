# ADR 0008: Normalized history

## Status

Accepted

## Decision

Harness events are reduced to a stable JSONL schema with deterministic ids. Usage is taken from completed assistant messages, not streaming snapshots. Normalized events store categories such as `test` or `git`, not full commands, prompts, or file contents. Retrospectives read summaries and these events. Raw transcripts remain in the private store.

## Consequences

Replacing Pi does not require rewriting the retrospective or the run summary. Re-ingesting the same stream does not double-count usage or events.
