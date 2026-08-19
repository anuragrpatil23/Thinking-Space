import { memo, useEffect, useRef, useState, type ReactNode } from 'react'
import { Loader2, X, FolderTree, ChevronDown, ChevronRight, Save, Tag, MoreHorizontal, Info } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/lego_blocks/units/ui/tooltip'
import { Switch } from '@/components/lego_blocks/units/ui/switch'
import FolderTreePickerBlock from '@/components/lego_blocks/integrations/FolderTreePickerBlock'
import ProjectDestinationListBlock from '@/components/lego_blocks/units/ProjectDestinationListBlock'
import DestinationPickerSheetBlock from '@/components/lego_blocks/integrations/DestinationPickerSheetBlock'
import MoodPickerBlock, { moodDotClassForLabelBlock } from '@/components/lego_blocks/integrations/MoodPickerBlock'
import NoteTagsPopoverBlock from '@/components/lego_blocks/integrations/NoteTagsPopoverBlock'
import InfoPanelToggleButtonBlock from '@/components/lego_blocks/units/InfoPanelToggleButtonBlock'
import MarkdownRichEditorBlock from '@/components/lego_blocks/integrations/MarkdownRichEditorLazyBlock'
import CanvasSurfaceOrch from '@/components/orchestrators/CanvasSurfaceOrch'
import BacklogCanvasAnchorBlock from '@/components/lego_blocks/integrations/BacklogCanvasAnchorBlock'
import { useNoteComposerOrch } from '@/components/orchestrators/useNoteComposerOrch'
import { openFileInNewTabOrch } from '@/services/orchestrators/fileSystemOrch'
import { useUILayoutBlock } from '@/components/lego_blocks/hooks/shared/useUILayoutBlock'
import { useNativeChromeImmersionBlock } from '@/components/lego_blocks/hooks/shared/useNativeChromeImmersionBlock'
import { deriveAdaptiveShellStateOrch } from '@/services/orchestrators/uiNavigationOrch'
import { NOTE_KINDS_BLOCK } from '@/services/lego_blocks/units/noteComposerBlock'

// Settings-panel vocabulary. Kept as constants so every row in the popover is
// visually identical — the old panel drifted because each row styled itself.
const PANEL_LABEL_CLASS = 'text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground/70'
const PANEL_INPUT_CLASS = 'h-9 w-full rounded-lg border border-input bg-background px-2.5 text-sm outline-none transition-colors focus:border-foreground/30'
const PANEL_CHIP_CLASS = 'group ltm-motion-fast inline-flex items-center gap-0.5 rounded-full border border-border/70 bg-background px-1.5 py-0.5 text-xs text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground'
const PANEL_CHIP_ACTIVE_CLASS = 'border-foreground bg-foreground text-background hover:border-foreground hover:text-background'

/** Title-bar chrome is icon-only, so every control needs a name on hover — and
 *  it is the explorer's tooltip, not the browser's `title=`: native tooltips
 *  wait ~1.5s, render outside the theme, and stack badly over popovers. */
function TitleBarTipBlock({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  )
}

const NEW_THOUGHT_CANVAS_WORLD_WIDTH = 4500
const NEW_THOUGHT_CANVAS_ANCHOR_WIDTH = 1024
const NEW_THOUGHT_CANVAS_ANCHOR_CENTER_X = NEW_THOUGHT_CANVAS_WORLD_WIDTH / 2
const NEW_THOUGHT_CANVAS_HEADING_TOP_Y = 320
const NEW_THOUGHT_CANVAS_ANCHOR_TOP_Y = 500
const NEW_THOUGHT_CANVAS_BOTTOM_BREATHING = 800

