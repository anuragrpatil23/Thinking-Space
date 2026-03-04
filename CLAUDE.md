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
- organizer principles/decision records in `coding-projects/thinking-space/thinking-organizer/*`

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

Current status (v1.0):
- Phase 0–5: DONE
- Agent Capability Transport: DONE
- EPIC-3 (Extension Platform): DONE

Next up:
- TS-HOTSWITCH: Multi Thinking Space Hot Switch (No Reload) - active (TS-HS-001 to TS-HS-008)
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
12. Multi-space switching must be no-reload and enforce per-space namespace isolation for cache/settings/runtime session state (see ADR-007).

## Architecture Reference
- YAML source-of-truth schema: `docs/ADR-004-YAML-Architecture.md`
- Multi-space hot-switch and isolation contract: `docs/ADR-007-Multi-Space-Hot-Switch-Isolation.md`

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
- `frontend/src/services/lego_blocks/integrations/capabilityRegistryBlock.ts` — capability registry with typed I/O contracts
- `frontend/src/services/orchestrators/capabilityRouterOrch.ts` — capability router with policy/audit/dry-run
- `frontend/src/services/lego_blocks/units/extensionManifestBlock.ts` — extension manifest validation + semver compatibility helpers
- `frontend/src/services/lego_blocks/integrations/extensionActionBlock.ts` — declarative action schema + context template resolution
- `frontend/src/services/orchestrators/extensionLoaderOrch.ts` — extension discovery/reload/activation lifecycle
- `frontend/src/services/orchestrators/extensionUiOrch.ts` — UI slot resolve + action invocation orchestration
- `frontend/src/services/orchestrators/extensionBuilderOrch.ts` — generate/preview/save/activate extension builder workflow

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
Use the `./thinkspc` wrapper from the repo root. It auto-loads `.env` (for `THINKSPC_VAULT_ROOT` or legacy `LTM_VAULT_ROOT`), sets runner flags, and defaults to `actor: {kind: "agent", id: "claude-code"}`.
Legacy alias: `./ltm` forwards to `./thinkspc`.
Wrapper defaults are token-efficient (`text` + `brief` output). Use `--full` for detailed text or `--json` for machine parsing.
Global output flags (`--json`, `--text`, `--brief`, `--full`) must appear before the command.
Shortcuts are supported: `search`, `claim`, `comment`, `done`, `wip`, `ready`, `blocked`, `context`.
CLI parsing supports both `--flag value` and `--flag=value`.
Long values can be loaded from files with `--<flag>-file` (for example `--text-file ./note.md`).

### Required fields for node creation (easy to forget, causes bugs):
- `--projectRoot coding-projects/thinking-space` — without it, nodes land at vault root and won't appear in organizer UI
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
  --projectRoot coding-projects/thinking-space \
  --description "Login form crashes on submit due to missing validation" \
  --extra-record_kind task

# Other write operations
./thinkspc organizer.node.update --uuid "abc-123" --status active --priority high
./thinkspc task.claim --uuid "abc-123" --owner claude-code
./thinkspc task.update_status --uuid "abc-123" --taskStatus done
./thinkspc done --uuid "abc-123"
./thinkspc run.log --title "Session log" --projectRoot coding-projects/thinking-space --agentName claude-code --result success
./thinkspc handoff.create --title "Handoff" --projectRoot coding-projects/thinking-space \
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
