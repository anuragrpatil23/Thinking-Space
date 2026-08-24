#!/usr/bin/env bash
set -euo pipefail

# ─── ios-profile-watch.sh ─────────────────────────────────────────────────────
# Watch the expiry clock on Apple's free-provisioning profiles for every app
# signed by this machine's development team, and say something BEFORE one
# lapses instead of after.
#
#   ./scripts/ios-profile-watch.sh              # human status table
#   ./scripts/ios-profile-watch.sh --check      # launchd mode: quiet unless close
#   ./scripts/ios-profile-watch.sh --days-left <bundle-id>   # machine-readable
#   ./scripts/ios-profile-watch.sh --path-for  <bundle-id>   # cached profile path
#   ./scripts/ios-profile-watch.sh --prepare-mint <bundle-id> [udid,udid]
#   ./scripts/ios-profile-watch.sh --install-agent            # daily launchd job
#
# TS_IOS_DRY_NOTIFY=1 prints the Telegram body instead of sending it.
#
# Why this exists (2026-08-23): the thinking-space profile expired mid-session
# and both iPhone + iPad went "app no longer available" with no warning. Two
# ships that same evening did NOT reset the clock — `-allowProvisioningUpdates`
# mints a profile only when no VALID cached one exists, so every build kept
# re-embedding the same 6-day-old profile until it lapsed.
#
# The cache is deliberately left alone. Reuse is what holds minting down to
# ~1 per app per 7 days instead of 1 per ship (two ships in one evening would
# otherwise be two mints). Apple's documented free-tier limit is 10 App IDs per
# 7 days and applies to REGISTERING new bundle ids, not regenerating a profile
# for one already registered — but that has not been verified here, so the
# design keeps mints at the floor a 7-day lifetime allows and records every one
# it triggers. If throttling ever appears, the ledger shows the real count.
#
# Renewal itself lives in checkpoint-ship-ios.sh: delete + rebuild has to be
# atomic, so the delete happens immediately before an xcodebuild that will
# re-mint, with a restore on failure. This script only observes and warns.

# This repo's own app. Everything else is derived from it — no Apple account
# identifier is hardcoded here, so nothing about the developer's team (or any
# other app they happen to sign) is baked into the repo.
PRIMARY_BUNDLE="${TS_IOS_BUNDLE_ID:-com.anurag.thinking-space}"
# Overridable so the renewal path can be exercised against fixtures instead of
# first running for real at the moment a profile expires.
PROFILE_DIR="${TS_IOS_PROFILE_DIR:-$HOME/Library/Developer/Xcode/UserData/Provisioning Profiles}"
STATE_FILE="${TS_IOS_STATE_FILE:-$HOME/.thinking-space/ios-profile-state.json}"
DEVICE_CONFIG="$HOME/.thinking-space/ios-device.json"
SECRETS="$HOME/.thinking-space/secrets.json"
JQ=/usr/bin/jq

# Warn once the profile has this many days or fewer left. Two days leaves room
# for a signed-out Xcode / an unreachable device without losing the app.
WARN_DAYS="${TS_IOS_WARN_DAYS:-2}"

# Renewal window + the backstop floor. One mint per profile lifetime is the
# floor a 7-day profile allows; the interval guard makes a runaway loop
# impossible even if the window math is ever wrong.
RENEW_WINDOW_DAYS="${TS_IOS_RENEW_WINDOW_DAYS:-2}"
MIN_MINT_INTERVAL_DAYS="${TS_IOS_MIN_MINT_INTERVAL_DAYS:-5}"

MODE=status
QUERY_BUNDLE=""
WANT_UDIDS=""
case "${1:-}" in
  --check)     MODE=check ;;
  --days-left) MODE=days-left; QUERY_BUNDLE="${2:-}" ;;
  --path-for)  MODE=path-for; QUERY_BUNDLE="${2:-}" ;;
  --prepare-mint) MODE=prepare-mint; QUERY_BUNDLE="${2:-}"; WANT_UDIDS="${3:-}" ;;
  --install-agent) MODE=install-agent ;;
  "")          MODE=status ;;
  *) echo "unknown flag: $1 (use --check, --days-left <id>, --path-for <id>, --prepare-mint <id>, --install-agent)" >&2; exit 2 ;;
esac

