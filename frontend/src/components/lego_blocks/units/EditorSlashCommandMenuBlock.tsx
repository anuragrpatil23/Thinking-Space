import { useEffect, useRef, type CSSProperties } from 'react'
import { cn } from '@/lib/utils'
import type {
  EditorCommandBlock,
  EditorCommandSectionBlock,
} from '@/components/lego_blocks/units/editorCommandsBlock'

// The `/` menu. Purely presentational: it owns no query state, no filtering and
// no keyboard handling — the *editor* keeps focus the whole time the menu is
// open, so arrow keys and Enter are intercepted by a CM6 keymap in
// `MarkdownRichEditorBlock` and arrive here only as a changed `activeId`.
//
// That is the whole reason this is not a `UniversalSearchBlock` like the
// wikilink picker: that one renders its own focusable input and lives pinned at
// the top of the editor, which is right when you are searching a vault and wrong
// when you are mid-sentence. Here the document *is* the input and the caret is
// the anchor.

export interface EditorSlashMenuPositionBlock {
  left: number
  /** Exactly one of these is set — `top` anchors the panel below the caret,
   *  `bottom` flips it above when the caret is too close to the bottom edge. */
  top?: number
  bottom?: number
}

export interface EditorSlashCommandMenuBlockProps {
  sections: readonly EditorCommandSectionBlock[]
  activeId: string | null
  position: EditorSlashMenuPositionBlock
  onSelect: (command: EditorCommandBlock) => void
  onHover: (commandId: string) => void
}

export default function EditorSlashCommandMenuBlock({
  sections,
  activeId,
  position,
  onSelect,
  onHover,
}: EditorSlashCommandMenuBlockProps) {
  const activeRowRef = useRef<HTMLButtonElement | null>(null)

  // Keyboard navigation happens in the editor, so the active row can move
  // outside the scrollport without any scroll event of its own.
  useEffect(() => {
    activeRowRef.current?.scrollIntoView({ block: 'nearest' })
  }, [activeId])

  const style: CSSProperties = {
    left: position.left,
    ...(position.top != null ? { top: position.top } : {}),
    ...(position.bottom != null ? { bottom: position.bottom } : {}),
  }

  return (
    <div
      className="pointer-events-none absolute z-50"
      style={style}
      // The menu is a passive surface; taking focus would drop the caret and
      // end the very input session it exists to serve.
      onMouseDown={(event) => event.preventDefault()}
    >
      <div
        className={cn(
          'pointer-events-auto max-h-[19rem] w-[19.5rem] overflow-y-auto overscroll-contain',
          'rounded-xl border border-border/60 bg-background/95 shadow-2xl backdrop-blur-xl',
          'ring-1 ring-black/[0.04] dark:ring-white/[0.06]',
          'py-1.5',
        )}
        role="listbox"
        aria-label="Insert"
      >
        {sections.map((section, sectionIndex) => (
          <div key={section.group}>
            <div
              className={cn(
                'px-3 pb-1 text-[10px] font-semibold uppercase tracking-[0.09em] text-muted-foreground/70',
                sectionIndex === 0 ? 'pt-1' : 'pt-2.5',
              )}
            >
              {section.group}
            </div>
            {section.commands.map((command) => {
              const Icon = command.icon
              const isActive = command.id === activeId
              return (
                <button
                  key={command.id}
                  ref={isActive ? activeRowRef : undefined}
                  type="button"
                  role="option"
                  aria-selected={isActive}
                  onMouseEnter={() => onHover(command.id)}
                  onClick={() => onSelect(command)}
                  className={cn(
                    'mx-1.5 flex w-[calc(100%-0.75rem)] items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors',
                    isActive ? 'bg-accent text-accent-foreground' : 'text-foreground/90',
                  )}
                >
                  <span
                    className={cn(
                      'grid h-6 w-6 shrink-0 place-items-center rounded-md border transition-colors',
                      isActive
                        ? 'border-primary/30 bg-primary/10 text-primary'
                        : 'border-border/50 bg-muted/40 text-muted-foreground',
                    )}
                  >
                    <Icon className="h-3.5 w-3.5" />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[13px] leading-tight">
                    {command.label}
                  </span>
                  {command.syntax && (
                    <span
                      className={cn(
                        'shrink-0 font-mono text-[11px] tabular-nums',
                        isActive ? 'text-accent-foreground/60' : 'text-muted-foreground/60',
                      )}
                    >
                      {command.syntax}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}
