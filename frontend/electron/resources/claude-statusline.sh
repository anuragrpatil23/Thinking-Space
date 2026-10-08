#!/usr/bin/env bash
# Thinking Space — Claude Code status line.
#
# Ships inside the app bundle, so it is versioned with Thinking Space and there
# is no loose copy in your home directory to maintain or trust. Point Claude
# Code at it once and it stays current through app updates.
#
# Two jobs. First: persist the reading. Claude Code pipes its session JSON to
# this script's stdin and never writes those numbers to disk, so this is the
# only chance to catch them — that file is what the "AI Plan usage" card reads.
# Second: print a status line, because Claude Code hides several footer hints
# once one exists and a silent script would quietly cost you something.
#
# To stop using it, remove "statusLine" from ~/.claude/settings.json.
set -u

input=$(cat)

# Where our files go.
#
# `$HOME` is the obvious answer and the wrong one on Windows. The app reads
# `os.homedir()`, which there is always the Windows profile (C:\Users\<name>),
# while the Git Bash / MSYS shell that runs this script can hand it a `HOME`
# pointing inside the MSYS root instead. The script then writes a perfectly
# good reading somewhere the app never looks — which presents as the feature
# silently doing nothing, not as an error, because every write here succeeds.
#
# `USERPROFILE` is set only on Windows and is exactly what `os.homedir()`
# returns there, so prefer it and normalise its backslashes. On macOS and Linux
# it is unset and this stays `$HOME` untouched.
ts_home="${USERPROFILE:-$HOME}"
ts_home="${ts_home//\\//}"

out="$ts_home/.thinking-space/claude-limits.json"
mkdir -p "$(dirname "$out")"
# Stored verbatim rather than filtered: no jq needed for the part that matters,
# and the app picks out what it needs. Write-then-rename because the app reads
# this on window focus and must never catch a half-written file.
printf '%s' "$input" > "$out.tmp" && mv "$out.tmp" "$out"

# Per-session copy, keyed by session id.
#
# The file above is last-writer-wins: with two Claude Code sessions open, each
# overwrites the other. That is harmless for rate limits (account-wide, same
# number from any session) but makes every session-scoped field in the payload —
# cost, context window, session name, lines changed — a coin flip between
# whichever rendered most recently. Keyed by session, they all become readable.
#
# sed rather than jq so this keeps working on a machine without it. A payload
# with no session_id simply skips this write.
session_id=$(printf '%s' "$input" | sed -n 's/.*"session_id" *: *"\([^"]*\)".*/\1/p' | head -1)
case "$session_id" in
  # Guard the filename: it lands in a path, and the value is external input.
  *[!A-Za-z0-9-]* | '') ;;
  *)
    # Provider is a directory, so the filename is exactly the session id and a
    # lookup from an AI-activity record is a direct path build.
    sessions="$ts_home/.thinking-space/ai-sessions/claude"
    mkdir -p "$sessions"
    printf '%s' "$input" > "$sessions/$session_id.json.tmp" \
      && mv "$sessions/$session_id.json.tmp" "$sessions/$session_id.json"
    ;;
esac

# Append-only history, one monthly file.
#
# The snapshot above is last-value-per-session: a session that ran all week
# leaves one row holding its final number, so there is no curve in it to plot.
# Usage over time only exists if something writes it down as it happens — it
# cannot be reconstructed later, which is why this starts collecting before
# anything reads it.
#
# Each line is a small projection — the fields a usage curve and per-session
# attribution actually need — at roughly 110 bytes against 1.4 KB for the whole
# payload. Over a year that is the difference between a few megabytes and most
# of a gigabyte, for fields nothing would plot. The full payload is already kept
# per session in ai-sessions/claude/, so nothing is lost by summarising here.
#
# Three ways to build it, in order, so no machine is left without history:
# jq when installed; a narrow grep for the numbers when not; and failing both,
# the raw payload, which the reader detects by its "payload" key. session_id is
# copied through untouched so these lines still join against AI-activity
# records.
# Provider-neutral root with a directory per provider — Codex samples land in a
# sibling folder, written by the app rather than this script. Separate files so
# each side's five-minute dedupe only ever reads its own last sample.
log_dir="$ts_home/.thinking-space/ai-usage-log/claude"
mkdir -p "$log_dir"
log_file="$log_dir/$(date +%Y-%m).jsonl"
now=$(date +%s)

