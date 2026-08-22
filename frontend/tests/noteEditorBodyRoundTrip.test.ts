// Durability contract: the editor round trip must not eat characters.
// See docs/contracts/DURABILITY.md.
//
// The editor only sees prose — frontmatter and the canvas fence are stripped on
// the way out and reattached on the way in. So this pair is the one place in
// the composer where a pure-function bug deletes text with nothing on screen to
// show it: the editor hands back a body, and whatever this reassembles is what
// gets written to disk.
//
// The property: reassembling an unchanged body must reproduce the file exactly.

import { describe, it, expect } from 'vitest'

import {
  noteEditorBodyBlock,
  applyEditorBodyBlock,
} from '@/services/lego_blocks/units/noteComposerBlock'
import {
  parseNoteCanvasBlock,
  applyNoteCanvasToContent,
  stringifyNoteCanvasBlock,
} from '@/services/lego_blocks/units/noteCanvasBlock'
import type { CanvasTile } from '@/components/lego_blocks/hooks/shared/useCanvasTilesBlock'

const canvasOps = { parse: parseNoteCanvasBlock, apply: applyNoteCanvasToContent }
const editorBody = (content: string) => noteEditorBodyBlock(content, parseNoteCanvasBlock)
const roundTrip = (content: string) =>
  applyEditorBodyBlock(content, editorBody(content), canvasOps)

const tile = { id: 't1', x: 0, y: 0, w: 10, h: 10 } as unknown as CanvasTile
const fence = stringifyNoteCanvasBlock([tile])

const frontmatter = [
  '---',
  'uuid: "8f14e45f"',
  'title: "A note"',
  'type: thought',
  'tags:',
  '  - thought',
  '---',
  '',
].join('\n')

describe('editor body round trip preserves content exactly', () => {
  const cases: Array<[string, string]> = [
    ['plain prose', 'Just some words.\n'],
    ['empty', ''],
    ['only whitespace', '   \n\n\t\n'],
    ['frontmatter + prose', `${frontmatter}A sentence.\n`],
    ['frontmatter only', frontmatter],
    ['prose with no trailing newline', `${frontmatter}No newline at the end`],
    ['blank lines inside prose', `${frontmatter}One.\n\n\nTwo.\n\n`],
    ['leading blank lines in the body', `${frontmatter}\n\n\nIndented start\n`],
    ['a canvas fence with prose above', `${frontmatter}Above the canvas.\n\n${fence}\n`],
    ['a canvas fence with prose below', `${frontmatter}\n${fence}\n\nBelow the canvas.\n`],
    ['a canvas fence and nothing else', `${frontmatter}${fence}\n`],
    ['prose that looks like frontmatter mid-document', `${frontmatter}Text.\n\n---\n\nMore text.\n`],
    ['a fenced code block that is not canvas', `${frontmatter}\`\`\`ts\nconst a = 1\n\`\`\`\n`],
    ['CRLF line endings', `---\r\ntitle: "x"\r\n---\r\n\r\nBody line\r\n`],
    ['unicode and emoji', `${frontmatter}Καλημέρα — 🌍 — naïve café\n`],
    ['a very long single line', `${frontmatter}${'x'.repeat(50_000)}\n`],
  ]

  it.each(cases)('preserves %s', (_label, content) => {
    const result = roundTrip(content)
    // Every character that went in must come back out.
    for (const line of content.split('\n')) {
      if (line.trim()) expect(result).toContain(line.trim())
    }
    expect(result).toBe(content)
  })
})

describe('frontmatter never reaches the editor', () => {
  it.each([
    ['LF', `${frontmatter}Body line\n`],
    ['CRLF', '---\r\ntitle: "x"\r\n---\r\n\r\nBody line\r\n'],
  ])('hides it for %s files', (_label, content) => {
    // A CRLF note must not show ten lines of uuid/key/tags above the caret
    // just because its line endings differ.
    expect(editorBody(content)).not.toContain('title:')
    expect(editorBody(content)).toContain('Body line')
  })
})

describe('editing through the round trip', () => {
  it('applies an edit without disturbing frontmatter', () => {
    const content = `${frontmatter}Original line.\n`
    const edited = applyEditorBodyBlock(content, 'Replaced line.\n', canvasOps)
    expect(edited).toBe(`${frontmatter}Replaced line.\n`)
    expect(edited.startsWith(frontmatter)).toBe(true)
  })

  it('keeps the canvas when only prose changes', () => {
    const content = `${frontmatter}Old prose.\n\n${fence}\n`
    const edited = applyEditorBodyBlock(content, 'New prose.\n', canvasOps)
    expect(parseNoteCanvasBlock(edited).tiles).toHaveLength(1)
    expect(edited).toContain('New prose.')
    expect(edited).not.toContain('Old prose.')
  })

  // A note without a canvas must not gain an empty one just by being edited.
  it('does not invent a canvas fence', () => {
    const edited = applyEditorBodyBlock(`${frontmatter}Words.\n`, 'More words.\n', canvasOps)
    expect(parseNoteCanvasBlock(edited).hadFence).toBe(false)
  })

  it('is idempotent under repeated round trips', () => {
    let content = `${frontmatter}Stable.\n\n${fence}\n`
    for (let i = 0; i < 5; i += 1) {
      const next = roundTrip(content)
      expect(next).toBe(content)
      content = next
    }
  })
})

describe('generated content round-trips', () => {
  // Fuzz over the structural pieces that have caused trouble, rather than over
  // random strings: the interesting bugs live at the seams.
  const pieces = ['', '\n', 'text\n', '\n\ntext\n\n', '---\n', '```\ncode\n```\n', fence + '\n']

  it('survives every combination of structural pieces', () => {
    for (const a of pieces) {
      for (const b of pieces) {
        for (const withFrontmatter of [true, false]) {
          const content = `${withFrontmatter ? frontmatter : ''}${a}${b}`
          expect(roundTrip(content)).toBe(content)
        }
      }
    }
  })
})
