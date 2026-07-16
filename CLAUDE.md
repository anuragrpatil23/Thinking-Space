# CLAUDE.md

Project-local Claude instructions for `Thinking Space`.

This file applies only when working inside `Thinking Space/`.

## Relationship to AGENTS.md
- `CLAUDE.md` is Claude Code's native project instruction file.
- `AGENTS.md` is the tool-agnostic/open-standard agent contract across coding tools.
- Both should stay consistent on architecture, priorities, and operating rules.

## Responsibility (Critical)
If Claude learns something useful, Claude must manually update `CLAUDE.md` to preserve that knowledge for future sessions.

Also mirror durable project knowledge to:
- `AGENTS.md` (cross-tool contract)
- organizer principles/decision records in `lifeblood_systems/thinkingspace.ai/thinking-organizer/*`

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

## Working Style (Inherited + Project-Specific)
- Think from first principles, then map to concrete code tradeoffs.
- Be concise and direct.
- Challenge weak assumptions with practical alternatives.
- Optimize for implementation momentum without sacrificing safety.

## Product Direction (Non-Negotiable)
The app must be built as all three from the ground up:

1. Thinking space for individuals
- Fast, local, hierarchical thinking (`Programs -> Epics -> Ideas -> Thoughts`)

2. Place where humans and AI work together
- Thinking and AI assistance in one contextual workspace

3. AI agent management space for humans
- Agent orchestration/visibility integrated with human thought workflows

These are architecture constraints, not optional positioning variants.

## Phase Order
Use `DEVELOPMENT.md` as source of truth for implementation phases and detailed architecture.

Current status (v2.5):
- Phase 0–5: DONE
- Agent Capability Transport: DONE
- EPIC-3 (Extension Platform): DONE
- Embedded Terminal (xterm.js + node-pty): DONE
- Live Source Mode + Rebuild Pipeline: DONE
- Notebook workspace upgrades: DONE
- Native iPhone shell/chrome work: DONE

Next up:
- EPIC-5: AI Actions Everywhere
- EPIC-6: Optional Remote/Agent Backends (later)

## Locked Technical Decisions
1. Electron-first runtime for near-term milestones.
2. **YAML frontmatter in Markdown files** as source of truth for hierarchy and metadata.
3. **IndexedDB (Dexie.js)** as rebuildable in-browser cache for fast hierarchy queries.
4. **No SQLite / native DB** — removed in favor of YAML + IndexedDB.
5. **No backend required** for core features (hierarchy, editing, AI actions).
6. **Folders are arbitrary** — hierarchy lives in YAML `parent` fields, not folder structure.
7. Related retrieval starts with lexical search via IndexedDB full-text.
8. Local-only extensions first; no early remote code execution.
9. AI local-first: Ollama (Electron) or WASM LLM (web/PWA).
10. Markdown file interaction uses one shared orchestrator/provider (`frontend/src/components/orchestrators/MarkdownViewerOrch.tsx`) for both view and edit; avoid page-specific editor overlays.
11. Code architecture follows lego blocks + orchestrators:
  - Reusable primitives in components/hooks/services.
  - Page/feature orchestration in orchestrator containers.
  - New major orchestrators follow `agents/TEMPLATES/ORCHESTRATOR_TEMPLATE.md`.

