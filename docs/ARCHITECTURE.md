# Architecture Overview

The system map for Thinking Space. Read this first when you're new to the codebase; read
[CODEBASE-GUIDE.md](CODEBASE-GUIDE.md) next for where code lives, and [PLAYBOOKS.md](PLAYBOOKS.md)
when you're ready to make a change.

_Last verified: 2026-07-16 (v2.6.x). If code and this doc disagree, trust the code and fix the doc._

## The one-paragraph version

Thinking Space is a local-first Electron app (with web and iOS Capacitor targets). The user's
**vault** — a folder of Markdown files with YAML frontmatter — is the single source of truth.
The renderer (React + TypeScript + Vite) reads and writes the vault through a sandboxed IPC
bridge, caches parsed metadata in **IndexedDB (Dexie)** for fast queries, and layers AI features
(chat, intelligence tasks, agent capabilities, AI-activity analytics) on top. There is no
required backend and no native database.

## Processes and trust boundaries

```
┌─────────────────────────────────────────────────────────────────┐
│ Electron main (frontend/electron/src/)          TRUSTED          │
│   index.ts — IPC handlers, window lifecycle, CSP                 │
│   lego_blocks/ — fs, PTY, watchers, schedulers, credentials      │
│   vaultPathGuardBlock — every vault IPC validates paths here     │
└────────────┬────────────────────────────────────────────────────┘
             │ contextBridge (preload.ts — sandboxed, single file)
┌────────────┴────────────────────────────────────────────────────┐
│ Renderer (frontend/src/)                        UNTRUSTED        │
│   React app; renders user markdown + arbitrary webviews          │
│   Reaches disk/network ONLY via window.electronAPI               │
└──────────────────────────────────────────────────────────────────┘

Sidecar runtimes (same codebase, different entry points):
  thinkspc CLI    — bundled .mjs run via ELECTRON_RUN_AS_NODE; agent
                    capability calls against the vault (no app needed)
  launchd jobs    — scheduled agent runs (schedulerProvisionBlock,
                    scheduleRunnerBlock); can notify via Telegram bot
  FastAPI backend — legacy web-mode proxy only; being phased out
```

Key consequences:

- **The renderer is untrusted.** It runs user-authored markdown and embedded webviews. Every
  IPC handler in `electron/src/index.ts` must validate its inputs. Vault-scoped handlers go
  through `vaultPathGuardBlock.ts` (see Security below).
- **The preload is sandboxed.** `frontend/electron/src/preload.ts` must remain a single
  self-contained file whose only `require()` is `electron`. Adding a Node builtin or relative
  require silently breaks the bridge (renderer loses `electronAPI`).
- **The CLI shares main-process blocks.** `thinkspc` (repo root) invokes the bundled capability
  CLI; it defaults to `actor: {kind: "agent", id: "claude-code"}` and writes the same vault
  files the app does.

## Data model: vault → Dexie → UI

1. **Vault files** are Markdown with YAML frontmatter. Hierarchy (`Programs → Epics → Ideas →
   Thoughts`) lives in YAML `parent`/`type`/`level` fields — **never** in folder structure.
   Folders are the user's business. Full schema: [ADR-004-YAML-Architecture.md](ADR-004-YAML-Architecture.md).
2. **`vaultSyncOrch.ts`** scans the vault (via the `vault:walk` IPC), parses frontmatter with
   `yamlNoteBlock.ts`, and populates **Dexie** (`dbBlock.ts`). Current schema (v4): `nodes`
   (uuid/key/type/parent/tags/status/... indexes), `links` (wikilink graph), `files`
   (path + mtime for incremental sync).
3. **Dexie is a disposable cache.** It can be dropped and rebuilt from the vault at any time.
   Never treat it as a source of truth; never write data to Dexie that isn't derivable from
   vault files.
