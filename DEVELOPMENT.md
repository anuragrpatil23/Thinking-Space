# Development Guide

Internal development documentation for Thinking Space. For an overview of the project, see [README.md](README.md).

## Table of Contents

- [Runtime Architecture](#runtime-architecture)
- [Frontend Architecture Contract](#frontend-architecture-contract)
- [Service Architecture Contract](#service-architecture-contract)
- [Storage Strategy](#storage-strategy)
- [Agent Capability Transport](#agent-capability-transport)
- [Agent Operations Pattern](#agent-operations-pattern)
- [Implementation Phases](#implementation-phases)
- [Milestone Releases](#milestone-releases)
- [Success Metrics](#success-metrics)
- [Risks and Mitigations](#risks-and-mitigations)
- [Multi-Agent Collaboration](#multi-agent-collaboration)

---

## Runtime Architecture

- **Frontend**: React + TypeScript + Vite + Tailwind (`frontend/`)
- **Backend (web mode)**: FastAPI + Python (`backend/`) — thin proxy only, being phased out for core features
- **Desktop/mobile modes**: Electron + Capacitor (`frontend/electron/`, `frontend/ios/`)
- **Storage**: Markdown files with YAML frontmatter in the vault (source of truth)
- **Cache**: IndexedDB via Dexie.js (in-browser fast access layer, rebuildable)
- **Agent CLI**: `./thinkspc` wrapper for capability invocations

## Frontend Architecture Contract

- Small reusable UI primitives live in `frontend/src/components/lego_blocks/units/*`.
- Composite reusable UI blocks live in `frontend/src/components/lego_blocks/integrations/*`.
- Reusable component-layer hooks live in `frontend/src/components/lego_blocks/hooks/*`.
- Orchestration containers live in `frontend/src/components/orchestrators/*`.
- Naming rules are mandatory:
  - Reusable component blocks use `*Block` suffix.
  - Hooks use `use*` prefix.
  - Orchestrators use `*Orch` suffix.
- Shared UI primitives live in `frontend/src/components/lego_blocks/units/ui/*`.
- New feature work should extend/reuse existing lego blocks first, then compose in orchestrators.
- Enforced by: `AGENTS.md`, `CLAUDE.md`, and `agents/TEMPLATES/ORCHESTRATOR_TEMPLATE.md`.

## Service Architecture Contract

- Reusable service primitives live in `frontend/src/services/lego_blocks/units/*`.
- Composite reusable service lego blocks live in `frontend/src/services/lego_blocks/integrations/*`.
- Workflow service composition lives in `frontend/src/services/orchestrators/*`.
- Naming rules are mandatory:
  - Reusable service primitives and integrations use `*Block` suffix.
  - Service orchestrators use `*Orch` suffix.
- UI code should consume service orchestration modules by default.

## Storage Strategy

### YAML Frontmatter + IndexedDB

- **Markdown files with YAML frontmatter** are the source of truth (portable, user-owned, git-friendly)
- **IndexedDB** (via Dexie.js) caches parsed frontmatter for fast hierarchy queries
- **Hierarchy lives in metadata** (`parent`, `type`, `level` fields), not folder structure
- **Folders are user's choice** — organize by date, domain, source, inbox/archive, whatever works

Full schema: `docs/ADR-004-YAML-Architecture.md`
Multi-space hot-switch + isolation contract: `docs/ADR-007-Multi-Space-Hot-Switch-Isolation.md`

### Example Note File

```yaml
---
uuid: "550e8400-e29b-41d4-a716-446655440000"
key: "build-thinking-space"
title: "Build Thinking Space App"
type: "epic"
level: 1
parent: "personal-growth"
parent_uuid: "a1b2c3d4-..."
tags: ["project/app", "ai/pkm"]
status: "active"
progress: 0.42
created_at: "2026-02-14T17:30:00Z"
updated_at: "2026-02-14T18:15:00Z"
---

## Body content here

Regular markdown body text...
```

### File Naming (Recommended, Not Enforced)

`{type}-{key}.md` or `{key}.md`
Examples: `epic-build-thinking-space.md`, `thought-ollama-in-browser.md`

### Vault Layout

```text
vault/
  thoughts/
    thought-ai-extensibility-ideas.md
    thought-ollama-in-browser.md
  epics/
    epic-build-thinking-space.md
  ideas/
    idea-in-app-feature-builder.md
  canvases/
    thinking-space-hierarchy.excalidraw.md
  attachments/
```

Folders are convenience groupings only. The app never enforces or relies on folder structure. Hierarchy is derived from YAML `parent` fields.

## Agent Capability Transport

Organizer operations are exposed through one capability contract in frontend TypeScript:
- Registry: `frontend/src/services/lego_blocks/integrations/capabilityRegistryBlock.ts`
- Router: `frontend/src/services/orchestrators/capabilityRouterOrch.ts`
- Contract ADR: `docs/ADR-005-Agent-Capabilities.md`
- Agent workspace schema ADR: `docs/ADR-006-Agent-Workspace-Schema.md`
- Rollout matrix: `docs/CAPABILITY_ROLLOUT_MATRIX.md`
- Ops repo checklist: `docs/OPS_REPO_SYNC_CHECKLIST.md`

External agent/curl access uses a thin transport layer:
- Frontend runner: `frontend/scripts/agent/capabilityRunner.ts`
- FastAPI proxy endpoints:
  - `GET /api/capabilities`
  - `POST /api/capabilities/invoke`

Workspace bootstrap/import tool:
- `frontend/scripts/agent/bootstrapAgentWorkspace.ts`
- Command:
  - `cd frontend && npm run agent:workspace:bootstrap -- "<project-root-path>"`

Operational controls:
- Frontend feature flags:
  - `agent_capabilities_enabled` (default: `false`)
  - `fastapi_capability_adapter_enabled` (default: `false`)
  - `extension_host_enabled` (default: `false`)
  - `extension_builder_enabled` (default: `false`)
- FastAPI adapter environment controls:
  - `LTM_FASTAPI_CAPABILITY_ADAPTER_ENABLED=true`
  - `LTM_CAPABILITY_BEARER_TOKEN=<token>` (optional)
  - `LTM_CAPABILITY_RATE_LIMIT_PER_MINUTE=<int>`
  - `LTM_CAPABILITY_MAX_PAYLOAD_BYTES=<int>`

Important constraint:
- Python backend does **not** implement duplicate YAML hierarchy services.
- Backend only proxies requests to the frontend capability runner.

## Agent Operations Pattern

For active agent orchestration, the source of truth is the vault-native organizer workspace:
- `coding-projects/thinking-space/thinking-organizer/*`

Required operating pattern:
1. Sync vault/cache first (`Sync Vault Now`) before reading/updating operational state.
2. Execute task lifecycle in-tool (`task.claim`, `task.update_status`, organizer UI actions).
3. Every created operation node must include a meaningful YAML `description`.
4. Every execution plan must be recorded in-tool before implementation begins.
5. Record run/handoff outcomes in-tool (`run.log`, `handoff.create`, comments/state history).

Quick invocation examples:

```bash
# CLI wrapper (recommended for agents — auto-loads .env, sets flags, defaults actor)
# Legacy alias: `./ltm` still works and forwards to `./thinkspc`
# Wrapper defaults are token-efficient (text + brief). Use --full or --json when needed.
./thinkspc organizer.nodes.list_roots --typeFilter program
./thinkspc search --query "status active" --limit 10
./thinkspc organizer.context --url "http://localhost:5173/thinking-space/thinking-organizer?tab=backlog&projectRoot=operations%2Fsfw"
./thinkspc task.claim --uuid "abc-123" --owner claude-code
./thinkspc done --uuid "abc-123"
./thinkspc comment --uuid "abc-123" --text-file ./status-update.md
./thinkspc run.log --title "Session" --projectRoot coding-projects/thinking-space --agentName claude-code --result success

# curl via FastAPI proxy (requires backend running)
curl -s http://127.0.0.1:8000/api/capabilities/invoke \
  -H "Content-Type: application/json" \
  -d '{
    "capability": "organizer.nodes.list_roots",
    "input": {"typeFilter": "program"},
    "actor": {"kind": "agent", "id": "curl"}
  }'
```

## Implementation Phases

### Phase 0: Architecture Alignment (EPIC-0)
Completed: docs alignment, YAML schema definition, SQLite removal, dependency install, architecture conformance refactor (lego blocks + orchestrators), coding philosophy standardization.

### Phase 1: YAML Note Block — Done
Completed: `yamlNoteBlock.ts` (parse/stringify/validate/key generation), `NewThoughtOrch` creates YAML frontmatter notes, backward compat with plain thoughts, YAML frontmatter in new thought + todo create flows.

### Phase 2: IndexedDB Cache Layer — Done
Completed: `dbBlock.ts` (Dexie.js schema, upsert, query, search), `vaultSyncOrch.ts` (scan vault, populate IndexedDB), incremental sync, agent orchestration metadata now first-class in cache.

### Phase 3: Hierarchy UI (ThinkingOrganizer) — Done
Completed: `TreeViewBlock.tsx` recursive tree with collapse/expand, `ThinkingOrganizerOrch` driven by IndexedDB, Jira-style create flow with project-scoped storage, hierarchy CRUD + mirrored path manager, node detail panel with arbitrary YAML field rendering.

### Phase 4: Thought Edit Flow — Done
Completed: unified markdown viewer/editor (`MarkdownViewerOrch`), conflict-safe save with mtime/hash checks.

### Phase 5: AI Actions — Done
Completed: global AI settings and telemetry, per-tab provider/model overrides, native AI login/runtime parity for Electron + Capacitor, desktop-to-mobile OAuth handoff.

### Agent Capability Transport — Done
Completed: 55-capability registry with typed I/O contracts, capability router with policy/audit/dry-run, frontend CLI runner + `./thinkspc` shell wrapper, FastAPI thin proxy, feature flags, rate limiting, bearer token controls, agent workspace with task lifecycle + run logging + handoffs + audit trail.

### EPIC-3: Local-Only Extension Platform — Done
Completed: extension manifest parser/validator + compatibility contract, extension loader/registry lifecycle orchestration, declarative action schema + slot routing, runtime extension UI slot integration, Electron JS/TS runtime sandbox with capability-bridge permission checks + audit propagation, in-app extension builder flow with permission approval gate.

### TS-HOTSWITCH: Multi Thinking Space Hot Switch (No Reload) — Done
Completed: deterministic space registry + active pointer, no-reload runtime switching path, per-space localStorage namespace contract, per-space IndexedDB namespaces, space-safe tab/route sanitization on switch, space-scoped UI persistence for explorer/new-thought/F9 surfaces, and rollout gates documented in `docs/ADR-007-Multi-Space-Hot-Switch-Isolation.md`.

### Future Work
- **EPIC-5: AI Actions Everywhere** — Shared text action component for all text surfaces, Summarize/Cleanup/Related actions with preview-before-apply
- **EPIC-6: Optional Remote/Agent Backends** — Optional remote task execution/provider connectors, local-first behavior stays default

## Milestone Releases

- `v0.2`: YAML notes + IndexedDB cache
- `v0.3`: Hierarchy UI + edit flow
- `v0.4`: AI actions + native AI login/runtime parity
- `v0.5`: Extension platform foundations
- `v1.0`: Full feature set with capability transport, extension builder, and multi-platform packaging

## Success Metrics

- Thought edit completion without overwrite/data loss regressions
- Reparent operations update YAML files correctly with no orphan metadata
- Related retrieval latency target for personal vault scale: sub-150ms typical
- Zero remote execution required for extension workflows in first platform release
- IndexedDB rebuilds correctly from YAML files (cache integrity)

## Risks and Mitigations

- **YAML frontmatter parse errors** — strict validation in `yamlNoteBlock`, graceful fallback for malformed files
- **IndexedDB cache divergence** — IndexedDB is pure cache, can be rebuilt anytime; incremental sync on file changes
- **Large vault performance** — incremental sync, file watcher events, IndexedDB caching
- **Unsafe extension behaviors** — explicit permission model + local-only policy + restricted capability surface + feature-flagged rollout
- **Cross-platform runtime mismatch** — declarative-first extension contract, avoid arbitrary remote code execution
- **Context bloat for multi-agent work** — organizer tool-native operations + capability audit logs + required in-tool plan/handoff records

## Multi-Agent Collaboration

Use the organizer workspace as source of truth for active operations:
- `coding-projects/thinking-space/thinking-organizer/*`

Key docs:
- `AGENTS.md` — top-level implementation contract
- `docs/ADR-005-Agent-Capabilities.md` — capability contract, transport, policy/audit expectations
- `docs/ADR-006-Agent-Workspace-Schema.md` — workspace schema and required operation fields

Recommended organizer layout:
- `development (agent operations)` program for implementation tasks/plans/runs
- `handoffs (agent operations)` program for transfer records
- `principles and decisions (agent operations)` program for durable guidance

Workflow:
1. Read `AGENTS.md`
2. Read `DEVELOPMENT.md`
3. Read `agents/README.md`
4. Read relevant ADR docs as needed
5. Sync organizer cache and claim an in-tool task (`task.claim`)
6. Record plan/run/handoff updates in organizer workspace
