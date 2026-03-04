// TypeScript port of backend/app/tools/file_activity.py
// Uses VaultFS abstraction — works on web (via backend) or Capacitor (local fs).

import type { VaultFS, VaultEntry } from '@/services/lego_blocks/integrations/fsBlock'
import { extractSection } from '@/services/lego_blocks/units/vaultConstantsBlock'
import { getActiveSpaceIdBlock } from '@/services/lego_blocks/units/storageKeyBlock'

// ── In-memory cache ──

let _cache: { timestamp: number; spaceId: string; entries: VaultEntry[] } | null = null
const CACHE_TTL = 120_000 // 120 seconds in ms

async function walkVaultCached(fs: VaultFS): Promise<VaultEntry[]> {
  const now = Date.now()
  const spaceId = getActiveSpaceIdBlock()
  if (_cache && _cache.spaceId === spaceId && now - _cache.timestamp < CACHE_TTL) {
    return _cache.entries
  }
  const entries = await fs.walkVault(['.md'])
  _cache = { timestamp: now, spaceId, entries }
  return entries
}

// ── Helpers ──

function dateFromTimestamp(ts: number): string {
  const d = new Date(ts * 1000)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function daysInRange(start: Date, end: Date): string[] {
  const result: string[] = []
  const cur = new Date(start)
  while (cur < end) {
    result.push(cur.toISOString().slice(0, 10))
    cur.setDate(cur.getDate() + 1)
  }
  return result
}

// ── Get month activity ──

export async function getMonthActivity(
  fs: VaultFS,
  year: number,
  month: number,
) {
  const entries = await walkVaultCached(fs)

  const monthStart = new Date(year, month - 1, 1)
  const monthEnd = month === 12 ? new Date(year + 1, 0, 1) : new Date(year, month, 1)
  const startStr = monthStart.toISOString().slice(0, 10)
  const endStr = monthEnd.toISOString().slice(0, 10)

  const dayCreated: Record<string, number> = {}
  const dayModified: Record<string, number> = {}
  const sectionCreated: Record<string, number> = {}
  const sectionModified: Record<string, number> = {}
  const sectionDayCreated: Record<string, Record<string, number>> = {}
  const sectionDayModified: Record<string, Record<string, number>> = {}

  for (const entry of entries) {
    const createdDate = dateFromTimestamp(entry.ctime)
    const modifiedDate = dateFromTimestamp(entry.mtime)
    const section = extractSection(entry.path)

    if (createdDate >= startStr && createdDate < endStr) {
      dayCreated[createdDate] = (dayCreated[createdDate] ?? 0) + 1
      sectionCreated[section] = (sectionCreated[section] ?? 0) + 1
      if (!sectionDayCreated[section]) sectionDayCreated[section] = {}
      sectionDayCreated[section][createdDate] = (sectionDayCreated[section][createdDate] ?? 0) + 1
    }

    if (modifiedDate >= startStr && modifiedDate < endStr && modifiedDate !== createdDate) {
      dayModified[modifiedDate] = (dayModified[modifiedDate] ?? 0) + 1
      sectionModified[section] = (sectionModified[section] ?? 0) + 1
      if (!sectionDayModified[section]) sectionDayModified[section] = {}
      sectionDayModified[section][modifiedDate] = (sectionDayModified[section][modifiedDate] ?? 0) + 1
    }
  }

  // Build days
  const allDays = daysInRange(monthStart, monthEnd)
  const days = allDays.map(d => ({
    date: d,
    created: dayCreated[d] ?? 0,
    modified: dayModified[d] ?? 0,
  }))

  // Build sections
  const allSections = new Set([...Object.keys(sectionCreated), ...Object.keys(sectionModified)])
  const sections = [...allSections]
    .map(s => ({
      name: s,
      created: sectionCreated[s] ?? 0,
      modified: sectionModified[s] ?? 0,
    }))
    .sort((a, b) => (b.created + b.modified) - (a.created + a.modified))

  const totalCreated = days.reduce((s, d) => s + d.created, 0)
  const totalModified = days.reduce((s, d) => s + d.modified, 0)

  // Build section_days
  const allSectionNames = new Set([...Object.keys(sectionDayCreated), ...Object.keys(sectionDayModified)])
  const sectionDaysOut: Record<string, Array<{ date: string; created: number; modified: number }>> = {}
  for (const s of allSectionNames) {
    const sCr = sectionDayCreated[s] ?? {}
    const sMo = sectionDayModified[s] ?? {}
    const activeDates = new Set([...Object.keys(sCr), ...Object.keys(sMo)])
    sectionDaysOut[s] = [...activeDates]
      .map(d => ({
        date: d,
        created: sCr[d] ?? 0,
        modified: sMo[d] ?? 0,
      }))
      .sort((a, b) => a.date.localeCompare(b.date))
  }

  return {
    year,
    month,
    days,
    total_created: totalCreated,
    total_modified: totalModified,
    sections,
    section_days: sectionDaysOut,
  }
}

// ── Get day activity ──

export async function getDayActivity(
  fs: VaultFS,
  targetDate: string,
) {
  const entries = await walkVaultCached(fs)

  const created: Array<{ path: string; section: string; size_bytes: number; timestamp: string }> = []
  const modified: Array<{ path: string; section: string; size_bytes: number; timestamp: string }> = []

  for (const entry of entries) {
    const createdDate = dateFromTimestamp(entry.ctime)
    const modifiedDate = dateFromTimestamp(entry.mtime)
    const section = extractSection(entry.path)

    if (createdDate === targetDate) {
      created.push({
        path: entry.path,
        section,
        size_bytes: entry.size,
        timestamp: new Date(entry.ctime * 1000).toISOString(),
      })
    } else if (modifiedDate === targetDate) {
      modified.push({
        path: entry.path,
        section,
        size_bytes: entry.size,
        timestamp: new Date(entry.mtime * 1000).toISOString(),
      })
    }
  }

  created.sort((a, b) => a.section.localeCompare(b.section) || a.path.localeCompare(b.path))
  modified.sort((a, b) => a.section.localeCompare(b.section) || a.path.localeCompare(b.path))

  // Group by section
  const sections: Record<string, { created: typeof created; modified: typeof modified }> = {}
  for (const f of created) {
    if (!sections[f.section]) sections[f.section] = { created: [], modified: [] }
    sections[f.section].created.push(f)
  }
  for (const f of modified) {
    if (!sections[f.section]) sections[f.section] = { created: [], modified: [] }
    sections[f.section].modified.push(f)
  }

  return {
    date: targetDate,
    created,
    modified,
    created_count: created.length,
    modified_count: modified.length,
    sections,
  }
}

// ── Get section month activity ──

export async function getSectionMonthActivity(
  fs: VaultFS,
  year: number,
  month: number,
  section: string,
) {
  const entries = await walkVaultCached(fs)

  const monthStart = new Date(year, month - 1, 1)
  const monthEnd = month === 12 ? new Date(year + 1, 0, 1) : new Date(year, month, 1)
  const startStr = monthStart.toISOString().slice(0, 10)
  const endStr = monthEnd.toISOString().slice(0, 10)

  type FileEntry = { path: string; section: string; size_bytes: number; timestamp: string }
  const byDate: Record<string, { created: FileEntry[]; modified: FileEntry[] }> = {}

  for (const entry of entries) {
    if (extractSection(entry.path) !== section) continue

    const createdDate = dateFromTimestamp(entry.ctime)
    const modifiedDate = dateFromTimestamp(entry.mtime)

    const makeEntry = (ts: number): FileEntry => ({
      path: entry.path,
      section,
      size_bytes: entry.size,
      timestamp: new Date(ts * 1000).toISOString(),
    })

    if (createdDate >= startStr && createdDate < endStr) {
      if (!byDate[createdDate]) byDate[createdDate] = { created: [], modified: [] }
      byDate[createdDate].created.push(makeEntry(entry.ctime))
    }

    if (modifiedDate >= startStr && modifiedDate < endStr && modifiedDate !== createdDate) {
      if (!byDate[modifiedDate]) byDate[modifiedDate] = { created: [], modified: [] }
      byDate[modifiedDate].modified.push(makeEntry(entry.mtime))
    }
  }

  const dates = Object.keys(byDate).sort().reverse()
  let totalCreated = 0
  let totalModified = 0
  const days = dates.map(d => {
    const data = byDate[d]
    data.created.sort((a, b) => a.path.localeCompare(b.path))
    data.modified.sort((a, b) => a.path.localeCompare(b.path))
    totalCreated += data.created.length
    totalModified += data.modified.length
    return { date: d, created: data.created, modified: data.modified }
  })

  return {
    section,
    year,
    month,
    days,
    total_created: totalCreated,
    total_modified: totalModified,
  }
}
