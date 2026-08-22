import {
  Bold,
  Code,
  SquareCode,
  Heading1,
  Heading2,
  Heading3,
  Heading4,
  Italic,
  Link2,
  List,
  ListOrdered,
  ListTodo,
  Minus,
  Quote,
  Strikethrough,
  Table,
  type LucideIcon,
} from 'lucide-react'
import {
  buildMarkdownTableTemplateBlock,
  formatMarkdownTableAtSelectionBlock,
} from '@/services/orchestrators/markdownTableOrch'
import { toObsidianWikilinkTargetOrch } from '@/services/orchestrators/obsidianLinkOrch'

// One catalog for every markdown-editing command the editor offers.
//
// Before this existed the same commands were hardcoded twice — once as toolbar
// buttons, once as context-menu entries — and the two had already drifted (the
// toolbar had quote/lists/table, the context menu did not). Adding the slash
// menu as a third copy would have tripled that. Surfaces are now *renderers
// over this list*: they pick ids and decide presentation, they never define
// behaviour.
//
// Every command is expressed as a whole-document patch — `(text, from, to) =>
// { value, start, end }` — because that is the shape `applyPatch` in
// `MarkdownRichEditorBlock` already dispatches. Keeping the shape means the
// registry needed no new plumbing on the CM6 side.

export interface EditorTextPatchBlock {
  value: string
  start: number
  end: number
}

export type EditorPatchFactoryBlock = (
  text: string,
  from: number,
  to: number,
) => EditorTextPatchBlock

/** Slash-menu section. Ordering of the sections is the order of this tuple. */
export const EDITOR_COMMAND_GROUPS_BLOCK = [
  'Basic formatting',
  'Headings',
  'Lists',
  'Insert',
] as const

export type EditorCommandGroupBlock = (typeof EDITOR_COMMAND_GROUPS_BLOCK)[number]

export interface EditorCommandBlock {
  id: string
  label: string
  group: EditorCommandGroupBlock
  icon: LucideIcon
  /** Markdown this produces, shown right-aligned in the slash menu. It doubles
   *  as teaching: the menu is how you learn the syntax you could have typed. */
  syntax?: string
  /** Extra slash-menu match terms beyond the label (never shown). */
  keywords?: readonly string[]
  /** Rendered instead of the icon on the toolbar, for the two commands that
   *  have always been text buttons there. */
  toolbarGlyph?: string
  patch: EditorPatchFactoryBlock
}

// ---------------------------------------------------------------------------
// Patch primitives — moved here from MarkdownRichEditorBlock unchanged, so the
// text they produce is byte-identical to what the toolbar produced before.
// ---------------------------------------------------------------------------

export function wrapSelectionBlock(
  source: string,
  start: number,
  end: number,
  prefix: string,
  suffix: string,
  placeholder: string,
): EditorTextPatchBlock {
  const selected = source.slice(start, end)
  const text = selected || placeholder
  const value = `${source.slice(0, start)}${prefix}${text}${suffix}${source.slice(end)}`
  const nextStart = start + prefix.length
  const nextEnd = nextStart + text.length
  return { value, start: nextStart, end: nextEnd }
}

export function prefixSelectionLinesBlock(
  source: string,
  start: number,
  end: number,
  formatter: (line: string, index: number) => string,
): EditorTextPatchBlock {
  const lineStart = source.lastIndexOf('\n', Math.max(0, start - 1)) + 1
  const lineEndRaw = source.indexOf('\n', end)
  const lineEnd = lineEndRaw === -1 ? source.length : lineEndRaw
  const lines = source.slice(lineStart, lineEnd).split('\n')
  const patched = lines.map((line, index) => formatter(line, index)).join('\n')
  const value = `${source.slice(0, lineStart)}${patched}${source.slice(lineEnd)}`
  return { value, start: lineStart, end: lineStart + patched.length }
}

export function insertWikilinkBlock(
  source: string,
  start: number,
  end: number,
): EditorTextPatchBlock {
  const selected = source.slice(start, end).trim()
  const rawTarget = selected || 'linked note'
  const target = toObsidianWikilinkTargetOrch(rawTarget) || rawTarget
  const wrapped = `[[${target}]]`
  const value = `${source.slice(0, start)}${wrapped}${source.slice(end)}`
  return {
    value,
    start: start + 2,
    end: start + 2 + target.length,
  }
}

export function insertTextAtSelectionBlock(
  source: string,
  start: number,
  end: number,
  insert: string,
): EditorTextPatchBlock {
  const value = `${source.slice(0, start)}${insert}${source.slice(end)}`
  const next = start + insert.length
  return { value, start: next, end: next }
}

