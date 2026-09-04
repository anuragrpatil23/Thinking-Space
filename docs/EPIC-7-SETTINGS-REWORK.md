# EPIC-7 Settings Rework

Status: planned (2026-09-04). Supersedes nothing; no code written yet.

The settings surface works — every capability is reachable if you know where to look —
but it is the least usable area of the app. This doc records why, in evidence, and the
plan to fix it. It is written to be read cold by a session with no prior context.

## Pillar Impact

- **Pillar 1 (individual thinking)** — folder colors, explorer config and site lists stop
  being typed by hand in a remote pane and become in-context actions where the thing lives.
- **Pillar 2 (humans + AI together)** — one project identity spans explorer, graphs, activity
  and attribution instead of four hand-maintained parallel tables.
- **Pillar 3 (agent management)** — attribution evidence moves next to the definition it
  explains; out-of-vault work (code checkouts, per-machine session stores) becomes a
  first-class, visibly-scoped case rather than an unlabelled edge.

## Three Root Causes

Everything below is downstream of these. Fixing symptoms individually has been tried
(the panes are individually well-commented) and does not converge.

### 1. There is no data model for a setting

`SettingsOrch.tsx` is a 19-branch `activeTab === 'x' &&` chain (`:1128`–`:2233`) over a
union of 19 string literals. A setting is not a value in this codebase; it is JSX at a line
number. Consequences, all of which are the same missing abstraction:

- No search over 58 setting groups.
- No deep links — `Settings.tsx:40-62` is a hand-written 11-branch ternary mapping query
  strings to tab ids, with a legacy `activity` → `ai_activity` alias baked in.
- No "modified from default", no per-section reset, no dirty guard.
- Phone list/detail (`SettingsOrch.tsx:404-428`) re-derives navigation from the same
  hardcoded `TAB_GROUPS`, so every structural change is made twice.
- Dead ids cannot be retired: `busyAction` is typed `SettingsTabId`, which still contains
  `'activity'` after that tab folded into `ai_activity` (see the comment at `:139`). Tab id,
  pane id, busy key and storage scope are one string.
- **Roaming is a hand-maintained `Set` of 5 keys** (see Sync, below) because there is
  nowhere to declare scope.

### 2. Settings hosts records and content, not just preferences

Roughly 20 real preferences. The bulk is record management — Projects (524 lines),
Workspace Profiles (359), AI-activity project mapping (424), session sources (292), RSS
feeds + groups, web bookmarks + groups, AI websites, scheduler tasks, moon-scene messages,
explorer color rules — rendered through a chrome of **three** components
(`SettingsGroupBlock.tsx`, 122 lines: `SettingsSectionHeaderBlock`, `SettingsGroupBlock`,
`SettingsRowBlock`) whose own header comment states the intent: *"one row per setting,
control right-aligned on the same line as its label."*

The system has one noun. That is the flatness — not spacing.

**Correction to an earlier reading:** this is *not* a "second source of truth" problem.
`.thinking-space/projects.json` is vault-stored, portable, and deliberately migrated off a
hardcoded personal path; its `projects.md` sibling is a generated mirror, written
best-effort after the JSON, skipped when unchanged (`projectsStorageBlock.ts:147,159`).
That design is sound. The one genuine content-as-config case is `profile.memories`.

### 3. Features live in Settings because they have no in-context home

To color a folder you must leave the explorer, open Settings, type the path from memory,
pick a colour from the macOS system panel, tick a box, press Save, navigate back and look.
`VaultExplorerBlock.tsx` has a full context menu and no "Color…" item.

Same shape for project `roots` (a textarea of vault-relative paths), activity ignored
paths, and adding a feed or site. **Settings is where a feature goes when nobody built the
affordance where it applies.**

## Findings Inventory

Evidence gathered 2026-09-04. Keep this section; it is the durable part.

### Save models — four, chosen by plumbing not design

| Model | Examples |
|---|---|
| Instant apply | theme, colour mode, markdown switches, dev flags |
| Draft + one Save at pane bottom | explorer rules, scheduler, profile, file activity |
| Per-field Save button | Google client id, Webull path / tab / credentials |
| Inline edit with Save/Cancel | `NativeRootRow` in `AiActivitySessionSourcesSettingsBlock` |

