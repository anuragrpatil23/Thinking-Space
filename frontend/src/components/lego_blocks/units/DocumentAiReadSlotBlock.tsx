// Above a document's text: what any AI-read provider has for it
// (documentAiReadBlock). Renders nothing when no provider matches the path.
import { useEffect, useReducer } from 'react'
import {
  documentAiReadProvidersBlock,
  ensureDocumentAiReadProvidersBlock,
  subscribeDocumentAiReadProvidersBlock,
} from '@/services/lego_blocks/units/documentAiReadBlock'

export default function DocumentAiReadSlotBlock({ path, className }: { path: string; className?: string }) {
  // Providers register as their modules load; re-render when one arrives
  const [, refresh] = useReducer((n: number) => n + 1, 0)
  useEffect(() => {
    ensureDocumentAiReadProvidersBlock()
    return subscribeDocumentAiReadProvidersBlock(refresh)
  }, [])
  const providers = documentAiReadProvidersBlock(path)
  if (providers.length === 0) return null
  return (
    <div className={className}>
      {providers.map(({ id, Component }) => <Component key={id} path={path} />)}
    </div>
  )
}
