import { describe, expect, it } from 'vitest'
import {
  classifyPdfLinkTextBlock,
  computePdfCaptionRegionBlock,
  computePdfPeekRegionBlock,
  findPdfFigureMentionsBlock,
  parsePdfCaptionStartBlock,
  parsePdfExplicitDestBlock,
} from '@/services/lego_blocks/units/pdfLinkTargetBlock'

describe('classifyPdfLinkTextBlock', () => {
  it('recognises figure and table references', () => {
    expect(classifyPdfLinkTextBlock('Figure 2')).toBe('figure')
    expect(classifyPdfLinkTextBlock('Fig. 1')).toBe('figure')
    expect(classifyPdfLinkTextBlock('Table 1')).toBe('table')
  })

  it('recognises author-year and numeric citations', () => {
    expect(classifyPdfLinkTextBlock('Hornik et al., 1989')).toBe('citation')
    expect(classifyPdfLinkTextBlock('2021')).toBe('citation')
    expect(classifyPdfLinkTextBlock('[12]')).toBe('citation')
    expect(classifyPdfLinkTextBlock('3')).toBe('citation')
  })

  it('recognises equations and sections', () => {
    expect(classifyPdfLinkTextBlock('Eq. 3')).toBe('equation')
    expect(classifyPdfLinkTextBlock('(4)')).toBe('equation')
    expect(classifyPdfLinkTextBlock('Section 2')).toBe('section')
    expect(classifyPdfLinkTextBlock('3.2')).toBe('section')
  })

  it('reads a bare number by the word before it', () => {
    expect(classifyPdfLinkTextBlock('2', 'see Figure ')).toBe('figure')
    expect(classifyPdfLinkTextBlock('3)', 'in Table ')).toBe('table')
    expect(classifyPdfLinkTextBlock('re 1)', ' (see Figu')).toBe('figure')
    expect(classifyPdfLinkTextBlock('e 2 w', 'In Tabl')).toBe('table')
    expect(classifyPdfLinkTextBlock('x B fo', '(see Appendi')).toBe('section')
    expect(classifyPdfLinkTextBlock('12')).toBe('citation')
  })

  it('treats a split author box as a citation', () => {
    expect(classifyPdfLinkTextBlock('(Deitke et al.,')).toBe('citation')
    expect(classifyPdfLinkTextBlock('(Fodor,')).toBe('citation')
    expect(classifyPdfLinkTextBlock('Tuli et')).toBe('citation')
    expect(classifyPdfLinkTextBlock('; Reed & Johnsen,')).toBe('citation')
    expect(classifyPdfLinkTextBlock('(Golo-')).toBe('citation')
    expect(classifyPdfLinkTextBlock('(Liu')).toBe('citation')
  })

  it('falls back to other', () => {
    expect(classifyPdfLinkTextBlock('')).toBe('other')
    expect(classifyPdfLinkTextBlock('supplementary material')).toBe('other')
  })
})

describe('parsePdfExplicitDestBlock', () => {
  it('reads XYZ and FitH destinations', () => {
    expect(parsePdfExplicitDestBlock([{}, { name: 'XYZ' }, 72, 700, null])).toEqual({ left: 72, top: 700 })
    expect(parsePdfExplicitDestBlock([{}, { name: 'FitH' }, 500])).toEqual({ left: null, top: 500 })
  })

  it('treats Fit and unknown modes as unspecified', () => {
    expect(parsePdfExplicitDestBlock([{}, { name: 'Fit' }])).toEqual({ left: null, top: null })
    expect(parsePdfExplicitDestBlock([{}, { name: 'XYZ' }, null, null])).toEqual({ left: null, top: null })
  })
})

