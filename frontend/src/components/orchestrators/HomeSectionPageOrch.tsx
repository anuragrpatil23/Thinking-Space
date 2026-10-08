import { useNavigate } from 'react-router-dom'
import AiActivityPanelBlock from '@/components/lego_blocks/integrations/AiActivityPanelBlock'
import ThisWeekDigestBlock from '@/components/lego_blocks/integrations/ThisWeekDigestBlock'
import HomeBoardFeedBlock from '@/components/lego_blocks/integrations/HomeBoardFeedBlock'
import { PhoneLargeTitleBlock } from '@/components/lego_blocks/units/PhoneListBlock'
import { useNativeBackHandlerBlock } from '@/components/lego_blocks/hooks/shared/useNativeBackHandlerBlock'
import {
  HOME_SECTION_PAGES_BLOCK,
  type HomeSectionBlock,
} from '@/services/lego_blocks/units/homeSectionPagesBlock'

/**
 * One of Home's long sections as a full-screen page rather than a card in
 * Home's scroll.
 *
 * On an iPhone a card frame cost about a fifth of the screen's width (page
 * margin plus card padding, both sides) and put a long document inside a box
 * inside Home's own long scroll. Here the same block runs edge to edge under
 * the shared large-title bar, and Home keeps only a tile that opens it.
 *
 * The scroller is this page's own element, not the shell's: the large-title
 * bar is `position: sticky` and needs its parent to be what scrolls. It also
 * pads its own bottom — nothing reserves room for the floating dock.
 */
export default function HomeSectionPageOrch({ section }: { section: HomeSectionBlock }) {
  const navigate = useNavigate()
  // The native chrome shows a back arrow while a handler is registered; these
  // pages are always one step below Home.
  useNativeBackHandlerBlock({ active: true, onBack: () => navigate('/') })

  return (
    <div className="flex h-full min-h-0 w-full">
      <div className="w-full flex-1 overflow-y-auto overflow-x-hidden overscroll-contain bg-background pb-[calc(var(--ltm-safe-bottom,0px)+5.5rem)]">
        <PhoneLargeTitleBlock title={HOME_SECTION_PAGES_BLOCK[section].title} />
        <div className="px-4 pt-3">
          {section === 'ai-activity' && <AiActivityPanelBlock surface="page" enableManualSessions />}
          {section === 'worked-on' && <ThisWeekDigestBlock surface="page" />}
          {section === 'board' && <HomeBoardFeedBlock surface="page" />}
        </div>
      </div>
    </div>
  )
}
