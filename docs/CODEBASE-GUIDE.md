# Codebase Guide

Where code lives, what the naming rules mean, and how to find things fast. Companion to
[ARCHITECTURE.md](ARCHITECTURE.md) (system map) and [PLAYBOOKS.md](PLAYBOOKS.md) (change recipes).

_Last verified: 2026-07-16. The architecture contracts summarized here are enforced in
`CLAUDE.md` (+ `docs/contracts/`) — those win on conflict._

## Repo layout

```
Thinking-Space/
├── frontend/                  # the entire app (renderer + electron + ios)
│   ├── src/                   # renderer (React + TS + Vite + Tailwind)
│   ├── electron/              # Electron main process + preload (own tsconfig)
│   ├── ios/                   # Capacitor iOS project
│   ├── tests/                 # vitest tests (*.test.ts, node environment)
│   ├── scripts/               # build + agent tooling (bundle-cli.mjs, capabilityRunner)
│   └── package.json           # all build/test/package scripts live here
├── backend/                   # legacy FastAPI proxy (web mode only, being phased out)
├── docs/                      # this folder — architecture, ADRs, build guides
├── agents/                    # multi-agent protocol + required templates
├── thinkspc / ltm             # agent capability CLI wrappers (repo root)
├── CLAUDE.md                  # contract index — read before coding (AGENTS.md points here)
└── DEVELOPMENT.md             # phases, milestones, agent ops pattern
```

## The two-layer lego rule

Everything follows the same pattern in both the component and service trees:

```
lego_blocks/units/          small, single-purpose primitives (no cross-imports up)
lego_blocks/integrations/   composites that assemble units
lego_blocks/hooks/          (components only) reusable React hooks
orchestrators/              page/feature containers that own flow + state wiring
```

| Layer | UI code | Service code | Electron main |
|---|---|---|---|
| Primitives | `src/components/lego_blocks/units/` | `src/services/lego_blocks/units/` | `electron/src/lego_blocks/` |
| Composites | `src/components/lego_blocks/integrations/` | `src/services/lego_blocks/integrations/` | (same folder) |
| Orchestration | `src/components/orchestrators/` | `src/services/orchestrators/` | `electron/src/orchestrators/` |

Naming is **mandatory** and is how you find things:

- `*Block` — reusable component or service module (`TreeViewBlock.tsx`, `yamlNoteBlock.ts`)
- `use*` — hooks (`useWorkspaceTabsOrch.ts` is the one orchestrator-hook hybrid)
- `*Orch` — orchestrators (`ThinkingOrganizerOrch.tsx`, `vaultSyncOrch.ts`)
- Never create `*HelperBlock` / `*HelpersBlock` — name blocks after their domain.
- Shared UI primitives (buttons, panels): `src/components/lego_blocks/units/ui/`.
- One consumer → keep the logic local. Reusable → extract to a domain-named block.
- Keep orchestrators thin: data loading, selectors, and handler wiring only; algorithms and
  transformations belong in blocks.

`frontend/src/personal_extension/` mirrors the same structure for personal-only, first-party
features (Webull, personal tools). Public/launch builds should not grow dependencies on it.

## Renderer tour (`frontend/src/`)

- **`App.tsx`** — routing (react-router `<Route>`), lazy page imports, app-level providers,
  vault-setup gate, tab shell. Big file; new pages plug in here.
- **`pages/`** — thin page components; each mounts an orchestrator. Don't put feature logic here.
- **`components/orchestrators/`** — one per major surface: `ThinkingSpaceOrch` (markdown
  workspace), `ThinkingOrganizerOrch` (hierarchy/backlog), `HomeCanvasOrch`, `ChatOrch`,
  `VaultGraphOrch`, `SettingsOrch`, `SchedulesOrch`, `MarkdownViewerOrch` (the ONE shared
  markdown view/edit provider — never add page-local editors), etc.
- **`services/orchestrators/`** — workflow modules the UI calls: `vaultSyncOrch` (vault→Dexie),
  `fileSystemOrch`, `chatOrch`, `intelligenceOrch`, `capabilityRouterOrch`,
  `extensionLoaderOrch`, `vaultGraphOrch`, `aiActivity*Orch`, ... UI consumes these, not
  low-level service blocks.
