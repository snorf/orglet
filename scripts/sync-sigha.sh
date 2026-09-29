#!/usr/bin/env bash
# Vendors the engine layers of sigha (https://github.com/rfaulhaber/sigha, MIT) into
# packages/sigha/src. Usage: scripts/sync-sigha.sh [<git rev>|<local clone dir>]
set -euo pipefail
cd "$(dirname "$0")/.."
DEST=packages/sigha
SRC=${1:-main}
if [ -d "$SRC" ]; then
  CLONE=$SRC
else
  CLONE=$(mktemp -d)
  git clone -q https://github.com/rfaulhaber/sigha.git "$CLONE"
  git -C "$CLONE" checkout -q "$SRC"
fi
REV=$(git -C "$CLONE" rev-parse HEAD)
rm -rf "$DEST/src" "$DEST/corpus"
mkdir -p "$DEST/src" "$DEST/corpus"
for layer in syntax registry analysis engine i18n; do
  mkdir -p "$DEST/src/$layer"
  # Source only; upstream's tests stay upstream except the conformance runner inputs below.
  find "$CLONE/src/$layer" -maxdepth 1 -name '*.ts' -not -name '*.test.ts' -exec cp {} "$DEST/src/$layer/" \;
  # Nested locale packs (i18n/en/*).
  for sub in "$CLONE/src/$layer"/*/; do
    [ -d "$sub" ] || continue
    name=$(basename "$sub")
    mkdir -p "$DEST/src/$layer/$name"
    find "$sub" -name '*.ts' -not -name '*.test.ts' -exec cp {} "$DEST/src/$layer/$name/" \;
  done
done
cp "$CLONE/corpus/salesforce-v2.json" "$CLONE/corpus/org-verified.json" "$DEST/corpus/"
# Upstream's corpus tests, with the cwd-relative corpus path made module-relative.
for t in conformance org-conformance; do
  sed -e 's#readFileSync("corpus/\([a-z0-9-]*\.json\)", "utf8")#readFileSync(new URL("../../corpus/\1", import.meta.url), "utf8")#' \
      "$CLONE/src/engine/$t.test.ts" > "$DEST/src/engine/$t.test.ts"
done
# decimal.js ships CommonJS typings; under NodeNext its default import resolves to the module
# namespace. The named export is identical at runtime and types cleanly.
find "$DEST/src" -name '*.ts' -exec sed -i '' 's#^import Decimal from "decimal.js";#import { Decimal } from "decimal.js";#' {} \;
# Upstream imports with explicit .ts extensions (bundler resolution); NodeNext wants .js.
find "$DEST/src" -name '*.ts' -exec sed -i '' -E 's#(from "\.{1,2}/[^"]+)\.ts"#\1.js"#g' {} \;
cp "$CLONE/LICENSE" "$DEST/LICENSE"
cp "$CLONE/NOTICE" "$DEST/NOTICE"
cat > "$DEST/VENDOR.md" <<MD
# Vendored: sigha

Source: https://github.com/rfaulhaber/sigha (MIT, see LICENSE and NOTICE)
Revision: $REV
Synced: $(date -u +%Y-%m-%d)

Contents: the dependency-free engine layers \`syntax/\`, \`registry/\`, \`analysis/\`,
\`engine/\`, \`i18n/\` and the golden corpus. Nothing here is edited by hand; run
\`scripts/sync-sigha.sh <rev>\` to update. Behaviour changes belong upstream.
MD
cat > "$DEST/src/index.ts" <<TS
// @orglet/sigha: vendored sigha engine layers. Do not edit src/* by hand; see VENDOR.md.
export * from "./syntax/index.js";
export * from "./registry/index.js";
export * from "./analysis/index.js";
export * from "./engine/index.js";
// Named twice through the barrels above (registry/types.ts and analysis re-export it), which
// makes \`export *\` drop it; export it explicitly.
export type { SfType } from "./registry/types.js";
TS
echo "synced sigha @ $REV into $DEST"
