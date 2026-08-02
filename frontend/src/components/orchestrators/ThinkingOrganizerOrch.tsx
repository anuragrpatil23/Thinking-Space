import { useCallback, useEffect, useRef, useState } from 'react'
import { BookText, Check, FolderTree, LayoutDashboard, List, Loader2, Network, Pencil, Plus, X } from 'lucide-react'
import UndertakingIndexBlock from '@/components/lego_blocks/integrations/UndertakingIndexBlock'
import UndertakingDagBlock from '@/components/lego_blocks/integrations/UndertakingDagBlock'
import UndertakingDetailDrawerBlock from '@/components/lego_blocks/integrations/UndertakingDetailDrawerBlock'
import NoteDetailDrawerBlock from '@/components/lego_blocks/integrations/NoteDetailDrawerBlock'
import { useSearchParams } from 'react-router-dom'
import { Button } from '@/components/lego_blocks/units/ui/button'
import SegmentedToggleBlock from '@/components/lego_blocks/units/ui/SegmentedToggleBlock'
import {
  STORAGE_KEYS,
  getJsonStorageItem,
  setJsonStorageItem,
  setStorageItem,
} from '@/services/orchestrators/storageOrch'
import {
  dispatchOrganizerSidebarChromeStateBlock,
  ORGANIZER_SIDEBAR_CHROME_TOGGLE_EVENT_BLOCK,
} from '@/services/lego_blocks/units/organizerSidebarChromeBlock'
import {
  readOrganizerUiStateOrch,
  writeOrganizerUiStateOrch,
  type OrganizerUiStateOrch,
} from '@/services/orchestrators/organizerUiStateOrch'
import BacklogOrch, {
  ORGANIZER_OPEN_CREATE_PROJECT_EVENT,
  ORGANIZER_PROJECTS_UPDATED_EVENT,
  type OrganizerProjectsUpdatedDetail,
} from '@/components/orchestrators/BacklogOrch'
import { cn } from '@/lib/utils'
import { useUILayoutBlock } from '@/components/lego_blocks/hooks/shared/useUILayoutBlock'
import {
  PHONE_LIST_ICON_CLASS_BLOCK,
  PhoneLargeTitleBlock,
  PhoneListGroupBlock,
  PhoneListRowBlock,
  PhoneListSectionHeaderBlock,
} from '@/components/lego_blocks/units/PhoneListBlock'
import { useIosSidebarSwipeBlock } from '@/components/lego_blocks/hooks/shared/useIosSidebarSwipeBlock'
import { useNativeBackHandlerBlock } from '@/components/lego_blocks/hooks/shared/useNativeBackHandlerBlock'
import { isCapacitorNative } from '@/services/lego_blocks/integrations/fsBlock'
import {
  pushNativeWithForwardBlock,
  setNativeNavigationStackBlock,
} from '@/services/lego_blocks/units/topChromeNativeBridgeBlock'

const PROJECT_ROOT_QUERY_PARAM = 'projectRoot'

function normalizePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
}

const ORGANIZER_SIDEBAR_COLLAPSED_KEY = 'organizer_sidebar_collapsed'
const ORGANIZER_PRIMARY_VIEW_KEY = 'organizer_primary_view'

// The org tab's top-level view. 'index' is the Thinking Organizer index (the
// new primary); 'list'/'canvas' are the existing backlog sub-views, kept during
// the transition off the work-item model.
type OrgView = 'index' | 'lineage' | 'list' | 'canvas'
function parseOrgView(value: string | null): OrgView {
  // 'queue' was briefly a view here. Anyone whose last session left it stored
  // lands on the index rather than on a blank fifth state — the queue is now
  // the chrome badge, not a place you navigate to.
  return value === 'index' || value === 'lineage' || value === 'list' || value === 'canvas'
    ? value
    : 'index'
}

interface ProjectEntry {
  name: string
  root: string
}