// New Note view. All composer state — destination, filename, todo mode,
// content, save — lives in `useNoteComposerOrch`; this file only decides how
// it looks. State kept local here is presentation-only: which surface is
// showing, which panel is revealed, and the draft fields of the
// quick-destination modal (its *result* goes through the orchestrator).
function CreateTab() {
  const { layout } = useUILayoutBlock()
  // Phones get a sheet instead of the floating dock — the native bottom chrome
  // already owns that edge (docs/contracts/IOS-NATIVE-CHROME.md).
  const isPhoneSurface = layout.mode === 'phone'
  // Same derivation the app shell uses, so the settings sheet reserves exactly
  // the height the bottom dock occupies rather than guessing at it.
  const shell = deriveAdaptiveShellStateOrch(layout)
  const composer = useNoteComposerOrch()

  // Canvas mode has no switch in the UI right now (removed 2026-07-31 at the
  // user's request — "I will think about it later"). The branch is kept so
  // bringing the toggle back is a one-line change rather than a re-write.
  const [viewSurface] = useState<'doc' | 'canvas'>('doc')
  const [canvasAnchorHeight, setCanvasAnchorHeight] = useState(800)
  const [showMetaPanel, setShowMetaPanel] = useState(false)
  // Note settings live behind the filename button in the title bar: the panel
  // is a popover on desktop, a bottom sheet on phone (the native bottom chrome
  // owns that edge). Never a permanently docked slab — the writing surface
  // stays edge to edge, which is the whole point of the iA layout.
  const [composerPanelOpen, setComposerPanelOpen] = useState(false)
  // The project half of the path, editable from the path itself. Separate from
  // the settings panel because it is the one part of the address that changes
  // often enough to deserve a one-click route (2026-08-19).
  const [projectMenuOpen, setProjectMenuOpen] = useState(false)
  const [destinationBrowserOpen, setDestinationBrowserOpen] = useState(false)
  // Phone only: destination is its own sheet, pushed on top of Note settings.
  const [destinationSheetOpen, setDestinationSheetOpen] = useState(false)
  // Emotions and tags left the settings panel (2026-07-31). They are not
  // settings like filename or destination — one is an act of reflection, the
  // other a quick aside while writing — so each gets its own title-bar button
  // and its own room.
  const [moodPickerOpen, setMoodPickerOpen] = useState(false)
  const [tagsPopoverOpen, setTagsPopoverOpen] = useState(false)
  const [showAiAssist, setShowAiAssist] = useState(false)
  // Phone only. The bar keeps what you reach for mid-sentence — mood, tags, the
  // save dot — and everything you go *looking* for (the editor's AI / Mindmap /
  // Formatting controls, and the metadata panel) moves behind this. Fitting all
  // seven on a 390px bar was never going to work; the icons kept climbing over
  // the filename (2026-08-01).
  const [overflowMenuOpen, setOverflowMenuOpen] = useState(false)

  // Title-bar popovers (mood, tags, metadata) hang off their own button, which
  // assumes there is room to the left of it. On a phone there is not: the mood
  // picker is a near-full-width panel anchored to a button three quarters of
  // the way across the bar, so `right-0` put its whole left half — the search
  // field, the quadrant labels, every feeling word — off the screen
  // (2026-08-01). On phone they stop being anchored to the trigger and centre
  // under the bar instead: dropping `relative` from the wrapper leaves the
  // title bar itself as the positioning ancestor, and it spans the viewport.
  const popoverAnchorClass = isPhoneSurface ? undefined : 'relative'
  const popoverPositionClass = isPhoneSurface
    ? 'absolute left-1/2 top-full z-50 mt-1.5 -translate-x-1/2'
    : 'absolute right-0 top-full z-50 mt-1.5'

  const panelTriggerRef = useRef<HTMLButtonElement | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const projectMenuTriggerRef = useRef<HTMLButtonElement | null>(null)
  const projectMenuRef = useRef<HTMLDivElement | null>(null)
  const tagsTriggerRef = useRef<HTMLButtonElement | null>(null)
  const tagsPopoverRef = useRef<HTMLDivElement | null>(null)
  const metaTriggerRef = useRef<HTMLDivElement | null>(null)
  const metaPanelRef = useRef<HTMLDivElement | null>(null)
  const moodTriggerRef = useRef<HTMLButtonElement | null>(null)
  const moodPopoverRef = useRef<HTMLDivElement | null>(null)
  const overflowTriggerRef = useRef<HTMLButtonElement | null>(null)
  const overflowMenuRef = useRef<HTMLDivElement | null>(null)
  // Portal target for the editor's own AI / Mindmap / formatting buttons, so
  // all chrome sits on the title bar's one line instead of a second strip.
  // State, not a ref: the editor must re-render once the node exists.
  const [editorControlsSlot, setEditorControlsSlot] = useState<HTMLDivElement | null>(null)


  // Dismiss the settings popover the way every other popover behaves: Escape,
  // or a click anywhere that isn't the panel or the button that opened it.
  // (Phone uses a sheet with its own scrim, so this only matters on desktop.)
  useEffect(() => {
    if (!composerPanelOpen || isPhoneSurface) return
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node
      if (panelRef.current?.contains(target)) return
      if (panelTriggerRef.current?.contains(target)) return
      setComposerPanelOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setComposerPanelOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [composerPanelOpen, isPhoneSurface])

  // Same contract for the project menu. It is a peer of the settings panel, not
  // a child, so it dismisses on its own terms — opening one closes the other
  // (below), which keeps two popovers from overlapping in the same bar.
  useEffect(() => {
    if (!projectMenuOpen) return
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node
      if (projectMenuRef.current?.contains(target)) return
      if (projectMenuTriggerRef.current?.contains(target)) return
      setProjectMenuOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setProjectMenuOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [projectMenuOpen])

  // One dismissal contract for the three title-bar popovers: a click inside a
  // popover (or on its own trigger) leaves it alone and closes the other two,
  // so they can never stack; a click anywhere else closes all of them.
  // Escape is owned by whichever popover has an input to clear first — mood and
  // tags handle their own — so only metadata needs it here.
  useEffect(() => {
    if (!tagsPopoverOpen && !showMetaPanel && !moodPickerOpen && !overflowMenuOpen) return
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node
      const inside = (
        popover: React.RefObject<HTMLElement | null>,
        trigger: React.RefObject<HTMLElement | null>,
      ) => Boolean(popover.current?.contains(target) || trigger.current?.contains(target))

      const hitTags = inside(tagsPopoverRef, tagsTriggerRef)
      const hitMeta = inside(metaPanelRef, metaTriggerRef)
      const hitMood = inside(moodPopoverRef, moodTriggerRef)
      const hitOverflow = inside(overflowMenuRef, overflowTriggerRef)

      if (!hitTags) setTagsPopoverOpen(false)
      if (!hitMeta) setShowMetaPanel(false)
      if (!hitMood) setMoodPickerOpen(false)
      if (!hitOverflow) setOverflowMenuOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setShowMetaPanel(false)
        setOverflowMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [tagsPopoverOpen, showMetaPanel, moodPickerOpen, overflowMenuOpen])

  // One box per job, matching the tree's box. Paths render flat — no emphasis
  // on the last segment: these are whole paths you jump to, and bolding the
  // leaf implied a distinction that does not exist here.
  const jumpListBlock = (title: string, paths: string[]) => (
    <div className="flex min-h-0 flex-col gap-1.5">
      <div className={PANEL_LABEL_CLASS}>{title}</div>
      {/* Capped: stacked in one column, an uncapped list would push its sibling
          off the bottom of the panel. Tall enough for five rows so the cap
          rarely bites — the old 15vh sliced the last row in half, which read as
          broken rather than as "scroll for more". */}
      <div className="min-h-0 max-h-[22vh] flex-1 space-y-0.5 overflow-auto rounded-lg border border-border/60 bg-background p-1.5">
        {paths.length === 0 ? (
          <div className="px-2 py-1.5 text-[11px] text-muted-foreground/60">Nothing yet.</div>
        ) : paths.map((path) => (
          <button
            key={`${title}-${path}`}
            type="button"
            onClick={() => composer.applyDestinationPath(path)}
            title={path}
            className="ltm-motion-fast block w-full break-all rounded-md px-2 py-1.5 text-left font-mono text-[11px] leading-relaxed text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            {path}
          </button>
        ))}
      </div>
    </div>
  )

  const handleRelatedThoughtOpenPath = (relatedPath: string) => {
    openFileInNewTabOrch(relatedPath)
    composer.setMessage(`Opened ${relatedPath} in a new tab.`)
  }

  // Ambient save state, borrowed from the explorer's editing badge
  // (MarkdownDocumentBlock): while auto-save is on there is no Save button at
  // all — the dot tells you where you stand. Clicking it toggles auto-save,
  // which is also the only way the Save button comes back.
  const isTodoMode = composer.makeThisTodo
  const saveBadgeLabel = composer.saving
    ? 'Saving…'
    : isTodoMode
      ? 'To do'
      : !composer.autoSaveEnabled
        ? (composer.isDirty ? 'Editing · manual' : 'Manual')
        : composer.isDirty
          ? 'Editing'
          : composer.saveState === 'saved' ? 'Saved' : 'Draft'

  const saveBadgeDotClass = composer.saving
    ? 'animate-pulse bg-amber-500'
    : !composer.autoSaveEnabled || isTodoMode
      ? 'bg-muted-foreground/50'
      : composer.isDirty
        ? 'bg-amber-500'
        : composer.saveState === 'saved' ? 'bg-emerald-500' : 'bg-muted-foreground/40'

  // Left as it was, on request (2026-07-31) — the save controls keep their
  // native `title=`; only mood, tags and the (i) button moved to tooltips.
  const saveStateBadgeBlock = (
    <button
      type="button"
      onClick={() => composer.setAutoSaveEnabled(!composer.autoSaveEnabled)}
      disabled={isTodoMode}
      title={isTodoMode
        ? 'To dos are appended on save — auto-save stays off so items are not duplicated'
        : composer.autoSaveEnabled
          ? 'Auto-save is on — click to switch to manual saving'
          : 'Auto-save is off — click to turn it on'}
      className={cn(
        'ltm-motion-fast inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground transition-colors',
        !isTodoMode && 'hover:bg-muted hover:text-foreground',
        isTodoMode && 'cursor-default',
      )}
    >
      <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', saveBadgeDotClass)} />
      <span className="hidden sm:inline">{saveBadgeLabel}</span>
    </button>
  )

  // Mood + tags. Both are icon-only, and both carry their own state as a
  // colour: the smiley takes the quadrant colour of the first feeling picked,
  // the tag icon fills in once anything is tagged. No word next to either — the
  // icons say it, and the bar has better uses for the width. No count either:
  // the point is a glance, and the number is in the room behind the button.
  // A blob, not a face. Lucide's `Smile` is a stroked circle with two dots for
  // eyes and at 16px it reads as unsettling rather than friendly (2026-07-31).
  // The circle is also the same mark the picker uses for its four quadrants, so
  // the button and the room behind it speak the same language.
  const moodDotClass = moodDotClassForLabelBlock(composer.emotions[0])

  // Title-bar tap targets. Desktop keeps the tight `p-1.5` icon button — it is
  // driven by a cursor, and a 44px button in a 44px bar reads as oversized
  // furniture. Phone gets the HIG 44pt minimum: these were ~28pt, small enough
  // that hitting mood instead of tags was routine (2026-08-01). The room comes
  // from the status-bar strip, which the bar now owns rather than sitting below.
  const titleBarIconButtonClass = isPhoneSurface
    ? 'h-11 w-11 justify-center rounded-lg'
    : 'rounded-md p-1.5'
  const titleBarIconSizeClass = isPhoneSurface ? 'h-[18px] w-[18px]' : 'h-4 w-4'

  const moodButtonBlock = !isTodoMode ? (
    <div className={popoverAnchorClass}>
      <TitleBarTipBlock
        label={composer.emotions.length > 0
          ? `Feeling ${composer.emotions.join(', ')}`
          : 'How do you feel?'}
      >
        <button
          ref={moodTriggerRef}
          type="button"
          onClick={() => setMoodPickerOpen(open => !open)}
          aria-expanded={moodPickerOpen}
          aria-label="Tag how you feel"
          className={cn(
            'ltm-motion-fast inline-flex items-center transition-colors hover:bg-muted',
            titleBarIconButtonClass,
            moodPickerOpen && 'bg-muted',
          )}
        >
          <span
            className={cn(
              'ltm-motion-fast rounded-full transition-colors',
              titleBarIconSizeClass,
              // Hollow while unset — a filled grey circle looks like a mood you
              // did not choose rather than a mood you have not chosen.
              moodDotClass ?? 'border-2 border-muted-foreground/50',
            )}
          />
        </button>
      </TitleBarTipBlock>
      {moodPickerOpen && (
        <div
          ref={moodPopoverRef}
          className={cn(
            'ltm-animate-fade-in overflow-hidden rounded-xl border border-border/70 bg-background shadow-2xl',
            popoverPositionClass,
          )}
        >
          <MoodPickerBlock
            selected={composer.emotions}
            onChange={composer.setEmotions}
            onClose={() => setMoodPickerOpen(false)}
            autoFocusSearch={!isPhoneSurface}
            // The panel hangs below the title bar, so a viewport-relative cap
            // overhangs the bottom of the screen by the bar's own height.
            maxHeightClassName={isPhoneSurface
              ? 'max-h-[min(38rem,calc(100vh-7rem))]'
              : undefined}
          />
        </div>
      )}
    </div>
  ) : null

  const tagsButtonBlock = (
    <div className={popoverAnchorClass}>
      {/* Phone: the trigger moves into the … menu and only the popover stays
          here, so it keeps hanging off the title bar rather than off a menu row
          that vanishes when you tap it (same split as metadata below). Losing
          the button is what buys the filename its centring — a 44pt target on
          each flank is more than a 390pt bar can spend (2026-08-01). */}
      {!isPhoneSurface && (
      <TitleBarTipBlock
        label={composer.tags.length > 0 ? composer.tags.join(', ') : 'Add tags'}
      >
        <button
          ref={tagsTriggerRef}
          type="button"
          onClick={() => setTagsPopoverOpen(open => !open)}
          aria-expanded={tagsPopoverOpen}
          aria-label="Add tags"
          className={cn(
            'ltm-motion-fast inline-flex items-center transition-colors hover:bg-muted hover:text-foreground',
            titleBarIconButtonClass,
            composer.tags.length > 0 ? 'text-foreground' : 'text-muted-foreground',
            tagsPopoverOpen && 'bg-muted text-foreground',
          )}
        >
          <Tag className={cn(titleBarIconSizeClass, composer.tags.length > 0 && 'fill-current')} />
        </button>
      </TitleBarTipBlock>
      )}
      {tagsPopoverOpen && (
        <div
          ref={tagsPopoverRef}
          className={cn(
            'ltm-animate-fade-in rounded-xl border border-border/70 bg-background shadow-2xl',
            popoverPositionClass,
          )}
        >
          <NoteTagsPopoverBlock
            tags={composer.tags}
            onChange={composer.setTags}
            onClose={() => setTagsPopoverOpen(false)}
          />
        </div>
      )}
    </div>
  )

  // Counts and the YAML preview, anchored to the (i) button. Read-only, so it
  // dismisses on any outside click without anything to reconcile.
  const metaPanelBlock = (
    <div className={popoverAnchorClass}>
      {/* On phone the (i) button lives in the … menu instead — only the panel
          itself renders here, still anchored to the title bar. */}
      {!isPhoneSurface && (
        <TitleBarTipBlock label="Metadata & YAML">
          {/* Empty `title` so the shared button's native tooltip does not race
              the themed one. The block is used on other surfaces that have no
              TooltipProvider, so its default stays the native string. */}
          <div ref={metaTriggerRef} className="flex">
            <InfoPanelToggleButtonBlock
              active={showMetaPanel}
              onToggle={() => setShowMetaPanel(open => !open)}
              title=""
            />
          </div>
        </TitleBarTipBlock>
      )}
      {showMetaPanel && (
        <div
          ref={metaPanelRef}
          className={cn(
            'ltm-animate-fade-in w-[min(24rem,calc(100vw-2rem))] space-y-2 rounded-xl border border-border/70 bg-background p-3 shadow-2xl',
            popoverPositionClass,
          )}
        >
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span><strong className="text-foreground/70">{composer.contentMeta.lines}</strong> lines</span>
            <span><strong className="text-foreground/70">{composer.contentMeta.words}</strong> words</span>
            <span><strong className="text-foreground/70">{composer.contentMeta.headings}</strong> headings</span>
            <span>{composer.contentMeta.size}</span>
          </div>
          <div className={PANEL_LABEL_CLASS}>YAML metadata</div>
          <textarea
            value={composer.frontmatterPreview}
            readOnly
            spellCheck={false}
            className="min-h-[8rem] w-full rounded-lg border border-border/60 bg-muted/20 px-2.5 py-2 font-mono text-xs text-foreground outline-none"
            aria-label="YAML metadata preview"
          />
          <div className="text-[11px] text-muted-foreground">
            Preview only. Final metadata is generated on save.
          </div>
        </div>
      )}
    </div>
  )

  // The phone's overflow menu. Two things live in it: the editor's own controls
  // (portalled in, wearing their `'menu'` layout) and the metadata panel's
  // trigger.
  //
  // Rendered always and *hidden* when closed rather than unmounted, because the
  // portal target has to outlive the menu: the moment `editorControlsSlot` goes
  // null the editor renders its controls in place instead — which would drop an
  // AI/Mindmap row into the top of the writing surface every time you dismissed
  // the menu.
  const overflowMenuBlock = isPhoneSurface ? (
    <div
      ref={overflowMenuRef}
      className={cn(
        'absolute right-2 top-full z-50 mt-1.5 w-[min(15rem,calc(100vw-2rem))] rounded-xl border border-border/70 bg-background p-1 shadow-2xl',
        !overflowMenuOpen && 'hidden',
      )}
    >
      {/* Any control in here acts and dismisses — each one opens a panel that
          wants the screen the menu is sitting on. */}
      <div
        ref={setEditorControlsSlot}
        className="w-full"
        onClick={() => setOverflowMenuOpen(false)}
      />
      <button
        type="button"
        onClick={() => {
          setTagsPopoverOpen(open => !open)
          setOverflowMenuOpen(false)
        }}
        className={cn(
          'ltm-motion-fast inline-flex w-full items-center justify-start gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors hover:bg-muted hover:text-foreground',
          composer.tags.length > 0 ? 'text-foreground' : 'text-muted-foreground',
        )}
      >
        <Tag className={cn('h-3.5 w-3.5 shrink-0', composer.tags.length > 0 && 'fill-current')} />
        {/* The count is what the bar's icon could only imply. A menu row has
            the width to just say it. */}
        {composer.tags.length > 0 ? `Tags · ${composer.tags.length}` : 'Tags'}
      </button>
      <button
        type="button"
        onClick={() => {
          setShowMetaPanel(open => !open)
          setOverflowMenuOpen(false)
        }}
        className="ltm-motion-fast inline-flex w-full items-center justify-start gap-2.5 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <Info className="h-3.5 w-3.5 shrink-0" />
        Metadata
      </button>
    </div>
  ) : null

  const overflowButtonBlock = isPhoneSurface ? (
    <button
      ref={overflowTriggerRef}
      type="button"
      onClick={() => setOverflowMenuOpen(open => !open)}
      aria-expanded={overflowMenuOpen}
      aria-label="More note controls"
      className={cn(
        'ltm-motion-fast inline-flex items-center text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
        titleBarIconButtonClass,
        overflowMenuOpen && 'bg-muted text-foreground',
      )}
    >
      <MoreHorizontal className={titleBarIconSizeClass} />
    </button>
  ) : null

  // Manual mode only. Auto-save is the normal path, and it needs no button.
  const manualSaveButtonBlock = (!composer.autoSaveEnabled || isTodoMode) ? (
    <button
      type="button"
      onClick={composer.save}
      disabled={!composer.canSave}
      title={isTodoMode ? 'Append these items to the todo note' : 'Save note'}
      className={cn(
        'ltm-motion-fast inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium transition-colors',
        composer.saveFeedbackVisible && !composer.saving
          ? 'text-emerald-600 dark:text-emerald-400'
          : 'text-muted-foreground hover:bg-muted hover:text-foreground',
        !composer.canSave && 'opacity-40',
      )}
    >
      {composer.saving
        ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
        : <Save className="h-3.5 w-3.5" />}
      <span className="hidden sm:inline">
        {composer.saveFeedbackVisible && !composer.saving ? 'Saved' : 'Save'}
      </span>
    </button>
  ) : null

  // One editor instance, two framings: canvas keeps the card-in-anchor
  // shape (toolbar pinned, bounded height); doc mode runs it full-bleed
  // with the toolbar collapsed behind its own toggle — the iA surface.
  const editorSurfaceBlock = (
    <MarkdownRichEditorBlock
      value={composer.editorBody}
      onChange={composer.setEditorBody}
      currentPath={composer.targetPath ?? ''}
      placeholder={composer.makeThisTodo ? 'One task per line...' : "What's on your mind?"}
      toolbarAlwaysVisible={viewSurface === 'canvas'}
      headerControlsContainer={viewSurface === 'doc' ? editorControlsSlot : null}
      headerControlsLayout={isPhoneSurface ? 'menu' : 'bar'}
      aiPanelOpen={showAiAssist}
      onAiPanelOpenChange={setShowAiAssist}
      aiAssistScope="new_thought"
      aiAssistUseCase="new_thought.assist"
      aiAssistDisabled={composer.saving || composer.loadingTargetContent}
      aiAssistHelperText="Suggestions apply inline. Configure provider/model in AI Settings."
      onRelatedThoughtOpenPath={handleRelatedThoughtOpenPath}
      typographyProfile="focus"
      // Without this the focus profile keeps its 76ch measure — ~770px of
      // monospace centered in a 390px viewport, so half of every line hung off
      // the left edge of the phone (2026-08-01). It also drops the header
      // controls to glyphs, which is what keeps them off the filename.
      compactMobile={isPhoneSurface}
      focusKeyboardInsetPx={layout.keyboardInset}
      className={viewSurface === 'canvas'
        ? 'min-h-[520px] rounded-none border-0 border-b border-border/40 md:min-h-[620px]'
        : 'h-full rounded-none border-0'}
    />
  )

  // Note settings — one popover, four stacked sections separated by hairlines:
  // identity, destination, options, emotions. Everything is a labelled row, so
  // the panel reads as a settings sheet rather than the pile of chips and
  // bordered boxes it used to be.
  // The destination as a sticky strip at the very top of the panel while the
  // browser is open. It has to outlive scrolling: the tree is taller than the
  // panel, so by the time you are deep enough to click something the path had
  // scrolled out of sight — which is exactly when you need to watch it change.
  // Always on, always pinned: the full path including the filename. This is the
  // panel's answer to "where does this note go", so the line that used to
  // repeat it under File name is gone — one place, not two.
  const stickyDestinationBlock = (
    <div className="sticky top-0 z-20 flex items-baseline gap-2 border-b border-border/60 bg-background/95 px-4 py-2.5 backdrop-blur">
      {/* Label and path share one line — the stacked version cost a whole row of
          panel height to say two words. */}
      {/* Sentence case, not the panel's uppercase label style. This one sits
          inline with the path and reads as the start of a sentence, not as a
          section header for the rows below.
          The dot is a resolved/unresolved tell: green once there is a real file
          to write to, dim while the path is still missing a piece. */}
      <div className="flex shrink-0 items-center gap-1.5 text-[11px] text-muted-foreground/70">
        <span
          className={cn(
            'ltm-motion-fast h-1.5 w-1.5 rounded-full transition-colors',
            composer.targetPath ? 'bg-emerald-500' : 'bg-muted-foreground/30',
          )}
        />
        Saving to
      </div>
      {composer.targetPath ? (
        <button
          type="button"
          onClick={() => openFileInNewTabOrch(composer.targetPath!)}
          title={composer.targetPath}
          // One line, never wrapped. `break-all` split the path mid-word and
          // left the filename orphaned on a second line reading `d` — the
          // folder gives way instead: it truncates, the filename never does,
          // because the filename is the part you are checking.
          className="flex min-w-0 flex-1 items-baseline text-left font-mono text-xs leading-snug transition-colors hover:text-primary"
        >
          <span className="truncate text-muted-foreground">{composer.destinationPath}/</span>
          <span className="shrink-0 font-semibold text-foreground">{composer.targetPath.split('/').pop()}</span>
        </button>
      ) : (
        <div className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground/60">
          {composer.makeThisTodo ? 'Pick a destination and date' : 'Pick a destination and file name'}
        </div>
      )}
    </div>
  )

  // The sheet is content-sized, so "make it taller" is a question of how much
  // room each section takes, not of the `max-h` cap — that cap was never being
  // reached (2026-08-01). Phone sections breathe more and every toggle row is a
  // 44pt target, which grows the sheet and makes it easier to hit at once.
  const panelSectionPadClass = isPhoneSurface ? 'px-4 py-5' : 'p-4'
  const switchSize = isPhoneSurface ? 'touch' : 'default'

  // The floating bottom dock used to sit on top of this sheet — its last two
  // rows were behind it, unreadable and untappable — so the sheet reserved the
  // dock's whole height. Now the sheet takes an immersion lease and the dock
  // goes away while it is open, which is what a modal should do: nothing behind
  // it is reachable anyway, and the dock was the loudest thing on the screen
  // competing with it. With the dock gone the reservation would be dead space,
  // so pad to the safe area only (2026-08-01).
  useNativeChromeImmersionBlock(isPhoneSurface && composerPanelOpen)
  const sheetBottomPadPx = Math.max(shell.bottomInset, 12)
  const panelToggleRowClass = cn(
    'flex items-center justify-between gap-3',
    isPhoneSurface && 'min-h-[44px]',
  )

  const noteConfigBlock = (
    <div className="divide-y divide-border/40 text-sm">
      {stickyDestinationBlock}
      {/* --- identity --- */}
      <div className={cn('space-y-2', panelSectionPadClass)}>
        <div className={PANEL_LABEL_CLASS}>{composer.makeThisTodo ? 'Todo date' : 'File name'}</div>
        {composer.makeThisTodo ? (
          <input
            type="date"
            value={composer.todoDateStr}
            onChange={(event) => composer.setTodoDateStr(event.target.value)}
            aria-label="Todo date"
            className={PANEL_INPUT_CLASS}
          />
        ) : (
          <input
            value={composer.filename}
            onChange={(event) => composer.setFilename(event.target.value)}
            placeholder="2026-02-26.md"
            aria-label="File name"
            className={PANEL_INPUT_CLASS}
          />
        )}
        {/* The resolved path used to be repeated here. It lives in the sticky
            "Saving to" strip at the top of the panel now. */}
        {composer.loadingTargetContent && (
          <div className="text-[11px] text-muted-foreground">Loading destination note…</div>
        )}
      </div>

      {/* --- note type ---
          Ahead of the destination on purpose: it routes to a different
          capability and changes what saving means, so it is the first decision
          about the note, not a switch tucked in with the cosmetic ones. */}
      <div className={cn('space-y-1.5', panelSectionPadClass)}>
        <div className={PANEL_LABEL_CLASS}>Note type</div>
        {/* Chips, same as Destination below. The segmented full-width control
            this used to be was the only widget in the panel shaped like that,
            and it stretched four short words across the whole row. */}
        <div className={cn('flex flex-wrap', isPhoneSurface ? 'gap-2' : 'gap-1.5')}>
          {NOTE_KINDS_BLOCK.map((kind) => (
            <button
              key={kind.id}
              type="button"
              onClick={() => composer.setNoteKind(kind.id)}
              className={cn(
                PANEL_CHIP_CLASS,
                'px-2.5',
                // PANEL_CHIP_CLASS is shared with the desktop quick-destination
                // chips, so the finger-sized version is layered on here rather
                // than in the constant.
                isPhoneSurface && 'h-9 px-3.5 text-sm',
                composer.noteKind === kind.id && PANEL_CHIP_ACTIVE_CLASS,
              )}
            >
              {kind.label}
            </button>
          ))}
        </div>
      </div>

      {/* --- destination ---
          Phone gets a disclosure row that pushes the picker sheet; everything
          below is the desktop layout, which has the width for a tree beside two
          jump lists and stays as it was. */}
      {isPhoneSurface ? (
        <button
          type="button"
          onClick={() => setDestinationSheetOpen(true)}
          className="ltm-motion-fast flex w-full items-center gap-3 p-4 text-left transition-colors hover:bg-muted/50"
        >
          <div className="min-w-0 flex-1">
            <div className={PANEL_LABEL_CLASS}>Destination</div>
            <div className="truncate pt-1 font-mono text-[13px] text-foreground">
              {composer.destinationPath || 'Choose a folder…'}
            </div>
          </div>
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
        </button>
      ) : (
      <div className={cn('space-y-2.5', panelSectionPadClass)}>
        <div className="flex items-center justify-between gap-2">
          <div className={PANEL_LABEL_CLASS}>Project</div>
          <button
            type="button"
            onClick={() => setDestinationBrowserOpen(open => !open)}
            className={cn(
              'ltm-motion-fast inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium transition-colors hover:bg-muted hover:text-foreground',
              destinationBrowserOpen ? 'bg-muted text-foreground' : 'text-muted-foreground',
            )}
          >
            <FolderTree className="h-3 w-3" />
            Browse
          </button>
        </div>

        {/* The project list, not a chip cloud of saved paths. Note type (above)
            supplies the folder inside the project, so this control answers one
            question — which project — and the two compose into the path shown on
            the "Saving to" line. Built-in folder shortcuts still exist in the
            model (todo mode reaches `todos/` through one); they are not a thing
            you click here, for the same reason they were removed in 2026-07-31:
            they duplicated the Note type control word for word. */}
        <ProjectDestinationListBlock
          destinations={composer.projectDestinations}
          activeKey={composer.activeProjectKey}
          onSelect={composer.selectProject}
          listClassName="max-h-[11rem]"
        />

        {/* The browser unfolds in place rather than in a modal (2026-07-31).
            A modal put a `fixed` scrim over a popover that lives inside the
            title bar's stacking context, so the scrim painted *on top of* the
            panel and the whole thing went translucent. Inline also means
            picking a folder is one click, not click-then-confirm. */}
        {destinationBrowserOpen && (
          <div className="space-y-2.5">
            {/* Three peers, each in its own box: explorer, most used, recent.
                The single outer container that used to wrap them added a frame
                around a frame and made the group read as one widget. */}
            {/* 1.15fr, not 1.6fr — full vault paths were wrapping onto three
                lines in the jump column while the tree sat on empty space. */}
            <div className="grid gap-2.5 sm:grid-cols-[1.15fr_1fr]">
              <div className="flex min-h-0 flex-col gap-1.5">
                <div className={PANEL_LABEL_CLASS}>Explorer</div>
                <FolderTreePickerBlock
                  value={composer.destinationPath}
                  onChange={composer.applyDestinationPath}
                  maxHeightClassName="max-h-[34vh]"
                />
              </div>
              {/* The two jump lists stack in one column beside the tree — side by
                  side they were each too narrow for a nested path. */}
              <div className="flex min-h-0 flex-col gap-2.5">
                {jumpListBlock('Most used', composer.mostUsedDestinations.map(entry => entry.path))}
                {jumpListBlock('Recent', composer.recentDestinations)}
              </div>
            </div>
          </div>
        )}
      </div>
      )}

      {/* --- options --- */}
      <div className={cn('space-y-3', panelSectionPadClass)}>
        {composer.makeThisTodo ? (
          <p className="text-xs text-muted-foreground">
            Each non-empty line becomes a checklist item — {composer.todoItemCount} detected.
            Items are appended, so to dos always save manually.
          </p>
        ) : (
          <>
            <div className={panelToggleRowClass}>
              <label htmlFor="auto-save" className="cursor-pointer text-sm">Auto-save</label>
              <Switch
                id="auto-save"
                size={switchSize}
                checked={composer.autoSaveEnabled}
                onCheckedChange={composer.setAutoSaveEnabled}
              />
            </div>
            <div className={panelToggleRowClass}>
              <label htmlFor="date-header" className="cursor-pointer text-sm">Add date header</label>
              <Switch id="date-header" size={switchSize} checked={composer.dateHeader} onCheckedChange={composer.setDateHeader} />
            </div>
            <div className={panelToggleRowClass}>
              <label htmlFor="custom-title" className="cursor-pointer text-sm">Use custom title</label>
              <Switch id="custom-title" size={switchSize} checked={composer.useCustomTitle} onCheckedChange={composer.setUseCustomTitle} />
            </div>
            {composer.useCustomTitle && (
              <input
                value={composer.title}
                onChange={(event) => composer.setTitle(event.target.value)}
                placeholder="Becomes the note title + heading"
                aria-label="Custom title"
                className={PANEL_INPUT_CLASS}
              />
            )}
          </>
        )}
      </div>

      {/* Emotions used to live here as a panel section. They are a title-bar
          button now — see `moodButtonBlock`. */}

      {/* Metadata used to render here, gated on `showMetaPanel` — but this
          whole block only exists while the *settings panel* is open, so the
          title-bar (i) button toggled something nothing was showing and read as
          dead (2026-07-31). It is its own popover now, like Mood and Tags. */}
    </div>
  )

  // iA-Writer layout (2026-07-31): New Note is one full-bleed writing surface.
  // The title bar is a solid light strip, not a floating overlay — iA anchors
  // the document name against paper, and a translucent bar over body text
  // reads as a scrim. The filename *is* the settings button; everything about
  // where and how this note gets written lives behind it.
  //
  // The label is the *full* target path, not just the leaf: this is the one
  // place that answers "where is this going", and the destination is the thing
  // people actually get wrong. The leaf is the fallback while no destination
  // is chosen yet.
  // Split rather than truncated whole: the folder is what dims and clips, the
  // filename always stays legible. Truncating the string end-to-start would
  // eat exactly the part you look at.
  const identityLeafFallback = composer.makeThisTodo
    ? `To Do · ${composer.todoDateStr}`
    : (composer.filename || 'Untitled')
  const identityDir = composer.targetPath
    ? composer.targetPath.slice(0, composer.targetPath.lastIndexOf('/') + 1)
    : ''
  // The path splits at the project boundary so the two halves can be clicked
  // separately: the project name is its own control, the rest opens the settings
  // panel. `activeProject` is resolved from the path rather than remembered, so
  // a folder reached through Explorer still names the project it sits inside.
  const activeProject = composer.projectDestinations.find(
    destination => destination.key === composer.activeProjectKey,
  ) ?? null
  const projectPrefix = activeProject ? `${activeProject.segments.join('/')}/` : ''
  const identityDirAfterProject = projectPrefix && identityDir.startsWith(projectPrefix)
    ? identityDir.slice(projectPrefix.length)
    : identityDir
  const identityLeaf = composer.targetPath
    ? composer.targetPath.slice(composer.targetPath.lastIndexOf('/') + 1)
    : identityLeafFallback

  // The bar belongs to the paper, so it takes the paper's colour — but "paper"
  // is a different token per theme. In light, `--background` is grey and
  // `--card` is white, so card is right. In dark the pair inverts (bg 9%, card
  // 12%), so plain `bg-card` painted a visibly lighter strip across the top of
  // an otherwise near-black writing surface. Follow the surface, not the token.
  //
  // No bottom border either. Once the bar is the same colour as the paper the
  // rule was the only thing left drawing a box around the writing area, and the
  // controls read as chrome floating on the page without it.
  const titleBarBlock = (
    // One provider for the whole bar — the popovers anchored inside it (mood,
    // tags, metadata) render within this tree, so their own tooltips inherit it.
    <TooltipProvider delayDuration={200}>
    {/* Grid, not flex, for the three zones. Equal `1fr` flanks centre the
        filename exactly as the old flex spacers did, but an `fr` track is
        `minmax(auto, 1fr)` — it refuses to shrink below its content, so the
        control cluster can no longer overflow its share and spill leftward over
        the filename, which is precisely how the two ended up drawn on top of
        each other twice (2026-08-01). When the name is too long to centre, the
        left flank collapses and it slides left rather than colliding.

        On phone the bar swallows the status-bar strip (`--ltm-safe-top`) rather
        than starting below it: that strip was painting the grey shell
        background above the paper, and the page is meant to read as one sheet
        from the top edge down. Paying for it in padding also buys the height
        that makes 44pt tap targets fit. */}
    <div
      className={cn(
        'absolute inset-x-0 top-0 z-40 grid grid-cols-[1fr_auto_1fr] items-center gap-1 bg-card px-2 dark:bg-background sm:gap-2',
        isPhoneSurface
          ? 'h-[calc(3.5rem+var(--ltm-safe-top))] pt-[var(--ltm-safe-top)]'
          : 'h-11',
      )}
    >
      <div />

      <div className="relative flex min-w-0 items-center justify-center">
        {/* The project segment is its own control (desktop only — the phone bar
            has no room, and its sheet lists projects already). Clicking the part
            of the path that names the project opens the project list right
            there; the rest of the pill still opens the settings panel. Two
            sibling buttons, never nested — the path *is* the picker. */}
        {!isPhoneSurface && (
          <TitleBarTipBlock label="Change project">
            <button
              ref={projectMenuTriggerRef}
              type="button"
              onClick={() => {
                setComposerPanelOpen(false)
                setProjectMenuOpen(open => !open)
              }}
              aria-expanded={projectMenuOpen}
              aria-label="Change project"
              className={cn(
                'ltm-motion-fast inline-flex shrink-0 items-center rounded-md px-1.5 py-1 text-sm transition-colors hover:bg-muted hover:text-foreground',
                projectMenuOpen ? 'bg-muted text-foreground' : 'text-muted-foreground',
              )}
            >
              <span className={cn('max-w-[10rem] truncate', !activeProject && 'italic opacity-70')}>
                {activeProject ? activeProject.name : 'No project'}
              </span>
              <span className="opacity-40">/</span>
            </button>
          </TitleBarTipBlock>
        )}

        {/* Names the action, not the path. The path is already on screen twice —
            in the button itself and on the "Saving to" line — so repeating it on
            hover said nothing; what the button *does* was the missing part. */}
        <TitleBarTipBlock label="Pick a destination">
        <button
          ref={panelTriggerRef}
          type="button"
          onClick={() => {
            setProjectMenuOpen(false)
            setComposerPanelOpen(open => !open)
          }}
          aria-expanded={composerPanelOpen}
          aria-label="Note settings"
          className={cn(
            'ltm-motion-fast inline-flex min-w-0 max-w-[min(34rem,62vw)] items-center gap-1.5 rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
            // Phone: this is the page's title, so it gets title weight and a
            // tappable row height rather than the desktop bar's quiet 14px
            // label. `max-w` above still keeps it off the control cluster.
            isPhoneSurface
              ? 'h-10 rounded-lg px-2.5 text-[15px] font-medium text-foreground'
              : 'px-2.5 py-1 text-sm',
            composerPanelOpen && 'bg-muted text-foreground',
          )}
        >
          <span className="flex min-w-0 items-baseline">
            {/* The folder only comes along on desktop. Sharing ~170pt with the
                filename, it truncated to `lifeblood_systems/…` — enough to
                identify nothing — and pushed the filename itself down to
                `2026…` (2026-08-01). One legible name beats two illegible
                ones, and the full path is a tap away on the "Saving to" line. */}
            {identityDirAfterProject && !isPhoneSurface && (
              <span className="truncate opacity-50">{identityDirAfterProject}</span>
            )}
            {/* The folder gives way, the filename never does. */}
            <span className="shrink-0">{identityLeaf}</span>
          </span>
          <ChevronDown
            className={cn(
              'shrink-0 opacity-50 transition-transform',
              isPhoneSurface ? 'h-4 w-4' : 'h-3.5 w-3.5',
              composerPanelOpen && 'rotate-180',
            )}
          />
        </button>
        </TitleBarTipBlock>

        {projectMenuOpen && !isPhoneSurface && (
          // Anchored to the bar, not to the trigger: the trigger is inside a
          // grid track that shrinks with the path, and a popover pinned to it
          // slid around as the folder name changed length.
          <div
            ref={projectMenuRef}
            className="absolute left-1/2 top-full z-50 mt-1.5 w-[min(22rem,calc(100vw-2rem))] -translate-x-1/2 overflow-hidden rounded-xl border border-border/70 bg-background p-2 shadow-2xl"
          >
            <ProjectDestinationListBlock
              destinations={composer.projectDestinations}
              activeKey={composer.activeProjectKey}
              onSelect={(projectKey) => {
                composer.selectProject(projectKey)
                setProjectMenuOpen(false)
              }}
              listClassName="max-h-[16rem]"
            />
          </div>
        )}

        {composerPanelOpen && !isPhoneSurface && (
          <div
            ref={panelRef}
            className={cn(
              // Deliberately NOT `ltm-motion-fast`. That utility carries a
              // press-feedback rule — `.ltm-motion-fast:active { opacity: .7 }`
              // (index.css) — and `:active` matches ancestors, so pressing any
              // chip or toggle inside the panel dimmed the *whole panel* to 70%
              // for the length of the click, showing the editor through it
              // (2026-07-31, finally traced). `ltm-motion-fast` is for leaf tap
              // targets only; a container that wraps buttons must never wear it.
              // No entry animation either, for the same reason: opacity on a
              // panel you interact with has no upside worth the risk.
              'absolute left-1/2 top-full z-50 mt-1.5 -translate-x-1/2 overflow-hidden rounded-xl border border-border/70 bg-background shadow-2xl transition-[width] duration-150 ease-out',
              // Wide while browsing: the tree carries deeply nested names next
              // to a jump-target column, and at 34rem both were wrapping.
              destinationBrowserOpen
                ? 'w-[min(54rem,calc(100vw-2rem))]'
                : 'w-[min(30rem,calc(100vw-2rem))]',
            )}
          >
            <div className="max-h-[70vh] overflow-auto">{noteConfigBlock}</div>
          </div>
        )}
      </div>

      {/* Emphatically NOT `min-w-0`. These are fixed-size icons with nothing to
          truncate, so letting the cluster shrink below its content just made it
          overflow — and an overflowing `justify-end` row spills to the *left*,
          which is how the icons ended up painted on top of the filename
          (2026-08-01). Its automatic minimum size is the icons' width, so the
          filename beside it is the thing that gives way, which is correct: the
          filename can truncate and an icon cannot. */}
      <div
        className={cn(
          'flex items-center justify-self-end gap-0.5',
          // Grid flanks share free space evenly, so the centered filename only
          // stays put while both flanks are the same width — and this one is
          // not a constant: the save badge and the manual-save button come and
          // go, and the filename visibly slid every time (2026-08-01). Pin the
          // column to the cluster's full width so its contents change inside a
          // fixed frame.
          isPhoneSurface && 'min-w-[7rem]',
        )}
      >
        {/* Desktop keeps the editor's controls inline on the bar; on phone they
            are portalled into the … menu, whose slot lives there instead. */}
        {!isPhoneSurface && <div ref={setEditorControlsSlot} className="flex items-center" />}
        {moodButtonBlock}
        {tagsButtonBlock}
        {saveStateBadgeBlock}
        {manualSaveButtonBlock}
        {metaPanelBlock}
        {overflowButtonBlock}
      </div>
      {overflowMenuBlock}
    </div>
    </TooltipProvider>
  )


  // Phone: the same panel as a bottom sheet. It cannot be a popover — the
  // native bottom chrome and the keyboard both claim that edge
  // (docs/contracts/IOS-NATIVE-CHROME.md).
  const composerSheetBlock = (isPhoneSurface && composerPanelOpen) ? (
    <>
      <div
        className="fixed inset-0 z-40 bg-background/60 backdrop-blur-sm"
        onClick={() => setComposerPanelOpen(false)}
      />
      <div
        // 85vh, not 75: at 75 the roomier sections below would have started
        // scrolling a sheet that has only six rows in it, which reads as the
        // panel being cut off rather than as a scroll region (2026-08-01).
        // 28px top radius, not 16: iOS sheets present with a corner large
        // enough to read as a card lifting off the screen, and at 16 against a
        // full-width sheet it just looked like a slightly soft edge.
        className="fixed inset-x-0 bottom-0 z-50 max-h-[85vh] overflow-auto rounded-t-[28px] border-t border-border bg-background shadow-2xl"
        style={{ paddingBottom: `${sheetBottomPadPx}px` }}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border/60 bg-background px-4 py-3">
          <span className="text-sm font-medium">Note settings</span>
          <button
            type="button"
            onClick={() => setComposerPanelOpen(false)}
            aria-label="Close note settings"
            className="rounded-full p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        {noteConfigBlock}
      </div>
    </>
  ) : null

  // Pushed on top of the settings sheet, so Cancel returns there rather than
  // dismissing the stack. Gated on `composerPanelOpen` too: the only way in is
  // through that sheet, and leaving it mounted after the parent closed would
  // strand a full-screen surface with nothing behind it.
  const destinationSheetBlock = (isPhoneSurface && composerPanelOpen && destinationSheetOpen) ? (
    <DestinationPickerSheetBlock
      value={composer.destinationPath}
      onChange={composer.applyDestinationPath}
      onClose={() => setDestinationSheetOpen(false)}
      projectDestinations={composer.projectDestinations}
      activeProjectKey={composer.activeProjectKey}
      onSelectProject={composer.selectProject}
      mostUsedDestinations={composer.mostUsedDestinations}
      recentDestinations={composer.recentDestinations}
      // Same dock reservation the settings sheet makes, plus the keyboard the
      // search field summons — it is pinned to the bottom edge, so it is the
      // one control that has to move out of the keyboard's way itself.
      bottomInsetPx={Math.max(sheetBottomPadPx, layout.keyboardInset)}
    />
  ) : null

  const statusMessagesBlock = (composer.message || composer.error) ? (
    <div className="space-y-2">
      {composer.message && (
        <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 dark:bg-emerald-500/20 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-300">
          {composer.message}
        </div>
      )}
      {composer.error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {composer.error}
        </div>
      )}
    </div>
  ) : null

  const canvasCardBlock = (
    <div className="space-y-4">
      {statusMessagesBlock}
      <div className="overflow-hidden">
        {editorSurfaceBlock}
        {noteConfigBlock}
      </div>
    </div>
  )

  return (
    // `ltm-page-flush-top`: this page paints its own status-bar strip (the
    // title bar's top padding), so the shell must not reserve one above it.
    <div className="ltm-newthought-shell ltm-page-flush-top flex h-full min-h-0 w-full">
      <div className="relative min-w-0 flex-1 overflow-hidden">
        {titleBarBlock}
        {viewSurface === 'canvas' ? (
          <div className="absolute inset-0">
            <CanvasSurfaceOrch
              surfaceId={`new-thought:${composer.targetPath ?? 'draft'}`}
              storage={composer.canvasStorage}
              worldWidth={NEW_THOUGHT_CANVAS_WORLD_WIDTH}
              worldHeight={NEW_THOUGHT_CANVAS_ANCHOR_TOP_Y + canvasAnchorHeight + NEW_THOUGHT_CANVAS_BOTTOM_BREATHING}
              clampMinScaleToFit
              initialFocus={{
                worldX: NEW_THOUGHT_CANVAS_ANCHOR_CENTER_X,
                worldY: NEW_THOUGHT_CANVAS_ANCHOR_TOP_Y + canvasAnchorHeight / 2,
                contentWidth: NEW_THOUGHT_CANVAS_ANCHOR_WIDTH,
                contentHeight: canvasAnchorHeight,
              }}
              worldExtras={
                <>
                  <div
                    style={{
                      position: 'absolute',
                      left: NEW_THOUGHT_CANVAS_ANCHOR_CENTER_X - NEW_THOUGHT_CANVAS_ANCHOR_WIDTH / 2,
                      top: NEW_THOUGHT_CANVAS_HEADING_TOP_Y,
                      width: NEW_THOUGHT_CANVAS_ANCHOR_WIDTH,
                      textAlign: 'center',
                      pointerEvents: 'none',
                    }}
                  >
                    <div className="text-3xl font-semibold tracking-tight text-foreground/90">
                      What's on your mind today?
                    </div>
                    <div className="mt-2 text-sm text-muted-foreground">
                      Compose below. Right-click anywhere on the canvas to drop a sticky.
                    </div>
                  </div>
                  <BacklogCanvasAnchorBlock
                    centerX={NEW_THOUGHT_CANVAS_ANCHOR_CENTER_X}
                    topY={NEW_THOUGHT_CANVAS_ANCHOR_TOP_Y}
                    width={NEW_THOUGHT_CANVAS_ANCHOR_WIDTH}
                    onHeightChange={setCanvasAnchorHeight}
                  >
                    {canvasCardBlock}
                  </BacklogCanvasAnchorBlock>
                </>
              }
            />
          </div>
        ) : (
          // Doc mode: the editor owns the whole area. Config floats over it
          // (desktop pill) or arrives as a sheet (phone) — never a docked
          // slab, so the writing surface runs edge to edge.
          //
          // The top padding clears the title bar, whose phone height includes
          // the status-bar strip it now owns. Keep the two in step.
          <div
            className={cn(
              'absolute inset-0 flex min-h-0 flex-col',
              isPhoneSurface ? 'pt-[calc(3.5rem+var(--ltm-safe-top))]' : 'pt-11',
            )}
          >
            {statusMessagesBlock && (
              <div className="shrink-0 px-4 pb-2">{statusMessagesBlock}</div>
            )}
            <div className="min-h-0 flex-1">
              {editorSurfaceBlock}
            </div>
            {composerSheetBlock}
            {destinationSheetBlock}
          </div>
        )}
      </div>

    </div>
  )
}

// memo: persistent surface — skip re-renders caused by unrelated App shell state.
export default memo(function NewThought() {
  return (
    <div className="ltm-page h-full">
      <CreateTab />
    </div>
  )
})
