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

out="$HOME/.thinking-space/claude-limits.json"
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
    sessions="$HOME/.thinking-space/claude-sessions"
    mkdir -p "$sessions"
    printf '%s' "$input" > "$sessions/$session_id.json.tmp" \
      && mv "$sessions/$session_id.json.tmp" "$sessions/$session_id.json"
    ;;
esac

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