interface ThinkingOrganizerOrchProps {
  active?: boolean
}

export default function ThinkingOrganizerOrch({ active = true }: ThinkingOrganizerOrchProps) {
  const { layout } = useUILayoutBlock()
  const isIos = layout.surface === 'capacitor-ios'
  const isIPhoneIosSurface = isIos && layout.mode === 'phone'
  const [searchParams, setSearchParams] = useSearchParams()

  // iPhone list/detail mode. On entering Organizer from the rail, the user
  // lands on the projects sidebar full-screen; tapping a project pushes into
  // the project's content. Back chevron / edge-swipe returns to the list.
  const [phoneInDetail, setPhoneInDetail] = useState(false)
  const phoneListMode = isIPhoneIosSurface && !phoneInDetail
  const phoneDetailMode = isIPhoneIosSurface && phoneInDetail

  useNativeBackHandlerBlock({
    active: phoneDetailMode,
    onBack: () => setPhoneInDetail(false),
  })

  const pushPhoneToDetail = useCallback(() => {
    if (!(isCapacitorNative() && isIPhoneIosSurface)) {
      setPhoneInDetail(true)
      return
    }
    void (async () => {
      try {
        await setNativeNavigationStackBlock(['/thinking-organizer'])
        await pushNativeWithForwardBlock('/thinking-organizer', () => {
          setPhoneInDetail(true)
        })
      } catch (err) {
        console.warn('[Organizer] phone detail push failed, falling back', err)
        setPhoneInDetail(true)
      }
    })()
  }, [isIPhoneIosSurface])
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false
    const stored = window.localStorage.getItem(ORGANIZER_SIDEBAR_COLLAPSED_KEY)
    return stored === '1'
  })
  const [orgView, setOrgViewState] = useState<OrgView>(() => {
    if (typeof window === 'undefined') return 'index'
    return parseOrgView(window.localStorage.getItem(ORGANIZER_PRIMARY_VIEW_KEY))
  })
  const setOrgView = useCallback((next: OrgView) => {
    setOrgViewState(next)
    setOpenUndertaking(null)
    if (typeof window !== 'undefined') window.localStorage.setItem(ORGANIZER_PRIMARY_VIEW_KEY, next)
    // Keep the backlog's own persisted sub-view in sync for list/canvas, so the
    // existing BacklogOrch reads the same choice.
    if (next === 'list' || next === 'canvas') {
      setStorageItem(STORAGE_KEYS.thinkingOrganizerBacklogView, next)
    }
  }, [])

  // Project context
  const [projectUiState, setProjectUiState] = useState<OrganizerUiStateOrch | null>(null)
  const [projectEntries, setProjectEntries] = useState<ProjectEntry[]>(
    () => getJsonStorageItem<ProjectEntry[]>(STORAGE_KEYS.thinkingOrganizerProjects, []),
  )
  const projectRoot = normalizePath(searchParams.get(PROJECT_ROOT_QUERY_PARAM) ?? '')
  // The ai-activity project id the index/lineage views key on. Today it's the
  // project-root basename, matching how chains are attributed; the registry
  // (D9) will canonicalize this so folder variants collapse to one project.
  const aiProjectId = projectRoot ? projectRoot.split('/').pop() ?? null : null
  // Which undertaking's detail page is open (null = the list/lineage view). The
  // index and lineage both drill into the same page.
  const [openUndertaking, setOpenUndertaking] = useState<string | null>(null)
  // The two drawers are one slot: a note's drawer links to the doing that fed
  // on it and back, so opening one has to close the other or they stack.
  const [openNote, setOpenNote] = useState<string | null>(null)
  const openUndertakingDrawer = useCallback((key: string) => {
    setOpenNote(null)
    setOpenUndertaking(key)
  }, [])
  const openNoteDrawer = useCallback((key: string) => {
    setOpenUndertaking(null)
    setOpenNote(key)
  }, [])

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<OrganizerProjectsUpdatedDetail>).detail
      if (detail?.projects) setProjectEntries(detail.projects)
    }
    window.addEventListener(ORGANIZER_PROJECTS_UPDATED_EVENT, handler)
    return () => window.removeEventListener(ORGANIZER_PROJECTS_UPDATED_EVENT, handler)
  }, [])
  const [editingMission, setEditingMission] = useState(false)
  const [missionDraft, setMissionDraft] = useState('')
  const [savingMission, setSavingMission] = useState(false)
  const missionTextareaRef = useRef<HTMLTextAreaElement | null>(null)

  const selectProject = useCallback((root: string) => {
    const normalized = normalizePath(root)
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      if (normalized) next.set(PROJECT_ROOT_QUERY_PARAM, normalized)
      else next.delete(PROJECT_ROOT_QUERY_PARAM)
      return next
    }, { replace: true })
    setJsonStorageItem(
      STORAGE_KEYS.thinkingOrganizerSelectedProjectRoot,
      normalized ? normalized.split('/') : [],
    )
    if (normalized) pushPhoneToDetail()
  }, [setSearchParams, pushPhoneToDetail])


  useEffect(() => {
    // A different project's undertaking must not stay open across a switch.
    setOpenUndertaking(null)
    if (!projectRoot) { setProjectUiState(null); return }
    let cancelled = false
    void readOrganizerUiStateOrch(projectRoot).then(state => {
      if (!cancelled) setProjectUiState(state)
    })
    return () => { cancelled = true }
  }, [projectRoot])

  const projectName = projectUiState?.projectName
    || (projectRoot ? (projectRoot.split('/').pop() ?? projectRoot) : '')
  const missionStatement = projectUiState?.missionStatement ?? ''

  const startEditMission = useCallback(() => {
    setMissionDraft(missionStatement)
    setEditingMission(true)
    setTimeout(() => missionTextareaRef.current?.focus(), 0)
  }, [missionStatement])

  const saveMission = useCallback(async () => {
    if (!projectRoot) return
    setSavingMission(true)
    try {
      const current = await readOrganizerUiStateOrch(projectRoot)
      const base: OrganizerUiStateOrch = current ?? {
        schemaVersion: 2,
        updatedAt: new Date().toISOString(),
        presetTags: [],
        tagColors: {},
        programGroups: [],
      }
      const updated = await writeOrganizerUiStateOrch(projectRoot, {
        ...base,
        missionStatement: missionDraft.trim() || undefined,
      })
      setProjectUiState(updated)
      setEditingMission(false)
    } finally {
      setSavingMission(false)
    }
  }, [projectRoot, missionDraft])

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(ORGANIZER_SIDEBAR_COLLAPSED_KEY, sidebarCollapsed ? '1' : '0')
  }, [sidebarCollapsed])

  useEffect(() => {
    if (!active) return
    dispatchOrganizerSidebarChromeStateBlock({
      enabled: true,
      collapsed: sidebarCollapsed,
      label: 'Organizer',
      headerVisible: true,
      showHeaderToggle: false,
    })
  }, [active, sidebarCollapsed])

  useEffect(() => {
    if (!active) return
    const handler = () => setSidebarCollapsed(prev => !prev)
    window.addEventListener(ORGANIZER_SIDEBAR_CHROME_TOGGLE_EVENT_BLOCK, handler)
    return () => window.removeEventListener(ORGANIZER_SIDEBAR_CHROME_TOGGLE_EVENT_BLOCK, handler)
  }, [active])

  const handleToggleSidebar = useCallback(() => setSidebarCollapsed(prev => !prev), [])
  useIosSidebarSwipeBlock({
    isIos: isIos && active,
    isOpen: active && !sidebarCollapsed,
    keyboardVisible: layout.keyboardVisible,
    onToggle: handleToggleSidebar,
  })

  const headerBlock = (
    <div className="mb-4">
      <h1 className="text-xl font-semibold tracking-tight md:text-2xl">
        {projectName || 'Thinking Organizer'}
      </h1>

      {projectRoot && (
          <div className="mt-1.5">
            {editingMission ? (
              <div className="flex flex-col gap-1.5">
                <textarea
                  ref={missionTextareaRef}
                  value={missionDraft}
                  onChange={e => setMissionDraft(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Escape') { setEditingMission(false) }
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { void saveMission() }
                  }}
                  placeholder="Project mission statement..."
                  rows={2}
                  className="w-full resize-none rounded-md border border-input bg-background px-2.5 py-1.5 text-sm outline-none focus:border-ring"
                />
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => void saveMission()}
                    disabled={savingMission}
                    className="inline-flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                  >
                    {savingMission ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                    Save
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingMission(false)}
                    className="inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs text-muted-foreground hover:bg-muted/70"
                  >
                    <X className="h-3 w-3" />
                    Cancel
                  </button>
                </div>
              </div>
            ) : missionStatement ? (
              <div className="group flex items-start gap-1.5">
                <p className="text-sm text-foreground/80">{missionStatement}</p>
                <button
                  type="button"
                  onClick={startEditMission}
                  className="mt-0.5 shrink-0 rounded p-0.5 text-muted-foreground/0 transition-colors group-hover:text-muted-foreground/60 hover:!text-muted-foreground"
                  title="Edit mission statement"
                >
                  <Pencil className="h-3 w-3" />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={startEditMission}
                className="text-xs text-muted-foreground/50 hover:text-muted-foreground"
              >
                + Add mission statement
              </button>
            )}
          </div>
        )}
      </div>
  )

  return (
    <div className="ltm-organizer-shell h-full min-h-0 w-full">
      <div className="flex h-full min-h-0">
        {/* On iPhone, the desktop collapse state is ignored — list/detail mode
            is the sole authority. Sidebar always shows in list mode. */}
        {!phoneDetailMode && (
          <aside
            className={cn(
              // `overscroll-none`: WebKit rubber-bands an overflow:auto pane on
              // a wheel gesture even when its content fits, so the project list
              // bounced under the cursor and read as a scrolling web page rather
              // than a fixed sidebar. It still scrolls when it genuinely
              // overflows — it just no longer moves when there is nowhere to go.
              'ltm-organizer-shell-nav bg-background/40 overflow-y-auto overflow-x-hidden overscroll-none',
              phoneListMode
                // The native dock floats over the web view (64pt above the home
                // indicator) and nothing reserves room for it, so the last
                // project could never be scrolled clear.
                // No padding of its own: the large-title bar spans edge to edge
                // and the list cards inset themselves.
                ? 'flex-1 pb-[calc(var(--ltm-safe-bottom,0px)+5.5rem)] opacity-100'
                : cn(
                    'shrink-0 transition-[width,opacity] duration-200 ease-out',
                    sidebarCollapsed
                      ? 'w-0 opacity-0 pointer-events-none border-r-0 px-0 py-4'
                      : 'w-[220px] opacity-100 border-r border-border/60 px-3 py-4',
                  ),
            )}>
            {phoneListMode ? (
              // Negative margins cancel the scroller's own `px-4 py-4` so the
              // blurred bar reaches the screen edges and the status bar.
              <PhoneLargeTitleBlock title="Organizer" />
            ) : (
              <p className="mb-2 px-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Thinking Organizer
              </p>
            )}
            {phoneListMode ? (
              <PhoneListSectionHeaderBlock className="pt-1">Projects</PhoneListSectionHeaderBlock>
            ) : (
              <p className="mb-2 mt-5 px-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Projects
              </p>
            )}
            <nav>
              <PhoneListGroupBlock enabled={phoneListMode} className={phoneListMode ? undefined : 'space-y-1'}>
              {projectEntries.map((entry) => {
                const active = projectRoot === entry.root
                if (phoneListMode) {
                  return (
                    <PhoneListRowBlock
                      key={entry.root}
                      icon={<FolderTree className={PHONE_LIST_ICON_CLASS_BLOCK} />}
                      label={entry.name}
                      onClick={() => selectProject(entry.root)}
                    />
                  )
                }
                return (
                  <button
                    key={entry.root}
                    type="button"
                    onClick={() => selectProject(entry.root)}
                    className={cn(
                      'ltm-motion-fast flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors',
                      active
                        ? 'bg-foreground text-background'
                        : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                    )}
                  >
                    <FolderTree className="h-4 w-4 shrink-0" />
                    <span className="truncate">{entry.name}</span>
                  </button>
                )
              })}
              {projectEntries.length === 0 && (
                <p className={cn(
                  'text-muted-foreground/60',
                  phoneListMode ? 'px-4 py-3 text-[15px]' : 'px-2 py-1 text-xs',
                )}>No projects yet.</p>
              )}
              </PhoneListGroupBlock>
            </nav>
            <Button
              size="sm"
              variant="outline"
              className={cn('mt-3 w-full', phoneListMode && 'h-11 w-[calc(100%-2rem)] mx-4 text-[15px]')}
              onClick={() => window.dispatchEvent(new CustomEvent(ORGANIZER_OPEN_CREATE_PROJECT_EVENT))}
            >
              <Plus className="mr-1.5 h-4 w-4" />
              Create Project
            </Button>
          </aside>
        )}

        <div className={cn(
          'relative min-w-0',
          phoneListMode ? 'hidden' : 'flex-1',
          orgView === 'canvas'
            ? 'overflow-hidden'
            : 'overflow-y-auto px-6 py-5',
        )}>
          {/* Four lenses onto the same undertakings. The queue used to sit here
              as a fifth option, which was a category error — it is a chore, not
              a lens — so it lives in the chrome beside the sidebar toggle. */}
          <div className="absolute right-3 top-3 z-40">
            <SegmentedToggleBlock
              value={orgView}
              onChange={setOrgView}
              ariaLabel="Organizer view"
              options={[
                { value: 'index', label: 'Index', icon: BookText, title: 'Thinking Organizer index' },
                { value: 'lineage', label: 'Lineage', icon: Network, title: 'grew_out_of lineage' },
                { value: 'list', label: 'List', icon: List, title: 'Backlog list view' },
                { value: 'canvas', label: 'Canvas', icon: LayoutDashboard, title: 'Canvas view' },
              ]}
            />
          </div>
          {orgView !== 'canvas' && headerBlock}
          {/* The index/lineage stay mounted; the detail opens as a drawer over
              them so a peek never costs your place in the scan. */}
          {orgView === 'index' ? (
            <UndertakingIndexBlock
              projectId={aiProjectId}
              onOpenUndertaking={openUndertakingDrawer}
              onOpenNote={openNoteDrawer}
            />
          ) : orgView === 'lineage' ? (
            <UndertakingDagBlock projectId={aiProjectId} onOpenUndertaking={openUndertakingDrawer} />
          ) : (
            <BacklogOrch
              view={orgView === 'canvas' ? 'canvas' : 'list'}
              canvasProjectName={projectName}
              canvasMissionStatement={missionStatement}
            />
          )}
          {(orgView === 'index' || orgView === 'lineage') && openUndertaking && aiProjectId && (
            <UndertakingDetailDrawerBlock
              projectId={aiProjectId}
              undertakingKey={openUndertaking}
              onOpen={openUndertakingDrawer}
              onClose={() => setOpenUndertaking(null)}
            />
          )}
          {orgView === 'index' && openNote && aiProjectId && (
            <NoteDetailDrawerBlock
              projectId={aiProjectId}
              noteKey={openNote}
              onOpenUndertaking={openUndertakingDrawer}
              onClose={() => setOpenNote(null)}
            />
          )}
        </div>
      </div>
    </div>
  )
}
