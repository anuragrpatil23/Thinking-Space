# CLAUDE.md

Canonical operating contract for any coding agent working in `Thinking Space` — Claude Code reads it natively, and `AGENTS.md` points non-Claude agents here so there is exactly one source of truth. Applies only when working inside this repo.

If this file conflicts with an assumption, follow this file + `DEVELOPMENT.md`.

## Responsibility (Critical)

If Claude learns something durable, Claude must write it down — but **not** into this file by default. This file is the index; it has a hard 40k-char budget and lives in every session's context.

Where new knowledge goes:
- An **enforced rule** (something that must not regress) → the matching file in `docs/contracts/`, then one line here if a new contract file was created.
- A **block-level explanation** (why this code is shaped this way) → `docs/reference/KEY-BLOCKS.md`.
- A **recipe** (how to make a kind of change) → `docs/PLAYBOOKS.md`.
- **Active work** (tasks, plans, handoffs) → the organizer (`thinkspc`), not markdown.

Mirror durable project knowledge to organizer principles/decision records in `lifeblood_systems/thinkingspace.ai/thinking-organizer/*`. `AGENTS.md` needs no mirroring — it is a pointer to this file.

## Working Style

- Think from first principles, then map to concrete code tradeoffs.
- Be concise and direct.
- Challenge weak assumptions with practical alternatives.
- Optimize for implementation momentum without sacrificing safety.

## Product Direction (Non-Negotiable)

The app must be built as all three from the ground up:

1. **Thinking space for individuals** — fast, local, hierarchical thinking (`Programs -> Epics -> Ideas -> Thoughts`). For knowledge workers, researchers, writers, founders who arrive at "I need a better way to organize my thoughts."
2. **Place where humans and AI work together** — thinking and AI assistance in one contextual workspace. For AI-savvy users who arrive at "AI tools are useful but disconnected from where I actually think."
3. **AI agent management space for humans** — agent orchestration/visibility integrated with human thought workflows. For power users and multi-agent operators who arrive at "I'm running AI agents but have nowhere to manage them alongside my own thoughts."

These are architecture constraints, not optional positioning variants:
- Do not design isolated feature silos serving only one pillar.
- Prefer shared primitives that strengthen all three.
- Any major change must state pillar impact before implementation.

## Phase Order

`DEVELOPMENT.md` is source of truth for implementation phases and detailed architecture.

Current status (v2.5) — DONE: Phase 0–5, Agent Capability Transport, EPIC-3 (Extension Platform), Live Source Mode + Rebuild Pipeline, Notebook workspace upgrades, native iPhone shell/chrome.

Embedded Terminal (xterm.js + node-pty) is DONE but **slated for removal** (decided 2026-07-16: overkill; users run agents in their own terminal). Do not build new features on it; it is no longer advertised in the README.

Next up: EPIC-5 (AI Actions Everywhere), then EPIC-6 (Optional Remote/Agent Backends, later).

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
10. One shared markdown orchestrator (`MarkdownViewerOrch.tsx`) for view and edit — no page-specific editor overlays.
11. **Editor = one CM6 engine, decorations on top** — no ProseMirror/Notion block model, ever. See [docs/contracts/EDITOR.md](docs/contracts/EDITOR.md).
12. **Lego blocks + orchestrators** everywhere. See [docs/contracts/CODE-ARCHITECTURE.md](docs/contracts/CODE-ARCHITECTURE.md).

## Enforced Contracts

Read the file before touching that area. Each one exists because something already regressed.

| Contract | One-line rule | Where |
|---|---|---|
| Security | Renderer is untrusted; main process is the trust boundary. No `nodeIntegration`, no unvalidated vault paths, no unpinned child `cwd`. | [docs/contracts/SECURITY.md](docs/contracts/SECURITY.md) |
| Startup performance | Heavy vendors never statically reachable from the entry; startup JS ≤ 2.4 MB. | [docs/contracts/STARTUP-PERFORMANCE.md](docs/contracts/STARTUP-PERFORMANCE.md) |
| iOS memory | An iOS-only crash with no JS error is a WebContent memory kill until proven otherwise. | [docs/contracts/IOS-MEMORY.md](docs/contracts/IOS-MEMORY.md) |
| Energy | No unconditional periodic timers; reading holds the display awake, nothing else does. | [docs/contracts/ENERGY.md](docs/contracts/ENERGY.md) |
| Code architecture | Units / integrations / hooks / orchestrators, with mandatory `*Block` / `use*` / `*Orch` naming. | [docs/contracts/CODE-ARCHITECTURE.md](docs/contracts/CODE-ARCHITECTURE.md) |
| Editor | One CM6 engine + decorations; markdown on disk stays byte-identical. | [docs/contracts/EDITOR.md](docs/contracts/EDITOR.md) |
| iOS native chrome | Locked chrome/sync-indicator/settings-roaming design; do not resurrect rejected variants. | [docs/contracts/IOS-NATIVE-CHROME.md](docs/contracts/IOS-NATIVE-CHROME.md) |

## Where Things Live

| What | Where |
|---|---|
| System map (processes, trust boundaries, data flow) | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) |
| Repo layout, how to find code | [docs/CODEBASE-GUIDE.md](docs/CODEBASE-GUIDE.md) |
| Change recipes + verify/ship checklist | [docs/PLAYBOOKS.md](docs/PLAYBOOKS.md) |
| Annotated key blocks (services, intelligence, Electron main) | [docs/reference/KEY-BLOCKS.md](docs/reference/KEY-BLOCKS.md) |
| `thinkspc` CLI + multi-agent discipline | [docs/reference/THINKSPC-CLI.md](docs/reference/THINKSPC-CLI.md) |
| Checkpoint ship ritual + Telegram notification channel | [docs/reference/CHECKPOINT-RITUAL.md](docs/reference/CHECKPOINT-RITUAL.md) |
| YAML schema (source of truth for hierarchy) | [docs/ADR-004-YAML-Architecture.md](docs/ADR-004-YAML-Architecture.md) |
| Capability system / workspace schema | [docs/ADR-005-Agent-Capabilities.md](docs/ADR-005-Agent-Capabilities.md), [docs/ADR-006-Agent-Workspace-Schema.md](docs/ADR-006-Agent-Workspace-Schema.md) |
| Phases, internal dev docs | [DEVELOPMENT.md](DEVELOPMENT.md) |
| Product overview, quick start | [README.md](README.md) |
| Multi-agent handoff protocol | [agents/README.md](agents/README.md) |
| Docs index | [docs/README.md](docs/README.md) |

## Startup Sequence (Claude Sessions)

1. This file is auto-loaded — it holds the locked decisions and points at everything else.
2. Check active tasks: `./thinkspc organizer.nodes.search --query "status active" --limit 10`
3. Read the contract or reference doc for the area you're about to touch. Don't read them all.

## Quality Bar

Every task completion should answer: which pillar(s) improved, which guardrails were preserved, what tests/validations were run, and what docs were updated for the next agent.

## Shipping

At a major checkpoint (user-visible feature or fix, verified): commit + push, then `./scripts/checkpoint-ship.sh` in the background; add `./scripts/checkpoint-ship-ios.sh` if iOS surfaces changed. Details and caveats: [docs/reference/CHECKPOINT-RITUAL.md](docs/reference/CHECKPOINT-RITUAL.md).

## Scope Boundary

These instructions apply to `Thinking Space` only.
