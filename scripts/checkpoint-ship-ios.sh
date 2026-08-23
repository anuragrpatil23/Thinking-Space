#!/usr/bin/env bash
set -euo pipefail

# ─── checkpoint-ship-ios.sh ───────────────────────────────────────────────────
# iOS counterpart of checkpoint-ship.sh: build the iPhone app from the current
# working tree and install it onto the user's configured device over
# devicectl (USB or same-network Wi-Fi).
#
#   ./scripts/checkpoint-ship-ios.sh          # checkpoint: clean+pushed tree only
#   ./scripts/checkpoint-ship-ios.sh --dirty  # dev iteration: skip clean/pushed preflight
#   ./scripts/checkpoint-ship-ios.sh --dry    # preflight checks only, no build
#
# Device selection (first match wins):
#   1. TS_IOS_DEVICE env var (device name or UDID)
#   2. ~/.thinking-space/ios-device.json  {"deviceName": "Ichigo"}
#   3. Auto-pick: exactly one paired iPhone → use it and persist the config
#
# Design constraints (mirrors checkpoint-ship.sh):
#   - Token-efficient: full xcodebuild/vite output goes to a log file; stdout
#     is a short pass/fail summary an agent reads in one glance.
#   - Touches only this repo, ~/.thinking-space, and the paired device.
#   - Unlike the Mac swap, a device install is a personal test build, so
#     --dirty is allowed for on-device iteration; the default stays strict.

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
FRONTEND_DIR="$ROOT_DIR/frontend"
IOS_PROJ="$FRONTEND_DIR/ios/App/App.xcodeproj"
BUNDLE_ID="com.anurag.thinking-space"
LOG_DIR="$HOME/.thinking-space/logs"
TMP_DIR="$HOME/.thinking-space/tmp"
# Persistent derived data → incremental native builds (~15s instead of ~2min).
DERIVED_DIR="$TMP_DIR/ios-derived"
DEVICE_CONFIG="$HOME/.thinking-space/ios-device.json"
STAMP="$(date +%Y%m%d-%H%M%S)"
LOG="$LOG_DIR/checkpoint-ship-ios-$STAMP.log"
JQ=/usr/bin/jq

mkdir -p "$LOG_DIR" "$TMP_DIR"

say()  { echo "  $*"; }
fail() { echo "  ✗ $*" >&2; echo "  log: $LOG" >&2; exit 1; }

# ─── Shared dist lock ─────────────────────────────────────────────────────────
# The Mac and iOS checkpoint scripts both build frontend/dist (electron vs
# capacitor targets). Running them concurrently once shipped a Mac app packed
# from a capacitor-flavored dist (ERR_FILE_NOT_FOUND on ltm-app://) — so both
# scripts serialize the dist-touching phase through this mkdir lock.
DIST_LOCK="$TMP_DIR/dist-build.lock"
acquire_dist_lock() {
  local waited=0
  while ! mkdir "$DIST_LOCK" 2>/dev/null; do
    # Steal locks older than 30 min — a killed build must not wedge shipping.
    if [ -n "$(find "$DIST_LOCK" -maxdepth 0 -mmin +30 2>/dev/null)" ]; then
      rmdir "$DIST_LOCK" 2>/dev/null || true
      continue
    fi
    [ $waited = 0 ] && say "waiting for another checkpoint build to release frontend/dist…"
    waited=1
    sleep 5
  done
  trap 'release_dist_lock' EXIT
}
release_dist_lock() { rmdir "$DIST_LOCK" 2>/dev/null || true; }

# Capacitor CLI needs Node >= 22; prefer Homebrew's.
export PATH="/opt/homebrew/bin:$PATH"

DIRTY=0 DRY=0
for arg in "$@"; do
  case "$arg" in
    --dirty) DIRTY=1 ;;
    --dry)   DRY=1 ;;
    *) fail "unknown flag: $arg (use --dirty or --dry)" ;;
  esac
done

# ─── Preflight: tree state ────────────────────────────────────────────────────
cd "$ROOT_DIR"
BRANCH="$(git rev-parse --abbrev-ref HEAD)"
HEAD_SHA="$(git rev-parse --short HEAD)"
TREE_LABEL="$BRANCH@$HEAD_SHA"

if [ $DIRTY = 0 ]; then
  if [ -n "$(git status --porcelain)" ]; then
    fail "working tree is dirty — commit+push first, or use --dirty for an on-device test build"
  fi
  if ! git diff --quiet "@{upstream}" HEAD 2>/dev/null; then
    fail "HEAD ($TREE_LABEL) is not pushed to its upstream — push first, or use --dirty"
  fi
else
  TREE_LABEL="$TREE_LABEL+dirty"
fi

# ─── Preflight: resolve target device ────────────────────────────────────────
DEVICES_JSON="$TMP_DIR/ios-devices-$STAMP.json"
xcrun devicectl list devices --json-output "$DEVICES_JSON" -q >/dev/null 2>&1 \
  || fail "devicectl failed — is Xcode installed?"