# ─── Telegram ────────────────────────────────────────────────────────────────
# Best-effort by design: a notification failing must never fail the check.
telegram_send() {
  # TS_IOS_DRY_NOTIFY=1 prints the message instead of sending it — lets the
  # exact alert be previewed without putting a test ping on the user's phone.
  if [ "${TS_IOS_DRY_NOTIFY:-0}" = 1 ]; then
    echo "--- telegram (dry run, not sent) ---"
    echo "$1"
    echo "------------------------------------"
    return 0
  fi
  [ -f "$SECRETS" ] || return 0
  local token chat
  token="$($JQ -r .telegram.bot_token "$SECRETS" 2>/dev/null || true)"
  chat="$($JQ -r .telegram.chat_id "$SECRETS" 2>/dev/null || true)"
  [ -n "$token" ] && [ "$token" != null ] || return 0
  curl -sS -X POST "https://api.telegram.org/bot${token}/sendMessage" \
    -H "Content-Type: application/json" \
    -d "$($JQ -nc --argjson chat "$chat" --arg text "$1" '{chat_id:$chat,text:$text,parse_mode:"Markdown"}')" \
    >/dev/null 2>&1 || true
}

# This repo can only re-mint its OWN app. Other apps on the same team are
# reported (they share a certificate, so they share failures) but their renewal
# lives in their own project — saying "run checkpoint-ship-ios.sh" for one of
# them would be actively wrong advice.
fix_hint() {
  [ "$1" = "$PRIMARY_BUNDLE" ] && return 0
  printf ' — rebuild from its own project'
}

# ─── Decode every cached profile for this team ───────────────────────────────
# Emits TSV: bundle-id <TAB> expiry-epoch <TAB> profile-path
# A profile is a CMS-signed plist; `security cms -D` unwraps it. Profiles for
# other teams (or junk files) are skipped rather than failing the run.
scan_profiles() {
  [ -d "$PROFILE_DIR" ] || return 0
  local f plist appid bundle exp_iso exp_epoch team
  while IFS= read -r -d '' f; do
    plist="$(security cms -D -i "$f" 2>/dev/null)" || continue
    [ -n "$plist" ] || continue
    team="$(echo "$plist" | /usr/bin/plutil -extract TeamIdentifier.0 raw - 2>/dev/null || true)"
    [ "$team" = "$TEAM_ID" ] || continue
    appid="$(echo "$plist" | /usr/bin/plutil -extract Entitlements.application-identifier raw - 2>/dev/null || true)"
    [ -n "$appid" ] || continue
    # "TEAMID.com.anurag.thinking-space" -> "com.anurag.thinking-space"
    bundle="${appid#"$TEAM_ID".}"
    exp_iso="$(echo "$plist" | /usr/bin/plutil -extract ExpirationDate raw - 2>/dev/null || true)"
    [ -n "$exp_iso" ] || continue
    # plutil prints ISO-8601 Zulu; date -j parses it back to an epoch.
    exp_epoch="$(date -j -u -f "%Y-%m-%dT%H:%M:%SZ" "$exp_iso" "+%s" 2>/dev/null || true)"
    [ -n "$exp_epoch" ] || continue
    printf '%s\t%s\t%s\n' "$bundle" "$exp_epoch" "$f"
  done < <(find "$PROFILE_DIR" -maxdepth 1 -name '*.mobileprovision' -print0 2>/dev/null)
}

# Latest-expiring profile wins when a bundle id has several cached — that is the
# one Xcode will resolve at build time.
best_for_bundle() {
  local want="$1"
  scan_profiles | awk -F'\t' -v w="$want" '$1 == w {if ($2 > best) {best = $2; line = $0}} END {if (line) print line}'
}

days_left_from_epoch() {
  local exp="$1" now
  now="$(date +%s)"
  # Integer floor: 0 means "expires sometime today", negative means already gone.
  echo $(( (exp - now) / 86400 ))
}

