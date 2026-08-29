import { getJsonStorageItem, getStorageItem, setJsonStorageItem, STORAGE_KEYS } from './storageKeyBlock'

// Per-profile nav rail customization: which icons show and in what order.
// Stored in localStorage — and because each workspace profile runs in its own
// session partition, prefs are per-profile with no extra plumbing (hide the
// Webull tab in a personal profile, keep it in the trading one).
//
// Semantics: hiding removes an item from the rail ONLY — the page stays
// routable and listed in the ⌘K command palette, so you can never strand
// yourself. Keyboard shortcuts (⌘1…n) follow the visible order, like Chrome.

/** Where the Home glyph anchors on the rail. Default 'bottom' (the bottom
 *  corner, above the profile switcher); users can drag it up to the top in
 *  jiggle-edit mode. */
export type NavRailHomePosition = 'top' | 'bottom'

export interface NavRailPrefsBlock {
  /** Item ids (route paths) in desired display order; unknown ids ignored,
   *  unlisted items keep their default relative order after the listed ones. */
  order: string[]
  /** Item ids hidden from the rail. */
  hidden: string[]
  /** Home glyph anchor — top (default) or bottom corner. */
  homePosition: NavRailHomePosition
  /** Which seeding rule decided this record's starting shape; absent on
   *  records written before seeding existed. */
  seedVersion?: number
}

export const NAV_RAIL_PREFS_EVENT = 'thinkspc:nav-rail-prefs-changed'

const EMPTY_PREFS_BLOCK: NavRailPrefsBlock = { order: [], hidden: [], homePosition: 'bottom' }

/** Rail items hidden on a fresh install. Both are niche surfaces — a brokerage
 *  workspace and a tools drawer — that most new users never open, so they cost
 *  rail space and read as clutter on first launch. Settings -> Navigation turns
 *  them back on, and (per the hiding semantics above) the pages stay routable
 *  and in the command palette meanwhile. */
export const NAV_RAIL_FRESH_INSTALL_HIDDEN_BLOCK: string[] = ['/webull', '/tools']

/** Bumped when the seeding rule below changes, so a record written by a
 *  previous (wrong) rule can be reconsidered once. */
const SEED_VERSION_BLOCK = 2

/** Keys the app writes during a cold boot, before anyone has done anything.
 *  Observed in this order on a freshly created profile: color mode, the shell
 *  tab record, the active tab id, the theme. They mean "the app started", not
 *  "someone used this", so prior-use detection must ignore them — the first
 *  attempt at this trusted them and classified every new profile as an
 *  existing user. Some carry a per-window `:window-<id>` suffix, hence the
 *  prefix match. */
const BOOT_WRITTEN_KEY_PREFIXES_BLOCK: string[] = [
  STORAGE_KEYS.appColorMode,
  STORAGE_KEYS.appTheme,
  STORAGE_KEYS.appShellTabs,
  STORAGE_KEYS.appShellActiveTabId,
  STORAGE_KEYS.navRailPrefs,
]

/** Has anyone actually used this profile? Read straight from localStorage —
 *  never through getStorageItem, whose vault-root path answers from the main
 *  process, which hands a newly created profile the vault root it was created
 *  with. That is profile configuration, not profile history. localStorage is
 *  partitioned per profile, so what it holds is this profile's own record.
 *  Any ltm-* key that a cold boot does not write means real use: a setting
 *  changed, a feed added, an organizer template saved. */
function hasPriorUseSignalBlock(): boolean {
  try {
    if (typeof localStorage === 'undefined') return false
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index)
      if (!key || !key.startsWith('ltm-')) continue
      const isBootKey = BOOT_WRITTEN_KEY_PREFIXES_BLOCK.some(
        (prefix) => key === prefix || key.startsWith(`${prefix}:`),
      )
      if (!isBootKey) return true
    }
    return false
  } catch {
    return false
  }
}

/** True when the stored record carries no evidence of a human choice, so
 *  re-seeding it cannot overwrite anything the user asked for. */
function isUntouchedRecordBlock(prefs: NavRailPrefsBlock): boolean {
  return prefs.order.length === 0 && prefs.hidden.length === 0 && prefs.homePosition === 'bottom'
}

/** Decide this profile's starting rail once, and record which rule decided.
 *  A fresh profile gets the fresh-install hidden set; a profile showing prior
 *  use keeps everything it already shows. Re-runs only when an older seed
 *  version wrote the record AND the user has not customized it since — that
 *  is what lets a profile seeded by the earlier, broken rule be corrected. */
export function seedNavRailDefaultsBlock(): void {
  const raw = getStorageItem(STORAGE_KEYS.navRailPrefs)
  if (raw !== null) {
    const current = getNavRailPrefsBlock()
    if (current.seedVersion === SEED_VERSION_BLOCK) return
    if (!isUntouchedRecordBlock(current)) {
      setNavRailPrefsBlock({ ...current, seedVersion: SEED_VERSION_BLOCK })
      return
    }
  }
  setNavRailPrefsBlock({
    ...EMPTY_PREFS_BLOCK,
    hidden: hasPriorUseSignalBlock() ? [] : [...NAV_RAIL_FRESH_INSTALL_HIDDEN_BLOCK],
    seedVersion: SEED_VERSION_BLOCK,
  })
}

/** Rail items the user may reorder/hide. Labels mirror the nav constants in
 *  App.tsx (the Webull label is user-customizable; pass the live label where
 *  a UI needs it). Home, Settings, and the profile avatar are not manageable
 *  on purpose — they're the app's fixed anchors. */
