import type { Extension } from '@codemirror/state'
import { markdown } from '@codemirror/lang-markdown'
import { javascript } from '@codemirror/lang-javascript'
import { html } from '@codemirror/lang-html'
import { css } from '@codemirror/lang-css'
import { python } from '@codemirror/lang-python'
import { json } from '@codemirror/lang-json'
import { yaml } from '@codemirror/lang-yaml'

// File-type detection for the shared CM6 editor: one engine, per-language
// grammar. Markdown files get the markdown grammar plus the live-preview
// decorations (gated by kind === 'markdown' at the wiring site); code files
// get real syntax highlighting and no markdown decorations; unknown text
// stays plain. First layer of the file-type → profile → preference cascade.

export type EditorLanguageKindBlock = 'markdown' | 'code' | 'plain'

export interface EditorLanguageBlock {
  kind: EditorLanguageKindBlock
  /** Stable identity for memoization — same id, same extension set. */
  id: string
  extension: Extension
}

function extensionOfPathBlock(path: string): string {
  const filename = path.slice(path.lastIndexOf('/') + 1)
  const dot = filename.lastIndexOf('.')
  if (dot <= 0) return ''
  return filename.slice(dot + 1).toLowerCase()
}

export function resolveEditorLanguageBlock(path: string | null | undefined): EditorLanguageBlock {
  const ext = extensionOfPathBlock(path ?? '')
  switch (ext) {
    case 'md':
    case 'markdown':
    case '':
      return { kind: 'markdown', id: 'markdown', extension: markdown() }
    case 'js':
    case 'mjs':
    case 'cjs':
    case 'jsx':
      return { kind: 'code', id: 'javascript', extension: javascript({ jsx: ext === 'jsx' }) }
    case 'ts':
    case 'mts':
    case 'cts':
    case 'tsx':
      return { kind: 'code', id: 'typescript', extension: javascript({ typescript: true, jsx: ext === 'tsx' }) }
    case 'py':
      return { kind: 'code', id: 'python', extension: python() }
    case 'json':
      return { kind: 'code', id: 'json', extension: json() }
    case 'yml':
    case 'yaml':
      return { kind: 'code', id: 'yaml', extension: yaml() }
    case 'html':
    case 'htm':
      return { kind: 'code', id: 'html', extension: html() }
    case 'css':
      return { kind: 'code', id: 'css', extension: css() }
    case 'sh':
    case 'bash':
    case 'zsh':
    case 'toml':
    case 'sql':
      // Recognized as code (monospace, no markdown decorations) but no
      // grammar pack shipped for them yet — plain highlighting.
      return { kind: 'code', id: `plain-code-${ext}`, extension: [] }
    default:
      return { kind: 'plain', id: 'plain', extension: [] }
  }
}
