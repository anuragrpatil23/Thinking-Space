#!/usr/bin/env bash
set -euo pipefail

# ─── checkpoint-ship.sh ───────────────────────────────────────────────────────
# Agent checkpoint ritual: build the app from the current (clean, pushed)
# working tree and install it over /Applications/Thinking Space.app.
#
#   ./scripts/checkpoint-ship.sh          # build + install + relaunch
#   ./scripts/checkpoint-ship.sh --dry    # preflight checks only
#
# Design constraints (see CLAUDE.md "Major Checkpoint Ritual"):
#   - Token-efficient: full output goes to a log file; stdout is a short
#     pass/fail summary an agent can read in one glance.
#   - No stray folder access: touches only this repo, ~/.thinking-space,
#     and /Applications/Thinking Space.app. No sudo.
#   - Refuses to ship a dirty or unbuilt tree — a checkpoint is by
#     definition committed + pushed work.
#   - Works from inside the app's own embedded terminal: the install step
#     runs as a detached swap script that survives the app quitting.

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
FRONTEND_DIR="$ROOT_DIR/frontend"
APP_SRC="$FRONTEND_DIR/electron/dist/mac-arm64/Thinking Space.app"
APP_DST="/Applications/Thinking Space.app"
LOG_DIR="$HOME/.thinking-space/logs"
TMP_DIR="$HOME/.thinking-space/tmp"
STAMP="$(date +%Y%m%d-%H%M%S)"
LOG="$LOG_DIR/checkpoint-ship-$STAMP.log"

mkdir -p "$LOG_DIR" "$TMP_DIR"

say()  { echo "  $*"; }
fail() { echo "  ✗ $*" >&2; echo "  log: $LOG" >&2; exit 1; }

# Capacitor CLI needs Node >= 22; prefer Homebrew's.
export PATH="/opt/homebrew/bin:$PATH"

# ─── Preflight ────────────────────────────────────────────────────────────────
cd "$ROOT_DIR"

[ "$(uname -m)" = "arm64" ] || fail "this script targets Apple Silicon (dist/mac-arm64)"

if [ -n "$(git status --porcelain)" ]; then
  fail "working tree is dirty — commit (and push) before shipping a checkpoint"
fi

BRANCH="$(git rev-parse --abbrev-ref HEAD)"
HEAD_SHA="$(git rev-parse --short HEAD)"
if ! git diff --quiet "@{upstream}" HEAD 2>/dev/null; then
  fail "HEAD ($BRANCH@$HEAD_SHA) is not pushed to its upstream — push first"
fi

# Signing identity: env override > self-signed local cert > Apple Development
# > ad-hoc (keychain-backed features like safeStorage won't persist across
# ad-hoc builds; see docs/BUILD-macOS-LOCAL.md).
LOCAL_CERT="Thinking Space Local Signing"

has_local_cert() {
  # No -v: an untrusted self-signed cert still signs fine (trust is only
  # needed to VERIFY), and -v may omit it.
  security find-identity -p codesigning 2>/dev/null | grep -q "$LOCAL_CERT"
}

# Auto-generate the stable self-signed signing cert (recipe from
# docs/BUILD-macOS-LOCAL.md §B). Stable identity = safeStorage/Keychain data
# survives rebuilds — Apple Development certs expire yearly and ad-hoc changes
# every build. Uses stock /usr/bin/openssl (LibreSSL: no -legacy flag needed).
ensure_local_cert() {
  has_local_cert && return 0
  local certdir
  certdir="$(mktemp -d "$TMP_DIR/cert-XXXXXX")"
  (
    cd "$certdir"
    /usr/bin/openssl req -x509 -newkey rsa:2048 -keyout cs.key -out cs.crt -days 3650 -nodes \
      -subj "/CN=$LOCAL_CERT" \
      -addext "basicConstraints=critical,CA:false" \
      -addext "keyUsage=critical,digitalSignature" \
      -addext "extendedKeyUsage=critical,codeSigning" \
      && /usr/bin/openssl pkcs12 -export -inkey cs.key -in cs.crt -out cs.p12 -passout pass:tspass \
           -name "$LOCAL_CERT" \
      && security import cs.p12 -k "$HOME/Library/Keychains/login.keychain-db" -P tspass -T /usr/bin/codesign -A
  ) >>"$LOG" 2>&1 || { rm -rf "$certdir"; return 1; }
  rm -rf "$certdir"
  has_local_cert
}

