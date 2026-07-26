# Capability Runner (`thinkspc`)

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

## Required fields for node creation (easy to forget, causes bugs)

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

## Browser URLs are not agent targets

Organizer links like `http://localhost:5173/.../thinking-organizer?tab=backlog&projectRoot=...` are human navigation links. Translate them first, then run capability commands:

```bash
./thinkspc organizer.context --url "<link>"
```

## Multi-Agent Discipline

Active multi-agent operations run in the vault-native organizer workspace at `lifeblood_systems/thinkingspace.ai/thinking-organizer/*`.

**Before coding:** read `CLAUDE.md` (architecture, contracts, locked decisions) → check active tasks (`./thinkspc organizer.nodes.search --query "status active" --limit 10`) → read further docs only as the task requires.

**During work:** claim one task (`task.claim`); keep scope tied to the acceptance criteria recorded on the task node; record a plan before executing anything non-trivial (>5 min); record durable principles/decisions in the organizer workspace when new reusable context appears.

**After work:** mark task state in the organizer; handoffs (`handoff.create`) are recommended when work is incomplete at session end.

**Every task completion should answer:** which pillar(s) improved, which guardrails were preserved, what tests/validations were run, and what docs were updated for the next agent.

Node pattern:
- Program `development (agent operations)` — active implementation tasks/plans/runs.
- Program `handoffs (agent operations)` — transfer records.
- Program `principles and decisions (agent operations)` — durable guidance.
- Plans link to execution tasks via `related_nodes` and/or `depends_on`.

Rules:

- Use organizer tool as source of truth for active operations (tasks, plans, handoffs).
- Every created operation node must include a substantive YAML `description`.
- Record implementation plans in the organizer tool for non-trivial tasks (estimated >5 minutes of work). Quick fixes and small changes don't need a plan node.
- Run logging (`run.log`) is optional — use it for significant multi-step sessions, not every interaction.
- All agent capability calls must use `actor.kind: "agent"`; never switch to `human` to bypass flag/policy checks.
- If `agent_capabilities_enabled` is off and a call fails with that error, pause and ask the user before continuing.
- For external vault writes (such as iCloud paths outside repo sandbox), request escalated filesystem permission first; never bypass by changing actor kind.
- Keep docs synchronized when strategy or architecture shifts.
- Use detailed commit messages that capture scope + intent + key changes; never `fix`, `update`, or `wip`.
- Commit body must be the final task output copied verbatim from the agent response (headings, bullets, wording, and order intact — no paraphrase, truncation, reordering, or restyling).
- Follow `agents/TEMPLATES/COMMIT_MESSAGE_TEMPLATE.md`.
