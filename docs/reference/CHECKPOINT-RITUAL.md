# Major Checkpoint Ritual (Ship It)

A "major checkpoint" = a user-visible feature or fix is complete and verified (typecheck/tests pass), not every commit. At a major checkpoint:

1. Commit (per `agents/TEMPLATES/COMMIT_MESSAGE_TEMPLATE.md`) and push.
2. Run `./scripts/checkpoint-ship.sh` (in the background — takes ~2–3 min). It builds the unpacked .app, verifies the startup-perf contract, signs, and swaps `/Applications/Thinking Space.app` in place (detached swap, so it also works from the app's own embedded terminal). Full output goes to `~/.thinking-space/logs/`; stdout is a ~4-line summary — read that, not the log, unless it failed.
3. The script refuses dirty/unpushed trees by design — don't work around that; commit first.
4. **iOS checkpoints**: if the checkpoint touched iOS-relevant surfaces (`frontend/ios/**`, or web code that renders in the iPhone shell — shared `frontend/src` counts), ALSO run `./scripts/checkpoint-ship-ios.sh` (in the background). It builds the web bundle, runs `cap sync`, xcodebuilds Release (`generic/platform=iOS`, automatic signing, persistent derived data at `~/.thinking-space/tmp/ios-derived` for fast incrementals), and installs + relaunches on the user's configured device(s) via `devicectl` (config `~/.thinking-space/ios-device.json` `{"deviceNames": ["Ichigo", "Ikigai"]}` — iPhone + iPad, one build installs to every listed device; legacy singular `deviceName` still honored; env override `TS_IOS_DEVICE` takes comma-separated names; auto-adopts a sole paired iPhone). Install retries 4× per device — the first wireless contact often hits a cold CoreDevice tunnel. Ship succeeds if AT LEAST ONE device takes the install; unreachable extras are reported per-device, never block the checkpoint. Needs each device on USB or the same Wi-Fi. Both ship scripts build the shared `frontend/dist` (electron vs capacitor targets) and serialize that phase via `~/.thinking-space/tmp/dist-build.lock`, so launching Mac + iOS ships together is safe (before the lock, a concurrent run once packed the Mac app from a capacitor-flavored dist → ERR_FILE_NOT_FOUND on `ltm-app://`). `--dirty` skips the clean/pushed preflight for mid-session on-device iteration (personal test build, no /Applications swap); the no-flag form stays strict. Read the ~5-line stdout summary, not the log.

DMG creation stays a separate deliberate release step; checkpoints install the app directly.

## iOS Provisioning Expiry (Free Provisioning)

Apple's free-tier profiles live **7 days**, and the app dies on every device the
moment one lapses — "app no longer available", no JS error, nothing in the log.

The trap (cost a full evening on 2026-08-23): **shipping does not reset the
clock.** `-allowProvisioningUpdates` mints a profile only when no *valid* cached
one exists, so an ordinary ship silently re-embeds the existing profile and
inherits its original expiry. Two ships that evening both shipped a profile
minted six days earlier, and the app died hours later. Confirmed in the build
log — `Provisioning Profile: "iOS Team Provisioning Profile: com.anurag.thinking-space"`
resolved to the stale cached one.

Reuse is nonetheless the right default: it holds minting to ~1 per app per 7
days instead of 1 per ship. So the cache is cleared **only inside the expiry
window** — exactly one mint per profile lifetime, the floor a 7-day profile
allows. (Apple's documented free-tier quota is 10 App IDs per 7 days and covers
*registering* bundle ids, not regenerating a profile for one already registered
— but that is unverified, so the design stays at the floor and logs every mint.)

- `./scripts/ios-profile-watch.sh` — status table for every profile signed by
  this machine's development team. Scanning by team (not by a bundle-id list) is
  deliberate: every app sharing that one signing certificate also shares its
  fate, so a lapsed or revoked certificate shows up for all of them at once
  rather than looking like several unrelated bugs. The team is *derived* — from
  `TS_IOS_TEAM_ID`, else `teamId` in `~/.thinking-space/ios-device.json`, else
  this app's own cached profile — so no Apple account identifier is committed,
  and a different machine or Apple ID needs no edit.
- `--check` — launchd mode: silent unless something is within 2 days, then
  Telegram. Also pings when *no* profile is cached at all, which is the
  signature of a signed-out Xcode.
- `--install-agent` — generates and bootstraps the daily 10:00 launchd job
  (`com.thinkingspace.ios-profile-watch`). The plist is generated locally, never
  committed: it needs absolute paths, which would otherwise bake one machine's
  username and repo location into the repo.
- `--prepare-mint <bundle-id>` — the renewal decision, called by
  `checkpoint-ship-ios.sh`. Prints TAB-separated `none` / `ok <days>` /
  `floor <days> <age>` / `mint <days> <backup> <origin>`. It lives here rather
  than inline in the ship script so it can be tested against fixtures
  (`TS_IOS_PROFILE_DIR`, `TS_IOS_STATE_FILE`, `TS_IOS_BACKUP_DIR`) instead of
  first running for real the day a profile lapses.
- Ledger at `~/.thinking-space/ios-profile-state.json`; a 5-day
  `MIN_MINT_INTERVAL_DAYS` floor makes a runaway loop unable to burn mints.
- `TS_IOS_DRY_NOTIFY=1` prints the Telegram body instead of sending it.

**Monitoring is team-wide; renewal is this app only.** Other apps on the same
team appear in the table and trigger the same expiry ping — they share one
certificate, so they share failures — but nothing here can re-mint them: renewal
happens inside this repo's ship script, which builds this bundle id alone. The
alert therefore tags foreign apps "rebuild from its own project" and suppresses
the `checkpoint-ship-ios.sh` advice when this app is not among the affected,
because running it would do nothing for them. Their repos need no changes; the
watcher reads Xcode's machine-level profile directory, not any project tree.

**A profile also goes stale in device coverage, not just in time.** Xcode
registers only the devices it can *see* when it mints, so a device that was
asleep at mint time is absent from `ProvisionedDevices` and installs to it fail
with `0xe8008012` ("cannot be installed on this device") while days-left still
looks healthy — an iPad stayed dead through a fully successful ship on
2026-08-23 for exactly this reason. The ship passes its target UDIDs to
`--prepare-mint`, which forces a re-mint on any gap, bypassing the mint floor
(a device joining is user-driven, not a timer loop). Note `plutil -extract
ProvisionedDevices json` needs an explicit `-o -` or it silently emits nothing;
an empty result must be treated as "check unavailable", never as "no devices
provisioned", or every ship re-mints.

Delete-then-rebuild is atomic by construction: the cache is cleared immediately
before the `xcodebuild` that re-mints, and **restored if that build fails**, so a
signed-out Xcode can never leave the machine with no profile at all.

**The one thing automation cannot do**: minting requires Xcode signed in
(Xcode ▸ Settings ▸ Accounts). That session lapsing is what turned the
2026-08-23 expiry into a dead end — `error: No Accounts` — so the watcher pings
when it finds zero cached profiles for the team, which is that state's signature.
A paid Developer Program membership ($99/yr) issues 1-year profiles and retires
this whole section.

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