# Device list: TS_IOS_DEVICE (comma-separated names/UDIDs) beats the config
# file, which is {"deviceNames": ["Ichigo","Ikigai"]} (legacy singular
# "deviceName" still honored). One build installs to every listed device.
WANT_LIST="${TS_IOS_DEVICE:-}"
if [ -z "$WANT_LIST" ] && [ -f "$DEVICE_CONFIG" ]; then
  WANT_LIST="$($JQ -r 'if .deviceNames then (.deviceNames | join(",")) else (.deviceName // empty) end' "$DEVICE_CONFIG" 2>/dev/null || true)"
fi

DEVICE_NAMES=()
DEVICE_IDS=()
if [ -n "$WANT_LIST" ]; then
  IFS=',' read -ra WANTED <<< "$WANT_LIST"
  for WANT in "${WANTED[@]}"; do
    WANT="$(echo "$WANT" | sed 's/^ *//;s/ *$//')"
    [ -n "$WANT" ] || continue
    DEVICE_ROW="$($JQ -c --arg w "$WANT" '
      [.result.devices[]
       | select(.connectionProperties.pairingState == "paired")
       | select((.deviceProperties.name | ascii_downcase) == ($w | ascii_downcase)
                or .identifier == $w
                or (.hardwareProperties.udid // "") == $w)]
      | first // empty' "$DEVICES_JSON")"
    [ -n "$DEVICE_ROW" ] || fail "device '$WANT' not found among paired devices (xcrun devicectl list devices)"
    DEVICE_NAMES+=("$(echo "$DEVICE_ROW" | $JQ -r '.deviceProperties.name')")
    DEVICE_IDS+=("$(echo "$DEVICE_ROW" | $JQ -r '.identifier')")
  done
  [ "${#DEVICE_IDS[@]}" -gt 0 ] || fail "no devices resolved from '$WANT_LIST'"
else
  # No config: exactly one paired iPhone → adopt it and persist the choice.
  CANDIDATES="$($JQ -c '
    [.result.devices[]
     | select(.connectionProperties.pairingState == "paired")
     | select(.hardwareProperties.deviceType == "iPhone")]' "$DEVICES_JSON")"
  COUNT="$(echo "$CANDIDATES" | $JQ 'length')"
  [ "$COUNT" = "1" ] || fail "no device configured — set one with: echo '{\"deviceNames\": [\"<name>\"]}' > $DEVICE_CONFIG (paired iPhones found: $COUNT)"
  DEVICE_ROW="$(echo "$CANDIDATES" | $JQ -c '.[0]')"
  DEVICE_NAMES+=("$(echo "$DEVICE_ROW" | $JQ -r '.deviceProperties.name')")
  DEVICE_IDS+=("$(echo "$DEVICE_ROW" | $JQ -r '.identifier')")
  $JQ -n --arg n "${DEVICE_NAMES[0]}" '{deviceNames: [$n]}' > "$DEVICE_CONFIG"
  say "adopted sole paired iPhone as default device (saved to $DEVICE_CONFIG)"
fi
rm -f "$DEVICES_JSON"

say "checkpoint-ios $TREE_LABEL  devices=$(IFS=','; echo "${DEVICE_NAMES[*]}")"

if [ $DRY = 1 ]; then
  say "✓ preflight ok (dry run — no build)"
  exit 0
fi

# ─── Build: web bundle + cap sync ────────────────────────────────────────────
say "building web bundle + cap sync (log: $LOG)"
acquire_dist_lock
(cd "$FRONTEND_DIR" && npm run build:ios) >"$LOG" 2>&1 || fail "web build / cap sync failed"

# Security contract (built output): no inline <script> bodies in the entry HTML.
INLINE_SCRIPTS=$(grep -Eo '<script[^>]*>' "$FRONTEND_DIR/dist/index.html" | grep -v 'src=' || true)
[ -z "$INLINE_SCRIPTS" ] || fail "security contract: inline <script> found in dist/index.html"

# cap sync copied dist into ios/App/App/public — dist is free for other builds
# while xcodebuild runs (it never reads frontend/dist).
release_dist_lock
trap - EXIT

# ─── Build: native app (Release, automatic signing) ──────────────────────────
# generic/platform=iOS builds a signed device binary without requiring the
# device to be reachable during the build — only the install step needs it.
#
# The version is read from frontend/package.json and passed in as a build
# setting rather than trusted from the Xcode project. MARKETING_VERSION is a
# hand-edited literal in project.pbxproj, so it silently fell behind: it said
# 2.6.0 for two months of ships while the Mac (which takes its version from
# package.json) said 2.8.0, and every iOS summary reported a version that had
# not been true since June. Deriving it here makes drift impossible without
# rewriting a tracked file mid-ship, which would leave the tree dirty for the
# next run. The pbxproj value is kept in step for plain Xcode GUI builds.
say "building native app (xcodebuild Release)"
APP_VERSION="$($JQ -r '.version // empty' "$FRONTEND_DIR/package.json")"
[ -n "$APP_VERSION" ] || fail "could not read version from $FRONTEND_DIR/package.json"
# Build number from the build's own clock: `YYYYMMDD.HHMM`, two period-separated
# integers (the shape CFBundleVersion wants), monotonic by construction. It was
# pinned at 1 forever, which made two builds of the same marketing version
# indistinguishable on the device — the exact confusion this pair of settings
# exists to prevent. Minute resolution, because that is the floor on how often
# a ship can complete.
BUILD_NUMBER="$(date +%Y%m%d.%H%M)"
xcodebuild \
  -project "$IOS_PROJ" \
  -scheme App \
  -configuration Release \
  -destination 'generic/platform=iOS' \
  -derivedDataPath "$DERIVED_DIR" \
  -allowProvisioningUpdates \
  MARKETING_VERSION="$APP_VERSION" \
  CURRENT_PROJECT_VERSION="$BUILD_NUMBER" \
  build >>"$LOG" 2>&1 || fail "xcodebuild failed"

APP_PATH="$DERIVED_DIR/Build/Products/Release-iphoneos/App.app"
[ -d "$APP_PATH" ] || fail "expected artifact missing: $APP_PATH"

# ─── Install + relaunch on each device ───────────────────────────────────────
# Needs each device on USB or the same Wi-Fi as this Mac. The first wireless
# contact often hits a cold CoreDevice tunnel ("connection reset by peer") —
# the attempt itself wakes it, so retry a few times before giving up.
# Multi-device contract: the ship succeeds if AT LEAST ONE device took the
# install; unreachable extras are reported, never block the checkpoint.
MARKETING_VERSION="$(defaults read "$APP_PATH/Info.plist" CFBundleShortVersionString 2>/dev/null || echo '?')"
BUILD_VERSION="$(defaults read "$APP_PATH/Info.plist" CFBundleVersion 2>/dev/null || echo '?')"
ANY_INSTALLED=0
RESULTS=()
for i in "${!DEVICE_IDS[@]}"; do
  DEVICE_NAME="${DEVICE_NAMES[$i]}"
  DEVICE_ID="${DEVICE_IDS[$i]}"
  say "installing to $DEVICE_NAME"
  # Kill the app if it's running BEFORE replacing it. Installing over a live
  # process is what left iPads (which get relaunched every ship, so the app
  # is always running) with a dead "app no longer available" icon that only
  # a manual Xcode install cleared. Best-effort: no-op when not running.
  # Process rows are "PID /path/.../App.app/App" — the bundle DIRECTORY is
  # App.app (xcode product name), not the bundle id, so match the suffix.
  # `|| true` is load-bearing: under `set -euo pipefail` a failing probe (device
  # asleep, tunnel cold) makes the substitution nonzero and kills the whole ship
  # here — before any install, with no summary and no ✗. It cost one silent
  # iPad-shaped hole in a checkpoint. This lookup is best-effort by design.
  PID="$(xcrun devicectl device info processes --device "$DEVICE_ID" 2>/dev/null \
    | awk '$2 ~ /\/App\.app\/App$/ {print $1; exit}')" || true
  if [ -n "$PID" ]; then
    xcrun devicectl device process signal --device "$DEVICE_ID" --pid "$PID" --signal SIGKILL >>"$LOG" 2>&1 || true
    sleep 1
  fi
  INSTALLED=0
  for attempt in 1 2 3 4; do
    if xcrun devicectl device install app --device "$DEVICE_ID" "$APP_PATH" >>"$LOG" 2>&1; then
      INSTALLED=1
      break
    fi
    say "install attempt $attempt failed — retrying (waking device tunnel)…"
    sleep $((attempt * 3))
  done
  if [ $INSTALLED = 1 ]; then
    ANY_INSTALLED=1
    # Best-effort relaunch so the new build is what's on screen. Fails
    # quietly if the device is locked — the install already succeeded.
    if xcrun devicectl device process launch --terminate-existing \
        --device "$DEVICE_ID" "$BUNDLE_ID" >>"$LOG" 2>&1; then
      RESULTS+=("$DEVICE_NAME: relaunched")
    else
      RESULTS+=("$DEVICE_NAME: installed (launch it manually — device likely locked)")
    fi
  else
    RESULTS+=("$DEVICE_NAME: UNREACHABLE (same network / plugged in / unlocked?)")
  fi
done

[ $ANY_INSTALLED = 1 ] || fail "install failed on every device — ${RESULTS[*]}"

say "✓ shipped v$MARKETING_VERSION build $BUILD_VERSION ($TREE_LABEL)"
for r in "${RESULTS[@]}"; do say "  $r"; done
say "log: $LOG"
