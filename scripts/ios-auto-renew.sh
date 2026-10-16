#!/usr/bin/env bash
set -euo pipefail

# ─── ios-auto-renew.sh ────────────────────────────────────────────────────────
# Keep free-provisioning iOS apps alive without anyone remembering to rebuild.
# Daily launchd job: for each configured app, rebuild + reinstall only when its
# profile is about to lapse (or a newer profile never reached the devices), then
# say on Telegram what happened.
#
#   ./scripts/ios-auto-renew.sh                  # run once now (what launchd runs)
#   ./scripts/ios-auto-renew.sh --status         # show what a run would do, change nothing
#   ./scripts/ios-auto-renew.sh --install-agent  # daily launchd job
#
# Apps come from ~/.thinking-space/ios-auto-renew.json — local, never committed,
# because it names other projects' absolute paths and device UDIDs:
#   {"apps": [{
#      "bundle":  "com.anurag.thinking-space",
#      "cmd":     ["/abs/path/scripts/checkpoint-ship-ios.sh", "--dirty"],
#      "app":     "/abs/path/to/Built.app",      # where cmd leaves the .app
#      "devices": ["<udid>", ...],               # every device it must reach
#      "mintsItself": true                       # cmd runs --prepare-mint itself
#   }]}
#
# Why "installed", not "cached", is the clock that matters: the app on a device
# carries the profile embedded at BUILD time. On 2026-10-15 Xcode minted a
# profile covering only Ichigo, signed the app with it, then minted a second one
# covering Ikigai 16s later — the cache looked healthy while the iPad rejected
# the install (0xe8008012). So success is judged from the built app's
# embedded.mobileprovision, and the expiry of what last reached every device is
# recorded per app. A cached profile newer than that means a rebuild is owed
# even when days-left looks fine.
#
# Minting cadence is unchanged: --prepare-mint (ios-profile-watch.sh) still
# owns the window + 5-day floor, so this job cannot mint more often than a ship.
# The one thing it cannot fix is a signed-out Xcode; that fails loudly here.

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
WATCH="$ROOT_DIR/scripts/ios-profile-watch.sh"
CONFIG="${TS_IOS_RENEW_CONFIG:-$HOME/.thinking-space/ios-auto-renew.json}"
STATE="${TS_IOS_RENEW_STATE:-$HOME/.thinking-space/ios-auto-renew-state.json}"
PROFILE_STATE="$HOME/.thinking-space/ios-profile-state.json"
LOG_DIR="$HOME/.thinking-space/logs"
LOCK_DIR="$HOME/.thinking-space/tmp/ios-auto-renew.lock"
JQ=/usr/bin/jq
# Same knobs as the watcher, so "due" here means what it means there.
RENEW_WINDOW_DAYS="${TS_IOS_RENEW_WINDOW_DAYS:-2}"
MIN_MINT_INTERVAL_DAYS="${TS_IOS_MIN_MINT_INTERVAL_DAYS:-5}"
# What checkpoint-ship-ios.sh prints for a device it could not install to. It
# exits 0 when ANY device took the install; for renewal, every device must.
INSTALL_FAIL_RE='UNREACHABLE|LOCKED \(|NOT FOUND \(|DISCONNECTED \(|OUT OF SPACE|✗'

MODE=run
case "${1:-}" in
  "")              MODE=run ;;
  --status)        MODE=status ;;
  --install-agent) MODE=install-agent ;;
  *) echo "unknown flag: $1 (use --status, --install-agent)" >&2; exit 2 ;;
esac

if [ "$MODE" = install-agent ]; then
  # Generated, not committed: absolute paths and this machine's PATH (nvm node
  # for the web build, homebrew for xcodegen) — launchd's default PATH has neither.
  SELF="$ROOT_DIR/scripts/$(basename "$0")"
  LABEL="com.thinkingspace.ios-auto-renew"
  AGENT_DIR="$HOME/Library/LaunchAgents"
  AGENT_LOGS="$HOME/Library/Application Support/thinking-space/launchd-logs"
  NODE_BIN="$(dirname "$(command -v node 2>/dev/null || echo /usr/local/bin/node)")"
  AGENT_PATH="$NODE_BIN:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
  mkdir -p "$AGENT_DIR" "$AGENT_LOGS"
  cat > "$AGENT_DIR/$LABEL.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$SELF</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict><key>PATH</key><string>$AGENT_PATH</string></dict>
  <key>StartCalendarInterval</key>
  <dict><key>Hour</key><integer>3</integer><key>Minute</key><integer>30</integer></dict>
  <key>StandardOutPath</key><string>$AGENT_LOGS/$LABEL.out.log</string>
  <key>StandardErrorPath</key><string>$AGENT_LOGS/$LABEL.err.log</string>
