# Security Policy

Thinking Space is a **local-first** desktop app (Electron) that reads and writes a
folder of your notes ("the vault"). It has no backend of its own — your data
stays on your machine and in whatever cloud folder you choose to sync. This
document explains how to report vulnerabilities, what the trust model is, and how
releases are kept tamper-evident.

## Reporting a vulnerability

**Please do not open a public issue for security problems.**

Report privately through GitHub's **Security → Report a vulnerability** (private
advisory) on this repository:
<https://github.com/anuragrpatil23/Thinking-Space/security/advisories/new>

Include, where possible:
- affected version (Help → About, or the DMG/installer filename),
- your OS and platform (macOS Apple Silicon / Windows x64 / etc.),
- a description and, ideally, a minimal reproduction,
- the impact you believe it has.

You can expect an initial acknowledgement within a few days. Please give a
reasonable window to ship a fix before any public disclosure. Fixes are released
as new versions and the corresponding advisory is published once users have had
time to update.

## Supported versions

Security fixes land on the latest release line. Always update to the newest
version before reporting — the issue may already be fixed.

| Version | Supported |
| ------- | --------- |
| latest (2.6.x) | ✅ |
| older | ❌ |

## Trust model

The **main process is the trust boundary**. The renderer displays your markdown
and can embed arbitrary third-party web pages in `<webview>` tags, so it is
treated as potentially hostile; all privileged operations (filesystem, git,
network, credentials) live behind vetted IPC handlers in the main process.

- **Your vault is the only thing the app touches.** Every vault filesystem IPC
  handler validates the renderer-supplied path against a main-process-anchored
  set of authorized roots (the folder you picked / persisted) and rejects path
  traversal. The app will not read or write outside the vault you selected.
- **What is explicitly out of scope of the trust boundary:** content you place
  in your own vault. Extensions you install under `.extensions/`, notes, and
  local files are run/opened with your privileges by your action — treat vault
  contents you didn't author with the same caution as any file you'd open.
- **Secrets** (e.g. Webull API keys) are stored via the OS keychain through
  Electron `safeStorage`, not in plaintext. AI provider tokens are read from the
  standard CLI locations you already authorized (`~/.claude`, `~/.codex`).

## Security posture (enforced in code)

These are contracts, not aspirations — see `CLAUDE.md` / `AGENTS.md`
"Security Contract (Enforced)":

- **Electron hardening:** `contextIsolation: true` and `nodeIntegration: false`
  on every window; the renderer reaches the main process only through a narrow,
  typed `contextBridge` preload API.
- **No inline scripts / strict CSP:** the production `script-src` is restricted
  to the app scheme with **no `'unsafe-inline'`**; `connect-src` is limited to
  the app plus any AI endpoint you configure.
- **Command execution is constrained:** the `git` bridge only permits an
  allowlisted set of subcommands and rejects git global-option injection
  (`-c`, `--exec-path`); child processes are spawned without a shell.
- **Outbound requests are target-restricted:** broker/API bridges use host
  allowlists, and the generic fetch helpers reject loopback, link-local
  (including cloud-metadata `169.254.169.254`), and private-network targets to
  prevent SSRF — including across redirects.
- **Webviews are sandboxed:** third-party pages run in a separate session with a
  minimal permission allowlist (media/clipboard/fullscreen); camera, microphone,
  and geolocation are denied.
- **Extensions run sandboxed:** local extension code executes in a restricted
  `vm` context (no `require`/`process`/`child_process`, code-generation
  disabled, size and time limits) and can only reach capabilities its declared
  permissions grant.

## Release integrity

**Verify what you install.** Download binaries only from the official
[GitHub Releases](https://github.com/anuragrpatil23/Thinking-Space/releases)
page. Release artifacts are published with checksums; auto-update uses
`electron-updater` (kept on a patched version that fixes the Windows
code-signing-bypass advisory).

### For maintainers — producing a signed & notarized macOS build

The build config (`frontend/electron/electron-builder.config.json`) is already
notarization-ready: Hardened Runtime is enabled and the minimal entitlements the
app needs (JIT + library-validation relaxation for the node-pty native module
and the system Widevine CDM) live in `resources/entitlements.mac.plist`. These
settings are harmless for unsigned local builds — electron-builder skips signing
when no Developer ID identity is present.

To cut a signed + notarized release you need an Apple **Developer ID Application**
certificate and an app-specific password, then set the standard env vars before
building:

```bash
# Code signing (either a cert file or auto-discovery from the login keychain)
export CSC_LINK=/path/to/DeveloperIDApplication.p12
export CSC_KEY_PASSWORD='…'
# Notarization (Apple ID + app-specific password + team)
export APPLE_ID='you@example.com'
export APPLE_APP_SPECIFIC_PASSWORD='abcd-efgh-ijkl-mnop'
export APPLE_TEAM_ID='XXXXXXXXXX'
```

Then flip `mac.notarize` to `true` (or `{ "teamId": "XXXXXXXXXX" }`) in the
build config and run the release build. Verify the result:

```bash
codesign --verify --deep --strict --verbose=2 "dist/mac-arm64/Thinking Space.app"
spctl -a -vvv -t install "dist/mac-arm64/Thinking Space.app"   # should say: accepted, source=Notarized Developer ID
xcrun stapler validate "dist/Thinking Space-<version>-arm64.dmg"
```

Windows builds are signed via the NSIS target when a code-signing certificate is
configured; ship over HTTPS from GitHub Releases so `electron-updater` can verify
the update signature.
