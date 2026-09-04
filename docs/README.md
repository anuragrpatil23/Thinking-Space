# docs/

Start here if you're a new agent or contributor:

1. **[ARCHITECTURE.md](ARCHITECTURE.md)** — system map: processes, trust boundaries, data flow, subsystems, contracts.
2. **[CODEBASE-GUIDE.md](CODEBASE-GUIDE.md)** — repo layout, lego-block/orchestrator conventions, how to find things.
3. **[PLAYBOOKS.md](PLAYBOOKS.md)** — recipes for common changes (UI feature, IPC channel, Dexie schema, intelligence task, ...) + verify/ship checklist.

Enforced contracts (`contracts/`) — read the one covering the area you're about to touch:

- [contracts/SECURITY.md](contracts/SECURITY.md) — Electron hardening, vault path guards, child-process cwd / TCC
- [contracts/STARTUP-PERFORMANCE.md](contracts/STARTUP-PERFORMANCE.md) — code-split boundaries + startup JS budget
- [contracts/IOS-MEMORY.md](contracts/IOS-MEMORY.md) — WebContent memory kills, diagnosis workflow
- [contracts/ENERGY.md](contracts/ENERGY.md) — timers, screen wake lock, native plugin build steps
- [contracts/CODE-ARCHITECTURE.md](contracts/CODE-ARCHITECTURE.md) — frontend + service lego-block/orchestrator rules
- [contracts/EDITOR.md](contracts/EDITOR.md) — one CM6 engine, decorations on top
- [contracts/IOS-NATIVE-CHROME.md](contracts/IOS-NATIVE-CHROME.md) — native chrome, sync indicator, settings roaming

Reference (`reference/`):

- [reference/KEY-BLOCKS.md](reference/KEY-BLOCKS.md) — annotated key service / intelligence / Electron-main blocks
- [reference/THINKSPC-CLI.md](reference/THINKSPC-CLI.md) — capability runner + multi-agent discipline
- [reference/CHECKPOINT-RITUAL.md](reference/CHECKPOINT-RITUAL.md) — ship scripts + Telegram notification channel
- [ADR-004-YAML-Architecture.md](ADR-004-YAML-Architecture.md) — YAML frontmatter schema (source of truth for hierarchy)
- [ADR-005-Agent-Capabilities.md](ADR-005-Agent-Capabilities.md) — agent capability contract
- [ADR-006-Agent-Workspace-Schema.md](ADR-006-Agent-Workspace-Schema.md) — organizer workspace schema
- [EPIC-3-LOCAL-EXTENSION-PLATFORM.md](EPIC-3-LOCAL-EXTENSION-PLATFORM.md) — extension platform design
- [EPIC-7-SETTINGS-REWORK.md](EPIC-7-SETTINGS-REWORK.md) — settings schema, primitives, pane consolidation, sync correctness
- [CAPABILITY_ROLLOUT_MATRIX.md](CAPABILITY_ROLLOUT_MATRIX.md) — capability rollout state
- [BUILD-macOS-LOCAL.md](BUILD-macOS-LOCAL.md) / [BUILD-iOS.md](BUILD-iOS.md) — packaging guides
- [EXCALIDRAW_UPGRADE_PLAYBOOK.md](EXCALIDRAW_UPGRADE_PLAYBOOK.md), [OPS_REPO_SYNC_CHECKLIST.md](OPS_REPO_SYNC_CHECKLIST.md), [UI-ADAPTIVE-VALIDATION-MATRIX.md](UI-ADAPTIVE-VALIDATION-MATRIX.md) — occasional operations

`CLAUDE.md` at the repo root is the index: locked decisions plus pointers into
`contracts/` and `reference/` (`AGENTS.md` is just a pointer to it). It overrides these docs on
conflict. Keep it thin — new detail belongs in a contract or reference file here, not in the root
instruction file (40k-char budget).
Multi-agent protocol: `agents/README.md`.