/** Fenced block. The selection becomes the body and the cursor lands on the
 *  language slot, which is the first thing you want to type. */
function insertCodeBlockPatchBlock(
  source: string,
  start: number,
  end: number,
): EditorTextPatchBlock {
  const selected = source.slice(start, end)
  const atLineStart = start === 0 || source[start - 1] === '\n'
  const lead = atLineStart ? '' : '\n'
  const body = selected || ''
  const wrapped = `${lead}\`\`\`\n${body}\n\`\`\`\n`
  const value = `${source.slice(0, start)}${wrapped}${source.slice(end)}`
  // Cursor on the language slot, immediately after the opening fence.
  const languageSlot = start + lead.length + 3
  return { value, start: languageSlot, end: languageSlot }
}

/** Standalone block insert: guarantees the construct owns its own line without
 *  swallowing text that was already there. */
function insertOnOwnLinePatchBlock(construct: string): EditorPatchFactoryBlock {
  return (source, start, end) => {
    const atLineStart = start === 0 || source[start - 1] === '\n'
    const lead = atLineStart ? '' : '\n'
    return insertTextAtSelectionBlock(source, start, end, `${lead}${construct}\n`)
  }
}

// ---------------------------------------------------------------------------
// The catalog
// ---------------------------------------------------------------------------

export const EDITOR_COMMANDS_BLOCK: readonly EditorCommandBlock[] = [
  {
    id: 'bold',
    label: 'Bold',
    group: 'Basic formatting',
    icon: Bold,
    syntax: '**',
    keywords: ['strong'],
    patch: (text, from, to) => wrapSelectionBlock(text, from, to, '**', '**', 'bold text'),
  },
  {
    id: 'italic',
    label: 'Italic',
    group: 'Basic formatting',
    icon: Italic,
    syntax: '*',
    keywords: ['emphasis'],
    patch: (text, from, to) => wrapSelectionBlock(text, from, to, '*', '*', 'italic text'),
  },
  {
    id: 'strikethrough',
    label: 'Strikethrough',
    group: 'Basic formatting',
    icon: Strikethrough,
    syntax: '~~',
    keywords: ['strike', 'delete'],
    patch: (text, from, to) => wrapSelectionBlock(text, from, to, '~~', '~~', 'struck text'),
  },
  {
    id: 'code',
    label: 'Inline code',
    group: 'Basic formatting',
    icon: Code,
    syntax: '`',
    patch: (text, from, to) => wrapSelectionBlock(text, from, to, '`', '`', 'code'),
  },
  {
    id: 'codeblock',
    label: 'Code block',
    group: 'Basic formatting',
    icon: SquareCode,
    syntax: '```',
    keywords: ['fence', 'snippet'],
    patch: insertCodeBlockPatchBlock,
  },
  {
    id: 'quote',
    label: 'Quote',
    group: 'Basic formatting',
    icon: Quote,
    syntax: '>',
    keywords: ['blockquote'],
    patch: (text, from, to) => prefixSelectionLinesBlock(text, from, to, (line) => `> ${line}`),
  },

  {
    id: 'heading1',
    label: 'Heading 1',
    group: 'Headings',
    icon: Heading1,
    syntax: '#',
    keywords: ['h1', 'title'],
    patch: (text, from, to) => wrapSelectionBlock(text, from, to, '# ', '', 'Heading'),
  },
  {
    id: 'heading2',
    label: 'Heading 2',
    group: 'Headings',
    icon: Heading2,
    syntax: '##',
    keywords: ['h2'],
    patch: (text, from, to) => wrapSelectionBlock(text, from, to, '## ', '', 'Heading'),
  },
  {
    id: 'heading3',
    label: 'Heading 3',
    group: 'Headings',
    icon: Heading3,
    syntax: '###',
    keywords: ['h3'],
    patch: (text, from, to) => wrapSelectionBlock(text, from, to, '### ', '', 'Heading'),
  },
  {
    id: 'heading4',
    label: 'Heading 4',
    group: 'Headings',
    icon: Heading4,
    syntax: '####',
    keywords: ['h4'],
    patch: (text, from, to) => wrapSelectionBlock(text, from, to, '#### ', '', 'Heading'),
  },

  {
    id: 'bulletList',
    label: 'Bullet list',
    group: 'Lists',
    icon: List,
    syntax: '-',
    keywords: ['unordered'],
    patch: (text, from, to) => prefixSelectionLinesBlock(text, from, to, (line) => `- ${line}`),
  },
  {
    id: 'numberedList',
    label: 'Numbered list',
    group: 'Lists',
    icon: ListOrdered,
    syntax: '1.',
    keywords: ['ordered'],
    patch: (text, from, to) => prefixSelectionLinesBlock(text, from, to, (line, i) => `${i + 1}. ${line}`),
  },
  {
    id: 'taskList',
    label: 'Task list',
    group: 'Lists',
    icon: ListTodo,
    syntax: '- [ ]',
    keywords: ['todo', 'checkbox'],
    patch: (text, from, to) => prefixSelectionLinesBlock(text, from, to, (line) => `- [ ] ${line}`),
  },

  {
    id: 'link',
    label: 'Link',
    group: 'Insert',
    icon: Link2,
    syntax: '[](url)',
    keywords: ['url', 'href'],
    patch: (text, from, to) => wrapSelectionBlock(text, from, to, '[', '](https://)', 'link text'),
  },
  {
    id: 'wikilink',
    label: 'Wikilink',
    group: 'Insert',
    icon: Link2,
    syntax: '[[ ]]',
    keywords: ['note', 'backlink', 'internal'],
    toolbarGlyph: '[[ ]]',
    patch: insertWikilinkBlock,
  },
  {
    id: 'table',
    label: 'Table',
    group: 'Insert',
    icon: Table,
    keywords: ['grid'],
    patch: (text, from, to) =>
      insertTextAtSelectionBlock(text, from, to, buildMarkdownTableTemplateBlock(3, 2)),
  },
  {
    id: 'formatTable',
    label: 'Format table',
    group: 'Insert',
    icon: Table,
    keywords: ['align', 'tidy'],
    toolbarGlyph: 'Fmt Tbl',
    patch: formatMarkdownTableAtSelectionBlock,
  },
  {
    id: 'horizontalRule',
    label: 'Horizontal rule',
    group: 'Insert',
    icon: Minus,
    syntax: '---',
    keywords: ['divider', 'separator', 'hr'],
    patch: insertOnOwnLinePatchBlock('---'),
  },
]

