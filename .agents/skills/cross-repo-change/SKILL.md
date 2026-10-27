---
name: cross-repo-change
description: Plan compatible changes across more than one telecom repository and the separate draft pull requests they require.
---

# Cross-repository changes

Each writable repository gets its own commit and draft pull request. The shared name is the task's `feature_branch`, not one Git branch that spans remotes.

1. Change the contract before the consumer when the consumer would not compile against the old contract.
2. Keep the old behavior working until the task says a version boundary is allowed.
3. Name every repository in the task's writable or context lists. Do not edit a read-only checkout.
4. If one repository publishes and another fails, the result is partial. Do not claim the set is complete.
5. Contract tests in the read-only repository are evidence. They are not a place to commit the change unless that alias is writable.

Last verified: 2026-10-27 against the publisher rules in this metarepository.