## Security Contract (Enforced)
Electron hardening that must not regress (renderer runs user markdown + arbitrary webviews, so the main process is the trust boundary):
- **`nodeIntegration: false`** on every BrowserWindow (`electron/src/setup.ts`). The renderer reaches main only through the `preload.ts` contextBridge; it never needs Node. Do not flip this on.
- **`contextIsolation: true`** stays on for every window.
- **`sandbox: true`** on every BrowserWindow. This requires the preload (`build/src/preload.js`) to stay a single self-contained file whose only `require()` is `electron` — no relative `require`, no Node builtins (`fs`/`path`/`crypto`). The Capacitor platform marker is inlined and the terminal-enabled flag comes from main via `terminal:enabled:getSync` for exactly this reason. If you must add a Node/relative dependency to the preload, bundle it (esbuild) first or sandbox breaks silently (renderer loses `electronAPI`).
- **No inline scripts in `index.html`.** Production `script-src` omits `'unsafe-inline'` (dev-only for Vite HMR). Entry-time scripts go in `main.tsx`/unit blocks (e.g. `iphoneViewportBlock.ts`), never inline `<script>`. After touching HTML/CSP, verify `dist/index.html` has zero `<script>` (only the external module).
- **Every vault-scoped IPC handler** validates the renderer `vaultRoot` via `assertAuthorizedVaultRootBlock`/`resolveInsideVaultBlock` (`vaultPathGuardBlock.ts`) — never trust a renderer path.
- **`vault:git`** only runs an allowlisted set of subcommands and rejects leading git global options (`-c`, `--exec-path`); don't widen it to pass arbitrary args.
- **Outbound network bridges** stay host/target-restricted: Webull + Google use host allowlists; `net:fetchText`/`net:fetchBytes` reject loopback/link-local/private targets (SSRF guard `assertPublicFetchUrlBlock`), including on redirects.
- **Webview `connect-src`/CSP** and the webview permission allowlist (`setupWebviewSessionPermissions`) stay narrow; new outbound origins go through `cspWhitelistBlock.ts`, not a broadened template.

## Startup Performance Contract (Enforced)
- Heavy vendors (Excalidraw, pdfjs/react-pdf, CodeMirror, recharts) must never be statically reachable from the app entry. They load through code-split boundaries:
  - `MarkdownDocumentLazyBlock` — the only way eager code may mount `MarkdownDocumentBlock` (pulls CodeMirror + pdfjs + Excalidraw + markdown/katex pipeline).
  - `MarkdownRichEditorLazyBlock` — the only way eager code may mount the CodeMirror editor.
  - Chart blocks (`DashboardChartsBlock`, `AiActivity*Block`, `CodexUsageMetricChartBlock`) are `lazy()`-imported at each consumer.
- Do NOT list lazy-only vendors in `vite.config.ts` `manualChunks` — object-form manualChunks forces those chunks into the entry's static import graph (side-effect ordering), silently re-eagerizing them. Only startup vendors (react, dexie) belong there.
- Verify after touching imports: `BUILD_TARGET=electron npx vite build`, then check `dist/index.html` modulepreload list — it must contain only `vendor-react` and `vendor-dexie`. Startup JS payload budget: ≤ 2.4 MB (was 5.24 MB before 2026-07 startup-perf pass, −56%).

## Architecture Reference
Full YAML schema and architecture details: `docs/ADR-004-YAML-Architecture.md`

## Frontend Architecture Contract (Enforced)
- Small reusable UI primitives must live in `frontend/src/components/lego_blocks/units/*`.
- Composite UI lego blocks that compose units must live in `frontend/src/components/lego_blocks/integrations/*`.
- Component-layer hooks must live in `frontend/src/components/lego_blocks/hooks/*`.
- Page/feature orchestration must live in `frontend/src/components/orchestrators/*`.
- `frontend/src/personal_extension/components/*` is allowed for personal-only first-party code when it mirrors the same architecture:
  - `lego_blocks/{units,integrations,hooks}`
  - `orchestrators`
- Do not create `*HelperBlock` or `*HelpersBlock` component files. Prefer concrete domain block names.
- If logic has only one consumer, keep it local.
- If logic is reusable, extract to a domain-specific `*Block`/`use*Block` (for example `BacklogListDomainBlock`, `MarkdownDocumentContentBlock`) instead of helper-style naming.
- Naming is mandatory:
  - Reusable component files use `*Block` suffix.
  - Hook files start with `use`.
  - Orchestrator files use `*Orch` suffix.
- Shared UI primitives stay in `frontend/src/components/lego_blocks/units/ui/*`.
- Do not add one-off feature components in `pages/` when a lego block or orchestrator extension is the correct pattern.
- If an exception is unavoidable, document it in both `CLAUDE.md` and `AGENTS.md` in the same change.
- Caution: keep UI orchestrators thin. Extract reusable logic and heavy transformations into lego blocks/hooks/services before orchestrator complexity grows.

