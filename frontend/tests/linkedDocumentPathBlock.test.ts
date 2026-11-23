import { describe, expect, it } from 'vitest'
import { linkedDocumentBreadcrumbBlock, linkedDocumentPathBlock, parseLinkedDocumentPathBlock } from '../src/services/lego_blocks/units/linkedDocumentPathBlock'

describe('a linked document path', () => {
  it('round-trips and hides the id from the breadcrumb', () => {
    const path = linkedDocumentPathBlock('abc', 'papers/guo-2026/guo-2026.pdf')
    expect(parseLinkedDocumentPathBlock(path)).toEqual({ folderId: 'abc', relPath: 'papers/guo-2026/guo-2026.pdf', kind: 'papers' })
    expect(parseLinkedDocumentPathBlock(linkedDocumentPathBlock('abc', 'run.py', 'code'))).toEqual({ folderId: 'abc', relPath: 'run.py', kind: 'code' })
    expect(linkedDocumentBreadcrumbBlock(path)).toBe('Linked folder / papers / guo-2026')
  })

  it('is not read from ordinary or malformed paths', () => {
    for (const path of ['notes/a.md', '@linked/', '@linked/abc', '@linked/abc/']) expect(parseLinkedDocumentPathBlock(path)).toBeNull()
  })
})
