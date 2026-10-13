#!/usr/bin/env bash
# Vendors sf-skills enterprise_api/<Object>.json (https://github.com/forcedotcom/sf-skills, Apache-2.0)
# for the objects in scripts/gen-baseline/objects.json into scripts/gen-baseline/source/sf-skills, unmodified.
# Usage: scripts/sync-sfdocs.sh [<git sha>|<local clone dir>]  (SFDOCS_DEST overrides the target dir)
set -euo pipefail
cd "$(dirname "$0")/.."
DEST=${SFDOCS_DEST:-scripts/gen-baseline/source/sf-skills}
SRC=${1:-main}
ASSETS=plugins/builder/salesforce-development/skills/platform-data-and-tooling-api-context-get/assets/enterprise_api
CLEANUP=""
trap 'if [ -n "$CLEANUP" ]; then rm -rf "$CLEANUP"; fi' EXIT
if [ -d "$SRC" ]; then
  CLONE=$SRC
else
  CLONE=$(mktemp -d)
  CLEANUP=$CLONE
  git -C "$CLONE" init -q
  git -C "$CLONE" remote add origin https://github.com/forcedotcom/sf-skills.git
  git -C "$CLONE" sparse-checkout set --no-cone "/$ASSETS/" /LICENSE.txt /NOTICE /NOTICE.txt
  git -C "$CLONE" fetch -q --depth 1 --filter=blob:none origin "$SRC"
  git -C "$CLONE" checkout -q FETCH_HEAD
fi
REV=$(git -C "$CLONE" rev-parse HEAD)
OBJECTS=$(grep -oE '"[A-Za-z0-9_]+"' scripts/gen-baseline/objects.json | tr -d '"')
rm -rf "$DEST"
mkdir -p "$DEST"
MISSING=""
for name in $OBJECTS; do
  if [ -f "$CLONE/$ASSETS/$name.json" ]; then
    cp "$CLONE/$ASSETS/$name.json" "$DEST/$name.json"
  else
    MISSING="$MISSING $name"
  fi
done
MISSING=${MISSING# }
cp "$CLONE/LICENSE.txt" "$DEST/LICENSE.txt"
for n in NOTICE NOTICE.txt; do
  if [ -f "$CLONE/$n" ]; then cp "$CLONE/$n" "$DEST/$n"; fi
done
cat > "$DEST/VENDOR.md" <<MD
# Vendored: sf-skills enterprise_api

Source: https://github.com/forcedotcom/sf-skills (Apache-2.0, see LICENSE.txt; Copyright (c) 2026 Salesforce, Inc.)
Path: $ASSETS
Revision: $REV
Synced: $(date -u +%Y-%m-%d)
Missing upstream: ${MISSING:-none}

Files are copied unmodified. They are an input to scripts/gen-baseline (offline generator) and are not shipped
in any package. Run \`scripts/sync-sfdocs.sh <sha>\` to re-pin; re-pinning is a deliberate PR.

## Files (sha256)

MD
if command -v shasum > /dev/null 2>&1; then HASH="shasum -a 256"; else HASH="sha256sum"; fi
(
  cd "$DEST"
  for f in $(LC_ALL=C ls | grep -v '^VENDOR.md$'); do
    $HASH "$f"
  done
) >> "$DEST/VENDOR.md"
echo "synced sf-skills @ $REV into $DEST"