SIGN_ID="${TS_SIGN_IDENTITY:-}"
if [ -z "$SIGN_ID" ]; then
  if has_local_cert; then
    SIGN_ID="$LOCAL_CERT"
  elif ensure_local_cert; then
    SIGN_ID="$LOCAL_CERT"
    say "generated self-signed cert '$LOCAL_CERT' (10y) — first codesign may pop a Keychain dialog: click 'Always Allow'"
    say "note: if the previous build used a different identity, saved secure credentials reset once (safeStorage is signature-bound)"
  elif security find-identity -p codesigning -v 2>/dev/null | grep -q "Apple Development"; then
    SIGN_ID="$(security find-identity -p codesigning -v | grep "Apple Development" | head -1 | sed 's/.*"\(.*\)"/\1/')"
  else
    SIGN_ID="-"
    say "warning: ad-hoc signing — Keychain-backed features (saved credentials) won't persist across rebuilds"
  fi
fi

INSIDE_APP=0
if pgrep -f "Thinking Space.app/Contents/MacOS" >/dev/null 2>&1; then
  # If our own ancestry includes the app, we're in its embedded terminal.
  p=$$
  while [ "$p" -gt 1 ]; do
    if ps -o command= -p "$p" 2>/dev/null | grep -q "Thinking Space.app/Contents/MacOS"; then
      INSIDE_APP=1; break
    fi
    p="$(ps -o ppid= -p "$p" 2>/dev/null | tr -d ' ' || echo 1)"
  done
fi

# ─── Security-contract checks (source-level; see docs/PLAYBOOKS.md) ─────────
# A build that weakens these must not reach the user's machine, no matter what
# the agent that produced it read or skipped.
SETUP_TS="$FRONTEND_DIR/electron/src/setup.ts"
PRELOAD_TS="$FRONTEND_DIR/electron/src/preload.ts"
INDEX_TS="$FRONTEND_DIR/electron/src/index.ts"

grep -q "nodeIntegration: false" "$SETUP_TS" || fail "security contract: nodeIntegration:false missing from setup.ts"
grep -q "contextIsolation: true" "$SETUP_TS" || fail "security contract: contextIsolation:true missing from setup.ts"
grep -q "sandbox: true" "$SETUP_TS"          || fail "security contract: sandbox:true missing from setup.ts"
grep -q "vaultPathGuardBlock" "$INDEX_TS"    || fail "security contract: index.ts no longer wires vaultPathGuardBlock"
BAD_PRELOAD_IMPORTS=$(grep -E "^import .* from|require\(['\"]" "$PRELOAD_TS" | grep -v "'electron'" || true)
[ -z "$BAD_PRELOAD_IMPORTS" ] || fail "security contract: preload.ts imports beyond 'electron' (breaks sandbox): $BAD_PRELOAD_IMPORTS"

say "checkpoint $BRANCH@$HEAD_SHA  sign=[$SIGN_ID]  $([ $INSIDE_APP = 1 ] && echo 'inside-app (deferred swap)' || echo 'external terminal')  security-contract ok"

if [ "${1:-}" = "--dry" ]; then
  say "✓ preflight ok (dry run — no build)"
  exit 0
fi

# ─── Build ────────────────────────────────────────────────────────────────────
# Quit the running app before building when we're NOT inside it: building and
# running concurrently causes memory contention (12s Vite builds ballooning to
# minutes — see docs/BUILD-macOS-LOCAL.md).
if [ $INSIDE_APP = 0 ] && pgrep -f "Thinking Space.app/Contents/MacOS" >/dev/null 2>&1; then
  say "quitting running app..."
  pkill -9 -f "Thinking Space.app/Contents/MacOS" || true
  sleep 3
fi

say "building (unpacked .app; log: $LOG)"
# Stop electron-builder from auto-discovering keychain identities during pack —
# its signing path isn't on the key's access list and pops a scary keychain
# password dialog. We sign explicitly below with /usr/bin/codesign, which IS
# pre-authorized on the key (security import -T).
export CSC_IDENTITY_AUTO_DISCOVERY=false
if ! ./build.sh electron:pack >"$LOG" 2>&1; then
  fail "build failed"
