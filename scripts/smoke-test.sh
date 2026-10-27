#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"
pnpm forge doctor
pnpm exec vitest run tests/e2e/doctor.test.ts tests/integration/local-flow.test.ts
echo "Smoke test finished. No live GitHub pull request was created."
