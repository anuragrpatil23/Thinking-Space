# Multi-Agent Ops (Codex + Claude)

Purpose: enable parallel agents to execute without repeatedly re-reading the whole codebase.

## Files to Use
- `AGENTS.md`: non-negotiable product/architecture contract for all implementation work
- `CLAUDE.md`: Claude-native project file (must stay consistent with `AGENTS.md`)
- `docs/ARCHITECTURE.md`: system map — processes, trust boundaries, data flow, subsystems
- `docs/CODEBASE-GUIDE.md`: repo layout, lego-block/orchestrator conventions, how to find code
- `docs/PLAYBOOKS.md`: recipes for common changes + verify/ship checklist
- `README.md`: roadmap and epic order source of truth
- `docs/ADR-005-Agent-Capabilities.md`: capability contract and operational controls
- `docs/ADR-006-Agent-Workspace-Schema.md`: organizer workspace schema + operation fields
- `agents/TEMPLATES/HANDOFF_TEMPLATE.md`: required handoff format
- `agents/TEMPLATES/ORCHESTRATOR_TEMPLATE.md`: required structure for new major orchestrator files
- `agents/TEMPLATES/COMMIT_MESSAGE_TEMPLATE.md`: required commit message structure

Active operations source of truth:
- `lifeblood_systems/thinkingspace.ai/thinking-organizer/*`

## Startup Sequence (Every New Agent)
1. Read `AGENTS.md` (or `CLAUDE.md` for Claude — it's auto-loaded and covers the same ground)
2. New to the codebase? Read `docs/ARCHITECTURE.md` → `docs/CODEBASE-GUIDE.md`; open `docs/PLAYBOOKS.md` for the kind of change you're making
3. Check active tasks: `./thinkspc organizer.nodes.search --query "status active" --limit 10`
4. Claim a task and start working
5. Read additional docs only when the task requires it (see "Files to Use" above)

## Mandatory Tool Pattern
1. Run active task lifecycle only in organizer workspace.
2. Every created operation node must include a meaningful YAML `description`.
3. Record plans in the organizer for non-trivial tasks (estimated >5 minutes). Quick fixes don't need a plan node.
4. Update task state in-tool. Run logging (`run.log`) is optional — use for significant sessions only.
5. Use `actor.kind: "agent"` for agent capability calls. Never switch to `human` to bypass controls.
6. If call fails with `Agent capabilities are disabled by feature flag.`, pause and ask user to enable it.
7. If vault path is outside sandbox (for example iCloud), request escalated permissions before writes.

Workspace layout pattern:
- `development (agent operations)` program for active implementation tasks/plans/runs.
- `handoffs (agent operations)` program for transfer notes.
- `principles and decisions (agent operations)` program for durable guidance.

## Capability API Pattern
Use the `./ltm` wrapper from the repo root (auto-loads `.env` for vault path, sets runner flags, defaults actor to `agent/claude-code`).
`./ltm` defaults to readable text in interactive terminals; use `--json` when output must be machine-parseable.

Required fields for node creation (easy to forget, causes bugs):
- `--projectRoot lifeblood_systems/thinkingspace.ai` — without it, nodes land at vault root
- `--description "..."` — mandatory for every created node
- `--parentKey "..."` — places nodes in correct hierarchy
- `--extra-record_kind <kind>` — `task`, `run`, `handoff`, `decision`, `principle`, `note`
- `--extra-*` is for custom metadata only; use first-class flags for first-class fields (`--comments`, `--description`, etc). Use `comment.add` to append a note.

```bash
# Read operations
./ltm list
./ltm organizer.nodes.list_roots --typeFilter program
./ltm organizer.node.get_by_key --key "development-agent-operations"

# Create node (all required fields shown)
./ltm organizer.node.create --type task --title "My task" \
  --parentKey "task-backlog" \
  --projectRoot lifeblood_systems/thinkingspace.ai \
  --description "Short description of the task" \
  --extra-record_kind task

# Other operations
./ltm task.claim --uuid "abc-123" --owner claude-code
./ltm task.update_status --uuid "abc-123" --taskStatus done
./ltm handoff.create --title "Handoff" --projectRoot lifeblood_systems/thinkingspace.ai \
  --summary "Notes" --fromAgent claude-code --toAgent human \
  --parentKey handoffs-agent-operations
./ltm comment.add --uuid "abc-123" --text "Done" --addedBy claude-code

# Raw JSON escape hatch (reads stdin)
./ltm invoke < payload.json
```

Setup: `.env` at repo root must have `LTM_VAULT_ROOT=/path/to/your/vault`.

## Status Vocabulary
- `READY`: unclaimed, clear to execute
- `IN_PROGRESS`: currently owned by one agent
- `BLOCKED`: waiting on decision or dependency
- `DONE`: completed in organizer task/run records

## Ownership Rules
- One task, one owner at a time.
- Update task status in organizer records at task start and end.
- Log completed work in organizer run/task notes with date and artifacts.
- Add a handoff record in organizer workspace before ending session if work is incomplete.

## Token Efficiency Rules
- Do not re-scan full repo unless required by task.
- Use organizer principles/decisions nodes plus ADR docs first.
- Read only files relevant to the claimed task.
- Add durable discoveries to organizer principles/decisions nodes, then reference there.

## Quality Rules
- No silent scope changes.
- Include acceptance criteria in each task.
- Record commands/tests run in handoff entries.
- If blocked, document blocker and exact next unblock step.
- For each major task, state pillar impact (Thinking space / Human+AI / Agent management).
- Default code pattern: lego-block primitives composed by orchestrators.
- New major screen orchestrators should follow `agents/TEMPLATES/ORCHESTRATOR_TEMPLATE.md`.
- Frontend placement rules are mandatory:
- Reusable primitives -> `frontend/src/components/lego_blocks/*` with `*Block` suffix.
- Flow containers -> `frontend/src/components/orchestrators/*` with `*Orch` suffix.
- Shared UI primitives -> `frontend/src/components/lego_blocks/ui/*`.
- Service placement rules are mandatory:
- Service primitives -> `frontend/src/services/lego_blocks/*` with `*Block` suffix.
- Service workflows -> `frontend/src/services/orchestrators/*` with `*Orch` suffix.
- UI should consume service workflows from `services/orchestrators` by default.
- Caution: orchestrators must stay thin. If orchestration files grow dense with reusable logic, extract to lego blocks/services/hooks.
- Git commits must use detailed messages describing scope, intent, and substantive changes.
- Commit body must be the exact final agent task output copied verbatim.
- Do not paraphrase, shorten, reorder, or restyle any part of that copied final output.
- Use `agents/TEMPLATES/COMMIT_MESSAGE_TEMPLATE.md`.
