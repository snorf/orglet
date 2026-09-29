#!/usr/bin/env bash
# Runs the jsforce e2e conformance subset against a running orglet instance.
#
# Usage:
#   run.sh <base-url> <access-token> [--seed] [-- <jest args...>]
#
# Example (against the server started per README.md):
#   ./run.sh http://localhost:8081 "$TOKEN" --seed
#
# Clones (or updates) jsforce main into .cache/jsforce, installs its deps,
# builds it, optionally seeds fixture data via seed.mjs, then runs the
# jsforce e2e test file subset documented in README.md.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CACHE_DIR="$SCRIPT_DIR/.cache/jsforce"

BASE_URL="${1:?usage: run.sh <base-url> <access-token> [--seed] [-- <jest args...>]}"
TOKEN="${2:?usage: run.sh <base-url> <access-token> [--seed] [-- <jest args...>]}"
shift 2

DO_SEED=0
JEST_ARGS=()
while [ $# -gt 0 ]; do
  case "$1" in
    --seed) DO_SEED=1; shift ;;
    --) shift; JEST_ARGS+=("$@"); break ;;
    *) JEST_ARGS+=("$1"); shift ;;
  esac
done

if [ ${#JEST_ARGS[@]} -eq 0 ]; then
  JEST_ARGS=(
    test/connection-crud.test.ts
    test/query.test.ts
    test/connection-meta.test.ts
    test/sobject.test.ts
    test/connection-session.test.ts
    test/bulk.test.ts
  )
fi

node_major="$(node -e 'console.log(process.versions.node.split(".")[0])' 2>/dev/null || echo 0)"
if [ "$node_major" -lt 22 ]; then
  echo "warning: Node 22+ is required (found major version $node_major)." >&2
fi

if [ ! -d "$CACHE_DIR/.git" ]; then
  echo "cloning jsforce (main) into $CACHE_DIR..."
  mkdir -p "$(dirname "$CACHE_DIR")"
  git clone --depth 1 -b main https://github.com/jsforce/jsforce.git "$CACHE_DIR"
else
  echo "updating jsforce in $CACHE_DIR..."
  git -C "$CACHE_DIR" fetch --depth 1 origin main
  git -C "$CACHE_DIR" reset --hard origin/main
fi

echo "installing jsforce dependencies..."
(cd "$CACHE_DIR" && npm ci)

echo "building jsforce (tsc)..."
(cd "$CACHE_DIR" && npx tsc -p . --pretty)

if [ "$DO_SEED" -eq 1 ]; then
  echo "seeding fixture data into $BASE_URL..."
  BASE_URL="$BASE_URL" TOKEN="$TOKEN" node "$SCRIPT_DIR/seed.mjs"
fi

echo "running jsforce e2e subset against $BASE_URL..."
cd "$CACHE_DIR"
SF_LOGIN_URL="$BASE_URL" SF_ACCESS_TOKEN="$TOKEN" npx jest --forceExit "${JEST_ARGS[@]}"
