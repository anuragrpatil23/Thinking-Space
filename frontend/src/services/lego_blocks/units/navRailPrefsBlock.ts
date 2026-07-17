import { getJsonStorageItem, setJsonStorageItem, STORAGE_KEYS } from './storageKeyBlock'

// Per-profile nav rail customization: which icons show and in what order.
// Stored in localStorage — and because each workspace profile runs in its own
// session partition, prefs are per-profile with no extra plumbing (hide the
// Webull tab in a personal profile, keep it in the trading one).
//
// Semantics: hiding removes an item from the rail ONLY — the page stays
// routable and listed in the ⌘K command palette, so you can never strand
// yourself. Keyboard shortcuts (⌘1…n) follow the visible order, like Chrome.

export interface NavRailPrefsBlock {
  /** Item ids (route paths) in desired display order; unknown ids ignored,
   *  unlisted items keep their default relative order after the listed ones. */
  order: string[]
  /** Item ids hidden from the rail. */
  hidden: string[]
}

export const NAV_RAIL_PREFS_EVENT = 'thinkspc:nav-rail-prefs-changed'

const EMPTY_PREFS_BLOCK: NavRailPrefsBlock = { order: [], hidden: [] }

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
  return { order: clean(record.order), hidden: clean(record.hidden) }
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

export function resetNavRailPrefsBlock(): void {
  setNavRailPrefsBlock(EMPTY_PREFS_BLOCK)
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
