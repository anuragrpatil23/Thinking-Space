# AGENTS.md

Required operating contract for any coding agent working in `Thinking Space`.

If this file conflicts with assumptions, follow this file + `DEVELOPMENT.md`.

## Mission
Build one product that is intentionally all three of these from the ground up:

1. Thinking space for individuals
- Audience: knowledge workers, researchers, writers, founders
- Value: fast, local, hierarchical thinking (`Programs -> Epics -> Ideas -> Thoughts`)
- Entry: "I need a better way to organize my thoughts"

2. Place where humans and AI work together
- Audience: AI-savvy users frustrated by disconnected tools
- Value: thinking and AI assistance in the same contextual workspace
- Entry: "AI tools are useful but disconnected from where I actually think"

3. AI agent management space for humans
- Audience: power users, developers, multi-agent operators
- Value: manage agents, track runs/work, integrate output with human thinking
- Entry: "I am running AI agents but have nowhere to manage them alongside my own thoughts"

These are architecture requirements, not optional positioning variants.

## Strategy Rules
- Do not design isolated feature silos for only one pillar.
- Prefer shared primitives that strengthen all three pillars.
- Any major change must state pillar impact before implementation.

## Working Style (Derived from CLAUDE.md)
- Think from first principles, then map decisions to concrete code tradeoffs.
- Stay concise and direct; avoid filler and vague recommendations.
- Challenge weak assumptions politely and propose better alternatives.
- Optimize for practical progress, not theoretical architecture purity.

## CLAUDE.md and AGENTS.md
- `CLAUDE.md` is Claude Code's native file for project-specific instructions.
- `AGENTS.md` is the cross-tool open-standard contract.
- Both should contain consistent onboarding, architecture constraints, and execution priorities.
- If Claude learns useful project knowledge, Claude must manually update `CLAUDE.md` and synchronize durable items into `AGENTS.md` plus organizer principles/decision records.

## Phase Order
Use `DEVELOPMENT.md` as source of truth for implementation phases and detailed architecture.

Current status (v2.5): Phases 0–5, Agent Capability Transport, EPIC-3, Embedded Terminal, Live Source Mode, notebook workspace upgrades, and native iPhone shell/chrome work are all complete.

iOS native chrome (locked 2026-07-19, details in CLAUDE.md): the top status-bar veil is one static masked progressive blur — never Liquid Glass, never scroll-linked; the bottom chrome collapses Safari-style into a single centered chip; the tab switcher is a Safari-style card grid with live WKWebView snapshots; the native side-panel toggle shows only on pages whose iPhone layout doesn't already handle the panel (hidden on Thinking Space explorer, Webull/F9, Thinking Organizer); the iPhone explorer header is a single icon row (collapsed search, RSS in the toolbar slot, no File-info button).

Upcoming:
- EPIC-5: AI Actions Everywhere
- EPIC-6: Optional Remote/Agent Backends (later)

If sequence changes, update `DEVELOPMENT.md` first, then align active organizer plan/task nodes.

