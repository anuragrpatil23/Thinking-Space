import type { Extension } from '@codemirror/state'
import type { Language } from '@codemirror/language'
import { markdown } from '@codemirror/lang-markdown'
import {
  javascript,
  javascriptLanguage,
  jsxLanguage,
  tsxLanguage,
  typescriptLanguage,
} from '@codemirror/lang-javascript'
import { html, htmlLanguage } from '@codemirror/lang-html'
import { css, cssLanguage } from '@codemirror/lang-css'
import { python, pythonLanguage } from '@codemirror/lang-python'
import { json, jsonLanguage } from '@codemirror/lang-json'
import { yaml, yamlLanguage } from '@codemirror/lang-yaml'

// File-type detection for the shared CM6 editor: one engine, per-language
// grammar. Markdown files get the markdown grammar plus the live-preview
// decorations (gated by kind === 'markdown' at the wiring site); code files
// get real syntax highlighting and no markdown decorations; unknown text
// stays plain. First layer of the file-type → profile → preference cascade.

/** Fence-info word -> grammar, for code blocks *inside* markdown notes.
 *
 *  `markdown()` with no options parses a fenced block as one flat `FencedCode`
 *  token — the ```` ```python ```` label is read by nobody. These are the same
 *  grammar packs the whole-file cases below already use, so wiring them in here
 *  costs no extra bundle: the packs are in the editor chunk either way.
 *
 *  Deliberately NOT `@codemirror/language-data`, which would give ~150
 *  languages behind a lazy loader. That trades a synchronous, already-paid-for
 *  set for a dynamic import inside the typing path, and the seven languages
 *  here cover what actually gets pasted into these notes. A ```` ```rust ````
 *  block stays plain — that is the honest ceiling without a new dependency. */
const FENCED_CODE_LANGUAGES_BLOCK: Record<string, Language> = {
  javascript: javascriptLanguage,
  js: javascriptLanguage,
  mjs: javascriptLanguage,
  cjs: javascriptLanguage,
  node: javascriptLanguage,
  jsx: jsxLanguage,
  typescript: typescriptLanguage,
  ts: typescriptLanguage,
  tsx: tsxLanguage,
  python: pythonLanguage,
  py: pythonLanguage,
  json: jsonLanguage,
  jsonc: jsonLanguage,
  yaml: yamlLanguage,
  yml: yamlLanguage,
  html: htmlLanguage,
  htm: htmlLanguage,
  xml: htmlLanguage,
  css: cssLanguage,
}

/** CM6 hands us the whole info string, which can carry more than a name —
 *  ```` ```ts title="x" ```` is common. Only the first word names the language. */
export function resolveFencedCodeLanguageBlock(info: string): Language | null {
  const name = info.trim().split(/\s+/)[0]?.toLowerCase() ?? ''
  if (!name) return null
  return FENCED_CODE_LANGUAGES_BLOCK[name] ?? null
}

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
      return {
        kind: 'markdown',
        id: 'markdown',
        extension: markdown({ codeLanguages: resolveFencedCodeLanguageBlock }),
      }
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