The split is **not** a risk judgement. Prop-owned settings sync into a draft via `useEffect`
(`SettingsOrch.tsx:499-502` scheduler, `:534-537` explorer), which forces a dirty flag,
which forces a Save button. Self-read settings write straight through
(`updateMarkdownEditorSettings`, `:657`). `Settings.tsx` passes 12 props while the
orchestrator reads a dozen other prefs itself, with no principle separating the two.

Tell: the copy at `:1024` — *"Legacy explorer color preset loaded. Save Explorer Settings to
persist."* The UI explains its own save semantics in prose.

### Feedback

`SettingsOrch` renders one global `message`/`error` pair at `:2278-2279`, **after all 19
panes**, so save confirmations land below the fold on any long pane and never clear on tab
change. `AiSettingsOrch:376-377` renders its own pair at the **top** of its pane, in emerald
rather than muted. Two placements, two colours, one concept. `busyAction` is a single global
`SettingsTabId`, so two sections cannot be busy at once.

### Per-pane

**Select Thinking Space** (`:2205-2224`) — never shows the current space, though
`getStoredVaultRoot()` (`storageKeyBlock.ts:163`) is one call away. Five names for one
action (nav "Select", title "Select", row "Switch", button "Open Selector", confirm "folder
selector"). A group heading over a group of one. `SettingsRowBlock`'s `max-w-[600px]` text
column plus a right-pushed control makes the description wrap *and* leaves a ~200px gap.
Filled/primary button for an action that reloads the whole app, then a `window.confirm`.
Copy explains what does *not* happen. Header interpolates `runtimeLabel` → "this desktop
runtime". **Duplicates the pane below it**: `WorkspaceProfileBlock`
(`profileContextBlock.ts:5-14`) already owns `vaultRoot` alongside name/icon/accent.

**Profile** (`:1753-1846`) — `name` is read by exactly one consumer
(`HomeWelcomeBlock.tsx:56`). `symbol` is rendered **nowhere** (grepped; the only `.symbol`
hits are Webull tickers). `memories` has **no reader at all**, and no AI path in the app
injects user context — `aiAssistOrch` has no profile reference; the only prompt construction
in the tree is the extension builder; there is no `CLAUDE.md`/`AGENTS.md` reference in the
frontend. The identity editor is duplicated in `VaultSetupOrch.tsx:30-51,165-182`. Disabled
filled Save reads as less clickable than the outline "Reload from Thinking Space" beside it.
Name collision with "Thinking Space Profiles" — both have a name and a visual token, and the
one with no visible effect is called Profile.

**Explorer** (`:1296-1428`) — three save models on one pane; the button says "Save Explorer
Settings" and saves only the rules; two different "Reset" buttons. "Selected item color" is
app-wide accent (its own description names the RSS row, the editor caret and text selection)
filed here because the storage key is `explorerSelectedColor`. Ten rules × four columns
rendered as `SettingsRowBlock stacked`, so "Descendants" and "Remove" each print ten times
for want of a column header. No normalization on write (`normalizeExplorerFolderPathInput`
at `:180` is used only for the dedup key), so a trailing slash yields a selector that matches
nothing, silently. No match count, no preview. **Precedence is CSS source order** —
`buildExplorerFolderColorCssBlock` (`App.tsx:467-485`) emits equal-specificity selectors in
array order, so the last rule added wins; latent today because parents have descendants off.
Raw hex applied identically in both themes. "Load Legacy Preset" ships one person's folder
structure (`DEFAULT_EXPLORER_FOLDER_COLOR_PRESET_BLOCK`).

**AI Activity** — the **reference implementation**. Read the header comment on
`AiActivityProjectMappingSettingsBlock.tsx:1-13`: definition lives in Projects, this page
shows what the definition did, the only write hands folders to the real registry, legacy
rules are labelled legacy. Problems: ~13 concerns in one pane (sources, harvest, vault
writes, diagnosis, legacy rules, 7 view toggles, plus *file* activity which is not AI);
the diagnosis surface is below three config groups; the two vault-write toggles create files
in the user's vault indefinitely and are styled as ordinary switches with no footprint
readout; **the app coordinates with itself through a textarea** — it writes
`ai-activity/raw-sessions/` and asks the user to type those prefixes back in so it can read
them; scope is prose in one group and absent in the others. **No dismiss action**: a detected
row offers only "Make this a project", so the list only grows — against the Assignment
contract's *every session gets a disposition*.

**AI Websites / Web** — the same feature twice.
`AiWebsiteBlock {id,name,url,partition}` vs `WebSiteBlock {id,name,url,partition,groupId}`.
358 lines of parallel service code, two storage keys, two panes, two tabs, for one field.
Both descriptions share a verbatim sentence. The boundary already leaked — Web has a group
named "Codex". Multi-account is the stated primary use case and the answer is "duplicate the
row and name it yourself" (Grok - F9 / Grok - UT / Gmail - F9 / Gmail - UT). Groups carry
three dimensions at once: project (F9 Websites, sfdl), kind (Mail, Codex), state (Archive).
**URL editing exists in the service and not the UI** — `updateAiWebsiteOrch` and
`updateWebSiteOrch` both accept `url`, the UI offers only Rename, and `partition` is set once
at creation, so fixing a typo by remove-and-re-add destroys the login session. No favicons,
no search, Rename/Remove printed on every row.

**Scheduler** — `SCHEDULED_TASK_ACTION_OPTIONS_BLOCK`
(`schedulerSettingsBlock.ts:30-36`) has exactly **one** entry, `vault_sync`. A generic task
registry, sanitization and per-task last-attempt storage for one job, given a nav item, a
pane, a group heading and a Save/Reset pair. Its own description says it refreshes the
IndexedDB cache — the same subject as **Index & Cache**, in a different nav group.
`schedulerTaskLastAttemptById` is stored and never displayed, so the pane shows next-run (a
calculation) and hides last-run (the evidence), for a job that only runs while the app is open.

### Visual

- **A forked control system.** `ProjectsSettingsBlock.tsx:102-109` defines private
  `FIELD_CLASS` (h-9, `text-sm`), `LABEL_CLASS` (11px muted), `HINT_CLASS` while
  `SettingsGroupBlock.tsx:121` exports `SETTINGS_CONTROL_CLASS_BLOCK` (h-8, 13px) and
  `SettingsRowBlock` renders labels at 13px foreground. Two definitions of "input" and
  "label", visible on one screen. It is the only block that forked.
- **Not a type scale.** 10/11/12/13/15/19 as arbitrary values, plus `text-sm`/`text-xs` from
  the fork — two vocabularies that don't align (14 exists in one and not the other). Pane
  title 19 → group heading 11 is an 8px cliff with nothing between; label/body/hint/footnote
  are crushed into 11–13, so hierarchy is carried by colour.
- **No focus vocabulary.** `index.css` has no global `:focus-visible` rule (only two
  context-menu rules). `ProjectsSettingsBlock.tsx:456` is a `<button>` with no focus style,
  so it falls through to the UA ring painted in the **macOS system accent** — the amber
  outline in the screenshots is not from the app palette.
- **The user-chosen accent is unused in Settings.** `--ltm-explorer-selected-color`
  (default `#c73773`) drives editor selection, explorer selection and the RSS list, and
  appears nowhere on the screen where it is chosen.
- **Sidebar throws away an affordance it has.** `SidebarNavRowBlock` accepts `icon` and
  `trailing` (its doc: *"a count, a current setting"*). `SettingsOrch.tsx:1108-1114` passes
  neither — 19 identical grey text rows, the only nav in the app without icons.
- **The pane floats.** `SETTINGS_PANE_WIDTH_BLOCK` is `mx-auto max-w-[880px]` inside a
  container that is already padded and flex-1, so content centres away from the 258px
  sidebar and leaves a gutter belonging to nothing.
- **Destructive actions use `window.confirm`** (`:599, :615, :636, :659`).
- **Empty states are rows.** `ProjectsSettingsBlock:433-441` renders "Loading projects…" and
  "No projects yet." as `SettingsRowBlock label=`.

### Cross-device sync

Mechanism is locked in `contracts/IOS-NATIVE-CHROME.md:34-37`: `ui.json` via
`vaultUiPreferencesOrch` (typed, normalized, read-merge-write), startup pull through the
public setters, debounced write-through push via `registerStorageWriteListenerBlock`;
`profile.json` roams separately and predates it.

Defects found:

1. **A failed read silently overwrites everything with defaults.**
   `readVaultUiPreferencesOrch` catches *all* errors and returns
   `createDefaultVaultUiPreferencesBlock()`. `updateVaultUiPreferencesOrch` then does
   `{ ...current, ...partial }` and writes. One transient read failure plus one toggle
   replaces the whole preferences file. The read can fail for ordinary reasons on iOS
   (undownloaded iCloud placeholder, read during a sync write, cold launch). **This is the
   same failure already fixed for `profile.json`** via the `isDefaultUserProfileBlock`
   guard the contract describes; `ui.json` has no equivalent.
2. **Pull runs once, at startup.** `initAiActivityPrefsRoamingOrch` is called from
   `App.tsx:1995` and there is no watcher on `ui.json`. A device that never pulls can
   read-modify-write a stale file and silently revert the other device's change — outcome
   depends on iCloud latency vs. when you next touch an unrelated toggle. This is the jank.
3. **Whole-file read-modify-write with no version.** No timestamps, no revision, no
   per-field mtime, so two divergent copies cannot be merged — only taken wholesale. iCloud
   conflict copies (`ui 2.json`) are neither read nor reported, against the Derivation
   contract's *derived layers fail loudly*.
4. **Pushes reassert stale state.** `scheduleAiActivityPrefsPushOrch` writes the full
   5-value `snapshotLocalAiActivityPrefsOrch()`, not the field that changed.
5. **The roaming boundary is a hand-maintained `Set`** of 5 of the 11 `aiActivity*` keys.
   The exclusions in the contract are correct calls (Electron-only CLI, per-profile nav
   rail, per-machine paths) but live as prose plus a `Set` three files from the settings
   they govern.
6. **Two files, two mechanisms, one concept** — which is why one got the clobber guard.

## Target Model

### A. Settings schema (the keystone)

One declarative registry. Each entry:

```ts
{
  id: 'explorer.selectedColor',        // stable; also the deep link
  title, description, section,
  kind: 'toggle'|'choice'|'text'|'path'|'secret'|'recordList'|'action'|'status',
  scope: 'device' | 'space' | 'keychain',
  scopeReason?: string,                // renders as the badge tooltip
  availability?: (rt) => boolean,      // replaces scattered isElectron()/nativeRuntime
  read, write, default, keywords,
}
```

Derived for free, each ~20 lines against the registry instead of a per-pane retrofit:
search, deep links (deletes the `Settings.tsx` ternary ladder), modified-from-default,
per-section reset, dirty tracking + navigation guard, scope badges, status probes, and the
phone list/detail rendered from one source. Also satisfies `CODE-ARCHITECTURE.md`'s
*keep orchestrators thin* — the 2,946-line orchestrator is the clearest violation in the repo.

**`scope` in the schema is what makes sync correct** (below). It is not only a UI concern.

### B. Primitive vocabulary

Today three components. Add, each small:

```
SettingsRowBlock          keep; tighten to the compact tier
SettingsChoiceRowBlock    segmented control for <=4 options (kills the <select> column)
SettingsPathRowBlock      mono display + Browse… + validity tick + match count
SettingsSecretRowBlock    masked, shows a hint (sk-ant-…4f2), never the value
SettingsActionRowBlock    button-led; danger variant tints the zone
SettingsStatusRowBlock    dot + state + timestamp, tabular-nums
SettingsRecordListBlock   list + detail; the record surfaces stop being rows
SettingsTableBlock        column headers once, not per-row labels
SettingsEmptyBlock        centred, one line + one action — not a row
SettingsScopeBadgeBlock   this device / your space / keychain
```

### C. Tokens

Six named type steps, no arbitrary values, one vocabulary:

```
title    20/600/-0.02em     section  13/600/-0.01em    label  13/500
body     12.5/400           meta     11/500/0.06em     mono   12/400
```

The load-bearing change: **group headings stop being 11px uppercase micro-caps and become
13px semibold sentence case.** Micro-caps are a label style; using them as headings is what
collapsed the hierarchy. Caps demote to `meta`.

Density in three tiers: `compact py-2.5` (toggles), `default py-3.5` (with description),
`expanded py-4` (record editors, diagnostics).

Colour roles the palette lacks: **Accent** = `--ltm-explorer-selected-color` for focus rings,
active state and modified-from-default; **Selection** = `bg-foreground` (keep — app-wide and
documented); **Danger** = tinted zone, not red text; **Status** = green/amber/grey, probes only.

### D. Scope and provenance (the signature)

Every row carries a mark: `▪ this device` / `◈ your space` / `⚿ keychain`. One
**"What travels"** view lists the space-scoped set, names the backing file, and shows the
last sync. Clear-cache's dialog enumerates exactly what it will reset — today it silently
wipes theme, feeds, bookmarks, Drive token and provider defaults while saying only *"Clear
local cache and reload the app now?"*.

No other app's settings screen has to answer *"does this follow me to my iPhone?"*, because
no other app's preferences are half a portable markdown vault and half `localStorage`.

### E. Projects as the folder→meaning table

Six folder-path lists exist; one has structure:

| List | Storage | Structured |
|---|---|---|
| Project `roots` | `.thinking-space/projects.json` | yes — named, grouped, aliased, coloured |
| Explorer colour rules | vault UI prefs | free text |
| File activity ignored paths | `fileActivityIgnoredPaths` | free text |
| AI activity vault source prefixes | `aiActivityVaultSourcePrefixes` | free text |
| Vault sync excluded prefixes | `vaultSyncExcludedPrefixes` | free text |
| Webull execution + sim folders | `webullExecutionSettings` | free text |

The user's own data shows the duplication: explorer rules re-type the registry
(`acceleration_core/F9` is both a rule and a project root; the parentless rules are the
project *groups*), and Web groups are named after projects ("F9 Websites", "sfdl").

Two layers:

- **Project level** — the default for its roots: colour, kind, and per-folder behaviour
  (track activity / include in sync / source for AI sessions).
- **Folder level** — override in the explorer context menu, showing what is inherited.

Project colour already drives `VaultGraphOrch`, `SessionGraphSlideOverBlock` and
`PathGraphSlideOverBlock`. Framing: **the colour belongs to the project, and each surface
expresses it where it can** — the file tree for in-vault roots, graphs and activity for
everything else. Not every folder is a project (`.trash`, attachments, archive), so the
folder layer is load-bearing, not garnish.

**Native session stores stay independent.** A project's `roots` are where work happens; a
session store is where a tool logs. Different axes.

### F. Out-of-vault work is normal, not an edge case

Detected projects show `Thinking-Space` at `/Volumes/…/PersonalGit/Thinking-Space` (a repo)
beside `F9` inside the vault. Agents run in repos; a tool that only sees the notes folder
cannot do pillar 3.

Consequence: **source reachability never leaves the settings block** — `getNativeAiSessionRoots`
and `rootsUnavailable` are used only by `AiActivitySessionSourcesSettingsBlock`. On iPhone,
where native stores cannot be read, a project shows zero chains and looks idle. That is the
Derivation contract's *absence is not evidence*. Rows need three states:

```
● active      8 chains · 152 msgs
○ quiet       no sessions in 30d
◌ unknown     not visible from this device — sessions live on a Mac
```

This also reframes *"Mirror AI-derived digests to `ai-activity/`"*: it is the bridge that
makes out-of-vault history portable and durable past the ~30-day harness deletion, not a
display preference.

## Pane Disposition

19 panes → 10. Nothing a user can do today is removed.

| Pane | Disposition |
|---|---|
| Profile | Keep as **You**. Wire or delete `symbol`; replace `memories` with a pointer to a vault markdown context file. Merge editor with `VaultSetupOrch`. |
| Projects | **Keep in Settings.** Absorb Detected projects; add Elsewhere triage; per-folder behaviour. |
| Select Thinking Space | **Merge** into Thinking Space Profiles → **Spaces**. |
| Thinking Space Profiles | Becomes **Spaces** (current-space card + known spaces + status). |
| Theme | Keep. Gains the accent from Explorer. |
| Navigation | Keep. |
| Explorer | Keep, reduced: icon style + a review table. Authoring moves to the explorer context menu. |
| Moon Scene | Keep; messages become a record list. |
| Activity | Split: **Sources** stays; attribution moves to Projects; ~7 view toggles move onto the Activity view; file-activity paths become per-folder. |
| Scheduler | **Delete.** One row on Index & Cache. |
| AI | Keep. Diagnostics promoted out of the `nativeRuntime` fold. |
| AI Websites | **Merge** into Web → **Sites**. |
| Web | Becomes **Sites**: one model, accounts as first-class, project tag, favicons, editable URL. |
| Google Docs and Sheets | Fold into **Sites** or keep as a connection row. Decide in Phase 4. |
| RSS Feeds | Keep; record list primitive; add "add feed" from the reader. |
| Webull | Keep (personal extension). |
| Index & Cache | Keep; gains the auto-refresh row and last-run evidence. |
| About | Keep. |
| Developer | Keep. |

## Implementation

Phases 0 and 1 are independent of everything else and land first.

### Phase 0 — Sync correctness (do first; ship alone)

0.1 **Guard the default clobber.** In `vaultUiPreferencesOrch.ts`, split
`readVaultUiPreferencesOrch` into three outcomes — `absent` / `empty` / `unreadable` —
returning a discriminated result rather than defaults-on-catch. `updateVaultUiPreferencesOrch`
**aborts** on `unreadable` and surfaces the failure; only `absent`/`empty` may merge into
defaults. Mirror the `isDefaultUserProfileBlock` guard's intent.
Test: simulate a throwing `fs.read`, assert no write occurs and the on-disk file is intact.

0.2 **Per-field records + delta writes.** Move `ui.json` to
`{ version: 2, fields: { <id>: { v, t, d } } }` with a read-time migration from the flat
shape. Write only the changed field. Merge rule: latest `t` wins per field. `d` = device id
(reuse `readingInstallId` or add one) so the UI can say "changed on iPhone, 4 min ago".

0.3 **Watch `ui.json`.** Reuse the existing vault watch path; apply incoming changes through
the public `storageKeyBlock` setters so their events fire and mounted UI updates live
(`applyRoamedAiActivityPrefsOrch` already does this correctly — it just runs once).
Keep the `applyingRoamingPullOrch` re-entrancy guard.

0.4 **Surface conflicts.** Detect `ui 2.json`-style siblings; report rather than ignore.

0.5 **Fold `profile.json` into the same mechanism** once 0.1–0.3 are green, so there is one
file, one guard set, one merge rule.

Update `contracts/IOS-NATIVE-CHROME.md` in the same change — it currently locks the
read-merge-write shape that 0.2 replaces.

### Phase 1 — Visual foundations (independent, ~1 day)

1.1 Add a global `:focus-visible` rule in `index.css` using the accent token. Removes the
macOS amber ring and puts the user's chosen accent on the screen where they chose it.
1.2 Delete the forked class system in `ProjectsSettingsBlock.tsx:102-109`; move to shared
tokens. This alone fixes the screenshot that started this review.
1.3 Export the six-step type scale and three density tiers next to
`SETTINGS_CONTROL_CLASS_BLOCK`. Convert group headings from micro-caps to 13px semibold.
1.4 Pass `icon` and `trailing` in `SettingsOrch.tsx:1108-1114` — trailing shows the current
value or a count ("Theme → Dark", "Projects → 4"). Two props; turns 19 anonymous rows into
an overview.
1.5 Anchor the pane: drop `mx-auto`, left-align to a ~720px measure, reserve the right
gutter for status.
1.6 Replace the four `window.confirm` calls with a themed dialog block.

### Phase 2 — The schema

2.1 Define the registry type and a `settingsRegistryBlock` in
`services/lego_blocks/units/`. Populate from the panes that survive Phase 4, starting with
the true preferences (~20 entries).
2.2 Render panes from the registry; keep the existing JSX for record surfaces until
Phase 3 replaces them.
2.3 Derive from it, in this order: deep links (delete the `Settings.tsx:40-62` ladder),
search, modified-from-default + reset, dirty tracking + navigation guard.
2.4 Unify feedback: one banner owned by the shell, top of pane, cleared on navigation.
Remove the pair at `SettingsOrch.tsx:2278-2279` and the duplicate at `AiSettingsOrch:376-377`.
Make `busyAction` per-section.
2.5 Unify ownership: everything through registry `read`/`write`. Delete the prop-drilling in
`Settings.tsx` and the `useEffect` draft syncs at `:499-502` and `:534-537`. Instant-apply
becomes the default because nothing is forced into a draft by its plumbing.

### Phase 3 — Primitives

3.1 Build the block list in **B**. 3.2 Convert `<select>` choices of ≤4 options to
segmented controls. 3.3 Convert the explorer rules list and the site lists to
`SettingsTableBlock` / `SettingsRecordListBlock`. 3.4 Real empty states.

### Phase 4 — Consolidation

4.1 **Spaces**: merge Select Thinking Space into Thinking Space Profiles. Current-space card
(name, path in mono, note count, sync state, git branch), known-spaces list with `Open`,
unreachable folders marked, `Add a space…`, themed confirm naming the destination.
4.2 **Sites**: merge `aiWebsite*` into `webSite*`. One block, one storage key, one pane.
Introduce **accounts** (named once, reused across sites — replaces the "Grok - F9" naming
convention), a **project** tag on each site, favicons, editable URL (the service already
accepts it), search. Migration must preserve `partition` per entry or logins are lost.
4.3 **Scheduler → Index & Cache** as one row; show last-run from
`schedulerTaskLastAttemptById` beside next-run. Delete the pane and the one-member action
registry, or keep the registry only if EPIC-5 will add tasks.
4.4 **Activity split**: Sources stays; move the ~7 view toggles onto the Activity view;
move file-activity ignored paths to per-folder (Phase 6).
4.5 **Profile → You**: decide `symbol` (wire it somewhere real or delete it); replace the
`memories` textarea with a pointer row to a vault markdown context file, and make in-app AI
actions read it — vault-root `CLAUDE.md`/`AGENTS.md` if present, else
`.thinking-space/context.md`, plus `<folder>/CLAUDE.md` per project. One context, two
readers (the app and a terminal agent). Merge the editor with `VaultSetupOrch`.

### Phase 5 — In-context affordances

5.1 Explorer context menu → **Color…** with a curated 8-token palette defined for both
themes, custom as an escape hatch, live preview behind the menu.
5.2 Explorer context menu → track activity / include in sync, showing inheritance.
5.3 "Add this feed" from the RSS reader; "Add this site" from the Web tab.
5.4 Folder picker for project `roots` and the Webull paths, replacing free-text textareas.

### Phase 6 — Projects leverage

6.1 Derive explorer folder colours from project `roots` + `color`; keep manual rules as
overrides. One-time import: *"8 of your 10 rules match a project; adopt project colours?"* —
never a silent switch.
6.2 Per-project folder behaviour (activity / sync / AI source) with folder-level override.
6.3 Absorb Detected projects into Projects: **Your projects** (active / quiet / unknown)
and **Elsewhere** below a break — folders with sessions that are not projects, with three
dispositions: `Make a project`, `Add to…` (root or alias — retires the legacy mapping
rules), `Not a project` (persisted, reviewable, never silently cleared).
6.4 Fix explorer rule precedence: sort by path specificity and emit in that order, so the
nested rule wins deterministically instead of by insertion accident. Normalize paths on
write. Show match counts.
6.5 Surface source reachability outside the settings block so activity views can distinguish
*idle* from *not visible from here*.

### Phase 7 — Scope surfaced

7.1 Scope badges on every row from the schema. 7.2 **"What travels"** view. 7.3 Clear-cache
dialog enumerates what it resets. 7.4 "Changed on iPhone, 4 min ago" provenance line.
7.5 Vault-write toggles show their footprint (files, size, last write).

## Verification

- Two devices, same vault: change different settings on each within the debounce window;
  both survive. Change the same setting; both converge to the later timestamp.
- Force `fs.read` to throw, change a setting: **no write occurs**, file intact, failure visible.
- iPhone cold launch against an undownloaded `ui.json`: no default clobber.
- Remove and re-add a site through the Sites migration: `partition` preserved, still logged in.
- Explorer: two overlapping descendant rules resolve by specificity, not insertion order.
- A rule with a trailing slash reports "matches 0 folders" instead of failing silently.
- Startup JS budget still ≤ 2.4 MB (`contracts/STARTUP-PERFORMANCE.md`).
- Phone list/detail renders every surviving pane from the registry, no parallel path.

## Open Questions

1. Does `profile.symbol` get wired to something real, or deleted? Nothing renders it today.
2. Google Docs and Sheets — a Sites entry, or its own connection row?
3. Keep the one-member scheduler action registry for EPIC-5, or delete it now?
4. Do AI activity **source prefixes** fold into projects, or stay independent? They are about
   where transcripts land, not where work happens — leaning independent.
5. Device id for `ui.json` `d` field: reuse `readingInstallId` or mint a separate one?
