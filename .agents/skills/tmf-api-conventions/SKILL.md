---
name: tmf-api-conventions
description: Locate the local TM Forum schema and the API version actually implemented before changing requests, errors, events, or pagination.
---

# TM Forum conventions in this workspace

Normative TM Forum behavior is not copied into this skill. The source repository is the authority for which API and version are implemented.

1. Find the schema, OpenAPI file, or contract test in the checked-out repository or in `shared-contracts` when that alias is in the task context.
2. Record the API name and version you found. Do not assume it matches another repository.
3. Follow the local error, event, and pagination shapes already used by that version.
4. Keep default behavior backward compatible unless the task explicitly says otherwise.
5. If the local contract and the task disagree, stop and report the ambiguity.

Last verified: 2026-10-27. No external TMF document is vendored here.
