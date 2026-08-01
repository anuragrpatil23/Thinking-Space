import { memo, useEffect, useRef, useState, type ReactNode } from 'react'
import { Loader2, X, Plus, FolderTree, ChevronDown, Save, Star, Tag } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/lego_blocks/units/ui/tooltip'
import { Switch } from '@/components/lego_blocks/units/ui/switch'
import FolderTreePickerBlock from '@/components/lego_blocks/integrations/FolderTreePickerBlock'
import MoodPickerBlock, { moodDotClassForLabelBlock } from '@/components/lego_blocks/integrations/MoodPickerBlock'
import NoteTagsPopoverBlock from '@/components/lego_blocks/integrations/NoteTagsPopoverBlock'
import InfoPanelToggleButtonBlock from '@/components/lego_blocks/units/InfoPanelToggleButtonBlock'
import MarkdownRichEditorBlock from '@/components/lego_blocks/integrations/MarkdownRichEditorLazyBlock'
import CanvasSurfaceOrch from '@/components/orchestrators/CanvasSurfaceOrch'
import BacklogCanvasAnchorBlock from '@/components/lego_blocks/integrations/BacklogCanvasAnchorBlock'
import { useNoteComposerOrch } from '@/components/orchestrators/useNoteComposerOrch'
import { openFileInNewTabOrch } from '@/services/orchestrators/fileSystemOrch'
import { useUILayoutBlock } from '@/components/lego_blocks/hooks/shared/useUILayoutBlock'
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
  const [destinationBrowserOpen, setDestinationBrowserOpen] = useState(false)
  const [quickDestinationLabel, setQuickDestinationLabel] = useState('')
  // Emotions and tags left the settings panel (2026-07-31). They are not
  // settings like filename or destination — one is an act of reflection, the
  // other a quick aside while writing — so each gets its own title-bar button
  // and its own room.
  const [moodPickerOpen, setMoodPickerOpen] = useState(false)
  const [tagsPopoverOpen, setTagsPopoverOpen] = useState(false)
  const [showAiAssist, setShowAiAssist] = useState(false)

  const panelTriggerRef = useRef<HTMLButtonElement | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const tagsTriggerRef = useRef<HTMLButtonElement | null>(null)
  const tagsPopoverRef = useRef<HTMLDivElement | null>(null)
  const metaTriggerRef = useRef<HTMLDivElement | null>(null)
  const metaPanelRef = useRef<HTMLDivElement | null>(null)
  const moodTriggerRef = useRef<HTMLButtonElement | null>(null)
  const moodPopoverRef = useRef<HTMLDivElement | null>(null)
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

  // One dismissal contract for the three title-bar popovers: a click inside a
  // popover (or on its own trigger) leaves it alone and closes the other two,
  // so they can never stack; a click anywhere else closes all of them.
  // Escape is owned by whichever popover has an input to clear first — mood and
  // tags handle their own — so only metadata needs it here.
  useEffect(() => {
    if (!tagsPopoverOpen && !showMetaPanel && !moodPickerOpen) return
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node
      const inside = (
        popover: React.RefObject<HTMLElement | null>,
        trigger: React.RefObject<HTMLElement | null>,
      ) => Boolean(popover.current?.contains(target) || trigger.current?.contains(target))

      const hitTags = inside(tagsPopoverRef, tagsTriggerRef)
      const hitMeta = inside(metaPanelRef, metaTriggerRef)
      const hitMood = inside(moodPopoverRef, moodTriggerRef)

      if (!hitTags) setTagsPopoverOpen(false)
      if (!hitMeta) setShowMetaPanel(false)
      if (!hitMood) setMoodPickerOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setShowMetaPanel(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [tagsPopoverOpen, showMetaPanel, moodPickerOpen])

  // Saves whatever the tree currently points at as a labelled chip. The path
  // comes from the composer rather than local state because the inline tree
  // commits as you click — there is no draft to reconcile.
  const handleSaveQuickDestination = () => {
    const label = quickDestinationLabel.trim()
    if (!label || !composer.destinationPath) return
    if (composer.addQuickDestination(label, composer.destinationPath.split('/').filter(Boolean))) {
      setQuickDestinationLabel('')
    }
  }

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

  const moodButtonBlock = !isTodoMode ? (
    <div className="relative">
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
            'ltm-motion-fast inline-flex items-center rounded-md p-1.5 transition-colors hover:bg-muted',
            moodPickerOpen && 'bg-muted',
          )}
        >
          <span
            className={cn(
              'ltm-motion-fast h-4 w-4 rounded-full transition-colors',
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
          className="ltm-animate-fade-in absolute right-0 top-full z-50 mt-1.5 overflow-hidden rounded-xl border border-border/70 bg-background shadow-2xl"
        >
          <MoodPickerBlock
            selected={composer.emotions}
            onChange={composer.setEmotions}
            onClose={() => setMoodPickerOpen(false)}
          />
        </div>
      )}
    </div>
  ) : null

  const tagsButtonBlock = (
    <div className="relative">
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
            'ltm-motion-fast inline-flex items-center rounded-md p-1.5 transition-colors hover:bg-muted hover:text-foreground',
            composer.tags.length > 0 ? 'text-foreground' : 'text-muted-foreground',
            tagsPopoverOpen && 'bg-muted text-foreground',
          )}
        >
          <Tag className={cn('h-4 w-4', composer.tags.length > 0 && 'fill-current')} />
        </button>
      </TitleBarTipBlock>
      {tagsPopoverOpen && (
        <div
          ref={tagsPopoverRef}
          className="ltm-animate-fade-in absolute right-0 top-full z-50 mt-1.5 rounded-xl border border-border/70 bg-background shadow-2xl"
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
    <div className="relative">
      <TitleBarTipBlock label="Metadata & YAML">
        {/* Empty `title` so the shared button's native tooltip does not race the
            themed one. The block is used on other surfaces that have no
            TooltipProvider, so its default stays the native string. */}
        <div ref={metaTriggerRef} className="flex">
          <InfoPanelToggleButtonBlock
            active={showMetaPanel}
            onToggle={() => setShowMetaPanel(open => !open)}
            title=""
          />
        </div>
      </TitleBarTipBlock>
      {showMetaPanel && (
        <div
          ref={metaPanelRef}
          className="ltm-animate-fade-in absolute right-0 top-full z-50 mt-1.5 w-[min(24rem,calc(100vw-2rem))] space-y-2 rounded-xl border border-border/70 bg-background p-3 shadow-2xl"
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
      aiPanelOpen={showAiAssist}
      onAiPanelOpenChange={setShowAiAssist}
      aiAssistScope="new_thought"
      aiAssistUseCase="new_thought.assist"
      aiAssistDisabled={composer.saving || composer.loadingTargetContent}
      aiAssistHelperText="Suggestions apply inline. Configure provider/model in AI Settings."
      onRelatedThoughtOpenPath={handleRelatedThoughtOpenPath}
      typographyProfile="focus"
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

  const noteConfigBlock = (
    <div className="divide-y divide-border/40 text-sm">
      {stickyDestinationBlock}
      {/* --- identity --- */}
      <div className="space-y-2 p-4">
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
      <div className="space-y-1.5 p-4">
        <div className={PANEL_LABEL_CLASS}>Note type</div>
        {/* Chips, same as Destination below. The segmented full-width control
            this used to be was the only widget in the panel shaped like that,
            and it stretched four short words across the whole row. */}
        <div className="flex flex-wrap gap-1.5">
          {NOTE_KINDS_BLOCK.map((kind) => (
            <button
              key={kind.id}
              type="button"
              onClick={() => composer.setNoteKind(kind.id)}
              className={cn(
                PANEL_CHIP_CLASS,
                'px-2.5',
                composer.noteKind === kind.id && PANEL_CHIP_ACTIVE_CLASS,
              )}
            >
              {kind.label}
            </button>
          ))}
        </div>
      </div>

      {/* --- destination --- */}
      <div className="space-y-2.5 p-4">
        <div className="flex items-center justify-between gap-2">
          <div className={PANEL_LABEL_CLASS}>Destination</div>
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

        {/* Only the user's own chips. The built-in Thoughts / Meetings / To Do /
            None shortcuts are gone from the row (2026-07-31): they duplicated
            the Note type control word for word directly above while meaning
            something entirely different (a folder, not a tag), which made the
            panel look like it was asking the same question twice. They still
            exist in the model — todo mode uses the `todo` one to reach the
            todos folder — they are just not a thing you click here. */}
        <div className="flex flex-wrap gap-1.5">
          {composer.quickDestinations.map((destination) => {
            const destinationPathValue = destination.pathSegments.join('/')
            const active = destinationPathValue === composer.destinationPath
            return (
              <span key={destination.id} className={cn(PANEL_CHIP_CLASS, active && PANEL_CHIP_ACTIVE_CLASS)}>
                <button
                  type="button"
                  className="px-1"
                  title={destinationPathValue}
                  onClick={() => composer.applyDestinationSegments(destination.pathSegments)}
                >
                  {destination.label}
                </button>
                <button
                  type="button"
                  className="ltm-motion-fast rounded-full p-0.5 opacity-0 transition-opacity group-hover:opacity-60 hover:!opacity-100"
                  title={`Remove quick destination ${destination.label}`}
                  onClick={() => composer.deleteQuickDestination(destination.id)}
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              </span>
            )
          })}
          <button
            type="button"
            onClick={() => setDestinationBrowserOpen(open => !open)}
            title="Browse for a folder"
            aria-label="Browse for a folder"
            className="ltm-motion-fast inline-flex h-6 w-6 items-center justify-center rounded-full border border-dashed border-border text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground"
          >
            <Plus className="h-3 w-3" />
          </button>
        </div>

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
            <div className="flex gap-1.5">
              <input
                value={quickDestinationLabel}
                onChange={(event) => setQuickDestinationLabel(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') { event.preventDefault(); handleSaveQuickDestination() }
                }}
                placeholder="Save this folder destination as a chip…"
                aria-label="Quick destination name"
                className="h-8 min-w-0 flex-1 rounded-lg border border-input bg-background px-2.5 text-xs outline-none transition-colors focus:border-foreground/30"
              />
              <button
                type="button"
                onClick={handleSaveQuickDestination}
                disabled={!quickDestinationLabel.trim() || !composer.destinationPath}
                className="ltm-motion-fast inline-flex h-8 shrink-0 items-center gap-1 rounded-lg border border-border/70 bg-background px-2.5 text-xs font-medium transition-colors hover:bg-muted disabled:opacity-40"
              >
                <Star className="h-3 w-3" />
                Save
              </button>
            </div>
          </div>
        )}
      </div>

      {/* --- options --- */}
      <div className="space-y-3 p-4">
        {composer.makeThisTodo ? (
          <p className="text-xs text-muted-foreground">
            Each non-empty line becomes a checklist item — {composer.todoItemCount} detected.
            Items are appended, so to dos always save manually.
          </p>
        ) : (
          <>
            <div className="flex items-center justify-between gap-3">
              <label htmlFor="auto-save" className="cursor-pointer text-sm">Auto-save</label>
              <Switch
                id="auto-save"
                checked={composer.autoSaveEnabled}
                onCheckedChange={composer.setAutoSaveEnabled}
              />
            </div>
            <div className="flex items-center justify-between gap-3">
              <label htmlFor="date-header" className="cursor-pointer text-sm">Add date header</label>
              <Switch id="date-header" checked={composer.dateHeader} onCheckedChange={composer.setDateHeader} />
            </div>
            <div className="flex items-center justify-between gap-3">
              <label htmlFor="custom-title" className="cursor-pointer text-sm">Use custom title</label>
              <Switch id="custom-title" checked={composer.useCustomTitle} onCheckedChange={composer.setUseCustomTitle} />
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
    <div className="absolute inset-x-0 top-0 z-40 flex h-11 items-center gap-2 bg-card px-2 dark:bg-background">
      {/* Equal-width flanks keep the filename optically centered. */}
      <div className="flex-1" />

      <div className="relative flex min-w-0 shrink items-center justify-center">
        {/* Names the action, not the path. The path is already on screen twice —
            in the button itself and on the "Saving to" line — so repeating it on
            hover said nothing; what the button *does* was the missing part. */}
        <TitleBarTipBlock label="Pick a destination">
        <button
          ref={panelTriggerRef}
          type="button"
          onClick={() => setComposerPanelOpen(open => !open)}
          aria-expanded={composerPanelOpen}
          aria-label="Note settings"
          className={cn(
            'ltm-motion-fast inline-flex min-w-0 max-w-[min(34rem,62vw)] items-center gap-1.5 rounded-md px-2.5 py-1 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
            composerPanelOpen && 'bg-muted text-foreground',
          )}
        >
          <span className="flex min-w-0 items-baseline">
            {identityDir && <span className="truncate opacity-50">{identityDir}</span>}
            <span className="shrink-0">{identityLeaf}</span>
          </span>
          <ChevronDown
            className={cn(
              'h-3.5 w-3.5 shrink-0 opacity-50 transition-transform',
              composerPanelOpen && 'rotate-180',
            )}
          />
        </button>
        </TitleBarTipBlock>

        {composerPanelOpen && !isPhoneSurface && (
          <div
            ref={panelRef}
            className={cn(
              // No entry animation. It was fading the whole panel to
              // translucent mid-interaction (2026-07-31) — the trigger is still
              // unidentified, but an opacity animation on a panel you interact
              // with has no upside worth that risk.
              'ltm-motion-fast absolute left-1/2 top-full z-50 mt-1.5 -translate-x-1/2 overflow-hidden rounded-xl border border-border/70 bg-background shadow-2xl transition-[width]',
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

      <div className="flex flex-1 items-center justify-end gap-0.5">
        <div ref={setEditorControlsSlot} className="flex items-center" />
        {moodButtonBlock}
        {tagsButtonBlock}
        {saveStateBadgeBlock}
        {manualSaveButtonBlock}
        {metaPanelBlock}
      </div>
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
        className="fixed inset-x-0 bottom-0 z-50 max-h-[75vh] overflow-auto rounded-t-2xl border-t border-border bg-background shadow-2xl"
        style={{ paddingBottom: 'var(--safe-area-inset-bottom, 0px)' }}
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
    <div className="ltm-newthought-shell flex h-full min-h-0 w-full">
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
          <div className="absolute inset-0 flex min-h-0 flex-col pt-11">
            {statusMessagesBlock && (
              <div className="shrink-0 px-4 pb-2">{statusMessagesBlock}</div>
            )}
            <div className="min-h-0 flex-1">
              {editorSurfaceBlock}
            </div>
            {composerSheetBlock}
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