if [ "$MODE" = install-agent ]; then
  # Generated locally rather than committed: a launchd plist needs absolute
  # paths, which would bake this machine's username and repo location into the
  # repo. Anyone cloning runs this flag instead.
  SELF="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"
  LABEL="com.thinkingspace.ios-profile-watch"
  AGENT_DIR="$HOME/Library/LaunchAgents"
  LOG_DIR_AGENT="$HOME/Library/Application Support/thinking-space/launchd-logs"
  mkdir -p "$AGENT_DIR" "$LOG_DIR_AGENT"
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
    <string>--check</string>
  </array>
  <key>StartCalendarInterval</key>
  <dict><key>Hour</key><integer>10</integer><key>Minute</key><integer>0</integer></dict>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>$LOG_DIR_AGENT/$LABEL.out.log</string>
  <key>StandardErrorPath</key><string>$LOG_DIR_AGENT/$LABEL.err.log</string>
</dict>
</plist>
PLIST
  /usr/bin/plutil -lint "$AGENT_DIR/$LABEL.plist" >/dev/null || { echo "  ✗ generated plist is malformed" >&2; exit 1; }
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
  launchctl bootstrap "gui/$(id -u)" "$AGENT_DIR/$LABEL.plist" || { echo "  ✗ launchctl bootstrap failed" >&2; exit 1; }
  echo "  ✓ installed $LABEL (daily 10:00)"
  echo "    remove with: launchctl bootout gui/\$(id -u)/$LABEL && rm $AGENT_DIR/$LABEL.plist"
  exit 0
fi

# ─── Resolve the signing team ────────────────────────────────────────────────
# Order: explicit env → config file → the team on this app's own cached profile
# → the sole team present if every cached profile agrees. Deriving it keeps the
# account id out of the repo, and means a machine with a different Apple ID
# works with no edit. Scanning BY TEAM (rather than by a list of bundle ids) is
# deliberate: every app signed by the same certificate shares its fate, so they
# all show up in one status table without this repo naming any of them.
resolve_team() {
  if [ -n "${TS_IOS_TEAM_ID:-}" ]; then echo "$TS_IOS_TEAM_ID"; return 0; fi
  if [ -f "$DEVICE_CONFIG" ]; then
    local cfg
    cfg="$($JQ -r '.teamId // empty' "$DEVICE_CONFIG" 2>/dev/null || true)"
    [ -n "$cfg" ] && { echo "$cfg"; return 0; }
  fi
  local f plist team appid
  local own="" sole="" multi=0
  while IFS= read -r -d '' f; do
    plist="$(security cms -D -i "$f" 2>/dev/null)" || continue
    team="$(echo "$plist" | /usr/bin/plutil -extract TeamIdentifier.0 raw - 2>/dev/null || true)"
    [ -n "$team" ] || continue
    appid="$(echo "$plist" | /usr/bin/plutil -extract Entitlements.application-identifier raw - 2>/dev/null || true)"
    [ "${appid#"$team".}" = "$PRIMARY_BUNDLE" ] && own="$team"
    if [ -z "$sole" ]; then sole="$team"; elif [ "$sole" != "$team" ]; then multi=1; fi
  done < <(find "$PROFILE_DIR" -maxdepth 1 -name '*.mobileprovision' -print0 2>/dev/null)
  [ -n "$own" ] && { echo "$own"; return 0; }
  [ -n "$sole" ] && [ $multi = 0 ] && { echo "$sole"; return 0; }
  return 1
}

TEAM_ID="$(resolve_team || true)"
if [ -z "$TEAM_ID" ]; then
  echo "  ⚠️  no signing team could be determined — no cached profiles for $PRIMARY_BUNDLE." >&2
  echo "     Xcode is likely signed out (Xcode ▸ Settings ▸ Accounts)." >&2
  # Query modes must stay machine-parseable even here: callers branch on "none".
  case "$MODE" in days-left) echo none ;; prepare-mint) echo none ;; path-for) exit 1 ;; esac
  # No profiles at all is the signature of a signed-out Xcode — nothing can be
  # minted in that state, so it is worth a ping on its own.
  [ "$MODE" = check ] && telegram_send "⚠️ *iOS signing*: no cached provisioning profiles — Xcode is likely signed out (Xcode ▸ Settings ▸ Accounts). The next iOS build will fail to sign."
  exit 0
fi