## Locked Technical Decisions
1. Electron-first runtime for near-term milestones.
2. **YAML frontmatter in Markdown files** as source of truth for all node metadata and hierarchy.
3. **IndexedDB (Dexie.js)** as rebuildable in-browser cache. NOT a source of truth.
4. **No SQLite / native DB** — previous SQLite plan is superseded.
5. **No backend required** for core features (hierarchy, editing, AI).
6. **Folders are arbitrary** — hierarchy is metadata-driven via YAML `parent` fields.
7. Lexical related retrieval first via IndexedDB full-text search.
8. Local-only extensions first; no early remote code execution.
9. AI local-first: Ollama (Electron) or WASM LLM (web/PWA).
10. Extension platform rollout is feature-flagged (`extension_host_enabled`, `extension_builder_enabled`) and defaults to disabled until explicitly enabled.
11. **Embedded Terminal — slated for removal** (decided 2026-07-16: overkill; users run agents in their own terminal). Still ships (xterm.js + node-pty; `TerminalPage.tsx`, `ptyManagerBlock.ts`) but do not build new features on it and do not advertise it; removal is a planned cleanup task.
12. **Vault-scoped file access (macOS TCC contract)**: Electron main never trusts a renderer-supplied path. All vault/hierarchy/harvest IPC handlers validate `vaultRoot` through `frontend/electron/src/lego_blocks/vaultPathGuardBlock.ts` (authorized roots = persisted root, native folder-dialog pick, `vault:root:setPersisted`); relative paths are contained via `path.relative`. Terminal PTYs default to the vault root, not `$HOME`. Goal: the app only ever asks macOS for access to the user's vault folder.
13. **Workspace profiles (Chrome-style)**: each profile = one vault + accent color + own window(s). Registry in `frontend/electron/src/lego_blocks/profileRegistryBlock.ts` (`userData/state/profiles.json`, main-owned trust anchor). The default profile stays on Electron's default session and the legacy `vault-root.json` (zero migration for existing installs); non-default profiles run in `persist:profile-<id>` app partitions — a bare partition has neither the custom app scheme nor CSP, so windows must go through `prepareProfileAppSessionBlock` (setup.ts) before first load. `vault:root:getPersistedSync`/`setPersisted` answer per-sender-window profile; `vault:watch:event` routes only to the owning profile's windows (`getWindowsForVaultRootBlock`) — never broadcast vault-scoped events to all windows. Web-tab webviews use per-profile partitions (`persist:thinking-space-links[-<id>]`); popups reuse the opener webview's session. One vault per profile is enforced; deleting a profile clears its partitions' storage.
14. **Editor = one CM6 engine, decorations on top (locked 2026-07-17)**: no ProseMirror/Notion block JSON — markdown+YAML stay byte-identical on disk; richer editing is CM6 decorations (Live Preview model) in `MarkdownRichEditorBlock` (units: markdownInlineImageExtensionBlock, markdownSyntaxHidingExtensionBlock, markdownTaskCheckboxExtensionBlock, editorLanguageBlock for per-file-type grammar routing; markdown decorations only mount for markdown files). Code files never render as markdown in view mode — `CodeDocumentViewBlock` mounts a read-only CM6 surface with the same grammar + syntax highlighting instead of the prose pipeline (decided 2026-07-17). User toggle `livePreviewSyntaxHiding`; with it on, entering editing from view mode is a **long-press on every surface** (mouse and touch) — plain click stays reading, holding ~450ms edits at the press point (`longPressToEditActive`); the pencil button always stays as the discoverable primary (decided 2026-07-17: uniform hold-to-edit kills accidental single-click edits on desktop/Electron).
15. **Vault-write prefs are per vault root** (decided 2026-07-17): keyed by vault root in `userData/state/vault-write-prefs.json` (`vaultWritePrefsPersistenceBlock.ts`) — a global flag leaked one vault's opt-in into every profile's vault. **One unified `ai-activity/` folder** (merged 2026-07-18): harvested raw → `ai-activity/raw-sessions/<source>/`, digests → `ai-activity/{atoms,chains,ranges}`, hand-logged → `ai-activity/manual-sessions.jsonl`. Two opt-ins stay distinct: `writeAiRaw` gates `ai-activity/raw-sessions/` and keeps a per-vault dir-exists migration (existed = new `ai-activity/raw-sessions/` OR legacy `ai-raw/`/`ai_raw/`; off would silently lose Screen Time history past the macOS 28-day cliff); `writeAiActivity` gates the digests mirror, strictly opt-in with no migration — AI Activity works from harness logs + local cache; the mirror exists for durability (harness logs deleted after ~30 days) and cross-device sync, and the Settings copy explains that. `migrateAiRawIntoAiActivityBlock` (at `vault:watch:start`) folds legacy `ai-raw/raw`/`ai_raw/raw` into `ai-activity/raw-sessions`. Setters assert the vault root via `vaultPathGuardBlock`. Hand-logged **manual sessions** ("painting 4h") are first-party durable data, so writes ride the folder's **general** permission — `getVaultWriteAiActivityAnyEnabled()` = `writeAiRaw || writeAiActivity` (changed 2026-07-18 from the digests-mirror opt-in specifically). Stored in `ai-activity/manual-sessions.jsonl` (`manualSessionBlock.ts`, `source: 'manual'`), added to the AI-activity pipeline; "+ Log session" in the day table is gated on the home card and disabled with a Settings nudge when both opt-ins are off. NOTE: claude-code session md ingest is the user's external SessionEnd hook (`~/.claude/hooks/render-session.sh`) — its `DEST` must point at `ai-activity/raw-sessions/claude-code` for the merge to hold for new sessions.
16. **Live Source Mode (fork-based)**: user modifications live in the user's own GitHub fork, cloned locally and set as `sourcePath` (Settings → Developer). The app does NOT ship or extract its own source — the shipped-source-editing model was removed 2026-07 (changes were untracked, unbacked-up, and clobbered by updates). Vite dev server is spawned from `viteServerBlock.ts`; renderer switches to `http://127.0.0.1:{port}` without restart. Rebuild via `viteRebuildBlock.ts` → detached swap script replaces the running `.app` and relaunches. Fork onboarding script (plain-language, zero-jargon): `docs/PLAYBOOKS.md` §12.

