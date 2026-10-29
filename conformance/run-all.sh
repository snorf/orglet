#!/usr/bin/env bash
# Starts orglet on $PROJECT (default examples/acme) and runs every SDK conformance check against it: the jsforce
# e2e subset (jsforce/run.sh --seed, first, on the fresh schema its README numbers assume), the
# simple-salesforce script (python/run.py), and both legs of describe-check, poly-check and
# rollup-check, and both cmdt-check legs against a second server on conformance/cmdt-check/project
# (Phase 11). Used by the `conformance` CI job; locally, point it at a throwaway schema.
# Exit status is non-zero if any leg failed; a PASS/FAIL line per leg is printed at the end.
#
# Env: PROJECT (default examples/acme; the SFDX project the main server loads). FIXTURE is derived as
#      $(basename "$PROJECT") and passed to the poly-check and rollup-check legs. With
#      PROJECT=examples/enterprise the enterprise seed leg runs as well and describe-check also covers
#      describe-check/objects-enterprise.txt.
#      PORT (default 8093), ORG_SCHEMA (default conformance_run; must be a fresh schema),
#      CMDT_PORT (default PORT+1), CMDT_SCHEMA (default ${ORG_SCHEMA}_cmdt; must be fresh too),
#      PYTHON (default conformance/python/.venv/bin/python), ORGLET_DATABASE_URL (as for orglet up).
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
PROJECT="${PROJECT:-examples/acme}"
FIXTURE="$(basename "$PROJECT")"
PORT="${PORT:-8093}"
ORG_SCHEMA="${ORG_SCHEMA:-conformance_run}"
PYTHON="${PYTHON:-conformance/python/.venv/bin/python}"
BASE="http://localhost:$PORT"
CMDT_PORT="${CMDT_PORT:-$((PORT + 1))}"
CMDT_SCHEMA="${CMDT_SCHEMA:-${ORG_SCHEMA}_cmdt}"
CMDT_BASE="http://localhost:$CMDT_PORT"

# describe-check object list: empty (scripts fall back to objects.txt) except for the enterprise fixture.
DESCRIBE_OBJECTS=()
if [ "$FIXTURE" = enterprise ]; then
  while IFS= read -r name; do DESCRIBE_OBJECTS+=("$name"); done < <(
    cat conformance/describe-check/objects.txt conformance/describe-check/objects-enterprise.txt \
      | sed -e 's/#.*//' -e 's/[[:space:]]//g' -e '/^$/d')
fi

node packages/cli/dist/index.js up --project "$PROJECT" --org-schema "$ORG_SCHEMA" --port "$PORT" --quiet &
PID=$!
node packages/cli/dist/index.js up --project conformance/cmdt-check/project --org-schema "$CMDT_SCHEMA" --port "$CMDT_PORT" --quiet &
CMDT_PID=$!
trap 'kill "$PID" "$CMDT_PID" 2>/dev/null' EXIT
for _ in $(seq 1 60); do curl -sf "$BASE/services/data" >/dev/null && break; sleep 1; done
curl -sf "$BASE/services/data" >/dev/null || { echo "error: orglet did not answer on $BASE" >&2; exit 1; }
for _ in $(seq 1 60); do curl -sf "$CMDT_BASE/services/data" >/dev/null && break; sleep 1; done
curl -sf "$CMDT_BASE/services/data" >/dev/null || { echo "error: orglet did not answer on $CMDT_BASE" >&2; exit 1; }
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
leg jsforce-subset env FIXTURE="$FIXTURE" conformance/jsforce/run.sh "$BASE" "$TOKEN" --seed
leg simple-salesforce env BASE_URL="$BASE" "$PYTHON" conformance/python/run.py
if [ "$FIXTURE" = enterprise ]; then
  leg enterprise-seed env BASE_URL="$BASE" TOKEN="$TOKEN" node examples/enterprise/seed.mjs
fi
leg describe-check-jsforce env BASE_URL="$BASE" node conformance/describe-check/jsforce.mjs ${DESCRIBE_OBJECTS[@]+"${DESCRIBE_OBJECTS[@]}"}
leg describe-check-python env BASE_URL="$BASE" "$PYTHON" conformance/describe-check/sf_describe.py ${DESCRIBE_OBJECTS[@]+"${DESCRIBE_OBJECTS[@]}"}
leg poly-check-jsforce env BASE_URL="$BASE" FIXTURE="$FIXTURE" node conformance/poly-check/jsforce.mjs
leg poly-check-python env BASE_URL="$BASE" FIXTURE="$FIXTURE" "$PYTHON" conformance/poly-check/sf_poly.py
leg rollup-check-jsforce env BASE_URL="$BASE" FIXTURE="$FIXTURE" node conformance/rollup-check/jsforce.mjs
leg rollup-check-python env BASE_URL="$BASE" FIXTURE="$FIXTURE" "$PYTHON" conformance/rollup-check/sf_rollup.py
leg cmdt-check-jsforce env BASE_URL="$CMDT_BASE" node conformance/cmdt-check/jsforce.mjs
leg cmdt-check-python env BASE_URL="$CMDT_BASE" "$PYTHON" conformance/cmdt-check/sf_cmdt.py

echo "=== summary ==="
printf '%s\n' "${SUMMARY[@]}"
exit "$rc"
