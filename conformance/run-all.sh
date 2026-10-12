#!/usr/bin/env bash
# Starts orglet on examples/acme and runs every SDK conformance check against it: the jsforce
# e2e subset (jsforce/run.sh --seed, first, on the fresh schema its README numbers assume), the
# simple-salesforce script (python/run.py), and both legs of describe-check, poly-check and
# rollup-check. Used by the `conformance` CI job; locally, point it at a throwaway schema.
# Exit status is non-zero if any leg failed; a PASS/FAIL line per leg is printed at the end.
#
# Env: PORT (default 8093), ORG_SCHEMA (default conformance_run; must be a fresh schema),
#      PYTHON (default conformance/python/.venv/bin/python), ORGLET_DATABASE_URL (as for orglet up).
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
PORT="${PORT:-8093}"
ORG_SCHEMA="${ORG_SCHEMA:-conformance_run}"
PYTHON="${PYTHON:-conformance/python/.venv/bin/python}"
BASE="http://localhost:$PORT"

node packages/cli/dist/index.js up --project examples/acme --org-schema "$ORG_SCHEMA" --port "$PORT" --quiet &
PID=$!
trap 'kill "$PID" 2>/dev/null' EXIT
for _ in $(seq 1 60); do curl -sf "$BASE/services/data" >/dev/null && break; sleep 1; done
curl -sf "$BASE/services/data" >/dev/null || { echo "error: orglet did not answer on $BASE" >&2; exit 1; }
TOKEN=$(curl -s -X POST "$BASE/services/oauth2/token" \
  -d 'grant_type=password&client_id=x&client_secret=y&username=admin@orglet.local&password=x' \
  | node -pe 'JSON.parse(require("fs").readFileSync(0)).access_token')

SUMMARY=()
rc=0
leg() {
  local name="$1"; shift
  echo "=== $name ==="
  if "$@"; then SUMMARY+=("PASS $name"); else SUMMARY+=("FAIL $name"); rc=1; fi
}
leg jsforce-subset conformance/jsforce/run.sh "$BASE" "$TOKEN" --seed
leg simple-salesforce env BASE_URL="$BASE" "$PYTHON" conformance/python/run.py
leg describe-check-jsforce env BASE_URL="$BASE" node conformance/describe-check/jsforce.mjs
leg describe-check-python env BASE_URL="$BASE" "$PYTHON" conformance/describe-check/sf_describe.py
leg poly-check-jsforce env BASE_URL="$BASE" node conformance/poly-check/jsforce.mjs
leg poly-check-python env BASE_URL="$BASE" "$PYTHON" conformance/poly-check/sf_poly.py
leg rollup-check-jsforce env BASE_URL="$BASE" node conformance/rollup-check/jsforce.mjs
leg rollup-check-python env BASE_URL="$BASE" "$PYTHON" conformance/rollup-check/sf_rollup.py

echo "=== summary ==="
printf '%s\n' "${SUMMARY[@]}"
exit "$rc"
