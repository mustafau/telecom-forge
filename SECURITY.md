# Security

## Supported versions

Report issues against the default branch of this repository. There is no separate LTS line yet.

## Reporting a vulnerability

Prefer [GitHub private vulnerability reporting](https://github.com/mustafau/telecom-forge/security/advisories/new) for this repository when it is enabled. If that is unavailable, open a private channel with the maintainer (`@mustafau`) instead of a public issue.

Do **not** include in a public issue:

- API keys, GitHub App private keys, tokens, or `.env` contents
- Raw Pi / harness session transcripts or full command lines from history stores
- Customer or operator data from any source repository checkout

Include instead: affected version or commit SHA, a minimal reproduction, impact, and (if relevant) a Forge `run_id` without attaching raw evidence.

## Operational notes

This control plane treats the coding agent as untrusted for publish and history credentials. See `docs/threat-model.md`. Accidental exposure of a secret: revoke and rotate it, then record the run or commit range without pasting the secret.
