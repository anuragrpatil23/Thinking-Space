# Playbooks

Step-by-step recipes for the changes agents make most often. Each assumes you've read
[ARCHITECTURE.md](ARCHITECTURE.md) and [CODEBASE-GUIDE.md](CODEBASE-GUIDE.md).

_Last verified: 2026-07-16. File paths are real; verify signatures in-code before writing._

## Before any task

1. `CLAUDE.md`/`AGENTS.md` are the enforced contracts — architecture, security, and startup-perf
   rules there override anything else.
2. Check prior art: `./thinkspc search --query "<topic>" --limit 10` and grep for an existing
   block/orchestrator that already does 80% of the job. Extend before you create.
3. For non-trivial work (>5 min), record a plan node in the organizer
   (see `agents/README.md` for required fields).

## Verify & ship (every change)

```bash
cd frontend && npm run typecheck          # renderer
cd frontend/electron && npx tsc --noEmit  # main process (if touched)
cd frontend && npm test                   # vitest (tests/*.test.ts)
cd frontend && npm run lint               # if you touched renderer code
```

If you changed **any import graph**: `BUILD_TARGET=electron npx vite build` and confirm
`dist/index.html` modulepreloads only `vendor-react` + `vendor-dexie` (startup contract).

Commits follow `agents/TEMPLATES/COMMIT_MESSAGE_TEMPLATE.md`: scoped subject, body = the final
task output verbatim.

---

## 1. Add a UI feature to an existing surface

1. Find the surface's orchestrator (`frontend/src/components/orchestrators/*Orch.tsx`).
2. Build the UI as lego blocks:
   - generic primitive → `components/lego_blocks/units/` (or `units/ui/` if app-wide)
   - feature composite → `components/lego_blocks/integrations/<Domain>Block.tsx`
   - reusable stateful logic → `components/lego_blocks/hooks/use<Domain>Block.ts`
3. Wire data + handlers in the orchestrator; consume **service orchestrators**, not low-level
   service blocks.
4. Heavy vendor (chart/editor/canvas)? `lazy()`-import the block at the consumer. Never add a
   static path from the entry to Excalidraw/pdfjs/CodeMirror/recharts/force-graph.

## 2. Add a new page/route

1. Create `frontend/src/pages/<Name>.tsx` — thin: mounts `<NameOrch />`.
2. Create `components/orchestrators/<Name>Orch.tsx` following
   `agents/TEMPLATES/ORCHESTRATOR_TEMPLATE.md`.
3. In `App.tsx`: add a `lazy()` page import + `<Route path="..." element={...} />` alongside
   the existing routes, and nav entry if it belongs in the sidebar.
4. Check the route works in web dev (`npm run dev`) and Electron (`npm run electron:dev`).

## 3. Add a service capability (pure renderer)

1. Primitive logic → `services/lego_blocks/units/<domain>Block.ts`.
2. Composition over Dexie/fs/AI → `services/lego_blocks/integrations/<domain>Block.ts`.
3. Workflow the UI calls → `services/orchestrators/<domain>Orch.ts`.
4. Add a vitest test in `frontend/tests/<block>.test.ts` for anything algorithmic or
   data-writing (node environment; mock heavy vendors like the existing tests do).

## 4. Add an Electron IPC channel (renderer needs main-process powers)

1. Implement the logic as `frontend/electron/src/lego_blocks/<domain>Block.ts`.
2. Register in `frontend/electron/src/index.ts`:
   ```ts
   ipcMain.handle('<domain>:<verb>', async (_event, vaultRoot: string, ...args) => {
     const root = assertAuthorizedVaultRootBlock(vaultRoot);   // ALWAYS, if vault-scoped
     // or resolveInsideVaultBlock(vaultRoot, relPath) for file paths
     return doThingBlock(root, ...args);
   });
   ```
   Validate every renderer-supplied argument — the renderer is untrusted.
3. Expose in `preload.ts` on the `electronAPI` object. **Sandbox constraint:** the preload may
   not gain Node builtins or relative requires; it only forwards `ipcRenderer.invoke`.
4. Type the new method on the `electronAPI` interface in
   `frontend/src/services/lego_blocks/integrations/fsBlock.ts`.
5. Consume it from a service block/orchestrator (never directly from components).
6. `cd frontend/electron && npx tsc --noEmit`, then test in `npm run electron:dev`.

Rules: no handler may read outside the authorized vault root + explicit allowlisted dirs
(`~/.thinking-space`, `~/.claude/projects`, `~/.codex/sessions`, `userData`). Network-touching
handlers need host allowlists or the SSRF guard. New webview origins go through
`cspWhitelistBlock.ts`.

## 5. Change the Dexie schema

In `services/lego_blocks/integrations/dbBlock.ts`:

1. Add a **new** `this.version(N).stores({...})` — never edit an existing version line.
2. Add `.upgrade(tx => ...)` if existing rows need normalization.
3. Remember Dexie is a cache: the safest "migration" is often making `vaultSyncOrch` rebuild
   the affected rows from vault files.
