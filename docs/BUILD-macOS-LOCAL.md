# Local macOS Build & Install (Self-Signed)

How to build the Electron app from source and install it as a real, runnable
macOS app **without an Apple Developer account** — the fast "edit → build →
sign → install → relaunch" loop used for personal builds of this fork.

> This is for **local/personal** builds. It is **not** how official signed/
> notarized releases are produced. See `BUILD-iOS.md` for iOS.

---

## TL;DR — the repeatable loop

After the one-time setup below, every change ships with:

```bash
cd ~/Documents/Thinking-Space
export PATH="/opt/homebrew/bin:$PATH"          # Node >= 22 (Capacitor needs it)

APP="frontend/electron/dist/mac-arm64/Thinking Space.app"
DST="$HOME/Applications/Thinking Space.app"

pkill -9 -f "Thinking Space.app/Contents/MacOS"; sleep 3   # 0. quit the running copy FIRST
./build.sh mac                                 # 1. build (vite + electron + package)
codesign --deep --force --sign "Thinking Space Local Signing" "$APP"   # 2. sign
rm -rf "$DST" && ditto "$APP" "$DST"           # 3. install to ~/Applications
open "$DST"                                     # 4. relaunch
```

The build takes ~1.5–3 min. The artifact path is `arm64` on Apple Silicon.

> **Quit the app *before building*, not just before installing.** On a 16 GB
> machine, building (Vite/esbuild + electron-builder) while the app is also
> running causes memory contention that can stall the Vite step for minutes (seen:
> a 12 s build ballooning past 6 min). Killing the running copy up front keeps the
> build fast *and* frees the bundle for the `ditto` install. The quit moved to
> step 0 above.

> **Always fully quit the running copy first** (`pkill -9` + a short wait, then
> confirm with `pgrep -f "Thinking Space.app/Contents/MacOS"`). Copying over a
> still-running bundle corrupts it (`cp` fails partway with "Operation not
> permitted" / "invalid Info.plist"). `ditto` is preferred over `cp -R` for
> copying `.app` bundles.

---

## Why each step exists (the gotchas)

These are the non-obvious things that will bite you otherwise.

### 1. Node must be ≥ 22
`./build.sh mac` runs `npx cap sync @capacitor-community/electron`, and the
Capacitor CLI requires **Node ≥ 22**. The system Node at `/usr/local/bin/node`
may be older (e.g. v20), which makes the cap-sync step fail. Prefixing
`PATH="/opt/homebrew/bin:$PATH"` puts Homebrew's newer Node first.

### 2. `build.sh` does not stop on a failed step
`build.sh` swallows individual step failures and **still produces a `.dmg`,
printing a success line even if a step (e.g. cap sync) failed.** Never trust
the exit code alone. After building, check:

```bash
grep -c "✗" /tmp/your-build.log     # must be 0
```

### 3. The app must be code-signed — ad-hoc is not enough
macOS only grants **Keychain** access (used by `safeStorage` for Webull
credentials, etc.) to apps with a **stable code-signing identity**. A default
local build is *ad-hoc* signed, which macOS treats as unstable → the app
reports **"secure storage is unavailable."**

The fix is a one-time **self-signed certificate** (setup below) plus signing
the app with it on every build:

```bash
codesign --deep --force --sign "Thinking Space Local Signing" "$APP"
# verify: flags should read 0x0(none) with no "adhoc", Authority = your cert
codesign -dvv "$APP" 2>&1 | grep -iE "Authority|flags"
```

`electron-builder.config.json` also sets `mac.hardenedRuntime: false`, because
Hardened Runtime blocks Keychain access unless the app is signed with a real
Apple Developer ID (which local builds don't have).

### 4. Install to `~/Applications`, not `/Applications`
macOS **App Management** protection blocks writing app bundles into
`/Applications` from the terminal (`Operation not permitted`). Use
`~/Applications` (your home Applications folder) — it runs identically and has
no such restriction. (Finder drag-installs to `/Applications` still work; only
scripted copies are blocked.)

### 5. First launch: Gatekeeper
A self-signed app isn't notarized, so the first open may warn about an
"unidentified developer." Right-click the app → **Open → Open** once.

### 6. Changing the signing identity invalidates saved secrets
`safeStorage` ties its encryption key to the app's signature. If the signing
identity changes, previously-saved encrypted data can no longer be decrypted
and the app may show a decryption error. Clear the stale store and re-enter:

```bash
rm -f "$HOME/Library/Application Support/thinking-space/secure-storage/webull.v1.json"
```

(Re-signing with the **same** certificate each time avoids this — credentials
then carry across rebuilds.)

---

## One-time setup

### A. Homebrew Node (≥ 22)
```bash
brew install node      # provides /opt/homebrew/bin/node
node -v                # confirm >= 22 with /opt/homebrew/bin first on PATH
```

### B. Self-signed code-signing certificate
Creates the stable identity macOS needs for Keychain access.

> **`-legacy` depends on which `openssl` you have.** With **OpenSSL 3.x**
> (e.g. Homebrew's), the `-legacy` flag is required so Apple's keychain can
> import the `.p12`. But macOS's stock `/usr/bin/openssl` is **LibreSSL**, which
> does **not** recognize `-legacy` (it already emits the legacy PBE format) — on
> LibreSSL you must **drop the flag** or the `pkcs12` command errors out with
> `unknown option '-legacy'`. Check with `openssl version`.

```bash
cd /tmp
openssl req -x509 -newkey rsa:2048 -keyout cs.key -out cs.crt -days 3650 -nodes \
  -subj "/CN=Thinking Space Local Signing" \
  -addext "basicConstraints=critical,CA:false" \
  -addext "keyUsage=critical,digitalSignature" \
  -addext "extendedKeyUsage=critical,codeSigning"
# OpenSSL 3.x: add -legacy ; LibreSSL (stock macOS /usr/bin/openssl): omit it
openssl pkcs12 -export -inkey cs.key -in cs.crt -out cs.p12 -passout pass:tspass
security import cs.p12 -k "$HOME/Library/Keychains/login.keychain-db" -P tspass -T /usr/bin/codesign -A
rm -f cs.key cs.crt cs.p12
```

The first `codesign` run will pop a Keychain dialog — click **Always Allow**.
The cert shows as `CSSMERR_TP_NOT_TRUSTED`, which is fine: trust is only needed
to *verify* a signature, not to *sign* with it or to get Keychain access.

To remove it later: Keychain Access → login → delete "Thinking Space Local Signing".

---

## Quick reference

| What | Where |
|------|-------|
| Source repo | `~/Documents/Thinking-Space` |
| Build command | `./build.sh mac` (Node ≥ 22) |
| Built app | `frontend/electron/dist/mac-arm64/Thinking Space.app` |
| Installed app | `~/Applications/Thinking Space.app` |
| Signing identity | `Thinking Space Local Signing` (self-signed) |
| App data (userData) | `~/Library/Application Support/thinking-space` (migrated from legacy `long-term-memory` on first launch) |
| Typecheck only | `./build.sh typecheck` |