## Architecture Reference
- Onboarding docs (read when new to an area): `docs/ARCHITECTURE.md` (system map) → `docs/CODEBASE-GUIDE.md` (where code lives) → `docs/PLAYBOOKS.md` (change recipes + verify/ship checklist). Index: `docs/README.md`.
- Full YAML schema and architecture details: `docs/ADR-004-YAML-Architecture.md`

## Security Contract (Enforced)
Electron hardening that must not regress (the renderer runs user markdown + arbitrary webviews; the main process is the trust boundary):
- `nodeIntegration: false` + `contextIsolation: true` + `sandbox: true` on every BrowserWindow (`electron/src/setup.ts`). The renderer reaches main only via the `preload.ts` contextBridge — never re-enable Node integration. Sandbox requires the preload to stay a single self-contained file whose only `require()` is `electron` (Capacitor marker inlined; terminal flag via `terminal:enabled:getSync`); adding a relative/Node require to the preload needs a bundler or sandbox breaks.
- No inline scripts in `index.html`; production `script-src` omits `'unsafe-inline'` (dev-only for Vite HMR). Entry-time scripts live in `main.tsx`/unit blocks (e.g. `iphoneViewportBlock.ts`). Verify `dist/index.html` has zero inline `<script>` after HTML/CSP edits.
- Every vault-scoped IPC handler validates `vaultRoot` via `assertAuthorizedVaultRootBlock`/`resolveInsideVaultBlock` (`vaultPathGuardBlock.ts`).
- `vault:git` runs only allowlisted subcommands and rejects leading git global options (`-c`, `--exec-path`).
- Outbound bridges stay target-restricted: Webull/Google host allowlists; `net:fetchText`/`net:fetchBytes` reject loopback/link-local/private targets (`assertPublicFetchUrlBlock`), including on redirects.
- Webview CSP `connect-src` + permission allowlist stay narrow; new outbound origins go through `cspWhitelistBlock.ts`.
- Every child process runs with `cwd` pinned to the vault root (fallback userData / `~/.thinking-space`) — never the app's inherited cwd (`/`) or `$HOME`. Children's file access is TCC-attributed to the app; unpinned children caused the Desktop/Documents/Downloads/Network-Volumes prompt storm (fixed 2026-07-17: `claudeCliBlock.resolveChildCwdBlock`, `runner.mjs defaultExecutionCwd`; PTYs already pinned). The app's TCC prompt budget is one: the vault folder.

## Startup Performance Contract (Enforced)
- Heavy vendors (Excalidraw, pdfjs/react-pdf, CodeMirror, recharts) must never be statically reachable from the app entry; they load through code-split boundaries (`MarkdownDocumentLazyBlock`, `MarkdownRichEditorLazyBlock`, per-consumer `lazy()` chart imports).
- Do NOT add lazy-only vendors to `vite.config.ts` `manualChunks` — object-form manualChunks pulls those chunks back into the entry's static import graph.
- After changing imports, verify `dist/index.html` modulepreloads only `vendor-react` + `vendor-dexie`. Startup JS budget: ≤ 2.4 MB.

