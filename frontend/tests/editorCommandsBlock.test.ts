import { describe, expect, it } from 'vitest'
import {
  CONTEXT_MENU_COMMAND_IDS_BLOCK,
  EDITOR_COMMANDS_BLOCK,
  TOOLBAR_COMMAND_IDS_BLOCK,
  filterEditorCommandsBlock,
  flattenEditorCommandSectionsBlock,
  getEditorCommandBlock,
} from '@/components/lego_blocks/units/editorCommandsBlock'

/** Runs a command the way `applyPatch` does and returns the resulting document
 *  plus the text the editor would leave selected. */
function runCommand(id: string, source: string, from: number, to: number) {
  const command = getEditorCommandBlock(id)
  if (!command) throw new Error(`unknown command: ${id}`)
  const patch = command.patch(source, from, to)
  return { value: patch.value, selected: patch.value.slice(patch.start, patch.end) }
}

describe('editorCommandsBlock — surfaces resolve', () => {
  it('every toolbar id names a real command', () => {
    for (const id of TOOLBAR_COMMAND_IDS_BLOCK) {
      expect(getEditorCommandBlock(id), id).toBeDefined()
    }
  })

  it('every context-menu id names a real command', () => {
    for (const id of CONTEXT_MENU_COMMAND_IDS_BLOCK) {
      expect(getEditorCommandBlock(id), id).toBeDefined()
    }
  })

  it('has no duplicate ids', () => {
    const ids = EDITOR_COMMANDS_BLOCK.map((cmd) => cmd.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

// The refactor moved these out of MarkdownRichEditorBlock. The output has to
// stay byte-identical to what the toolbar produced before, so these are pinned.
describe('editorCommandsBlock — patch output', () => {
  it('wraps a selection and keeps it selected', () => {
    expect(runCommand('bold', 'make me loud', 5, 12)).toEqual({
      value: 'make **me loud**',
      selected: 'me loud',
    })
  })

  it('inserts a placeholder when nothing is selected', () => {
    expect(runCommand('italic', 'x', 1, 1)).toEqual({
      value: 'x*italic text*',
      selected: 'italic text',
    })
  })

  it('prefixes headings at each level', () => {
    expect(runCommand('heading1', 'Title', 0, 5).value).toBe('# Title')
    expect(runCommand('heading2', 'Title', 0, 5).value).toBe('## Title')
    expect(runCommand('heading3', 'Title', 0, 5).value).toBe('### Title')
    expect(runCommand('heading4', 'Title', 0, 5).value).toBe('#### Title')
  })

  it('prefixes every line the selection touches', () => {
    const src = 'one\ntwo\nthree'
    expect(runCommand('bulletList', src, 0, src.length).value).toBe('- one\n- two\n- three')
    expect(runCommand('numberedList', src, 0, src.length).value).toBe('1. one\n2. two\n3. three')
    expect(runCommand('taskList', src, 0, src.length).value).toBe(
      '- [ ] one\n- [ ] two\n- [ ] three',
    )
  })

  it('expands a partial selection to whole lines', () => {
    // Cursor inside "two" only — the line still gets the full prefix.
    expect(runCommand('quote', 'one\ntwo\nthree', 5, 5).value).toBe('one\n> two\nthree')
  })

  it('puts the cursor on the language slot of a new code block', () => {
    const { value, selected } = runCommand('codeblock', '', 0, 0)
    expect(value).toBe('```\n\n```\n')
    expect(selected).toBe('')
    // Empty selection, so assert the position directly.
    const patch = getEditorCommandBlock('codeblock')!.patch('', 0, 0)
    expect(patch.start).toBe(3)
    expect(value.slice(0, patch.start)).toBe('```')
  })

  it('fences the selection and breaks to its own line when mid-text', () => {
    expect(runCommand('codeblock', 'see: x', 5, 6).value).toBe('see: \n```\nx\n```\n')
  })

  it('gives a horizontal rule its own line', () => {
    expect(runCommand('horizontalRule', '', 0, 0).value).toBe('---\n')
    expect(runCommand('horizontalRule', 'text', 4, 4).value).toBe('text\n---\n')
  })

  it('builds a wikilink around the selection', () => {
    expect(runCommand('wikilink', 'see Ideas', 4, 9)).toEqual({
      value: 'see [[Ideas]]',
      selected: 'Ideas',
    })
  })
})

describe('editorCommandsBlock — slash filtering', () => {
  it('groups everything when the query is empty', () => {
    const sections = filterEditorCommandsBlock('')
    expect(sections.map((s) => s.group)).toEqual([
      'Basic formatting',
      'Headings',
      'Lists',
      'Insert',
    ])
  })

  it('excludes format-table, which has nothing to insert', () => {
    const ids = flattenEditorCommandSectionsBlock(filterEditorCommandsBlock('')).map((c) => c.id)
    expect(ids).not.toContain('formatTable')
    expect(ids).toContain('table')
  })

  it('drops empty groups instead of rendering an empty header', () => {
    const sections = filterEditorCommandsBlock('head')
    expect(sections.map((s) => s.group)).toEqual(['Headings'])
    expect(sections[0].commands).toHaveLength(4)
  })

  it('matches on keywords that are never displayed', () => {
    const ids = flattenEditorCommandSectionsBlock(filterEditorCommandsBlock('todo')).map((c) => c.id)
    expect(ids).toEqual(['taskList'])
  })

  it('is case-insensitive and ignores surrounding space', () => {
    const ids = flattenEditorCommandSectionsBlock(filterEditorCommandsBlock(' QUOTE ')).map((c) => c.id)
    expect(ids).toEqual(['quote'])
  })

  it('returns nothing for a query that matches no command', () => {
    expect(filterEditorCommandsBlock('zzz')).toEqual([])
  })
})
