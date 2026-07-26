# Major Checkpoint Ritual (Ship It)

A "major checkpoint" = a user-visible feature or fix is complete and verified (typecheck/tests pass), not every commit. At a major checkpoint:

1. Commit (per `agents/TEMPLATES/COMMIT_MESSAGE_TEMPLATE.md`) and push.
2. Run `./scripts/checkpoint-ship.sh` (in the background — takes ~2–3 min). It builds the unpacked .app, verifies the startup-perf contract, signs, and swaps `/Applications/Thinking Space.app` in place (detached swap, so it also works from the app's own embedded terminal). Full output goes to `~/.thinking-space/logs/`; stdout is a ~4-line summary — read that, not the log, unless it failed.
3. The script refuses dirty/unpushed trees by design — don't work around that; commit first.
4. **iOS checkpoints**: if the checkpoint touched iOS-relevant surfaces (`frontend/ios/**`, or web code that renders in the iPhone shell — shared `frontend/src` counts), ALSO run `./scripts/checkpoint-ship-ios.sh` (in the background). It builds the web bundle, runs `cap sync`, xcodebuilds Release (`generic/platform=iOS`, automatic signing, persistent derived data at `~/.thinking-space/tmp/ios-derived` for fast incrementals), and installs + relaunches on the user's configured device(s) via `devicectl` (config `~/.thinking-space/ios-device.json` `{"deviceNames": ["Ichigo", "Ikigai"]}` — iPhone + iPad, one build installs to every listed device; legacy singular `deviceName` still honored; env override `TS_IOS_DEVICE` takes comma-separated names; auto-adopts a sole paired iPhone). Install retries 4× per device — the first wireless contact often hits a cold CoreDevice tunnel. Ship succeeds if AT LEAST ONE device takes the install; unreachable extras are reported per-device, never block the checkpoint. Needs each device on USB or the same Wi-Fi. Both ship scripts build the shared `frontend/dist` (electron vs capacitor targets) and serialize that phase via `~/.thinking-space/tmp/dist-build.lock`, so launching Mac + iOS ships together is safe (before the lock, a concurrent run once packed the Mac app from a capacitor-flavored dist → ERR_FILE_NOT_FOUND on `ltm-app://`). `--dirty` skips the clean/pushed preflight for mid-session on-device iteration (personal test build, no /Applications swap); the no-flag form stays strict. Read the ~5-line stdout summary, not the log.

DMG creation stays a separate deliberate release step; checkpoints install the app directly.

## Proactive Notification Channel (Telegram → Anurag)

You can send messages directly to Anurag's phone via the Kai Telegram bot. Use this proactively when:
- A long-running task you started is finished and Anurag stepped away.
- You hit a blocker that needs human input and the session has been idle.
- Anurag asked you to "let me know when X" / "ping me if Y".

Do NOT use it for:
- Routine task-complete pings the user is watching you do.
- Anything that would just be noise — the channel is meant to be high-signal.

How to send:
```bash
TOKEN=$(/usr/bin/jq -r .telegram.bot_token ~/.thinking-space/secrets.json)
CHAT=$(/usr/bin/jq -r .telegram.chat_id ~/.thinking-space/secrets.json)
curl -sS -X POST "https://api.telegram.org/bot${TOKEN}/sendMessage" \
  -H "Content-Type: application/json" \
  -d "$(/usr/bin/jq -nc --argjson chat "$CHAT" --arg text "your message here" \
      '{chat_id:$chat,text:$text,parse_mode:"Markdown"}')"
```

Credentials live at `~/.thinking-space/secrets.json` (mode 0600, never committed). Bot is `@anurag_kai_cc_bot`. Messages support Markdown and `obsidian://open?vault=...&file=...` links to make notifications tappable into vault notes.