4. **Live updates:** the main process watches the vault (`vaultWatcherBlock.ts`; falls back to
   polling for iCloud paths, which don't emit reliable FSEvents) and pushes `vault:watch:event`
   to all windows; `vaultLiveRefreshOrch.ts` re-syncs the touched files.

Special vault directories the app owns (all optional/opt-in):

- `ai-raw/` — raw harvested signals (Apple Screen Time mirror, GoodNotes reading log). Gated by
  the `writeAiRaw` pref, **off by default** for new users.
- `ai-activity/` — AI-session digests/summaries. Gated by `writeAiActivity`, off by default.
- The organizer workspace (e.g. `lifeblood_systems/thinkingspace.ai/thinking-organizer/`) —
  agent tasks/plans/handoffs as ordinary YAML notes.

## Storage locations outside the vault

| Location | Contents |
|---|---|
| Electron `userData/state/` | `vault-root.json`, `source-config.json`, vault-write prefs |
| `~/.thinking-space/` | `config.json` (CLI), `secrets.json` (0600, never committed), `intelligence-cache/`, `codex-profiles/`, `state/telegram/` |
| `~/.local/bin/thinkspc` | CLI shim provisioned on first app launch |
| `~/.claude/projects`, `~/.codex/sessions` | Read-only inputs for AI Activity (native session transcripts) |

## Major subsystems

### Hierarchy / Organizer
YAML CRUD through `hierarchyRepoBlock.ts` (electron main) exposed as `hierarchy:*` IPC;
renderer side is `ThinkingOrganizerOrch` + Dexie queries. Reparenting = editing YAML `parent`
fields + resync.

### AI chat (user-facing)
`aiChatBlock.ts` + `chatOrch.ts`. Providers include Anthropic, OpenAI-compatible local servers,
and `claude -p` CLI passthrough (`claudeCli:chat` IPC) so Pro-plan users aren't double-billed.
User chat **never** goes through the intelligence subsystem.

### Intelligence subsystem (internal AI tasks)
Model-agnostic layer for internal jobs (session titles, structured extracts, tool loops).
Public surface: `intelligenceOrch.ts` (`runContract`, `runWithTools`, `availability`,
`diagnose`). Tasks are typed **Contracts** in
`services/lego_blocks/units/intelligence/contracts/`. Results cache in
`~/.thinking-space/intelligence-cache/<taskId>/<key>.json`, keyed by
`(taskId, inputHash, promptVersion, model)`. To add a task: write a contract block and call
`runContract` — do not open a new HTTP path.

### AI Activity
Parses native Claude/Codex session transcripts (`nativeAiSessionsBlock` in main;
`nativeAiSessionParserBlock` in renderer), attributes file edits to vault notes
(`touchedPaths` provenance from tool_use records), renders dashboards and the vault graph.
Parsed sessions cache under a `CACHE_VERSION` in `aiActivityCacheBlock.ts` — **bump it whenever
the parsed-session shape changes.**

### Vault graph
`vaultGraphOrch.ts` merges Dexie links, git file births, and AI-session heat into a
force-directed map (`/vault-graph`). The force-graph vendor is dynamically imported in
`VaultGraphCanvasBlock` only (startup contract).

### Agent capabilities
Typed operation registry (`capabilityRegistryBlock.ts`, 55+ ops) routed through
`capabilityRouterOrch.ts` with policy, audit logging, and dry-run. Reached from: the app UI,
the `thinkspc` CLI, and (legacy) the FastAPI proxy. Contract: [ADR-005](ADR-005-Agent-Capabilities.md);
workspace schema: [ADR-006](ADR-006-Agent-Workspace-Schema.md). Feature-flagged
(`agent_capabilities_enabled`, default off).

### Extension platform (EPIC-3)
Local-only, declarative extensions: manifest validation (`extensionManifestBlock`), action
schema (`extensionActionBlock`), loader/UI/builder orchestrators (`extensionLoaderOrch`,
`extensionUiOrch`, `extensionBuilderOrch`), sandboxed runtime invoke in main
(`extensionRuntimeSandboxBlock`). Feature-flagged off by default.

### Embedded terminal
xterm.js in the renderer, node-pty in main (`ptyManagerBlock.ts`), routed by `webContentsId`.
PTYs default to the **vault root** cwd (not `$HOME` — macOS TCC reasons). All terminal tabs
stay mounted (`visibility:hidden`) so shells survive tab switches.

### Live Source Mode
User modifications live in the user's own GitHub fork, cloned locally and set as `sourcePath`
(Settings → Developer) — the app does not ship or extract its own source. From that clone the
app can spawn a Vite dev server (`viteServerBlock`) and rebuild/swap the running app
(`viteRebuildBlock` → detached swap script). This is how the app can modify itself from its own
terminal. Fork onboarding (plain-language script + steps): [PLAYBOOKS.md](PLAYBOOKS.md) §12.

### Schedules
Recurring agent runs via launchd: plist generation (`launchdPlistBlock`), provisioning
(`schedulerProvisionBlock`), execution (`scheduleRunnerBlock`), transcripts stored per schedule
(`transcriptStoreBlock`), optional Telegram delivery (`telegramBotBlock` + conversation state).

## Security contract (must not regress)

Summarized from `CLAUDE.md` / `AGENTS.md` (the enforced versions — read those before touching
anything listed here):

- `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true` on every BrowserWindow.
- No inline scripts in `index.html`; production CSP omits `'unsafe-inline'`.
- Every vault-scoped IPC handler validates the renderer-supplied `vaultRoot` via
  `assertAuthorizedVaultRootBlock` / `resolveInsideVaultBlock` (`vaultPathGuardBlock.ts`).
  Authorized roots = persisted root, native folder-dialog pick, `vault:root:setPersisted`.
- `vault:git` runs an allowlisted subcommand set only.
- Outbound fetch bridges reject loopback/link-local/private targets (SSRF guard), including on
  redirects; webview CSP and permissions stay narrow (`cspWhitelistBlock.ts`).
- macOS TCC goal: **the app only ever asks for access to the user's vault folder.** Anything
  touching other apps' containers (Screen Time, GoodNotes) is opt-in and off by default.

## Startup performance contract (must not regress)

Heavy vendors (Excalidraw, pdfjs, CodeMirror, recharts, force-graph) must never be statically
reachable from the entry. They load only through `MarkdownDocumentLazyBlock`,
`MarkdownRichEditorLazyBlock`, and per-consumer `lazy()` imports. After touching imports:
`BUILD_TARGET=electron npx vite build` and confirm `dist/index.html` modulepreloads only
`vendor-react` + `vendor-dexie`. Budget: ≤ 2.4 MB startup JS.

## Build targets

| Target | Command | Notes |
|---|---|---|
| Electron dev | `cd frontend && npm run electron:dev` | full build + cap sync + launch |
| Web dev | `cd frontend && npm run dev` | Vite dev server |
| macOS package | `npm run package:mac` | see [BUILD-macOS-LOCAL.md](BUILD-macOS-LOCAL.md) |
| Windows/Linux | `npm run package:win` / `package:linux` | |
| iOS | `npm run package:ios` | Capacitor; see [BUILD-iOS.md](BUILD-iOS.md) |
| Tests | `cd frontend && npm test` | vitest, `frontend/tests/*.test.ts`, node env |
| Typecheck | `cd frontend && npm run typecheck`; `cd frontend/electron && npx tsc --noEmit` | run both |
