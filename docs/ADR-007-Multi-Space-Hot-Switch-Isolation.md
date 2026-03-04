# ADR-007: Multi Thinking Space Hot-Switch and Per-Space State Isolation

Status: Accepted  
Date: 2026-03-03

## Context

Thinking Space currently assumes a single active vault root per app session:
- `ltm-vault-root` is stored globally.
- `getVaultFS()` returns a singleton bound to one root.
- IndexedDB cache uses a single database name (`ThinkingSpaceDB`).
- Many UI/service settings are stored in global localStorage keys.
- Switching Thinking Space in `App.tsx` sets `needsVaultSetup` and triggers `window.location.reload()`.

This behavior prevents true multi-space usage and causes cross-space leakage risk for cache/state/settings.

## Pillar Impact

1. Thinking space for individuals
- Users can move between personal/work/research spaces instantly without losing app context.

2. Place where humans and AI work together
- AI history/settings/actions remain scoped to the correct space, preventing accidental cross-space context bleed.

3. AI agent management space for humans
- Agent tasks/runs/handoffs can be isolated by space while still managed from one runtime session.

## Decision

Adopt a no-reload hot-switch architecture with strict per-space isolation as the implementation contract for `TS-HS-001` through `TS-HS-008`.

### 1) Active Space Identity Model

Introduce a canonical `SpaceSession` model:
- `spaceId`: deterministic ID derived from runtime + normalized root marker.
- `spaceRoot`: selected root marker/path (`/abs/path`, `cap-picker:*`, `browser-fs`, `web-backend`).
- `runtime`: `electron | ios | android | web`.
- `switchEpoch`: monotonic number incremented for each switch to invalidate stale async work.
- `status`: `ready | switching | error`.

`spaceId` is the namespace key for every stateful layer.

### 2) Isolation Boundaries (Mandatory)

All stateful storage must be scoped by `spaceId` or explicitly global:

- IndexedDB:
  - Current: `ThinkingSpaceDB` (shared)
  - Contract: `ThinkingSpaceDB::<spaceId>` (or equivalent deterministic namespace)
- Local storage settings:
  - Current: global keys (for example `ltm-app-shell-tabs`)
  - Contract: `ltm.space.<spaceId>.<key>`
  - Global allowlist only for bootstrap metadata (for example last-selected space pointer and known-space registry)
- In-memory module caches:
  - Must be keyed by `spaceId` or cleared on switch
  - No singleton cache may survive switch without namespace checks
- Runtime adapters/singletons:
  - `VaultFS` resolution must be session-scoped, not globally sticky across spaces
- Event bus/custom events:
  - Events that mutate/read state must include space context or be dispatched from active session scope only

### 3) Hot-Switch Lifecycle (No Reload)

Switch flow must be atomic and cancellable:

1. Validate target space and build target `SpaceSession`.
2. Enter `switching` state and freeze mutation surfaces.
3. Increment `switchEpoch` and cancel/ignore in-flight operations from previous epoch.
4. Swap active `SpaceSession` in one committed state update.
5. Rebind runtime dependencies (FS, cache handles, orchestrator selectors) to target `spaceId`.
6. Ensure target cache availability (smart sync/rebuild policy by freshness).
7. Re-resolve active route/tab safety for target space.
8. Exit `switching` state and resume UI interactions.

`window.location.reload()` is disallowed in the switch path.

### 4) Route and Tab Safety

Tabs/routes are scoped by space:
- Tab state persistence key includes `spaceId`.
- Route payloads that reference file/project roots are validated after switch.
- Invalid route context falls back to safe landing route (`/thinking-space` or configured default).
- Cross-space route carryover is not permitted.

### 5) Service and Settings Scope

Services that currently read global vault root or global storage must shift to session-aware resolution. This includes, at minimum:
- vault sync/cache orchestration
- markdown document read caches
- AI prompt history/cache
- organizer UI state persistence
- git sync metadata
- auth/credential caches where they are intended to be space-specific

If a setting is intentionally global, it must be documented as global in code comments and ADR notes.

## Implementation Contract by Task

- `TS-HS-001`: this ADR and invariants.
- `TS-HS-002`: storage key schema + migration plan to space namespace.
- `TS-HS-003`: runtime session orchestrator + no-reload switch pipeline.
- `TS-HS-004`: IndexedDB/cache namespacing and cache lifecycle.
- `TS-HS-005`: Thinking Space manager/switcher UI bound to session model.
- `TS-HS-006`: tab/route safety enforcement on switch.
- `TS-HS-007`: service-level namespace adoption and scoped settings.
- `TS-HS-008`: test matrix, rollout gates, docs, and migration validation.

## Invariants (Must Hold)

1. No cross-space read/write leakage for cache, tabs, or scoped settings.
2. Active space switch does not trigger full page reload.
3. All YAML source-of-truth guardrails remain unchanged.
4. IndexedDB remains rebuildable cache; namespace separation does not change source-of-truth model.
5. Switching failure is recoverable without data loss and without destructive cache migration.

## Migration Strategy

- Preserve backward compatibility for existing single-space users:
  - Treat current root as initial default `spaceId`.
  - On first run after migration, move or rehydrate global state into namespaced keys.
- Prefer lazy migration:
  - Migrate a key on first access for a space, not via one destructive bulk conversion.
- Keep rollback path:
  - If namespaced state is missing/corrupt, rebuild from YAML and default-safe settings.

## Validation Matrix and Rollout Gates (Required Before Rollout)

- Switch `A -> B -> A` without reload and without stale data flash.
- Concurrent sync/write operations from prior space are cancelled or ignored after epoch change.
- Tab state, organizer state, and editor state remain isolated by `spaceId`.
- IndexedDB instances remain independent per space and can be rebuilt independently.
- Failure injection during switch leaves both source and target spaces consistent.

Rollout gates:
1. Unit/integration validation passes:
   - `npm --prefix frontend run test -- tests/spaceRegistryOrch.test.ts tests/spaceRouteSafetyBlock.test.ts tests/storageKeyBlock.test.ts tests/vaultSyncOrch.test.ts tests/markdownDocumentsOrch.test.ts`
2. Production build validation passes:
   - `npm --prefix frontend run build`
3. Manual smoke matrix passes in Electron and Web runtimes:
   - register at least two spaces
   - switch from Settings between registered spaces with no reload
   - verify stale `thinking-space?file=...` route is sanitized per target space
   - verify stale organizer `projectRoot` URL is sanitized per target space
   - verify explorer/tab/new-thought recents persist independently per space

## Consequences

Positive:
- True multi-space workflow in one runtime session.
- Stronger privacy and correctness boundaries between contexts.
- Better foundation for future optional remote/agent backend multiplexing.

Tradeoffs:
- More explicit state plumbing across services/orchestrators.
- Additional migration/test complexity for existing global storage usage.

## Non-Goals

- Changing YAML source-of-truth schema for hierarchy.
- Introducing backend dependency for core switch behavior.
- Enabling remote code execution or relaxing extension permission model.
