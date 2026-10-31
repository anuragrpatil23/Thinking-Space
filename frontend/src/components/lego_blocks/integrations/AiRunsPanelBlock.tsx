// The AI Runs sheet: the engine's state, what is running and waiting, and what
// every finished run sent and got back. Opened from the AI section of the ⋯
// menu. It used to be a tab in the Debug Console, which said "debugging" about
// what is really day-to-day work — is my digest coming, and why not.

import { Sparkles, X } from 'lucide-react'
import { useResizableSheetBlock } from '@/components/lego_blocks/hooks/useResizableSheetBlock'
import IntelligenceRunsTabBlock from '@/components/lego_blocks/units/IntelligenceRunsTabBlock'
import SheetResizeHandleBlock from '@/components/lego_blocks/units/SheetResizeHandleBlock'

interface AiRunsPanelBlockProps {
  isOpen: boolean
  onClose: () => void
}

export default function AiRunsPanelBlock({ isOpen, onClose }: AiRunsPanelBlockProps) {
  const sheet = useResizableSheetBlock('ai-runs', 520)

  return (
    <>
      {isOpen && (
        <div
          className="fixed inset-0 z-[88] bg-black/20 backdrop-blur-[1px]"
          onClick={onClose}
          aria-hidden
        />
      )}

      {isOpen && <SheetResizeHandleBlock {...sheet.handle} />}

      <div
        role="dialog"
        aria-label="AI runs"
        aria-hidden={!isOpen}
        data-ltm-sheet={isOpen ? '' : undefined} style={{ width: `min(96vw, ${sheet.width}px)` }}
        className={`fixed right-0 top-0 z-[89] flex h-full flex-col border-l border-border/60 bg-background/95 shadow-2xl backdrop-blur-xl transition-transform duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] ${
          isOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <div className="flex shrink-0 items-center gap-2 border-b border-border/50 px-4 py-3">
          <Sparkles className="h-4 w-4 text-muted-foreground" />
          <span className="flex-1 text-sm font-semibold text-foreground">AI Runs</span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close AI runs"
            className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        {/* Mounted only while open: the list subscribes to the queue and ticks
            a clock while work is in flight, none of which a closed sheet needs. */}
        <div className="ltm-nav-scroll min-h-0 flex-1 overflow-y-auto">
          {isOpen && <IntelligenceRunsTabBlock />}
        </div>
      </div>
    </>
  )
}
