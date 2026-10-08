import HomeSectionPageOrch from '@/components/orchestrators/HomeSectionPageOrch'
import type { HomeSectionBlock } from '@/services/lego_blocks/units/homeSectionPagesBlock'

// One of Home's long sections as its own full-screen page — where the iPhone
// Home tiles lead. Wider surfaces keep the sections on Home; the routes still
// work there.
export default function HomeSection({ section }: { section: HomeSectionBlock }) {
  return <HomeSectionPageOrch section={section} />
}