## Major Checkpoint Ritual (Ship It)
A "major checkpoint" = a user-visible feature or fix is complete and verified, not every commit. Ritual: commit (template) → push → `./scripts/checkpoint-ship.sh` in the background (~2–3 min; builds unpacked .app, checks the startup-perf contract, signs, detached-swaps `/Applications/Thinking Space.app`). Read its ~4-line stdout summary; full log lands in `~/.thinking-space/logs/`. The script refuses dirty/unpushed trees — commit first, never bypass. DMGs remain a separate deliberate release step.

**iOS checkpoints:** if the checkpoint touched iOS-relevant surfaces (`frontend/ios/**`, or web code that renders in the iPhone shell — shared `frontend/src` counts), ALSO run `./scripts/checkpoint-ship-ios.sh` in the background. It builds the web bundle, runs `cap sync`, xcodebuilds Release, and installs + relaunches on the user's configured device (`~/.thinking-space/ios-device.json`, env override `TS_IOS_DEVICE`; auto-adopts a sole paired iPhone). Needs the device on USB or same Wi-Fi as the Mac; if the install step fails because the device is unreachable, report it and move on — never block the checkpoint on it. Both ship scripts serialize their shared `frontend/dist` build phase via `~/.thinking-space/tmp/dist-build.lock`, so launching Mac + iOS ships together is safe. `--dirty` exists for mid-session on-device iteration (personal test build — no /Applications swap involved); the no-flag form stays strict (clean+pushed). Same token-efficient contract: read the ~5-line stdout summary, not the log.

## Architecture Guardrails
- Keep markdown files with YAML frontmatter as portable source-of-truth content.
- Hierarchy is defined by YAML `parent`/`type`/`level` fields, NOT folder structure.
- IndexedDB is a pure cache layer — can be rebuilt from YAML files at any time.
- Standardize markdown view/edit through one shared orchestrator (`frontend/src/components/orchestrators/MarkdownViewerOrch.tsx`); do not add page-local markdown edit modals.
- Reparent by updating YAML `parent` fields in affected files + syncing IndexedDB.
- Add conflict-safe saves for thought editing (`mtime`/hash checks).
- Avoid destructive migrations without rollback/recovery path.
- No backend dependency for core features.

## Code Design Philosophy
- Use lego blocks: small reusable primitives for UI, hooks, and services.
- Use orchestrators: page/feature containers that compose primitives and own flow/state wiring.
- Keep primitives generic and prop-driven; avoid feature-specific branching inside shared components.
- Keep data loading, derived selectors, and orchestration handlers in orchestrators.
- If logic or UI is duplicated twice, extract or extend a shared primitive before adding a third copy.
- Do not add one-off editors, viewers, or modals when a shared component can be extended safely.
- Caution: keep orchestrators thin. If an orchestrator starts accumulating reusable domain logic, parsing, or complex transformation code, extract that into lego blocks (components/services/hooks) immediately.

## Frontend Placement and Naming Rules (Enforced)
- `frontend/src/components/lego_blocks/units/*` stores smallest reusable UI blocks (pure/singular building blocks).
- `frontend/src/components/lego_blocks/integrations/*` stores composite blocks that compose multiple units and feature-level UI glue.
- `frontend/src/components/lego_blocks/hooks/*` stores reusable component-layer hooks (behavior lego, no rendering).
- `frontend/src/components/orchestrators/*` stores page/feature orchestration containers only.
- `frontend/src/personal_extension/components/*` is allowed for personal-only first-party code when it mirrors the same architecture:
  - `lego_blocks/{units,integrations,hooks}`
  - `orchestrators`
- Do not create `*HelperBlock` or `*HelpersBlock` files. These are treated as grab-bag anti-patterns.
- If logic has a single consumer, keep it local to that block/orchestrator.
- If logic is reusable, extract it into a domain-specific `*Block`/`use*Block` with a concrete name (for example `BacklogListDomainBlock`, `MarkdownDocumentContentBlock`) rather than generic helper naming.
- File suffixes are mandatory:
  - Reusable component primitives and integrations end with `Block` (example: `SectionChecklistBlock.tsx`).
  - Hooks start with `use` (example: `useBacklogInlineNotesBlock.ts`).
  - Orchestration containers end with `Orch` (example: `TodoCalendarOrch.tsx`).
