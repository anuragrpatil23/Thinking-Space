# Code Architecture Contract (Enforced)

Code architecture follows lego blocks + orchestrators: reusable primitives in components/hooks/services, page/feature orchestration in orchestrator containers.

## Design Philosophy

- Use lego blocks: small reusable primitives for UI, hooks, and services.
- Use orchestrators: page/feature containers that compose primitives and own flow/state wiring.
- Keep primitives generic and prop-driven; avoid feature-specific branching inside shared components.
- Keep data loading, derived selectors, and orchestration handlers in orchestrators.
- If logic or UI is duplicated twice, extract or extend a shared primitive before adding a third copy.
- Do not add one-off editors, viewers, or modals when a shared component can be extended safely.
- Caution: keep orchestrators thin. If an orchestrator starts accumulating reusable domain logic, parsing, or complex transformation code, extract that into lego blocks (components/services/hooks) immediately.

## Data Guardrails

- Keep markdown files with YAML frontmatter as portable source-of-truth content.
- Hierarchy is defined by YAML `parent`/`type`/`level` fields, NOT folder structure.
- IndexedDB is a pure cache layer — can be rebuilt from YAML files at any time.
- Reparent by updating YAML `parent` fields in affected files + syncing IndexedDB.
- Add conflict-safe saves for thought editing (`mtime`/hash checks).
- Avoid destructive migrations without rollback/recovery path.
- No backend dependency for core features.

## Frontend Architecture Contract

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
- If an exception is unavoidable, document it in `CLAUDE.md` and in this file in the same change.
- Caution: keep UI orchestrators thin. Extract reusable logic and heavy transformations into lego blocks/hooks/services before orchestrator complexity grows.

## Service Architecture Contract

- Low-level reusable service primitives must live in `frontend/src/services/lego_blocks/units/*`.
- Composite reusable service lego blocks must live in `frontend/src/services/lego_blocks/integrations/*`.
- Workflow service composition must live in `frontend/src/services/orchestrators/*`.
- `frontend/src/personal_extension/services/*` is allowed for personal-only first-party code when it mirrors the same architecture:
  - `lego_blocks/{units,integrations}`
  - `orchestrators`
- Naming is mandatory:
  - Service primitive and integration files use `*Block` suffix.
  - Service workflow files use `*Orch` suffix.
- UI code should consume service orchestrators by default, not low-level service primitives. Direct imports from `services/lego_blocks/{units,integrations}` in UI are only allowed for shared type-only usage.
- Caution: keep service orchestrators thin. Move shared algorithms, scanners, adapters, and transformation logic into service lego blocks.

## Orchestrator Template Rule

- New major screen-level orchestrators should follow `agents/TEMPLATES/ORCHESTRATOR_TEMPLATE.md`.
- Keep section order consistent so agents can scan and modify code quickly.
- If an orchestrator intentionally deviates, document why at the top of the file.

## Architecture Review Checklist (required for frontend changes)

1. Did I place reusable logic in `lego_blocks/{units,integrations,hooks}` and flow wiring in `orchestrators`?
2. Did I keep naming consistent with `*Block` and `*Orch`?
3. Did I avoid page-local one-off variants of existing shared components?
4. Did I update docs (`CLAUDE.md` and the relevant `docs/` file) if architecture knowledge changed?