</dict>
</plist>
PLIST
  /usr/bin/plutil -lint "$AGENT_DIR/$LABEL.plist" >/dev/null || { echo "  ✗ generated plist is malformed" >&2; exit 1; }
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
  launchctl bootstrap "gui/$(id -u)" "$AGENT_DIR/$LABEL.plist" || { echo "  ✗ launchctl bootstrap failed" >&2; exit 1; }
  echo "  ✓ installed $LABEL (daily 03:30; a run missed while asleep fires on wake)"
  echo "    remove with: launchctl bootout gui/\$(id -u)/$LABEL && rm $AGENT_DIR/$LABEL.plist"
  exit 0
fi

[ -f "$CONFIG" ] || { echo "  ✗ no config at $CONFIG" >&2; exit 1; }

say() { echo "  $*"; }
notify() { [ "$MODE" = run ] && "$WATCH" --notify "$1" >/dev/null 2>&1 || true; }

# ─── Profile helpers ─────────────────────────────────────────────────────────
profile_exp() {  # <file> → expiry epoch, or 0
  local iso
  iso="$(security cms -D -i "$1" 2>/dev/null | /usr/bin/plutil -extract ExpirationDate raw -o - - 2>/dev/null || true)"
  [ -n "$iso" ] || { echo 0; return; }
  date -j -u -f "%Y-%m-%dT%H:%M:%SZ" "$iso" "+%s" 2>/dev/null || echo 0
}
profile_missing_devices() {  # <file> <udid,udid> → space-separated missing (or "?" if unreadable)
  local devs missing="" u
  devs="$(security cms -D -i "$1" 2>/dev/null | /usr/bin/plutil -extract ProvisionedDevices json -o - - 2>/dev/null || true)"
  [ -n "$devs" ] || { echo "?"; return; }
  IFS=',' read -ra _u <<< "$2"
  for u in "${_u[@]}"; do
    echo "$devs" | $JQ -e --arg u "$u" 'index($u) != null' >/dev/null 2>&1 || missing="$missing $u"
  done
  echo "${missing# }"
}
fmt_day() { date -r "$1" "+%a %b %e"; }

state_get() { $JQ -r --arg b "$1" --arg k "$2" '.[$b][$k] // empty' "$STATE" 2>/dev/null || true; }
state_set() {
  local prev="{}"
  [ -f "$STATE" ] && prev="$(cat "$STATE" 2>/dev/null || echo '{}')"
  echo "$prev" | $JQ -c --arg b "$1" --arg k "$2" --arg v "$3" '.[$b] = ((.[$b] // {}) + {($k): $v})' > "$STATE.tmp" && mv "$STATE.tmp" "$STATE"
}

if [ "$MODE" = run ]; then
  mkdir -p "$(dirname "$LOCK_DIR")" "$LOG_DIR"
  mkdir "$LOCK_DIR" 2>/dev/null || { say "another renewal is running — skipping"; exit 0; }
  trap 'rmdir "$LOCK_DIR" 2>/dev/null || true' EXIT
fi

NOW="$(date +%s)"
COUNT="$($JQ '.apps | length' "$CONFIG")"
REPORT=()
FAILED=0