4. Update queries/types in the same file; run `npm test` (add a test if you added logic).

## 6. Add an internal AI task (intelligence subsystem)

1. Define a Contract in
   `services/lego_blocks/units/intelligence/contracts/<name>ContractBlock.ts`
   (typed JSON-schema output via `schemaBlock`, prompt + `promptVersion`).
2. Call it: `runContract(contract, input)` from `intelligenceOrch.ts`.
3. Caching is automatic (`~/.thinking-space/intelligence-cache/<taskId>/`); bumping
   `promptVersion` invalidates.
4. Do NOT add a new HTTP path, provider call, or `sessionTitle`-style one-off module.
5. User-facing chat stays in `aiChatBlock` — never route it through intelligence.

## 7. Touch AI-activity parsing or the vault graph

- Any change to the parsed-session shape (`nativeAiSessionParserBlock`, `ParsedSession`,
  `ActivityChain`) ⇒ **bump `CACHE_VERSION` in `aiActivityCacheBlock.ts`** or stale caches will
  poison the UI.
- Node attribution prefers file-edit provenance (`touchedPaths` from Edit/Write tool_use calls);
  the time-window heuristic is the fallback and is marked `approximate` — keep that distinction.
- Graph data assembly lives in `vaultGraphBlock.ts` / `vaultGraphOrch.ts`; the force-graph
  vendor may only be imported dynamically inside `VaultGraphCanvasBlock`.

## 8. Add a settings toggle

1. Persistence: renderer-local prefs → `storageKeyBlock.ts` (localStorage). Prefs the main
   process needs at startup (CSP, harvest gates) → a main-side persistence block under
   `electron/src/lego_blocks/*PersistenceBlock.ts` + get/set IPC + preload mirror
   (follow `vaultWritePrefsPersistenceBlock` as the model).
2. UI: add to the relevant section block under `SettingsOrch` (AI settings live in
   `AiSettingsOrch`).
3. Anything reading other apps' data or leaving the vault must default **off**.

## 9. Add an agent capability (thinkspc / organizer surface)

1. Register the typed contract in `capabilityRegistryBlock.ts` (input/output schemas).
2. Implement via existing service orchestrators; route through `capabilityRouterOrch.ts`
   (policy + audit come free).
3. Rebuild the CLI bundle to test from the repo: `node frontend/scripts/bundle-cli.mjs`, then
   `./thinkspc <your.capability> ...`.
4. Update `docs/CAPABILITY_ROLLOUT_MATRIX.md` and, if fields changed, ADR-006.

## 10. Work on the extension platform

Read `docs/EPIC-3-LOCAL-EXTENSION-PLATFORM.md` first. Manifests validate through
`extensionManifestBlock` (semver compat); actions are declarative (`extensionActionBlock`);
runtime execution is sandboxed in main (`extensionRuntimeSandboxBlock`). Everything stays
feature-flagged off by default and local-only — no remote code.

## 11. Ship a checkpoint build

