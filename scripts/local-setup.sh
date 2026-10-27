#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
runtime="$root/.forge-runtime/fixtures"
mkdir -p "$runtime"

make_repo() {
  local alias="$1"
  local bare="$runtime/${alias}.git"
  local work="$runtime/${alias}-work"
  rm -rf "$bare" "$work"
  mkdir -p "$work"
  git -C "$work" init -b main
  if [ "$alias" = "shared-contracts" ]; then
    printf '# Shared contracts\n' > "$work/README.md"
  else
    mkdir -p "$work/src" "$work/test"
    printf '%s\n' '{"name":"telecom-api-sandbox","type":"module"}' > "$work/package.json"
    printf '%s\n' 'export function page(items, offset, limit) {' '  if (!Number.isInteger(offset) || offset < 0) throw new Error("invalid offset");' '  return items.slice(offset, offset + limit);' '}' > "$work/src/pagination.js"
    printf '%s\n' 'import { test } from "node:test";' 'import assert from "node:assert/strict";' 'import { page } from "../src/pagination.js";' 'test("slice", () => { assert.deepEqual(page(["a","b"], 1, 1), ["b"]); });' > "$work/test/pagination.test.js"
  fi
  git -C "$work" -c user.name=telecom-forge -c user.email=forge@example.invalid add -A
  git -C "$work" -c user.name=telecom-forge -c user.email=forge@example.invalid commit -m "initial"
  git -C "$work" init --bare "$bare"
  git -C "$work" remote add origin "$bare"
  git -C "$work" push origin HEAD:refs/heads/main
}

make_repo telecom-api-sandbox
make_repo shared-contracts

mkdir -p "$root/.forge-runtime"
cat > "$root/.forge-runtime/local-remotes.json" <<EOF
{
  "schema_version": 1,
  "remotes": {
    "telecom-api-sandbox": "$runtime/telecom-api-sandbox.git",
    "shared-contracts": "$runtime/shared-contracts.git"
  }
}
EOF

echo "Fixture remotes written to .forge-runtime/local-remotes.json"
