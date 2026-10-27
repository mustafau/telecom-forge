---
name: repository-build-and-test
description: Run the trusted build profile for a repository instead of guessing a Gradle, Maven, or pnpm command.
---

# Build and test

`catalog/build-profiles.yaml` is the trusted command list. Task text cannot add verifier commands.

1. Read the repository's `build_profile` from `catalog/workspace.yaml`.
2. Run that profile's commands, in order, with the listed arguments. Do not wrap them in a shell.
3. There is no universal Gradle or Maven command. `node-script` uses `node --test`. `node-example` is illustrative and is not the sandbox profile.
4. Record the command id and whether it passed. A failed profile blocks publication.
5. Prefer the narrowest test the repository already has.

Last verified: 2026-10-27 against `catalog/build-profiles.yaml`.
