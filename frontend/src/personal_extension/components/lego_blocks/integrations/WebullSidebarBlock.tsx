import { useState } from 'react'
import { ChevronRight, type LucideIcon } from 'lucide-react'
import {
  PHONE_LIST_ICON_CLASS_BLOCK,
  PhoneLargeTitleBlock,
  PhoneListGroupBlock,
  PhoneListRowBlock,
  PhoneListSectionHeaderBlock,
} from '@/components/lego_blocks/units/PhoneListBlock'
import TickerLogoBlock from '@/personal_extension/components/lego_blocks/units/TickerLogoBlock'
import type {
  WebullStudyStateBlock,
  WebullUniverseCompanyBlock,
  WebullUniverseGroupBlock,
} from '@/personal_extension/services/lego_blocks/units/webullCompanyUniverseBlock'
import { cn } from '@/lib/utils'

// The F9 sidebar: the views, then every company the vault knows about in three
// groups (held, watchlist, researched). Groups start folded with their counts
// showing, and every company carries a study marker — the unstudied ones are
// meant to be noticed.

const GROUPS_BLOCK: Array<{ id: WebullUniverseGroupBlock; label: string; hint: string }> = [
  { id: 'held', label: 'Held', hint: 'Companies you hold, by share of cost' },
  { id: 'watchlist', label: 'Watchlist', hint: 'Studied, not held' },
  { id: 'researched', label: 'To research', hint: 'Research collected, no study yet' },
]
const OPEN_GROUPS_STORAGE_KEY_BLOCK = 'webull_sidebar_open_groups_v1'

const STUDY_LABEL_BLOCK: Record<WebullStudyStateBlock, string> = {
  current: 'Studied',
  due: 'Study due for review',
  none: 'Not studied yet',
}

function readOpenGroupsBlock(): Set<WebullUniverseGroupBlock> {
  try {
    const raw = window.localStorage.getItem(OPEN_GROUPS_STORAGE_KEY_BLOCK)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    return new Set(Array.isArray(parsed) ? parsed.filter((v): v is WebullUniverseGroupBlock => v === 'held' || v === 'watchlist' || v === 'researched') : [])
  } catch {
    return new Set()
  }
}

/** ● studied · ◐ due for review · ○ not studied */
function StudyMarkerBlock({ state, onDark }: { state: WebullStudyStateBlock; onDark?: boolean }) {
  return (
    <span
      aria-label={STUDY_LABEL_BLOCK[state]}
      className={cn(
        'h-[7px] w-[7px] shrink-0 rounded-full',
        state === 'current' && (onDark ? 'bg-white dark:bg-zinc-900' : 'bg-emerald-500'),
        state === 'due' && (onDark
          ? 'bg-[linear-gradient(90deg,#fff_50%,transparent_50%)] ring-1 ring-white dark:bg-[linear-gradient(90deg,#18181b_50%,transparent_50%)] dark:ring-zinc-900'
          : 'bg-[linear-gradient(90deg,#f59e0b_50%,transparent_50%)] ring-1 ring-amber-500'),
        state === 'none' && (onDark ? 'ring-1 ring-white/70 dark:ring-zinc-900/70' : 'ring-1 ring-zinc-400/70 dark:ring-zinc-500'),
      )}
    />
  )
}

function CompanyAvatarBlock({ company, executionRoot, className }: { company: WebullUniverseCompanyBlock; executionRoot: string | null; className: string }) {
  if (company.ticker && executionRoot) {
    return <TickerLogoBlock ticker={company.ticker} executionRoot={executionRoot} className={className} />
  }
  const initial = (company.name ?? company.ticker ?? '?').charAt(0).toUpperCase()
  return (
    <span className={cn(className, 'flex items-center justify-center rounded-full bg-zinc-200 text-[9px] font-semibold text-zinc-600 dark:bg-zinc-700 dark:text-zinc-200')}>
      {initial}
    </span>
  )
}

export interface WebullSidebarViewBlock {
  id: string
  label: string
  icon: LucideIcon
  active: boolean
  onSelect: () => void
}

interface WebullSidebarBlockProps {
  phoneListMode: boolean
  views: WebullSidebarViewBlock[]
  companies: WebullUniverseCompanyBlock[]
  activeCompanyKey: string | null
  onSelectCompany: (company: WebullUniverseCompanyBlock) => void
  executionRoot: string | null
}

