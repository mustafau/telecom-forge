---
name: organization-navigation
description: Find the correct telecom repository, module, service owner, integration, and tests for a development task. Use before editing unfamiliar services or coordinating changes across repositories.
---

# Navigate the organization

Facts live in `catalog/repositories.md`, `catalog/services.md`, and `catalog/dependency-map.md`. Conventions live in this skill. Recommendations can change and must be checked against the checkout.

1. Read the catalog files from the metarepo root before searching source.
2. Search only checked-out, approved repositories under `repos/`.
3. Identify the owning service and the direction of integrations.
4. Check contract versions in code rather than assuming a TM Forum version.
5. Identify the narrowest test suite named by the repository's trusted build profile.
6. If ownership or architecture is unclear, record the question. Do not guess.

Do not modify the trusted repository catalog during a source implementation task.

Last verified: 2026-10-27. Catalog aliases are illustrative placeholders.
