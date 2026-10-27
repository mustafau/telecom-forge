# Services

This map describes the illustrative sandbox only. Confirm the real service, module, and contract version in the checked-out source before changing code.

| Service | Repository alias | Talks to | Notes |
|---|---|---|---|
| API sandbox | `telecom-api-sandbox` | Reads `shared-contracts` | Example request pagination behavior |
| Shared contracts | `shared-contracts` | Consumed by the sandbox | Read-only to implementation tasks |

Integration direction for the sandbox is one-way: the API sandbox reads shared schemas. It does not publish a new major contract version from an implementation task.