describe('computePdfPeekRegionBlock', () => {
  const page = { pageWidth: 612, pageHeight: 792 }
  /* Two columns: left text 54–300, right text 312–558. */
  const twoColumn = [
    { x: 54, y: 410, width: 246 },
    { x: 54, y: 422, width: 240 },
    { x: 312, y: 410, width: 246 },
  ]

  it('clips a left-column citation to its column', () => {
    const region = computePdfPeekRegionBlock({ ...page, kind: 'citation', destLeft: 54, destTop: 400, textItems: twoColumn })
    expect(region.x).toBe(48)
    expect(region.x + region.width).toBe(306)
    expect(region.y).toBe(396)
  })

  it('clips a right-column citation to its column', () => {
    const region = computePdfPeekRegionBlock({ ...page, kind: 'citation', destLeft: 312, destTop: 400, textItems: twoColumn })
    expect(region.x).toBe(306)
    expect(region.x + region.width).toBe(564)
  })

  it('keeps the full measure on a single-column page', () => {
    const region = computePdfPeekRegionBlock({
      ...page,
      kind: 'citation',
      destLeft: 72,
      destTop: 400,
      textItems: [{ x: 72, y: 410, width: 468 }],
    })
    expect(region.x + region.width).toBe(546)
  })

  it('shows a tall full-width band for figures, clamped to the page', () => {
    const region = computePdfPeekRegionBlock({ ...page, kind: 'figure', destLeft: 54, destTop: 100, textItems: [] })
    expect(region).toEqual({ x: 0, y: 0, width: 612, height: 100 + 792 * 0.35 })
  })

  it('shows the whole page when a figure destination has no point', () => {
    expect(computePdfPeekRegionBlock({ ...page, kind: 'figure', destLeft: null, destTop: null, textItems: [] }))
      .toEqual({ x: 0, y: 0, width: 612, height: 792 })
  })
})

describe('captions', () => {
  it('tells a LaTeX caption from an APA label from a mention', () => {
    expect(parsePdfCaptionStartBlock('Figure 3: Comparison of model biases')).toEqual({ kind: 'figure', number: '3', style: 'caption-below' })
    expect(parsePdfCaptionStartBlock('Figure 4')).toEqual({ kind: 'figure', number: '4', style: 'label-above' })
    expect(parsePdfCaptionStartBlock('Table 1: DMTS Regression')).toEqual({ kind: 'table', number: '1', style: 'label-above' })
    expect(parsePdfCaptionStartBlock('Figure 2 shows the stimuli')).toBeNull()
    expect(parsePdfCaptionStartBlock('Figure 4', 'shows more')).toBeNull()
  })

  it('finds mentions in running text', () => {
    const text = 'regular shapes (Fig. 3bc), and Table 1 too'
    const found = findPdfFigureMentionsBlock(text)
    expect(found.map((m) => [text.slice(m.start, m.end), m.kind, m.number])).toEqual([
      ['Fig. 3bc', 'figure', '3'],
      ['Table 1', 'table', '1'],
    ])
  })

  it('crops downward from an APA label and upward from a LaTeX caption', () => {
    const base = { pageWidth: 600, pageHeight: 800, captionLeft: 50, captionLineRight: 550 }
    const above = computePdfCaptionRegionBlock({ ...base, style: 'label-above', captionTop: 100 })
    expect(above.y).toBe(86)
    expect(above.y + above.height).toBe(540)
    const below = computePdfCaptionRegionBlock({ ...base, style: 'caption-below', captionTop: 500 })
    expect(below.y).toBe(100)
    expect(below.y + below.height).toBe(580)
    expect(below.width).toBe(600)
  })

  it('does not read a short APA label as a narrow float', () => {
    const region = computePdfCaptionRegionBlock({
      style: 'label-above', pageWidth: 600, pageHeight: 800, captionTop: 100, captionLeft: 72, captionLineRight: 104,
    })
    expect(region.x).toBe(0)
    expect(region.width).toBe(600)
  })

  it('keeps a single-column float to its column', () => {
    const region = computePdfCaptionRegionBlock({
      style: 'caption-below', pageWidth: 600, pageHeight: 800, captionTop: 500, captionLeft: 320, captionLineRight: 560,
    })
    expect(region.x).toBe(310)
    expect(region.width).toBe(290)
    const left = computePdfCaptionRegionBlock({
      style: 'caption-below', pageWidth: 600, pageHeight: 800, captionTop: 500, captionLeft: 50, captionLineRight: 290,
    })
    expect(left.x).toBe(40)
    expect(left.width).toBe(260)
  })
})
