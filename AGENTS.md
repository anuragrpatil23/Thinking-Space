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

Current status (v1.0): Phases 0–5, Agent Capability Transport, and EPIC-3 are all complete.

Upcoming:
- TS-HOTSWITCH: Multi Thinking Space Hot Switch (No Reload) - active (TS-HS-001 to TS-HS-008)
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

## Architecture Reference
- YAML source-of-truth schema: `docs/ADR-004-YAML-Architecture.md`
- Multi-space hot-switch and isolation contract: `docs/ADR-007-Multi-Space-Hot-Switch-Isolation.md`

## Architecture Guardrails
- Keep markdown files with YAML frontmatter as portable source-of-truth content.
- Hierarchy is defined by YAML `parent`/`type`/`level` fields, NOT folder structure.
- IndexedDB is a pure cache layer — can be rebuilt from YAML files at any time.
- Standardize markdown view/edit through one shared orchestrator (`frontend/src/components/orchestrators/MarkdownViewerOrch.tsx`); do not add page-local markdown edit modals.
- Reparent by updating YAML `parent` fields in affected files + syncing IndexedDB.
- Add conflict-safe saves for thought editing (`mtime`/hash checks).
- Avoid destructive migrations without rollback/recovery path.
- No backend dependency for core features.
- Thinking Space switching must be no-reload and preserve strict per-space state isolation for cache/settings/runtime session state.

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
- `coding-projects/thinking-space/thinking-organizer/*`

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
- `--projectRoot coding-projects/thinking-space` — without it, nodes land at vault root and won't appear in organizer UI
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
  --projectRoot coding-projects/thinking-space \
  --description "Short description of the task" \
  --extra-record_kind task

# Other write operations
./thinkspc task.claim --uuid "abc-123" --owner claude-code
./thinkspc task.update_status --uuid "abc-123" --taskStatus done
./thinkspc done --uuid "abc-123"
./thinkspc handoff.create --title "Handoff" --projectRoot coding-projects/thinking-space \
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
