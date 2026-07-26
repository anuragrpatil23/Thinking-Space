# Security Contract (Enforced)

## Trust posture

- Preserve local-first privacy guarantees.
- Minimize extension permissions and enforce explicit consent.
- No hidden remote calls in "local-only" flows.

## Electron hardening

Electron hardening that must not regress (renderer runs user markdown + arbitrary webviews, so the main process is the trust boundary):
- **`nodeIntegration: false`** on every BrowserWindow (`electron/src/setup.ts`). The renderer reaches main only through the `preload.ts` contextBridge; it never needs Node. Do not flip this on.
- **`contextIsolation: true`** stays on for every window.
- **`sandbox: true`** on every BrowserWindow. This requires the preload (`build/src/preload.js`) to stay a single self-contained file whose only `require()` is `electron` — no relative `require`, no Node builtins (`fs`/`path`/`crypto`). The Capacitor platform marker is inlined and the terminal-enabled flag comes from main via `terminal:enabled:getSync` for exactly this reason. If you must add a Node/relative dependency to the preload, bundle it (esbuild) first or sandbox breaks silently (renderer loses `electronAPI`).
- **No inline scripts in `index.html`.** Production `script-src` omits `'unsafe-inline'` (dev-only for Vite HMR). Entry-time scripts go in `main.tsx`/unit blocks (e.g. `iphoneViewportBlock.ts`), never inline `<script>`. After touching HTML/CSP, verify `dist/index.html` has zero `<script>` (only the external module).
- **Every vault-scoped IPC handler** validates the renderer `vaultRoot` via `assertAuthorizedVaultRootBlock`/`resolveInsideVaultBlock` (`vaultPathGuardBlock.ts`) — never trust a renderer path.
- **`vault:git`** only runs an allowlisted set of subcommands and rejects leading git global options (`-c`, `--exec-path`); don't widen it to pass arbitrary args.
- **Outbound network bridges** stay host/target-restricted: Webull + Google use host allowlists; `net:fetchText`/`net:fetchBytes` reject loopback/link-local/private targets (SSRF guard `assertPublicFetchUrlBlock`), including on redirects.
- **Webview `connect-src`/CSP** and the webview permission allowlist (`setupWebviewSessionPermissions`) stay narrow; new outbound origins go through `cspWhitelistBlock.ts`, not a broadened template.
- **Every child process must run with `cwd` pinned to the vault root** (fallback: userData / `~/.thinking-space`), never inherit the app's cwd (`/` when Finder-launched) or `$HOME`. macOS bills all file access by app-spawned children (claude CLI, scheduler runner agents, PTYs) to the APP's TCC identity — an unpinned child roaming from `/` or `$HOME` is what caused the "Thinking Space wants access to Desktop/Documents/Downloads/Network Volumes" prompt storm (fixed 2026-07-17: `claudeCliBlock.resolveChildCwdBlock`, `runner.mjs defaultExecutionCwd`, PTYs already pinned). The app's TCC prompt budget is exactly one: the vault folder. Related: TCC keys on bundle id + signing-cert leaf hash, so ad-hoc signing (pre-2026-07-16) reset all grants on every rebuild — the stable local cert in `checkpoint-ship.sh` must not regress.
