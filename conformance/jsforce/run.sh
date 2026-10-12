#!/usr/bin/env bash
# Runs the jsforce e2e conformance subset against a running orglet instance.
#
# Usage:
#   run.sh <base-url> <access-token> [--seed] [-- <jest args...>]
#
# Example (against the server started per README.md):
#   ./run.sh http://localhost:8081 "$TOKEN" --seed
#
# Checks out jsforce at the pinned commit JSFORCE_SHA into .cache/jsforce, installs and builds it once per
# sha (stamp file .orglet-built), optionally seeds fixture data via seed.mjs, then runs the two default Jest
# invocations documented in README.md (core files with CORE_FILTER, then test/bulk2.test.ts with
# BULK2_FILTER). Arguments after `--` replace both default runs with a single `npx jest --forceExit <args>`.
# Exit status is non-zero if any invocation failed. Upgrading the pin is a deliberate, separate change:
# update JSFORCE_SHA and the README results together.
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

# Pinned jsforce commit (jsforce 3.10.26, 2026-09-22). CI keys its cache on this value.
JSFORCE_SHA=9bae14ea0f1b9dff3b0cb0862a3e5f525f25a29f

CORE_FILES=(test/connection-crud.test.ts test/connection-meta.test.ts test/sobject.test.ts test/query.test.ts)
# Excludes Bulk v1 (incl. the copies bulk.test.ts re-registers via insertAccounts imports), the two
# Query#update/destroy tests whose setup calls Bulk v1 insertAccounts, SOSL, UI API, and the
# documented test defects. Every pattern is explained in README.md "Exclusions".
CORE_FILTER='^(?!.*(bulk|Bulk|layout|list view|listup list|search records|tabs list|theme information|identity information|already existing|randomly-waiting|allowBulk|recently accessed|Query#update and return updated records|Query#destroy and return deleted status)).*'

BULK2_FILES=(test/bulk2.test.ts)
# Empty until plan 07-04 fills in the classified exclusions (see README.md "Exclusions").
BULK2_FILTER=''

node_major="$(node -e 'console.log(process.versions.node.split(".")[0])' 2>/dev/null || echo 0)"
if [ "$node_major" -lt 22 ]; then
  echo "warning: Node 22+ is required (found major version $node_major)." >&2
fi

if [ ! -d "$CACHE_DIR/.git" ]; then
  echo "initialising jsforce checkout in $CACHE_DIR..."
  mkdir -p "$CACHE_DIR"
  git -C "$CACHE_DIR" init -q
  git -C "$CACHE_DIR" remote add origin https://github.com/jsforce/jsforce.git
fi
if [ "$(git -C "$CACHE_DIR" rev-parse HEAD 2>/dev/null || true)" != "$JSFORCE_SHA" ]; then
  echo "checking out jsforce @ $JSFORCE_SHA..."
  git -C "$CACHE_DIR" fetch --depth 1 origin "$JSFORCE_SHA"
  git -C "$CACHE_DIR" checkout -q --detach -f FETCH_HEAD
  rm -f "$CACHE_DIR/.orglet-built"
fi
if [ "$(cat "$CACHE_DIR/.orglet-built" 2>/dev/null || true)" != "$JSFORCE_SHA" ]; then
  echo "installing and building jsforce (npm ci, tsc)..."
  (cd "$CACHE_DIR" && npm ci && npx tsc -p . --pretty)
  echo "$JSFORCE_SHA" > "$CACHE_DIR/.orglet-built"
else
  echo "jsforce @ $JSFORCE_SHA already built (stamp present), skipping npm ci and tsc"
fi

if [ "$DO_SEED" -eq 1 ]; then
  echo "seeding fixture data into $BASE_URL..."
  BASE_URL="$BASE_URL" TOKEN="$TOKEN" node "$SCRIPT_DIR/seed.mjs"
fi

cd "$CACHE_DIR"
export SF_LOGIN_URL="$BASE_URL" SF_ACCESS_TOKEN="$TOKEN"
if [ ${#JEST_ARGS[@]} -gt 0 ]; then
  echo "running jsforce with explicit arguments against $BASE_URL..."
  exec npx jest --forceExit "${JEST_ARGS[@]}"
fi
rc=0
echo "=== jsforce run 1/2: core files against $BASE_URL ==="
npx jest --forceExit --verbose "${CORE_FILES[@]}" -t "$CORE_FILTER" || rc=1
echo "=== jsforce run 2/2: test/bulk2.test.ts against $BASE_URL ==="
if [ -n "$BULK2_FILTER" ]; then
  npx jest --forceExit --verbose "${BULK2_FILES[@]}" -t "$BULK2_FILTER" || rc=1
else
  npx jest --forceExit --verbose "${BULK2_FILES[@]}" || rc=1
fi
exit $rc