# One line every five minutes per session, and one whenever a limit moves.
#
# Rate-limit windows are 5 hours and 7 days, so five-minute resolution is 60
# samples across the short window and 2000 across the long one — far more than a
# curve needs. The interval is the size control: a minute's resolution would
# cost several times the disk for detail nothing would ever plot.
#
# The clock is per session, not per file. It used to be read off the log's last
# line, which made it one clock for the whole machine: with two sessions open,
# whichever rendered first took the slot and the other went unsampled for as
# long as they overlapped. The curve survived that (limits are account-wide);
# working out which session moved it did not.
#
# A changed percentage is logged at once, whatever the clock says. The
# percentages are whole numbers, so that is at most a hundred extra lines per
# window, and it pins each point of movement to the session that was running
# when it appeared instead of to whoever next crossed the five-minute mark.
#
# The stamp sits beside the session snapshot and holds "<epoch> <signature>",
# both written by us, so reading it back is safe in a way parsing Claude Code's
# payload would not be. The signature is narrowed to the rate_limits object for
# the same reason as the no-jq path below.
sig=$(printf '%s' "$input" | sed -n 's/.*"rate_limits"://p' \
  | grep -o '"used_percentage":[0-9.]*')
# One token, so the stamp reads back with a plain `read`.
sig=${sig//$'\n'/,}
stamp=''
last_t=''
last_sig=''
case "$session_id" in
  *[!A-Za-z0-9-]* | '')
    # No usable session id: fall back to the shared clock on the log itself.
    last_t=$(tail -c 4096 "$log_file" 2>/dev/null | tail -1 | sed -n 's/^{"t":\([0-9]*\).*/\1/p')
    last_sig="$sig"
    ;;
  *)
    stamp="$ts_home/.thinking-space/ai-sessions/claude/$session_id.stamp"
    [ -f "$stamp" ] && read -r last_t last_sig < "$stamp"
    ;;
esac
case "$last_t" in *[!0-9]* | '') last_t='' ;; esac
if [ -z "$last_t" ] || [ $((now - last_t)) -ge 300 ] || [ "$sig" != "${last_sig:-}" ]; then
  line=''

  if command -v jq >/dev/null 2>&1; then
    line=$(printf '%s' "$input" | jq -c --argjson t "$now" '{
      t: $t,
      p: "claude",
      sid: .session_id,
      fh: .rate_limits.five_hour.used_percentage,
      fhr: .rate_limits.five_hour.resets_at,
      sd: .rate_limits.seven_day.used_percentage,
      sdr: .rate_limits.seven_day.resets_at,
      cost: .cost.total_cost_usd,
      ctx: .context_window.used_percentage,
      model: .model.id
    }' 2>/dev/null)
  fi

  if [ -z "$line" ]; then
    # No jq. Narrow to the rate_limits object *before* matching, because
    # "used_percentage" is not unique in this payload — context_window has one
    # too, and it appears first. Matching the bare key across the whole document
    # silently logged context usage as the session limit.
    rl=$(printf '%s' "$input" | sed -n 's/.*"rate_limits"://p')
    pcts=$(printf '%s' "$rl" | grep -o '"used_percentage":[0-9]*' | grep -o '[0-9]*$' | grep -v '^$')
    fh=$(printf '%s\n' "$pcts" | sed -n 1p)
    sd=$(printf '%s\n' "$pcts" | sed -n 2p)
    if [ -n "$fh" ] && [ -n "$sd" ]; then
      line=$(printf '{"t":%s,"p":"claude","sid":"%s","fh":%s,"sd":%s}' "$now" "$session_id" "$fh" "$sd")
    fi
  fi

  # Neither worked — keep the raw payload rather than drop the sample. History
  # is the one thing that cannot be backfilled.
  [ -n "$line" ] || line=$(printf '{"t":%s,"p":"claude","payload":%s}' "$now" "$input")

  printf '%s\n' "$line" >> "$log_file"
  [ -z "$stamp" ] || printf '%s %s\n' "$now" "$sig" > "$stamp"
fi

# Display only — jq is optional, and its absence never breaks the card.
if command -v jq >/dev/null 2>&1; then
  printf '%s' "$input" | jq -r '[
    .model.display_name,
    (if .rate_limits.seven_day.used_percentage != null
       then "\(.rate_limits.seven_day.used_percentage | floor)% wk" else empty end)
  ] | map(select(. != null)) | join("  ·  ")'
else
  printf '%s' "$input" | sed -n 's/.*"display_name" *: *"\([^"]*\)".*/\1/p' | head -1
fi