## Service Architecture Contract (Enforced)
- Low-level reusable service primitives must live in `frontend/src/services/lego_blocks/units/*`.
- Composite reusable service lego blocks must live in `frontend/src/services/lego_blocks/integrations/*`.
- Workflow service composition must live in `frontend/src/services/orchestrators/*`.
- `frontend/src/personal_extension/services/*` is allowed for personal-only first-party code when it mirrors the same architecture:
  - `lego_blocks/{units,integrations}`
  - `orchestrators`
- Naming is mandatory:
  - Service primitive and integration files use `*Block` suffix.
  - Service workflow files use `*Orch` suffix.
- UI code should consume service orchestrators by default, not low-level service primitives.
- Caution: keep service orchestrators thin. Move shared algorithms, scanners, adapters, and transformation logic into service lego blocks.

## Key Service Blocks
- `frontend/src/services/lego_blocks/units/yamlNoteBlock.ts` — YAML frontmatter parse/stringify/validate/key generation
- `frontend/src/services/lego_blocks/integrations/dbBlock.ts` — Dexie.js IndexedDB cache layer
- `frontend/src/services/orchestrators/vaultSyncOrch.ts` — vault scan to IndexedDB sync
- `frontend/src/services/orchestrators/vaultGraphOrch.ts` — vault graph data (Dexie links + git file births + AI-session heat) for the /vault-graph Tools subtab; force-graph is dynamically imported in `VaultGraphCanvasBlock` only (startup contract). The graph can also be driven by the AI-activity card (lazy-mounted in a drawer): picking a day lights that day's touched notes, clicking a session zooms to the notes it touched. Node attribution prefers **file-edit provenance** — `ParsedSession.touchedPaths`/`ActivityChain.touchedPaths` (absolute paths extracted from Claude `tool_use` Edit/Write/MultiEdit/NotebookEdit calls in `nativeAiSessionParserBlock`) mapped vault-relative by `selectGraphNodesForChainsBlock` in `vaultGraphBlock.ts`; falls back to the time-window heuristic (marked `approximate`) for chat sources / GC'd transcripts. Bump `CACHE_VERSION` in `aiActivityCacheBlock.ts` whenever the parsed-session shape changes (provenance landed on v16).
- `frontend/src/services/lego_blocks/integrations/capabilityRegistryBlock.ts` — capability registry with typed I/O contracts
- `frontend/src/services/orchestrators/capabilityRouterOrch.ts` — capability router with policy/audit/dry-run
- `frontend/src/services/lego_blocks/units/extensionManifestBlock.ts` — extension manifest validation + semver compatibility helpers
- `frontend/src/services/lego_blocks/integrations/extensionActionBlock.ts` — declarative action schema + context template resolution
- `frontend/src/services/orchestrators/extensionLoaderOrch.ts` — extension discovery/reload/activation lifecycle
- `frontend/src/services/orchestrators/extensionUiOrch.ts` — UI slot resolve + action invocation orchestration
- `frontend/src/services/orchestrators/extensionBuilderOrch.ts` — generate/preview/save/activate extension builder workflow

## Intelligence Subsystem
Model-agnostic layer for internal AI tasks (session titles, structured extracts, tool loops). Never used for user chat — that path stays in `aiChatBlock`.

- `frontend/src/services/orchestrators/intelligenceOrch.ts` — public surface: `runContract`, `runWithTools`, `availability`, `diagnose`.
- `frontend/src/services/lego_blocks/units/intelligence/*` — schemaBlock (typed JSON-Schema DSL), promptContractBlock (Contract type), modelProfileBlock (per-model quirks), serverProfileBlock (openai-compat server probe), reasoningStripBlock, intelligenceErrorsBlock, intelligenceTelemetryBlock, contracts/sessionTitleContractBlock.
- `frontend/src/services/lego_blocks/integrations/intelligence/*` — providers/openaiCompatProviderBlock (mlx_lm.server, LM Studio, Ollama, llama.cpp, vLLM, OpenAI), providers/anthropicProviderBlock (Claude via @anthropic-ai/sdk), providerRegistryBlock (default provider + per-call override), toolLoopBlock, jobQueueBlock (concurrency + dedup), intelligenceCacheBlock (sidecar JSON via electron IPC).
- Cache lives at `~/.thinking-space/intelligence-cache/<taskId>/<key>.json`. Keyed by `(taskId, inputHash, promptVersion, model)` — any of those changing invalidates automatically.
- Default provider is user-configurable in Settings → AI → Intelligence Subsystem. Diagnostics panel there shows live provider status, capability probes, and the last 20 requests.
- To add a new intelligence task: define a Contract in `units/intelligence/contracts/<name>ContractBlock.ts`, call `runContract(contract, input)`. Do NOT open a new HTTP path or add another `sessionTitle`-style module.

