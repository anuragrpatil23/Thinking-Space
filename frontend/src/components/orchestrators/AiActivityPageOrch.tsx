import { useNavigate } from 'react-router-dom'
import AiActivityPanelBlock from '@/components/lego_blocks/integrations/AiActivityPanelBlock'
import { PhoneLargeTitleBlock } from '@/components/lego_blocks/units/PhoneListBlock'
import { useNativeBackHandlerBlock } from '@/components/lego_blocks/hooks/shared/useNativeBackHandlerBlock'

/**
 * AI activity as a full-screen page rather than a card on Home.
 *
 * On an iPhone the card frame cost about a fifth of the screen's width (page
 * margin plus card padding, both sides) and put a long document inside a box
 * inside Home's own long scroll. Here the same panel runs edge to edge under
 * the shared large-title bar, and Home keeps only a tile that opens it.
 *
 * The scroller is this page's own element, not the shell's: the large-title
 * bar is `position: sticky` and needs its parent to be what scrolls. It also
 * pads its own bottom — nothing reserves room for the floating dock.
 */
export default function AiActivityPageOrch() {
  const navigate = useNavigate()
  // The native chrome shows a back arrow while a handler is registered; this
  // page is always one step below Home.
  useNativeBackHandlerBlock({ active: true, onBack: () => navigate('/') })

  return (
    <div className="flex h-full min-h-0 w-full">
      <div className="w-full flex-1 overflow-y-auto overflow-x-hidden overscroll-contain bg-background pb-[calc(var(--ltm-safe-bottom,0px)+5.5rem)]">
        <PhoneLargeTitleBlock title="AI activity" />
        <div className="px-4 pt-3">
          <AiActivityPanelBlock surface="page" enableManualSessions />
        </div>
      </div>
    </div>
  )
}
