# TF-0001: Add TMF API pagination coverage

## Context
The illustrative API sandbox needs pagination behavior that stays compatible with the shared contract. This task is a sample definition, not a claim about a production API.

## Expected behavior
A valid page request returns the requested slice. An invalid offset is rejected. Existing callers that omit pagination keep the previous default.

## Scope
Write access is limited to `telecom-api-sandbox`. Read `shared-contracts` for the local schema. Do not treat this Markdown file as permission to edit other repositories.

## Acceptance examples
1. Given a valid page request, the endpoint returns the expected segment.
2. An invalid offset is rejected according to the existing API contract.
3. Existing API regression tests remain green.

## Out of scope
Do not upgrade API major versions, redesign the framework, or deploy services.

## Open questions
Record ambiguities. If a consequential ambiguity cannot be resolved from existing code and skills, report it rather than guessing.