## Key Electron Blocks (main process)
- `frontend/electron/src/lego_blocks/vaultPathGuardBlock.ts` — authorization gate for renderer-supplied vault roots. Every vault/hierarchy/harvest IPC handler validates `vaultRoot` against main-anchored roots (persisted root, native `vault:selectFolder` pick, `vault:root:setPersisted`); `resolveInsideVaultBlock` adds traversal-safe containment via `path.relative` (not `startsWith`). New vault-scoped IPC handlers MUST call `assertAuthorizedVaultRootBlock`/`resolveInsideVaultBlock` — never trust a renderer path. This is also the macOS TCC story: the app only ever touches the user-chosen vault (terminal PTYs default to the vault root, not `$HOME`, for the same reason).
- `frontend/electron/src/lego_blocks/sourceConfigBlock.ts` — read/write `userData/state/source-config.json` (mode, sourcePath, vitePort)
- `frontend/electron/src/lego_blocks/viteServerBlock.ts` — spawn Vite dev server from source path, poll readiness (45s timeout)
- `frontend/electron/src/lego_blocks/viteRebuildBlock.ts` — 5-step rebuild pipeline + detached swap script (`applyRebuildBlock`)
- `frontend/electron/src/lego_blocks/ptyManagerBlock.ts` — node-pty PTY lifecycle, IPC routing by `webContentsId`, per-window cleanup
- `frontend/electron/src/lego_blocks/intelligenceCacheStoreBlock.ts` — sidecar JSON cache for intelligence outputs; also cleans up the legacy `session-titles/` dir on startup.

## Startup Sequence (Claude Sessions)
1. `CLAUDE.md` is auto-loaded — contains architecture, contracts, and locked decisions.
2. Check active tasks: `./thinkspc organizer.nodes.search --query "status active" --limit 10`
3. Read additional docs only when the task requires it:
   - `README.md` — for product overview and quick start
   - `DEVELOPMENT.md` — for architecture contracts, phases, and internal dev docs
   - `docs/ADR-005-Agent-Capabilities.md` — when modifying the capability system
   - `docs/ADR-006-Agent-Workspace-Schema.md` — when modifying workspace schema fields
   - `agents/README.md` — for multi-agent handoff protocol

## Multi-Agent Discipline
- Use organizer tool as source of truth for active operations (tasks, plans, handoffs).
- Every created operation node must include a substantive YAML `description`.
- Record implementation plans in the organizer tool for non-trivial tasks (estimated >5 minutes of work). Quick fixes and small changes don't need a plan node.
- Run logging (`run.log`) is optional — use it for significant multi-step sessions, not every interaction.
- All agent capability calls must use `actor.kind: "agent"`; never switch to `human` to bypass flag/policy checks.
- If `agent_capabilities_enabled` is off and a call fails with that error, pause and ask the user before continuing.
- For external vault writes (such as iCloud paths outside repo sandbox), request escalated permissions first.
- Follow workspace usage pattern:
  - `development (agent operations)` for active task/plan work.
  - `handoffs (agent operations)` for handoff records.
  - `principles and decisions (agent operations)` for durable guidance.
- Keep docs synchronized when strategy or architecture shifts.
- Use detailed commit messages that capture scope + intent + key changes; do not use generic commit titles.
- Commit body must be the final task output copied verbatim from the agent response (no paraphrase, truncation, or reformatting).
- Follow `agents/TEMPLATES/COMMIT_MESSAGE_TEMPLATE.md`.