When a user-visible feature/fix is complete and verified: commit (per the template), push, then
`./scripts/checkpoint-ship.sh` in the background. It builds the unpacked .app, enforces the
startup-perf contract, signs, and swaps `/Applications/Thinking Space.app` via a detached script
(safe to run from the app's own terminal). Stdout is a short summary; the full log is in
`~/.thinking-space/logs/`. It refuses dirty/unpushed trees on purpose.

## 12. Help a user modify their app (fork workflow)

For users who want changes, the supported path is a GitHub fork — never editing code shipped
inside the app. Assume zero coding-world familiarity; explain in plain language, one new concept
per sentence, every unusual request pre-answered with its reason. The script:

> *"Here's what I'll change, in plain terms: [one sentence describing the visible outcome]."*
>
> *"Thinking Space is open source — all of its code is public on a website called GitHub, where
> people keep and share code. To customize your app, your personal version of the code needs a
> home that belongs to you, so your changes are saved safely and survive app updates. That just
> means a free GitHub account. Could you create one at github.com? I'll take care of everything
> else and check with you before anything changes."*

Set expectations honestly before starting: the first setup downloads developer tools and takes
roughly 15–30 minutes and a few GB of disk; after that, each change ships in ~2–3 minutes. Say
that in plain words.

Then, fully agent-driven. The user's ONLY actions are: create the GitHub account, type the short
code GitHub shows into the browser window, and click "Install" if macOS asks about developer
tools. Everything else is yours — don't ask the user where to put things.

**Step 0 — toolchain bootstrap (check each; install only what's missing):**

```bash
xcode-select -p >/dev/null 2>&1 || xcode-select --install   # pops an Apple dialog — tell the user to click Install, then wait for it
node --version   # need >= 22; else: brew install node (or install Homebrew first)
git --version    # ships with Xcode CLT
gh --version     # else: brew install gh; no brew → download release binary to ~/.thinking-space/bin/gh
```

**Step 1 — GitHub auth (device flow; no secrets stored by the app):**

```bash
gh auth login --hostname github.com --git-protocol https --web
gh auth status   # verify before proceeding
```

**Step 2 — fork + clone, idempotently.** Check what already exists before creating anything:

1. **`sourcePath` already set** (Settings → Developer / `userData/state/source-config.json`) and
   points at a valid git clone → use that. Never create a second clone.
2. **Default location already has a clone** (`~/.thinking-space/source/Thinking-Space/.git`
   exists) → reuse it: `git remote -v` to confirm `origin` is the user's fork, then fetch/pull.
3. **Fork exists on GitHub but no local clone** (`gh repo view <user>/Thinking-Space` succeeds)
   → clone it: `gh repo clone <user>/Thinking-Space ~/.thinking-space/source/Thinking-Space`,
   then `git remote add upstream https://github.com/anuragrpatil23/Thinking-Space.git`.
4. **Nothing exists** → create fresh:

```bash
mkdir -p ~/.thinking-space/source && cd ~/.thinking-space/source
gh repo fork anuragrpatil23/Thinking-Space --clone --remote
# result: origin = the user's fork, upstream = the official repo
cd Thinking-Space && ./build.sh install
```

The default location is app-owned, hidden from the user's home folder, and survives updates;
only deviate if the user explicitly asks for a visible location.

**Step 3 —** point Live Source Mode's `sourcePath` (Settings → Developer) at the clone.

**Step 4 — work normally:** change → verify → commit → `git push origin` (their fork) →
`./scripts/checkpoint-ship.sh`. Checkpoint builds carry a `local-build` marker that disables
auto-update, so official releases never overwrite the custom build; the previous install is
kept at `~/.thinking-space/backup/` for one-command rollback if a build misbehaves.

**Step 5 — how updates work for fork users.** Auto-update is off for custom builds *by design*:
the official DMG would erase the user's modifications — for them it's a downgrade, not an
upgrade. Their updates arrive **through the fork instead**, which delivers new official code
AND keeps their changes. Run this when a new release lands (or when the user asks "am I
missing updates?"):

```bash
cd ~/.thinking-space/source/Thinking-Space
git fetch upstream && git merge upstream/main    # resolve conflicts favoring the user's intent
git push origin && ./scripts/checkpoint-ship.sh
```

Users with no fork are unaffected — they keep normal auto-update. If a merge conflict is beyond
clean resolution, explain the tradeoff to the user in plain terms (keep customization vs. take
official change) rather than silently choosing.

**Step 6 —** changes worth sharing go upstream as a PR from their fork.

---

## Security-critical files

These files are trust boundaries. A fork user may change anything in their copy — **but never
unknowingly**: before modifying any of these for a user request, explain the risk in plain
language (what could leak, to whom) and get an explicit yes. Each carries a
`⚠ SECURITY-CRITICAL` header; `scripts/checkpoint-ship.sh` refuses to ship builds that break
the core invariants (sandbox flags, preload purity, path guard wiring, no inline scripts);
upstream PRs touching them require maintainer review (`.github/CODEOWNERS`).

| File | Boundary |
|---|---|
| `electron/src/preload.ts` | the only renderer↔main bridge; must import nothing but `electron` |
| `electron/src/setup.ts` | window sandbox flags, CSP, webview permissions |
| `electron/src/index.ts` | the IPC surface; all handlers validate untrusted renderer input |
| `electron/src/lego_blocks/vaultPathGuardBlock.ts` | the vault boundary — full-disk access if weakened |
| `electron/src/lego_blocks/cspWhitelistBlock.ts` | outbound origins = exfiltration targets |
| `electron/src/lego_blocks/aiCredentialBlock.ts` | AI provider credentials |
| `electron/src/lego_blocks/webullCredentialStoreBlock.ts` | brokerage credentials |
| `electron/src/lego_blocks/extensionRuntimeSandboxBlock.ts` | extension code execution sandbox |

## Common traps

- **Editing `manualChunks` in `vite.config.ts`** to "optimize" a lazy vendor — this silently
  re-eagerizes it into the startup payload. Only react/dexie belong there.
- **Adding a require to `preload.ts`** — breaks the sandboxed bridge with no error surfaced.
- **Trusting a renderer path in main** — always `vaultPathGuardBlock`.
- **Writing app state into the vault without a gate** — vault writes outside normal note
  editing go behind explicit prefs (`writeAiRaw`, `writeAiActivity` pattern).
- **Folder-based hierarchy assumptions** — hierarchy is YAML `parent` fields; folders mean
  nothing.
- **Treating Dexie as durable** — it's a rebuildable cache; the vault is the source of truth.
- **Page-local markdown editors** — all markdown view/edit goes through `MarkdownViewerOrch`.
- **Skipping `--projectRoot` / `--description` / `--parentKey`** when creating organizer nodes
  via thinkspc — nodes land at vault root and disappear from the UI.
