import { useMemo } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { EditorState, type Extension } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { resolveEditorLanguageBlock } from '@/components/lego_blocks/units/editorLanguageBlock'
import { cn } from '@/lib/utils'

// Read-only reading view for code files. Code must NOT flow through the
// markdown prose renderer — that wraps `//` comments and imports as paragraphs
// and turns backtick strings into inline code. Instead we mount the same CM6
// engine used for editing (one engine, per-language grammar) in read-only mode
// so the reading view gets real syntax highlighting and preserved whitespace.

export interface CodeDocumentViewBlockProps {
  content: string
  path: string
  colorMode: 'light' | 'dark'
  className?: string
}

export default function CodeDocumentViewBlock({ content, path, colorMode, className }: CodeDocumentViewBlockProps) {
  const editorLanguage = useMemo(() => resolveEditorLanguageBlock(path), [path])

  const extensions = useMemo<Extension[]>(() => [
    editorLanguage.extension,
    EditorView.editable.of(false),
    EditorState.readOnly.of(true),
    EditorView.theme({
      '&': {
        backgroundColor: 'transparent',
        color: 'hsl(var(--foreground))',
      },
      '.cm-scroller': {
        backgroundColor: 'transparent',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
        lineHeight: '1.6',
      },
      '.cm-gutters': {
        backgroundColor: 'transparent',
        border: 'none',
        color: 'hsl(var(--muted-foreground))',
      },
      '.cm-activeLine, .cm-activeLineGutter': {
        backgroundColor: 'transparent',
      },
      '.cm-cursor': { display: 'none' },
    }),
  ], [editorLanguage])

  return (
    <div className={cn('ltm-code-document-view', className)}>
      <CodeMirror
        value={content}
        readOnly
        editable={false}
        theme={colorMode === 'dark' ? 'dark' : 'light'}
        basicSetup={{
          lineNumbers: true,
          foldGutter: true,
          highlightActiveLine: false,
          highlightActiveLineGutter: false,
          dropCursor: false,
          allowMultipleSelections: false,
          highlightSelectionMatches: false,
          searchKeymap: false,
        }}
        extensions={extensions}
      />
    </div>
  )
}
