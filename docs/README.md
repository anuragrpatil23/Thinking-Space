# docs/

Start here if you're a new agent or contributor:

1. **[ARCHITECTURE.md](ARCHITECTURE.md)** — system map: processes, trust boundaries, data flow, subsystems, contracts.
2. **[CODEBASE-GUIDE.md](CODEBASE-GUIDE.md)** — repo layout, lego-block/orchestrator conventions, how to find things.
3. **[PLAYBOOKS.md](PLAYBOOKS.md)** — recipes for common changes (UI feature, IPC channel, Dexie schema, intelligence task, ...) + verify/ship checklist.

Reference:

- [ADR-004-YAML-Architecture.md](ADR-004-YAML-Architecture.md) — YAML frontmatter schema (source of truth for hierarchy)
- [ADR-005-Agent-Capabilities.md](ADR-005-Agent-Capabilities.md) — agent capability contract
- [ADR-006-Agent-Workspace-Schema.md](ADR-006-Agent-Workspace-Schema.md) — organizer workspace schema
- [EPIC-3-LOCAL-EXTENSION-PLATFORM.md](EPIC-3-LOCAL-EXTENSION-PLATFORM.md) — extension platform design
- [CAPABILITY_ROLLOUT_MATRIX.md](CAPABILITY_ROLLOUT_MATRIX.md) — capability rollout state
- [BUILD-macOS-LOCAL.md](BUILD-macOS-LOCAL.md) / [BUILD-iOS.md](BUILD-iOS.md) — packaging guides
- [EXCALIDRAW_UPGRADE_PLAYBOOK.md](EXCALIDRAW_UPGRADE_PLAYBOOK.md), [OPS_REPO_SYNC_CHECKLIST.md](OPS_REPO_SYNC_CHECKLIST.md), [UI-ADAPTIVE-VALIDATION-MATRIX.md](UI-ADAPTIVE-VALIDATION-MATRIX.md) — occasional operations

Enforced contracts live at the repo root: `CLAUDE.md` / `AGENTS.md` (they override these docs on
conflict). Multi-agent protocol: `agents/README.md`.
