#!/usr/bin/env bash
set -euo pipefail

PACKAGE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
TARGET="${1:-.}"
TARGET="$(cd "$TARGET" && pwd -P)"

fail(){ echo "ERROR: $*" >&2; exit 1; }

[[ -d "$TARGET/.git" || -f "$TARGET/.git" ]] || fail "target is not a Git checkout: $TARGET"
[[ -f "$TARGET/README.md" ]] || fail "README.md missing"
[[ -f "$TARGET/constitution/genesis.json" ]] || fail "constitution/genesis.json missing; this is not the expected CYMONIA repository"
[[ -f "$TARGET/site/index.html" ]] || fail "site/index.html missing"
[[ -f "$TARGET/functions/api/[[path]].js" ]] || fail "functions/api/[[path]].js missing"

git -C "$TARGET" rev-parse --is-inside-work-tree >/dev/null 2>&1 || fail "target is not a Git worktree"
DIRTY="$(git -C "$TARGET" status --porcelain --untracked-files=all)"
if [[ -n "$DIRTY" && "${CYMONIA_ALLOW_DIRTY:-0}" != "1" ]]; then
  echo "$DIRTY" >&2
  fail "working tree is dirty. Commit/stash your work, or explicitly set CYMONIA_ALLOW_DIRTY=1 after reviewing it."
fi

mkdir -p "$TARGET/archive/v1"
if [[ ! -f "$TARGET/archive/v1/index-v1.html" ]]; then
  cp "$TARGET/site/index.html" "$TARGET/archive/v1/index-v1.html"
  echo "Archived previous production UI -> archive/v1/index-v1.html"
fi
if [[ -f "$TARGET/.github/workflows/economy.yml" && ! -f "$TARGET/archive/v1/economy-v1.yml" ]]; then
  cp "$TARGET/.github/workflows/economy.yml" "$TARGET/archive/v1/economy-v1.yml"
  echo "Archived previous v1 economy workflow -> archive/v1/economy-v1.yml"
fi

# Copy only package content. Existing unrelated repository files remain untouched.
PACKAGE_ROOT_ENV="$PACKAGE_ROOT" TARGET_ENV="$TARGET" python3 - <<'PY'
from pathlib import Path
import os, shutil
src=Path(os.environ['PACKAGE_ROOT_ENV'])
dst=Path(os.environ['TARGET_ENV'])
skip={'MANIFEST.sha256'}
for p in src.rglob('*'):
    if not p.is_file(): continue
    rel=p.relative_to(src)
    if rel.parts and rel.parts[0]=='.git': continue
    if rel.as_posix() in skip: continue
    # The archived v1 index is target-specific and is never supplied by the package.
    if rel.as_posix()=='archive/v1/index-v1.html': continue
    out=dst/rel
    out.parent.mkdir(parents=True,exist_ok=True)
    shutil.copy2(p,out)
print('Installed Sovereign World v2 package files.')
PY

# OAuth remains; only the old v1 side effect that auto-created a v1 world Citizen is removed.
TARGET_ENV="$TARGET" python3 - <<'PY'
from pathlib import Path
import os
p=Path(os.environ['TARGET_ENV'])/'functions/api/[[path]].js'
s=p.read_text(encoding='utf-8')
call='  await ensureHumanWorldCitizen(db(env), human.actor);\n'
import_line='  ensureHumanWorldCitizen,\n'
call_count=s.count(call)
import_count=s.count(import_line)
if call_count>1 or import_count>1:
    raise SystemExit(f'unexpected ensureHumanWorldCitizen occurrences: call={call_count} import={import_count}')
if call_count==1:
    s=s.replace(call,'',1)
if import_count==1:
    s=s.replace(import_line,'',1)
if 'ensureHumanWorldCitizen(db(env), human.actor)' in s:
    raise SystemExit('v1 OAuth world mutation patch did not apply')
p.write_text(s,encoding='utf-8')
print('Preserved GitHub OAuth; disabled v1 automatic world-Citizen mutation.')
PY

# Copy manifest only after installation, so CHECK can verify package-owned files.
if [[ -f "$PACKAGE_ROOT/MANIFEST.sha256" ]]; then cp "$PACKAGE_ROOT/MANIFEST.sha256" "$TARGET/MANIFEST.sha256"; fi

bash "$PACKAGE_ROOT/CHECK.sh" "$TARGET" --skip-browser

echo
echo "CYMONIA v2 Sovereign World applied successfully."
echo "Review with: git -C '$TARGET' status --short"
echo "Then commit on a feature branch and let GitHub CI run the full Playwright smoke."
