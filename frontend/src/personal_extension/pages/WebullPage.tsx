import { memo } from 'react'
import WebullOrch from '../components/orchestrators/WebullOrch'

interface WebullPageProps {
  pageLabel?: string
}

// memo: persistent surface — skip re-renders caused by unrelated App shell state.
export default memo(function WebullPage({ pageLabel }: WebullPageProps) {
  const title = pageLabel?.trim() || 'Webull'
  return (
    // min-h-0: F9 scrolls inside its own panes; .ltm-page's viewport min-height
    // made the host overflow by a few px and drew a second, full-length scrollbar.
    <div className="ltm-page h-full min-h-0">
      <WebullOrch pageTitle={title} />
    </div>
  )
})