case "$MODE" in
  days-left)
    [ -n "$QUERY_BUNDLE" ] || { echo "--days-left needs a bundle id" >&2; exit 2; }
    row="$(best_for_bundle "$QUERY_BUNDLE")"
    [ -n "$row" ] || { echo "none"; exit 0; }
    days_left_from_epoch "$(echo "$row" | cut -f2)"
    exit 0
    ;;
  path-for)
    [ -n "$QUERY_BUNDLE" ] || { echo "--path-for needs a bundle id" >&2; exit 2; }
    row="$(best_for_bundle "$QUERY_BUNDLE")"
    [ -n "$row" ] || exit 1
    echo "$row" | cut -f3
    exit 0
    ;;
  prepare-mint)
    # Decide whether the next xcodebuild should be forced to mint a fresh
    # profile, and if so, clear the cache so it has no choice. Prints one line
    # the caller parses:
    #   none                      no cached profile — a mint happens anyway
    #   ok <days>                 outside the window — reuse (the cheap path)
    #   floor <days> <age>        in window but minted too recently — reuse
    #   mint <days> <backup> <original-path>
    # Fields are TAB-separated — the original path contains spaces.
    #
    # The caller MUST restore <backup> to <original-path> if its build fails:
    # a cleared cache plus a failed build leaves nothing to sign with.
    [ -n "$QUERY_BUNDLE" ] || { echo "--prepare-mint needs a bundle id" >&2; exit 2; }
    row="$(best_for_bundle "$QUERY_BUNDLE")"
    if [ -z "$row" ]; then echo "none"; exit 0; fi
    exp="$(echo "$row" | cut -f2)"
    path="$(echo "$row" | cut -f3)"
    d="$(days_left_from_epoch "$exp")"
    # A profile also goes stale in DEVICE COVERAGE, not just in time. Xcode
    # registers only the devices it can see when it mints, so a device that was
    # asleep or off-network at mint time is simply absent from
    # ProvisionedDevices — and installing to it fails with 0xe8008012
    # ("cannot be installed on this device") while days-left still looks fine.
    # That is how Ikigai stayed dead after a successful ship on 2026-08-23.
    # Coverage gaps deliberately bypass the mint floor: they are user-driven
    # (a device joined) rather than timer-driven, so there is no runaway risk,
    # and a 5-day wait to adopt a new device would be absurd.
    if [ -n "$WANT_UDIDS" ]; then
      provisioned="$(security cms -D -i "$path" 2>/dev/null | /usr/bin/plutil -extract ProvisionedDevices json -o - - 2>/dev/null || true)"
      # Empty means the extract failed, NOT that no device is provisioned —
      # treating those the same would re-mint on every ship. Skip the check.
      [ -n "$provisioned" ] || provisioned=""
      if [ -n "$provisioned" ]; then
      missing=""
      IFS=',' read -ra _uds <<< "$WANT_UDIDS"
      for _u in "${_uds[@]}"; do
        [ -n "$_u" ] || continue
        echo "$provisioned" | $JQ -e --arg u "$_u" 'index($u) != null' >/dev/null 2>&1 || missing="$missing $_u"
      done
      if [ -n "$missing" ]; then
        backup_dir="${TS_IOS_BACKUP_DIR:-$HOME/.thinking-space/tmp}"
        mkdir -p "$backup_dir"
        backup="$backup_dir/profile-backup-$(date +%Y%m%d-%H%M%S)-$QUERY_BUNDLE.mobileprovision"
        cp "$path" "$backup"; rm -f "$path"
        printf 'mint\t%s\t%s\t%s\tdevices:%s\n' "$d" "$backup" "$path" "$(echo "$missing" | tr -s ' ' ',' | sed 's/^,//')"
        exit 0
      fi
      fi
    fi
    if [ "$d" -gt "$RENEW_WINDOW_DAYS" ]; then printf 'ok\t%s\n' "$d"; exit 0; fi
    # Backstop: never mint more often than the floor, whatever the window says.
    last_mint="$($JQ -r --arg b "$QUERY_BUNDLE" '.[$b].lastMint // empty' "$STATE_FILE" 2>/dev/null || true)"
    if [ -n "$last_mint" ]; then
      lm_epoch="$(date -j -u -f "%Y-%m-%dT%H:%M:%SZ" "$last_mint" "+%s" 2>/dev/null || echo 0)"
      if [ "$lm_epoch" != 0 ]; then
        age=$(( ( $(date +%s) - lm_epoch ) / 86400 ))
        if [ "$age" -lt "$MIN_MINT_INTERVAL_DAYS" ]; then printf 'floor\t%s\t%s\n' "$d" "$age"; exit 0; fi
      fi
    fi
    backup_dir="${TS_IOS_BACKUP_DIR:-$HOME/.thinking-space/tmp}"
    mkdir -p "$backup_dir"
    backup="$backup_dir/profile-backup-$(date +%Y%m%d-%H%M%S)-$QUERY_BUNDLE.mobileprovision"
    cp "$path" "$backup"
    rm -f "$path"
    # Tab-delimited: the original path contains spaces ("Provisioning Profiles").
    printf 'mint\t%s\t%s\t%s\texpiry\n' "$d" "$backup" "$path"
    exit 0
    ;;