export default function WebullSidebarBlock({
  phoneListMode,
  views,
  companies,
  activeCompanyKey,
  onSelectCompany,
  executionRoot,
}: WebullSidebarBlockProps) {
  const [openGroups, setOpenGroups] = useState<Set<WebullUniverseGroupBlock>>(() => readOpenGroupsBlock())
  const toggleGroup = (id: WebullUniverseGroupBlock) => setOpenGroups((prev) => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    try { window.localStorage.setItem(OPEN_GROUPS_STORAGE_KEY_BLOCK, JSON.stringify([...next])) } catch { /* per-viewer nicety only */ }
    return next
  })
  const studiedCount = companies.filter(c => c.studyState !== 'none').length

  if (phoneListMode) {
    return (
      <>
        <PhoneLargeTitleBlock title="F9" />
        <PhoneListGroupBlock enabled>
          {views.map(view => {
            const Icon = view.icon
            return <PhoneListRowBlock key={view.id} icon={<Icon className={PHONE_LIST_ICON_CLASS_BLOCK} />} label={view.label} onClick={view.onSelect} />
          })}
        </PhoneListGroupBlock>
        {GROUPS_BLOCK.map(group => {
          const members = companies.filter(c => c.group === group.id)
          if (members.length === 0) return null
          const studied = members.filter(c => c.studyState !== 'none').length
          return (
            <div key={group.id}>
              <PhoneListSectionHeaderBlock>{`${group.label} · ${studied}/${members.length} studied`}</PhoneListSectionHeaderBlock>
              <PhoneListGroupBlock enabled>
                {members.map(company => (
                  <PhoneListRowBlock
                    key={company.key}
                    icon={<CompanyAvatarBlock company={company} executionRoot={executionRoot} className="h-[22px] w-[22px]" />}
                    label={company.ticker ?? company.name ?? ''}
                    trailing={(
                      <span className="flex items-center gap-2">
                        {company.costShare !== null && `${(company.costShare * 100).toFixed(company.costShare >= 0.1 ? 0 : 1)}%`}
                        <StudyMarkerBlock state={company.studyState} />
                      </span>
                    )}
                    onClick={() => onSelectCompany(company)}
                  />
                ))}
              </PhoneListGroupBlock>
            </div>
          )
        })}
      </>
    )
  }

  return (
    <>
      <p className="mb-1.5 px-2.5 text-[11px] font-semibold text-zinc-500 dark:text-zinc-400">Webull</p>
      <nav className="space-y-0.5" aria-label="F9 views">
        {views.map(view => {
          const Icon = view.icon
          return (
            <button
              key={view.id}
              type="button"
              onClick={view.onSelect}
              aria-current={view.active ? 'page' : undefined}
              className={cn(
                'ltm-motion-fast flex h-8 w-full items-center gap-2.5 rounded-md px-2.5 text-left text-[13px] transition-colors',
                view.active
                  ? 'bg-zinc-900 text-white dark:bg-white dark:text-zinc-900'
                  : 'text-zinc-700 hover:bg-zinc-200/70 dark:text-zinc-200 dark:hover:bg-zinc-800',
              )}
            >
              <Icon className={cn('h-4 w-4 shrink-0', view.active ? 'text-white dark:text-zinc-900' : 'text-zinc-500 dark:text-zinc-400')} />
              <span className="truncate">{view.label}</span>
            </button>
          )
        })}
      </nav>

      <div className="mb-1 mt-5 flex items-baseline justify-between px-2.5">
        <p className="text-[11px] font-semibold text-zinc-500 dark:text-zinc-400">Businesses</p>
        <p className="text-[11px] tabular-nums text-zinc-400" title={`${studiedCount} of ${companies.length} studied`}>
          {studiedCount}/{companies.length} studied
        </p>
      </div>

      <div className="space-y-0.5">
        {GROUPS_BLOCK.map(group => {
          const members = companies.filter(c => c.group === group.id)
          if (members.length === 0) return null
          const open = openGroups.has(group.id)
          const studied = members.filter(c => c.studyState !== 'none').length
          // Folded, a group still shows the company you're on, so the sidebar says where you are.
          const visible = open ? members : members.filter(c => c.key === activeCompanyKey)
          return (
            <div key={group.id}>
              <button
                type="button"
                onClick={() => toggleGroup(group.id)}
                aria-expanded={open}
                title={group.hint}
                className="ltm-motion-fast flex h-7 w-full items-center gap-1.5 rounded-md px-1.5 text-left text-[13px] font-medium text-zinc-700 transition-colors hover:bg-zinc-200/70 dark:text-zinc-200 dark:hover:bg-zinc-800"
              >
                <ChevronRight className={cn('h-3.5 w-3.5 shrink-0 text-zinc-400 transition-transform duration-150', open && 'rotate-90')} />
                <span className="truncate">{group.label}</span>
                <span className="ml-auto text-[11px] font-normal tabular-nums text-zinc-400" title={`${studied} of ${members.length} studied`}>
                  {studied}/{members.length}
                </span>
              </button>
              {visible.length > 0 && (
                <div className="mb-1 space-y-px">
                  {visible.map(company => {
                    const active = company.key === activeCompanyKey
                    return (
                      <button
                        key={company.key}
                        type="button"
                        onClick={() => onSelectCompany(company)}
                        title={`${company.name ?? company.ticker ?? ''} · ${STUDY_LABEL_BLOCK[company.studyState]}`}
                        className={cn(
                          'ltm-motion-fast flex h-7 w-full items-center gap-2 rounded-md pl-6 pr-2 text-left text-[13px] transition-colors',
                          active
                            ? 'bg-zinc-900 text-white dark:bg-white dark:text-zinc-900'
                            : 'text-zinc-700 hover:bg-zinc-200/70 dark:text-zinc-200 dark:hover:bg-zinc-800',
                        )}
                      >
                        <CompanyAvatarBlock company={company} executionRoot={executionRoot} className="h-4 w-4" />
                        <span className="min-w-0 flex-1 truncate">{company.ticker ?? company.name}</span>
                        {company.costShare !== null && (
                          <span className={cn('text-[11px] tabular-nums', active ? 'text-white/80 dark:text-zinc-900/70' : 'text-zinc-400')}>
                            {(company.costShare * 100).toFixed(company.costShare >= 0.1 ? 0 : 1)}%
                          </span>
                        )}
                        <StudyMarkerBlock state={company.studyState} onDark={active} />
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </>
  )
}
