import { Suspense, forwardRef, lazy, type ComponentPropsWithoutRef } from 'react'
import type { MarkdownRichEditorBlockHandle } from './MarkdownRichEditorBlock'

// Code-split boundary: MarkdownRichEditorBlock pulls CodeMirror; loading it on
// demand keeps that vendor out of the startup bundle.
const MarkdownRichEditorInnerBlock = lazy(() => import('./MarkdownRichEditorBlock'))

export type { MarkdownRichEditorBlockHandle } from './MarkdownRichEditorBlock'

type MarkdownRichEditorLazyBlockProps = ComponentPropsWithoutRef<typeof MarkdownRichEditorInnerBlock>

const MarkdownRichEditorLazyBlock = forwardRef<MarkdownRichEditorBlockHandle, MarkdownRichEditorLazyBlockProps>(
  function MarkdownRichEditorLazyBlock(props, ref) {
    return (
      <Suspense fallback={<div className={props.className} />}>
        <MarkdownRichEditorInnerBlock {...props} ref={ref} />
      </Suspense>
    )
  },
)

export default MarkdownRichEditorLazyBlock