fi
# build.sh can print a success line even when a step failed — trust the ✗ marks.
if grep -q "✗" "$LOG"; then
  fail "build log contains failed steps (grep '✗' in the log)"
fi
[ -d "$APP_SRC" ] || fail "expected artifact missing: $APP_SRC"

# Startup-perf contract: entry must modulepreload only vendor-react + vendor-dexie.
BAD_PRELOADS=$(grep -o 'modulepreload[^>]*href="[^"]*"' "$FRONTEND_DIR/dist/index.html" \
  | grep -v "vendor-react\|vendor-dexie" || true)
[ -z "$BAD_PRELOADS" ] || fail "startup contract violated — unexpected modulepreloads: $BAD_PRELOADS"

# Security contract (built output): no inline <script> bodies in the entry HTML.
INLINE_SCRIPTS=$(grep -Eo '<script[^>]*>' "$FRONTEND_DIR/dist/index.html" | grep -v 'src=' || true)
[ -z "$INLINE_SCRIPTS" ] || fail "security contract: inline <script> found in dist/index.html"

# Mark as a local build BEFORE signing (so the signature covers it) — the app
# skips auto-update when this marker exists, otherwise the next official
# release would silently overwrite this custom build.
printf '%s %s\n' "$HEAD_SHA" "$STAMP" > "$APP_SRC/Contents/Resources/local-build"

say "signing"
if [ "$SIGN_ID" = "$LOCAL_CERT" ]; then
  say "(if your Mac asks about the signing key, click 'Always Allow' — it's this app's own local key, created on this machine)"
fi
codesign --deep --force --sign "$SIGN_ID" "$APP_SRC" >>"$LOG" 2>&1 || fail "codesign failed"

# ─── Install (detached swap — survives our own death if we live in the app) ──
# The previous install is kept at ~/.thinking-space/backup/ so a broken build
# never strands the user without an app. Rollback:
#   rm -rf "/Applications/Thinking Space.app" && ditto ~/.thinking-space/backup/"Thinking Space.app" "/Applications/Thinking Space.app"
BACKUP_DIR="$HOME/.thinking-space/backup"
SWAP="$TMP_DIR/checkpoint-swap-$STAMP.sh"
cat >"$SWAP" <<EOF
#!/usr/bin/env bash
set -e
exec >>"$LOG" 2>&1
pkill -9 -f "Thinking Space.app/Contents/MacOS" || true
sleep 3
if [ -d "$APP_DST" ]; then
  mkdir -p "$BACKUP_DIR"
  rm -rf "$BACKUP_DIR/Thinking Space.app"
  ditto "$APP_DST" "$BACKUP_DIR/Thinking Space.app"
fi
# macOS App Management can block scripted writes into /Applications on some
# machines ("Operation not permitted") — fall back to ~/Applications, which
# runs identically (docs/BUILD-macOS-LOCAL.md §4).
TARGET="$APP_DST"
if ! { rm -rf "$APP_DST" && ditto "$APP_SRC" "$APP_DST"; }; then
  echo "install to $APP_DST blocked (App Management TCC) — falling back to ~/Applications"
  TARGET="\$HOME/Applications/Thinking Space.app"
  mkdir -p "\$HOME/Applications"
  rm -rf "\$TARGET"
  ditto "$APP_SRC" "\$TARGET"
fi
xattr -dr com.apple.quarantine "\$TARGET" 2>/dev/null || true
open "\$TARGET"
# Clean build artifacts once the install is done — the ~GB-scale unpacked
# bundle has served its purpose and the backup lives in ~/.thinking-space.
rm -rf "$FRONTEND_DIR/electron/dist"
rm -f "$SWAP"
EOF
chmod +x "$SWAP"

NEW_VERSION="$(defaults read "$APP_SRC/Contents/Info.plist" CFBundleShortVersionString 2>/dev/null || echo '?')"
if [ $INSIDE_APP = 1 ]; then
  nohup "$SWAP" >/dev/null 2>&1 &
  disown
  say "✓ built v$NEW_VERSION ($BRANCH@$HEAD_SHA) — app will quit, swap, and relaunch itself now"
else
  "$SWAP"
  say "✓ shipped v$NEW_VERSION ($BRANCH@$HEAD_SHA) → $APP_DST (relaunched)"
fi
say "log: $LOG"