esac

# ─── status / check ──────────────────────────────────────────────────────────
ROWS="$(scan_profiles | sort)"

if [ -z "$ROWS" ]; then
  MSG="no profiles found for team $TEAM_ID"
  [ "$MODE" = check ] && telegram_send "⚠️ *iOS signing*: $MSG"
  echo "  ⚠️  $MSG"
  exit 0
fi

WARN_LINES=()
echo "  iOS provisioning profiles (team $TEAM_ID)"
while IFS=$'\t' read -r bundle exp path; do
  [ -n "$bundle" ] || continue
  d="$(days_left_from_epoch "$exp")"
  when="$(date -r "$exp" "+%b %e %H:%M")"
  if [ "$d" -lt 0 ]; then
    state="EXPIRED"
    WARN_LINES+=("*$bundle* — EXPIRED $when$(fix_hint "$bundle")")
  elif [ "$d" -le "$WARN_DAYS" ]; then
    state="${d}d left"
    WARN_LINES+=("*$bundle* — ${d}d left (expires $when)$(fix_hint "$bundle")")
  else
    state="${d}d left"
  fi
  printf '    %-34s %-10s %s\n' "$bundle" "$state" "$when"
done <<< "$ROWS"

# Record what was observed. The ledger is the audit trail for how often profiles
# actually turn over — the thing nobody could answer when this was designed.
mkdir -p "$(dirname "$STATE_FILE")"
OBSERVED="$($JQ -nc '{}')"
while IFS=$'\t' read -r bundle exp path; do
  [ -n "$bundle" ] || continue
  OBSERVED="$(echo "$OBSERVED" | $JQ -c --arg b "$bundle" --arg e "$(date -r "$exp" -u "+%Y-%m-%dT%H:%M:%SZ")" '.[$b] = {expires: $e}')"
done <<< "$ROWS"
PREV="{}"
[ -f "$STATE_FILE" ] && PREV="$(cat "$STATE_FILE" 2>/dev/null || echo '{}')"
# Merge: keep any lastMint stamps written by the ship script, refresh expiries.
echo "$PREV" | $JQ -c --argjson obs "$OBSERVED" --arg now "$(date -u +%Y-%m-%dT%H:%M:%SZ)" '
  reduce ($obs | keys[]) as $k (.; .[$k] = ((.[$k] // {}) + $obs[$k] + {lastSeen: $now}))
' > "$STATE_FILE"

if [ "${#WARN_LINES[@]}" -eq 0 ]; then
  [ "$MODE" = check ] && exit 0
  echo "  ✓ nothing expiring within ${WARN_DAYS}d"
  exit 0
fi

PRIMARY_AFFECTED=0
printf '%s\n' "${WARN_LINES[@]}" | grep -q "\*$PRIMARY_BUNDLE\*" && PRIMARY_AFFECTED=1

if [ $PRIMARY_AFFECTED = 1 ]; then
  ADVICE="A re-ship re-mints this app: \`./scripts/checkpoint-ship-ios.sh\`"
else
  ADVICE="None of these is $PRIMARY_BUNDLE — rebuild the affected app from its own project. (Shipping this repo will not help it.)"
fi
echo "  ⚠️  ${#WARN_LINES[@]} profile(s) need a re-mint"
echo "      $ADVICE"

if [ "$MODE" = check ]; then
  telegram_send "⚠️ *iOS profile expiry*
$(printf '%s\n' "${WARN_LINES[@]}")

$ADVICE
(Needs Xcode signed in — Xcode ▸ Settings ▸ Accounts.)"
fi
