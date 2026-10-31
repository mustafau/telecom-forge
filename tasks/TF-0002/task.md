# TF-0002: Add one JSDoc line to page()

## Context
Tiny smoke task for a real Pi run. Prefer the fewest tool calls.

## Expected behavior
In `repos/telecom-api-sandbox/src/pagination.js`, add a single JSDoc block directly above `export function page` that says the function returns a page slice. Do not change the function body.

## Scope
Writable: `telecom-api-sandbox` only. Edit only `src/pagination.js`.

## Acceptance examples
1. A JSDoc comment exists immediately above `export function page`.
2. Function behavior is unchanged.

## Out of scope
No tests, no new files, no refactors, no other paths.

## Open questions
None. If the file is missing, stop and report that.