const COMMANDS_BY_ID_BLOCK = new Map(EDITOR_COMMANDS_BLOCK.map((cmd) => [cmd.id, cmd]))

export function getEditorCommandBlock(id: string): EditorCommandBlock | undefined {
  return COMMANDS_BY_ID_BLOCK.get(id)
}

/** Ordered ids per surface. Order is data, not a filter predicate — the toolbar
 *  and context menu each had a deliberate arrangement worth preserving, and a
 *  `surfaces: [...]` flag on the command would have lost it. */
export const TOOLBAR_COMMAND_IDS_BLOCK: readonly string[] = [
  'heading1',
  'bold',
  'italic',
  'code',
  'link',
  'table',
  'formatTable',
  'wikilink',
  'quote',
  'bulletList',
  'numberedList',
]

export const CONTEXT_MENU_COMMAND_IDS_BLOCK: readonly string[] = [
  'bold',
  'italic',
  'code',
  'link',
  'wikilink',
]

/** Commands the slash menu offers, in catalog order. `formatTable` is excluded:
 *  it rewrites a table you are standing in rather than inserting anything, so it
 *  is meaningless at a `/` on an otherwise empty line. */
const SLASH_EXCLUDED_IDS_BLOCK = new Set(['formatTable'])

export interface EditorCommandSectionBlock {
  group: EditorCommandGroupBlock
  commands: EditorCommandBlock[]
}

/** Filter + group for the slash menu. Matching is subsequence-free on purpose —
 *  plain substring over label and keywords. A fuzzy match sounds nicer but makes
 *  a 17-item menu reorder under your fingers while you type, and every wrong
 *  first row is a wrong insertion into the document. */
export function filterEditorCommandsBlock(query: string): EditorCommandSectionBlock[] {
  const needle = query.trim().toLowerCase()
  const matches = EDITOR_COMMANDS_BLOCK.filter((cmd) => {
    if (SLASH_EXCLUDED_IDS_BLOCK.has(cmd.id)) return false
    if (!needle) return true
    if (cmd.label.toLowerCase().includes(needle)) return true
    return (cmd.keywords ?? []).some((word) => word.toLowerCase().includes(needle))
  })

  const sections: EditorCommandSectionBlock[] = []
  for (const group of EDITOR_COMMAND_GROUPS_BLOCK) {
    const commands = matches.filter((cmd) => cmd.group === group)
    if (commands.length > 0) sections.push({ group, commands })
  }
  return sections
}

/** Flattened match list in the order the sections render — this is what the
 *  arrow keys walk, so it must stay derived from `filterEditorCommandsBlock`
 *  rather than recomputed independently. */
export function flattenEditorCommandSectionsBlock(
  sections: readonly EditorCommandSectionBlock[],
): EditorCommandBlock[] {
  return sections.flatMap((section) => section.commands)
}
