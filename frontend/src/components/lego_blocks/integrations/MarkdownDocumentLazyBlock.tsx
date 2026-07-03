import { Suspense, lazy, type ComponentProps } from 'react'
import { Loader2 } from 'lucide-react'

// Code-split boundary: MarkdownDocumentBlock transitively pulls CodeMirror,
// pdfjs, Excalidraw, and the markdown/katex pipeline. Loading it on demand
// keeps those vendors out of the startup bundle.
const MarkdownDocumentInnerBlock = lazy(() => import('./MarkdownDocumentBlock'))

export type { MarkdownViewerMode } from './MarkdownDocumentBlock'

type MarkdownDocumentLazyBlockProps = ComponentProps<typeof MarkdownDocumentInnerBlock>

function MarkdownDocumentLoadingFallback({ className }: { className?: string }) {
  return (
    <div className={`flex items-center justify-center bg-background ${className ?? ''}`}>
      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
    </div>
  )
}

export default function MarkdownDocumentLazyBlock(props: MarkdownDocumentLazyBlockProps) {
  return (
    <Suspense fallback={<MarkdownDocumentLoadingFallback className={props.className} />}>
      <MarkdownDocumentInnerBlock {...props} />
    </Suspense>
  )
}