- **`services/lego_blocks/integrations/`** — the workhorses:
  - `fsBlock.ts` — the VaultFS abstraction (Electron IPC / Capacitor / browser FS Access /
    legacy web backend) + the `window.electronAPI` TypeScript surface. Any new preload API
    gets typed here.
  - `dbBlock.ts` — Dexie schema + queries (see PLAYBOOKS for schema changes).
  - `aiChatBlock.ts`, `aiProviderBlock.ts` — user chat; `intelligence/` — internal AI tasks.
  - `capabilityRegistryBlock.ts` — typed capability contracts.
  - `extension*Block.ts`, `excalidraw*Block.ts`, `telegram*Block.ts`, `vaultGraphBlock.ts`, ...
- **`services/lego_blocks/units/`** — primitives: `yamlNoteBlock.ts` (frontmatter
  parse/stringify/validate), `storageKeyBlock.ts` (localStorage keys + electron write-through
  for the vault root), `vaultConstantsBlock.ts`, intelligence units
  (`schemaBlock`, `promptContractBlock`, provider profiles), etc.

## Electron main tour (`frontend/electron/src/`)

- **`index.ts`** — every IPC handler (`ipcMain.handle`), window/CSP/session setup, Widevine.
  Grep `ipcMain.handle` for the full IPC surface. Vault-scoped handlers must use
  `vaultPathGuardBlock` (see Security in ARCHITECTURE.md).
- **`preload.ts`** — the contextBridge. Sandboxed: single file, only `require('electron')`.
- **`setup.ts`** — BrowserWindow creation (multi-window), security flags.
- **`lego_blocks/`** — one block per concern; the names say it all: `vaultPathGuardBlock`,
  `vaultWatcherBlock`, `ptyManagerBlock`, `hierarchyRepoBlock` (+ Db/Path/Schema siblings),
  `scheduleRunnerBlock`/`launchdPlistBlock`/`schedulerProvisionBlock`, `aiCredentialBlock`,
  `nativeAiSessionsBlock`, `claudeCliBlock`, `intelligenceCacheStoreBlock`,
  `sourceConfigBlock`/`viteServerBlock`/`viteRebuildBlock` (Live Source Mode),
  `appleScreenTimeBlock`/`goodnotesReadingBlock` (opt-in personal harvesters).
- **`cli/`** — the thinkspc capability CLI entry (bundled by `frontend/scripts/bundle-cli.mjs`).

## How to find things

The conventions make grep reliable:

```bash
# Who implements an IPC channel?
grep -rn "ipcMain.handle('vault:read'" frontend/electron/src

# Who calls it from the renderer?
grep -rn "vault:read\|vaultRead" frontend/electron/src/preload.ts frontend/src

# Where is a feature's orchestrator?
ls frontend/src/components/orchestrators | grep -i graph

# Which service block owns a domain?
ls frontend/src/services/lego_blocks/{units,integrations} | grep -i excalidraw

# Full IPC surface
grep -n "ipcMain.handle\|ipcMain.on" frontend/electron/src/index.ts
```

Search the organizer for prior work and decisions before starting anything non-trivial:

```bash
./thinkspc search --query "<topic>" --limit 10
```

## Docs index

| Doc | Read when |
|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | first onboarding; any cross-cutting change |
| this file | finding/placing code |
| [PLAYBOOKS.md](PLAYBOOKS.md) | making a specific kind of change |
| [ADR-004-YAML-Architecture.md](ADR-004-YAML-Architecture.md) | touching frontmatter schema/hierarchy |
| [ADR-005-Agent-Capabilities.md](ADR-005-Agent-Capabilities.md) | touching the capability system |
| [ADR-006-Agent-Workspace-Schema.md](ADR-006-Agent-Workspace-Schema.md) | touching workspace/operation fields |
| [EPIC-3-LOCAL-EXTENSION-PLATFORM.md](EPIC-3-LOCAL-EXTENSION-PLATFORM.md) | extension platform work |
| [BUILD-macOS-LOCAL.md](BUILD-macOS-LOCAL.md) / [BUILD-iOS.md](BUILD-iOS.md) | packaging |
| `agents/README.md` + `agents/TEMPLATES/*` | multi-agent protocol, handoffs, commit format |
| `CLAUDE.md` + `docs/contracts/` | always — enforced contracts |
