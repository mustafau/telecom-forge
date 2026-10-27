---
name: code-review-readiness
description: Leave a reviewable change summary, test evidence, and rollback note for each draft pull request.
---

# Review readiness

The final summary should let a reviewer decide without reading a model transcript.

- List repositories and paths that changed.
- List the build-profile command ids and their pass or fail result.
- Note contract compatibility and any migration or rollback limit.
- Point at related draft pull requests by task id when more than one repository changed.
- Do not include secrets, raw chain-of-thought, or customer data.

A draft pull request is ready for human review. It is not accepted.

Last verified: 2026-10-27.