- Shared UI primitives stay under `frontend/src/components/lego_blocks/units/ui/*` and are treated as lego blocks.
- Pages should compose orchestrators/blocks, not duplicate orchestration logic.
- New frontend component files that violate this structure should not be added unless `AGENTS.md` is updated first with rationale.

## Service Placement and Naming Rules (Enforced)
- `frontend/src/services/lego_blocks/units/*` stores smallest reusable service primitives (runtime adapters, scanners, transforms, shared types).
- `frontend/src/services/lego_blocks/integrations/*` stores composite service lego blocks that compose multiple units.
- `frontend/src/services/orchestrators/*` stores workflow service composition entrypoints used by UI orchestrators/pages.
- `frontend/src/personal_extension/services/*` is allowed for personal-only first-party code when it mirrors the same architecture:
  - `lego_blocks/{units,integrations}`
  - `orchestrators`
- Service file naming is mandatory:
  - Primitive and integration service files end with `Block` (example: `fsBlock.ts`, `yamlNoteBlock.ts`).
  - Workflow service files end with `Orch` (example: `thoughtsOrch.ts`, `vaultSyncOrch.ts`).
- UI code should import service workflows from `services/orchestrators` by default.
- Direct imports from `services/lego_blocks/{units,integrations}` in UI are only allowed for shared type-only usage.

## Architecture Review Checklist (Required for frontend changes)
1. Did I place reusable logic in `lego_blocks/{units,integrations,hooks}` and flow wiring in `orchestrators`?
2. Did I keep naming consistent with `*Block` and `*Orch`?
3. Did I avoid page-local one-off variants of existing shared components?
4. Did I update docs (`AGENTS.md`, `CLAUDE.md`, `DEVELOPMENT.md`) if architecture knowledge changed?

## Orchestrator Template Rule
- New major screen-level orchestrators should follow `agents/TEMPLATES/ORCHESTRATOR_TEMPLATE.md`.
- Keep section order consistent so agents can scan and modify code quickly.
- If an orchestrator intentionally deviates, document why at the top of the file.

## Security and Trust
- Preserve local-first privacy guarantees.
- Minimize extension permissions and enforce explicit consent.
- No hidden remote calls in "local-only" flows.

## Agent Tool Usage Pattern (Mandatory)
Active multi-agent operations must run in the vault-native organizer workspace.

Workspace location:
- `lifeblood_systems/thinkingspace.ai/thinking-organizer/*`

Required session pattern:
1. Check active tasks: `./thinkspc organizer.nodes.search --query "status active" --limit 10`
2. Claim/update tasks through capability operations (`task.claim`, `task.update_status`) or equivalent organizer UI actions.
3. Every newly created operation node must include a meaningful description in YAML `description` (not empty placeholder text).
4. Record implementation plans in the organizer for non-trivial tasks (estimated >5 minutes). Quick fixes don't need a plan node.
5. Run logging (`run.log`) is optional — use for significant multi-step sessions, not every interaction. Handoffs (`handoff.create`) are recommended when work is incomplete at session end.

Actor and permission rules:
1. Agents must always invoke capabilities with `actor.kind: "agent"` (never switch to `human`/`system` to bypass controls).
2. If a capability call returns `Agent capabilities are disabled by feature flag.`, pause and ask the user to enable `agent_capabilities_enabled` before continuing.
3. If writing to external vault paths (for example iCloud paths outside repo sandbox), request escalated filesystem permission first; do not bypass by changing actor kind.

Capability runner invocation pattern (use `./thinkspc` wrapper from repo root):
- Output defaults: wrapper runs in token-efficient mode (`text` + `brief`). Use `--full` for detailed text output or `--json` for machine parsing.
- Global output flags (`--json`, `--text`, `--brief`, `--full`) must be placed before the command.
- Shortcut commands are supported: `search`, `claim`, `comment`, `done`, `wip`, `ready`, `blocked`, `context`.
- CLI parsing supports both `--flag value` and `--flag=value`.
- Long text can be loaded from files with `--<flag>-file` (for example `--text-file ./note.md`).
- Legacy alias: `./ltm` still works and forwards to `./thinkspc`.
- Browser URLs (for example `http://localhost:5173/.../thinking-organizer?...`) are human navigation links, not agent task targets. For agents, translate them with `./thinkspc organizer.context --url "<link>"` and then run `./thinkspc` capability commands.