export const NAV_RAIL_MANAGEABLE_ITEMS_BLOCK: Array<{ id: string; label: string; group: 'primary' | 'tools' }> = [
  { id: '/thinking-space', label: 'Thinking Space', group: 'primary' },
  { id: '/new-thought', label: 'New Note', group: 'primary' },
  { id: '/webull', label: 'Webull', group: 'primary' },
  { id: '/thinking-organizer', label: 'Thinking Organizer', group: 'primary' },
  { id: '/tools', label: 'Tools', group: 'tools' },
  { id: '/vault-graph', label: 'Thinking Space Graph', group: 'tools' },
]

function sanitizePrefsBlock(value: unknown): NavRailPrefsBlock {
  if (!value || typeof value !== 'object') return EMPTY_PREFS_BLOCK
  const record = value as Partial<NavRailPrefsBlock>
  const clean = (list: unknown): string[] =>
    Array.isArray(list) ? [...new Set(list.filter((entry): entry is string => typeof entry === 'string'))] : []
  const homePosition: NavRailHomePosition = record.homePosition === 'top' ? 'top' : 'bottom'
  const seedVersion = typeof record.seedVersion === 'number' ? record.seedVersion : undefined
  return { order: clean(record.order), hidden: clean(record.hidden), homePosition, seedVersion }
}

export function getNavRailPrefsBlock(): NavRailPrefsBlock {
  return sanitizePrefsBlock(getJsonStorageItem<NavRailPrefsBlock>(STORAGE_KEYS.navRailPrefs, EMPTY_PREFS_BLOCK))
}

export function setNavRailPrefsBlock(prefs: NavRailPrefsBlock): void {
  const sanitized = sanitizePrefsBlock(prefs)
  setJsonStorageItem(STORAGE_KEYS.navRailPrefs, sanitized)
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(NAV_RAIL_PREFS_EVENT, { detail: sanitized }))
  }
}

/** Reset means the shipped default, which is the fresh-install shape — Webull
 *  and Tools hidden — not "everything visible". */
export function resetNavRailPrefsBlock(): void {
  setNavRailPrefsBlock({ ...EMPTY_PREFS_BLOCK, hidden: [...NAV_RAIL_FRESH_INSTALL_HIDDEN_BLOCK] })
}

export function hideNavRailItemBlock(id: string): void {
  const prefs = getNavRailPrefsBlock()
  if (prefs.hidden.includes(id)) return
  setNavRailPrefsBlock({ ...prefs, hidden: [...prefs.hidden, id] })
}

export function setNavRailItemHiddenBlock(id: string, hidden: boolean): void {
  const prefs = getNavRailPrefsBlock()
  setNavRailPrefsBlock({
    ...prefs,
    hidden: hidden
      ? [...new Set([...prefs.hidden, id])]
      : prefs.hidden.filter((entry) => entry !== id),
  })
}

/** Anchor the Home glyph to the top of the rail or the bottom corner. */
export function setNavRailHomePositionBlock(position: NavRailHomePosition): void {
  const prefs = getNavRailPrefsBlock()
  if (prefs.homePosition === position) return
  setNavRailPrefsBlock({ ...prefs, homePosition: position })
}

/** Move an item one slot up/down within its group's default+custom order.
 *  `groupIds` is the group's items in their CURRENT display order. */
export function moveNavRailItemBlock(groupIds: string[], id: string, direction: 'up' | 'down'): void {
  const index = groupIds.indexOf(id)
  if (index < 0) return
  const target = direction === 'up' ? index - 1 : index + 1
  if (target < 0 || target >= groupIds.length) return
  const nextGroup = [...groupIds]
  nextGroup.splice(index, 1)
  nextGroup.splice(target, 0, id)
  const prefs = getNavRailPrefsBlock()
  // The order array carries all groups; replace this group's ids with the new
  // sequence while leaving other groups' entries untouched.
  const otherEntries = prefs.order.filter((entry) => !groupIds.includes(entry))
  setNavRailPrefsBlock({ ...prefs, order: [...otherEntries, ...nextGroup] })
}

/** Drop `draggedId` onto `targetId`'s slot within a group (jiggle-mode drag).
 *  `groupIds` is the group's items in their CURRENT display order. */
export function reorderNavRailItemBlock(groupIds: string[], draggedId: string, targetId: string): void {
  if (draggedId === targetId) return
  const from = groupIds.indexOf(draggedId)
  const to = groupIds.indexOf(targetId)
  if (from < 0 || to < 0) return
  const nextGroup = [...groupIds]
  nextGroup.splice(from, 1)
  nextGroup.splice(to, 0, draggedId)
  const prefs = getNavRailPrefsBlock()
  const otherEntries = prefs.order.filter((entry) => !groupIds.includes(entry))
  setNavRailPrefsBlock({ ...prefs, order: [...otherEntries, ...nextGroup] })
}

/** Apply order + visibility to a nav item list (matched by `to`). */
export function applyNavRailPrefsBlock<T extends { to: string }>(
  items: T[],
  prefs: NavRailPrefsBlock = getNavRailPrefsBlock(),
): T[] {
  const byId = new Map(items.map((item) => [item.to, item]))
  const ordered: T[] = []
  for (const id of prefs.order) {
    const item = byId.get(id)
    if (!item) continue
    ordered.push(item)
    byId.delete(id)
  }
  for (const item of items) {
    if (byId.has(item.to)) ordered.push(item)
  }
  return ordered.filter((item) => !prefs.hidden.includes(item.to))
}