for ((i = 0; i < COUNT; i++)); do
  BUNDLE="$($JQ -r ".apps[$i].bundle" "$CONFIG")"
  APP="$($JQ -r ".apps[$i].app" "$CONFIG")"
  UDIDS="$($JQ -r ".apps[$i].devices | join(\",\")" "$CONFIG")"
  SELF_MINT="$($JQ -r ".apps[$i].mintsItself // false" "$CONFIG")"
  CMD=()
  while IFS= read -r c; do CMD+=("$c"); done < <($JQ -r ".apps[$i].cmd[]" "$CONFIG")
  NAME="$(basename "$APP" .app)"; [ "$NAME" = App ] && NAME="Thinking Space"
  EMB="$APP/embedded.mobileprovision"

  CACHED_PATH="$("$WATCH" --path-for "$BUNDLE" 2>/dev/null || true)"
  CACHED_EXP=0; [ -n "$CACHED_PATH" ] && CACHED_EXP="$(profile_exp "$CACHED_PATH")"
  # Seed from the app already built: absent a record, assume what was last built
  # is what is on the devices — true right after any manual ship.
  INSTALLED_EXP="$(state_get "$BUNDLE" installedExpiry)"
  if [ -z "$INSTALLED_EXP" ]; then
    INSTALLED_EXP=0; [ -f "$EMB" ] && INSTALLED_EXP="$(profile_exp "$EMB")"
  fi
  DAYS=$(( (CACHED_EXP - NOW) / 86400 )); [ "$CACHED_EXP" = 0 ] && DAYS=-1

  REASON=""
  if [ "$CACHED_EXP" = 0 ]; then
    REASON="no cached profile"
  elif [ "$DAYS" -le "$RENEW_WINDOW_DAYS" ]; then
    # Mirror --prepare-mint's floor: inside it a rebuild would just re-embed the
    # same profile, so there is nothing to gain by running.
    LAST_MINT="$($JQ -r --arg b "$BUNDLE" '.[$b].lastMint // empty' "$PROFILE_STATE" 2>/dev/null || true)"
    AGE=99
    [ -n "$LAST_MINT" ] && AGE=$(( (NOW - $(date -j -u -f "%Y-%m-%dT%H:%M:%SZ" "$LAST_MINT" "+%s" 2>/dev/null || echo 0)) / 86400 ))
    [ "$AGE" -ge "$MIN_MINT_INTERVAL_DAYS" ] && REASON="profile ${DAYS}d left"
  fi
  if [ -z "$REASON" ] && [ "$CACHED_EXP" -gt $((INSTALLED_EXP + 60)) ]; then
    REASON="a newer profile never reached the devices"
  fi

  if [ -z "$REASON" ]; then
    say "$NAME: ok — devices good until $(fmt_day "$INSTALLED_EXP")"
    continue
  fi
  if [ "$MODE" = status ]; then
    say "$NAME: WOULD REBUILD — $REASON"
    continue
  fi

  say "$NAME: rebuilding — $REASON"
  LOG="$LOG_DIR/ios-auto-renew-$(date +%Y%m%d-%H%M%S)-$BUNDLE.log"
  RESULT=""
  # Two attempts: the second exists for the coverage race above, where the
  # first build embeds a profile that a later mint superseded.
  for attempt in 1 2; do
    BACKUP=""; ORIGIN=""; MINTED=0
    if [ "$SELF_MINT" != true ]; then
      IFS=$'\t' read -r PM_S PM_A PM_B PM_C PM_D <<< "$("$WATCH" --prepare-mint "$BUNDLE" "$UDIDS" 2>/dev/null || echo none)"
      [ "${PM_S:-}" = mint ] && { BACKUP="$PM_B"; ORIGIN="$PM_C"; MINTED=1; }
    fi
    RC=0
    "${CMD[@]}" >>"$LOG" 2>&1 || RC=$?
    # Never leave the cache empty: a failed mint gets the old profile back.
    if [ $MINTED = 1 ] && ! "$WATCH" --path-for "$BUNDLE" >/dev/null 2>&1; then
      mkdir -p "$(dirname "$ORIGIN")"; cp "$BACKUP" "$ORIGIN"
      MINTED=0
    fi
    # Same ledger the ship writes, so the mint floor sees renewals made here.
    if [ $MINTED = 1 ]; then
      prev="{}"; [ -f "$PROFILE_STATE" ] && prev="$(cat "$PROFILE_STATE")"
      echo "$prev" | $JQ -c --arg b "$BUNDLE" --arg t "$(date -u +%Y-%m-%dT%H:%M:%SZ)" '.[$b] = ((.[$b] // {}) + {lastMint: $t})' > "$PROFILE_STATE"
      rm -f "$BACKUP"
    fi

    if [ "$RC" != 0 ]; then
      RESULT="build/install failed (exit $RC)"
      grep -q "No Accounts" "$LOG" 2>/dev/null && RESULT="Xcode is signed out (Xcode ▸ Settings ▸ Accounts)"
      break
    fi
    if grep -Eq "$INSTALL_FAIL_RE" "$LOG"; then
      RESULT="not every device took the install: $(grep -E "$INSTALL_FAIL_RE" "$LOG" | tail -3 | sed 's/^ *//' | tr '\n' ';')"
      break
    fi
    MISSING="$(profile_missing_devices "$EMB" "$UDIDS")"
    if [ -n "$MISSING" ] && [ "$MISSING" != "?" ]; then
      RESULT="built profile is missing device(s): $MISSING"
      echo "--- attempt $attempt: $RESULT — rebuilding" >>"$LOG"
      continue
    fi
    NEW_EXP="$(profile_exp "$EMB")"
    state_set "$BUNDLE" installedExpiry "$NEW_EXP"
    RESULT=""
    break
  done

  if [ -z "$RESULT" ]; then
    say "$NAME: ✓ renewed — good until $(fmt_day "$NEW_EXP")"
    REPORT+=("✅ *$NAME* renewed — good until $(fmt_day "$NEW_EXP")")
  else
    FAILED=1
    say "$NAME: ✗ $RESULT (log: $LOG)"
    REPORT+=("❌ *$NAME*: $RESULT
log: \`$LOG\`")
  fi
done

if [ ${#REPORT[@]} -gt 0 ]; then
  HINT=""
  [ $FAILED = 1 ] && HINT="

Fix the cause, then run \`./scripts/ios-auto-renew.sh\` (or wait for tomorrow's run)."
  notify "🔁 *iOS auto-renew*
$(printf '%s\n' "${REPORT[@]}")$HINT"
fi
exit 0