Required fields for node creation (easy to forget, causes bugs):
- `--projectRoot lifeblood_systems/thinkingspace.ai` — without it, nodes land at vault root and won't appear in organizer UI
- `--description "..."` — mandatory for every created node
- `--parentKey "..."` — places nodes in correct hierarchy
- `--extra-record_kind <kind>` — for typed records: `task`, `run`, `handoff`, `decision`, `principle`, `note`
- `--extra-*` is for custom metadata only. Use first-class flags for first-class fields (`--comments`, `--description`, etc). For append-only notes prefer `comment.add`.

```bash
# Read operations
./thinkspc list
./thinkspc organizer.nodes.list_roots --typeFilter program
./thinkspc organizer.nodes.search --query "my task" --limit 5
./thinkspc search --query "my task" --limit 5
./thinkspc organizer.context --url "http://localhost:5173/thinking-space/thinking-organizer?tab=backlog&projectRoot=operations%2Fsfw"

# Create node (all required fields shown)
./thinkspc organizer.node.create --type task --title "My task" \
  --parentKey "task-backlog" \
  --projectRoot lifeblood_systems/thinkingspace.ai \
  --description "Short description of the task" \
  --extra-record_kind task

# Other write operations
./thinkspc task.claim --uuid "abc-123" --owner claude-code
./thinkspc task.update_status --uuid "abc-123" --taskStatus done
./thinkspc done --uuid "abc-123"
./thinkspc handoff.create --title "Handoff" --projectRoot lifeblood_systems/thinkingspace.ai \
  --summary "Notes" --fromAgent claude-code --toAgent human \
  --parentKey handoffs-agent-operations
./thinkspc comment.add --uuid "abc-123" --text "Done" --addedBy claude-code
./thinkspc comment --uuid "abc-123" --text-file ./status-update.md

# Raw JSON escape hatch (reads stdin)
./thinkspc invoke < payload.json
```

Setup: `.env` at repo root should set `THINKSPC_VAULT_ROOT=/path/to/your/vault` (or legacy `LTM_VAULT_ROOT`).

Recommended node pattern:
- Program: `development (agent operations)` for active implementation tasks/plans/runs.
- Program: `handoffs (agent operations)` for transfer records.
- Program: `principles and decisions (agent operations)` for durable guidance.
- Plans should be linked to execution tasks via `related_nodes` and/or `depends_on`.

## Multi-Agent Workflow
Before coding:
1. `AGENTS.md` (or `CLAUDE.md` for Claude) contains architecture, contracts, and locked decisions — read it.
2. Check active tasks: `./thinkspc organizer.nodes.search --query "status active" --limit 10`
3. Read additional docs only when the task requires it:
   - `README.md` — for product overview and quick start
   - `DEVELOPMENT.md` — for architecture contracts, phases, and internal dev docs
   - `docs/ADR-005-Agent-Capabilities.md` — when modifying capabilities
   - `docs/ADR-006-Agent-Workspace-Schema.md` — when modifying workspace schema

During work:
- Claim one task in the organizer tool (`task.claim` / task node status updates).
- Keep scope tied to acceptance criteria recorded on the task node.
- For non-trivial tasks (>5 min), record a plan in the organizer before execution.
- Record durable principles/decisions in organizer workspace when new reusable context is discovered.

After work:
- Mark task state in the organizer tool.
- Run logging (`run.log`) is optional — use for significant sessions only.
- Use detailed git commit messages with clear scope, intent, and key change summary; avoid vague messages like `fix`, `update`, or `wip`.
- Commit body must be an exact verbatim copy of the final agent task output (including headings, bullets, wording, and order) for that task.
- Do not paraphrase, shorten, reorder, or restyle the copied final output in the commit body.
- Use `agents/TEMPLATES/COMMIT_MESSAGE_TEMPLATE.md` for commit structure.

## Quality Bar
Every task completion should answer:
1. Which pillar(s) improved?
2. Which guardrails were preserved?
3. What tests/validations were run?
4. What docs were updated for the next agent?
