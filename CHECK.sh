#!/usr/bin/env bash
set -euo pipefail

TARGET="${1:-.}"
SKIP_BROWSER=0
if [[ "${2:-}" == "--skip-browser" ]]; then SKIP_BROWSER=1; fi
TARGET="$(cd "$TARGET" && pwd -P)"

fail(){ echo "ERROR: $*" >&2; exit 1; }
pass(){ echo "PASS: $*"; }

[[ -f "$TARGET/site/index.html" ]] || fail "site/index.html missing"
[[ -f "$TARGET/site/sovereign-world.js" ]] || fail "sovereign-world.js missing"
[[ -f "$TARGET/world/index.js" ]] || fail "world/index.js missing"
[[ -f "$TARGET/worker/src/index.js" ]] || fail "worker/src/index.js missing"
[[ -f "$TARGET/wrangler.world.toml" ]] || fail "wrangler.world.toml missing"
[[ -f "$TARGET/functions/api/v2/[[path]].js" ]] || fail "v2 Pages facade missing"

HTML="$(cat "$TARGET/site/index.html")"
grep -q 'id="worldCanvas"' <<<"$HTML" || fail "game world canvas missing"
grep -q 'id="societyHistory"' <<<"$HTML" || fail "Society History window missing"
grep -q 'sovereign-world.js' <<<"$HTML" || fail "sovereign game entrypoint missing"
for legacy in 'class="hud"' 'world-grid' 'analysis-grid' 'agents-panel' 'ledger-panel' 'researchView' 'participateView' 'protocolView'; do
  if grep -Fq "$legacy" <<<"$HTML"; then fail "legacy dashboard marker present: $legacy"; fi
done
pass "game-only shell contains no legacy dashboard"

if grep -Eq '^[[:space:]]*schedule:' "$TARGET/.github/workflows/economy.yml"; then
  fail "v1 GitHub workflow still schedules world advancement"
fi
pass "GitHub Actions is not the v2 world heartbeat"

while IFS= read -r -d '' js; do node --check "$js" >/dev/null; done < <(
  find "$TARGET/world" "$TARGET/worker" "$TARGET/functions/api/v2" "$TARGET/site" "$TARGET/scripts" -type f \( -name '*.js' -o -name '*.mjs' \) -print0
)
pass "JavaScript syntax"

(
  cd "$TARGET"
  node --test tests/test_sovereign_*.mjs
)
pass "sovereign unit/invariant tests"

(
  cd "$TARGET"
  node scripts/build_sovereign_genesis.mjs >/tmp/cymonia-v2-genesis.log
  node --input-type=module <<'NODE'
import fs from 'node:fs';
const x=JSON.parse(fs.readFileSync('site/data/sovereign-genesis.json','utf8'));
if(x.kind!=='GENESIS_REPLAY')throw new Error('genesis replay kind invalid');
if(x.world?.citizens?.length!==100)throw new Error('genesis population invalid');
if((x.world?.organizations||[]).length!==0)throw new Error('genesis society must be empty');
console.log('PASS: deterministic Genesis replay');
NODE
)

if [[ -f "$TARGET/MANIFEST.sha256" ]]; then
  TARGET_ROOT="$TARGET" python3 - <<'PY'
from pathlib import Path
import hashlib, os
root=Path(os.environ['TARGET_ROOT'])
for line in (root/'MANIFEST.sha256').read_text().splitlines():
    if not line.strip(): continue
    digest, rel=line.split('  ',1)
    p=root/rel
    if not p.is_file(): raise SystemExit(f'MANIFEST missing: {rel}')
    actual=hashlib.sha256(p.read_bytes()).hexdigest()
    if actual!=digest: raise SystemExit(f'MANIFEST mismatch: {rel}')
print('PASS: package manifest')
PY
fi

if [[ "$SKIP_BROWSER" -eq 0 ]]; then
  if node -e "import('playwright').then(()=>process.exit(0)).catch(()=>process.exit(1))" >/dev/null 2>&1; then
    PORT="${CYMONIA_CHECK_PORT:-8765}"
    python3 -m http.server "$PORT" --directory "$TARGET/site" >/tmp/cymonia-v2-check-http.log 2>&1 &
    SERVER_PID=$!
    trap 'kill "$SERVER_PID" 2>/dev/null || true' EXIT
    for _ in $(seq 1 30); do curl -fsS "http://127.0.0.1:$PORT/" >/dev/null 2>&1 && break; sleep .25; done
    (cd "$TARGET"; CYMONIA_URL="http://127.0.0.1:$PORT" node tests/browser-sovereign.mjs)
    pass "browser sovereign smoke"
  else
    echo "SKIP: browser smoke (Playwright not installed; CI runs it)"
  fi
fi

pass "CYMONIA v2 Sovereign World verification complete"