## Capability Runner Pattern
Two equivalent invocations — both run the same bundled CLI via Electron-as-Node, single source of truth:
- **`thinkspc`** (no `./`) from any directory once the Thinking Space app has been launched at least once (it provisions a shim at `~/.local/bin/thinkspc` + config at `~/.thinking-space/config.json`). Recommended.
- **`./thinkspc`** from the repo root — same runtime, but also picks up a fresh repo bundle (after `node frontend/scripts/bundle-cli.mjs`) so source edits are testable without re-installing the app. Sources repo `.env` if no env var/config is set.

Both default to `actor: {kind: "agent", id: "claude-code"}`. Cold start ~0.1s (no vite-node, no `node_modules` required, single bundled .mjs invoked via ELECTRON_RUN_AS_NODE=1 against `/Applications/Thinking Space.app/Contents/MacOS/Thinking Space`).
Legacy alias: `./ltm` forwards to `./thinkspc`.
Wrapper defaults are token-efficient (`text` + `brief` output). Use `--full` for detailed text or `--json` for machine parsing.
Global output flags (`--json`, `--text`, `--brief`, `--full`) must appear before the command.
Shortcuts are supported: `search`, `claim`, `comment`, `done`, `wip`, `ready`, `blocked`, `context`.
CLI parsing supports both `--flag value` and `--flag=value`.
Long values can be loaded from files with `--<flag>-file` (for example `--text-file ./note.md`).

### Required fields for node creation (easy to forget, causes bugs):
- `--projectRoot lifeblood_systems/thinkingspace.ai` — without it, nodes land at vault root and won't appear in organizer UI
- `--description "..."` — mandatory for every created node per multi-agent discipline
- `--parentKey "..."` — required to place nodes in the correct hierarchy (e.g., `handoffs-agent-operations`, `task-backlog`)
- `--extra-record_kind <kind>` — for typed records: `task`, `run`, `handoff`, `decision`, `principle`, `note`
- `--extra-*` is only for custom metadata (`extraFields`). For first-class fields use first-class flags (`--comments`, `--description`, etc). For append-only notes, use `comment.add`.

```bash
# Read operations
./thinkspc list
./thinkspc organizer.nodes.list_roots --typeFilter program
./thinkspc organizer.nodes.list_children --parentKey "epic-auth"
./thinkspc organizer.nodes.search --query "auth bug" --limit 10
./thinkspc search --query "auth bug" --limit 10
./thinkspc organizer.node.get --uuid "abc-123"

# Create node (all required fields shown)
./thinkspc organizer.node.create --type task --title "Fix login" \
  --parentKey "task-backlog" \
  --projectRoot lifeblood_systems/thinkingspace.ai \
  --description "Login form crashes on submit due to missing validation" \
  --extra-record_kind task

# Other write operations
./thinkspc organizer.node.update --uuid "abc-123" --status active --priority high
./thinkspc task.claim --uuid "abc-123" --owner claude-code
./thinkspc task.update_status --uuid "abc-123" --taskStatus done
./thinkspc done --uuid "abc-123"
./thinkspc run.log --title "Session log" --projectRoot lifeblood_systems/thinkingspace.ai --agentName claude-code --result success
./thinkspc handoff.create --title "Handoff" --projectRoot lifeblood_systems/thinkingspace.ai \
  --summary "Notes" --fromAgent claude-code --toAgent human \
  --parentKey handoffs-agent-operations
./thinkspc comment.add --uuid "abc-123" --text "Done" --addedBy claude-code
./thinkspc comment --uuid "abc-123" --text-file ./status-update.md

# Raw JSON escape hatch (reads stdin, for complex payloads)
./thinkspc invoke < payload.json
```

Setup: ensure `.env` at repo root has `THINKSPC_VAULT_ROOT=/path/to/your/vault` (or legacy `LTM_VAULT_ROOT`).

## Scope Boundary
These instructions apply to `Thinking Space` only.
