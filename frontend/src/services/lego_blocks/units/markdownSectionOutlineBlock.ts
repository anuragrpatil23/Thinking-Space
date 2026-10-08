import { assignSectionOutlineLabelsBlock } from '@/services/lego_blocks/units/outlineCounterBlock'
import type { MarkdownTableOfContentsItemBlock } from '@/services/lego_blocks/units/markdownTableOfContentsBlock'

/**
 * A note's headings as the reading view needs them: each with the same
 * outline label the Contents list shows, so a number in the note, in the
 * Contents button and in the list always names the same section.
 */
export interface MarkdownSectionRowBlock {
  id: string
  title: string
  level: number
  /** '' for the document title, which is not a section. */
  label: string
  isTitle: boolean
  item: MarkdownTableOfContentsItemBlock
}

export function buildMarkdownSectionRowsBlock(items: MarkdownTableOfContentsItemBlock[]): MarkdownSectionRowBlock[] {
  const { titleIndex, labels } = assignSectionOutlineLabelsBlock(items.map((item) => item.level))
  return items.map((item, index) => ({
    id: item.id,
    title: item.title,
    level: item.level,
    label: labels[index] ?? '',
    isTitle: index === titleIndex,
    item,
  }))
}

const MIN_SECTIONS_TO_NUMBER = 3
const ALREADY_NUMBERED = /^(\d+(\.\d+)*[.):]?\s|(step|part|chapter|section|phase)\s+\d+\b)/i

/**
 * Whether to draw outline numbers beside the note's own headings. Not on a
 * short note, where they are noise, and not when the author already numbered
 * the headings, where they would read "2 1. Setup".
 */
export function shouldNumberMarkdownHeadingsBlock(rows: MarkdownSectionRowBlock[]): boolean {
  const sections = rows.filter((row) => !row.isTitle)
  if (sections.length < MIN_SECTIONS_TO_NUMBER) return false
  const alreadyNumbered = sections.filter((row) => ALREADY_NUMBERED.test(row.title.trim())).length
  return alreadyNumbered * 2 < sections.length
}

export interface MarkdownSectionLocationBlock {
  /** From the top-level section down to the heading being read. */
  path: MarkdownSectionRowBlock[]
  /** That top-level section and every heading under it, in order. */
  section: MarkdownSectionRowBlock[]
}

const NOWHERE: MarkdownSectionLocationBlock = { path: [], section: [] }

/** Where `activeId` sits in the outline. Empty above the first section (the
 *  title is not a place within the note). */
export function resolveMarkdownSectionLocationBlock(
  rows: MarkdownSectionRowBlock[],
  activeId: string | null,
): MarkdownSectionLocationBlock {
  if (!activeId) return NOWHERE
  const activeIndex = rows.findIndex((row) => row.id === activeId)
  if (activeIndex < 0 || rows[activeIndex].isTitle) return NOWHERE

  const path = [rows[activeIndex]]
  let rootIndex = activeIndex
  let level = rows[activeIndex].level
  for (let index = activeIndex - 1; index >= 0; index -= 1) {
    const row = rows[index]
    if (row.isTitle) break
    if (row.level < level) {
      path.unshift(row)
      level = row.level
      rootIndex = index
    }
  }

  let end = rootIndex + 1
  while (end < rows.length && rows[end].level > rows[rootIndex].level) end += 1
  return { path, section: rows.slice(rootIndex, end) }
}

/**
 * Stamp the rendered headings with their outline identity. Done on the DOM
 * after each render, not through a counter in the heading renderer: a counter
 * keeps counting across re-renders and hands later renders no id at all.
 *
 * Headings inside quotes and lists are skipped — the outline is built from the
 * note's own top-level headings and does not count those.
 */
export function tagMarkdownHeadingElementsBlock(
  root: ParentNode,
  rows: MarkdownSectionRowBlock[],
  numbered: boolean,
): void {
  const headings = root.querySelectorAll<HTMLElement>('h1,h2,h3,h4,h5,h6')
  let index = 0
  for (const heading of Array.from(headings)) {
    if (heading.closest('blockquote, li')) continue
    const row = rows[index]
    index += 1
    if (!row) {
      heading.removeAttribute('data-markdown-heading-id')
      heading.removeAttribute('data-outline-label')
      continue
    }
    if (heading.dataset.markdownHeadingId !== row.id) heading.dataset.markdownHeadingId = row.id
    const label = numbered && !row.isTitle ? row.label : ''
    if (label) {
      if (heading.dataset.outlineLabel !== label) heading.dataset.outlineLabel = label
    } else {
      heading.removeAttribute('data-outline-label')
    }
  }
}
