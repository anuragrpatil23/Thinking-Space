import { describe, expect, it } from 'vitest'
import {
  boundingRectBlock,
  PDF_ANNOTATION_EDITOR_TYPE_BLOCK,
  pdfPointToScreenBlock,
  screenPointToPdfBlock,
  screenRectToQuadPointsBlock,
  simplifyStrokeBlock,
  toPdfStorageEntryBlock,
  type PdfPageGeometryBlock,
} from '@/services/lego_blocks/units/pdfAnnotationGeometryBlock'

const UNCROPPED: PdfPageGeometryBlock = {
  naturalWidth: 612,
  naturalHeight: 792,
  scale: 2,
  crop: { left: 0, top: 0, right: 0, bottom: 0 },
}

const CROPPED: PdfPageGeometryBlock = {
  ...UNCROPPED,
  crop: { left: 90, top: 70, right: 90, bottom: 70 },
}

describe('screen <-> pdf coordinates', () => {
  it('flips the y axis and divides out the zoom', () => {
    // Top-left of an uncropped page is the top-left in PDF space: (0, height).
    expect(screenPointToPdfBlock({ x: 0, y: 0 }, UNCROPPED)).toEqual({ x: 0, y: 792 })
    expect(screenPointToPdfBlock({ x: 200, y: 400 }, UNCROPPED)).toEqual({ x: 100, y: 592 })
  })

  it('offsets by the crop, so a mark lands in full-page coordinates', () => {
    expect(screenPointToPdfBlock({ x: 0, y: 0 }, CROPPED)).toEqual({ x: 90, y: 722 })
  })

  it('round-trips through screen space', () => {
    for (const geometry of [UNCROPPED, CROPPED]) {
      const original = { x: 137, y: 249 }
      const roundTripped = pdfPointToScreenBlock(screenPointToPdfBlock(original, geometry), geometry)
      expect(roundTripped.x).toBeCloseTo(original.x, 6)
      expect(roundTripped.y).toBeCloseTo(original.y, 6)
    }
  })

  it('keeps a mark in the same PDF place whether or not the crop is on', () => {
    /* The same printed word sits at different screen offsets under a crop, and
       the annotation must not move when the reader toggles trimming. */
    const uncroppedPoint = screenPointToPdfBlock({ x: 180, y: 140 }, UNCROPPED)
    const croppedPoint = screenPointToPdfBlock(
      { x: 180 - CROPPED.crop.left * UNCROPPED.scale, y: 140 - CROPPED.crop.top * UNCROPPED.scale },
      CROPPED,
    )
    expect(croppedPoint.x).toBeCloseTo(uncroppedPoint.x, 6)
    expect(croppedPoint.y).toBeCloseTo(uncroppedPoint.y, 6)
  })
})

describe('screenRectToQuadPointsBlock', () => {
  it('emits eight numbers in PDF QuadPoints order (TL, TR, BL, BR)', () => {
    const quad = screenRectToQuadPointsBlock({ left: 0, top: 0, width: 100, height: 20 }, UNCROPPED)
    expect(quad).toHaveLength(8)

    const [tlx, tly, trx, try_, blx, bly, brx, bry] = quad
    expect(tlx).toBe(0)
    expect(trx).toBe(50)
    expect(tly).toBe(792)
    expect(try_).toBe(792)
    // Bottom edge is lower in PDF space, i.e. a smaller y.
    expect(bly).toBeLessThan(tly)
    expect(bry).toBe(bly)
    expect(blx).toBe(tlx)
    expect(brx).toBe(trx)
  })
})

describe('boundingRectBlock', () => {
  it('returns PDF rect order [xMin, yMin, xMax, yMax]', () => {
    expect(boundingRectBlock([{ x: 5, y: 9 }, { x: 1, y: 20 }, { x: 8, y: 2 }]))
      .toEqual([1, 2, 8, 20])
  })

  it('degrades to a zero rect rather than Infinity on empty input', () => {
    expect(boundingRectBlock([])).toEqual([0, 0, 0, 0])
  })
})

describe('toPdfStorageEntryBlock', () => {
  it('produces the shape pdf.js dispatches on for a highlight', () => {
    const entry = toPdfStorageEntryBlock({
      kind: 'highlight',
      id: 'hl-1',
      pageNumber: 3,
      quadPoints: [10, 100, 60, 100, 10, 80, 60, 80],
      color: [250, 204, 21],
      opacity: 0.4,
      text: 'a passage',
    })

    expect(entry.annotationType).toBe(PDF_ANNOTATION_EDITOR_TYPE_BLOCK.HIGHLIGHT)
    expect(entry.pageIndex).toBe(2)
    expect(entry.quadPoints).toHaveLength(8)
    expect(entry.rect).toEqual([10, 80, 60, 100])
  })

  it('pads an ink rect by half the stroke width so the drawn shape is not clipped', () => {
    const entry = toPdfStorageEntryBlock({
      kind: 'ink',
      id: 'ink-1',
      pageNumber: 1,
      inkList: [[10, 10, 30, 40]],
      color: [220, 38, 38],
      opacity: 1,
      thickness: 4,
    })

    expect(entry.annotationType).toBe(PDF_ANNOTATION_EDITOR_TYPE_BLOCK.INK)
    expect(entry.paths).toEqual({ points: [[10, 10, 30, 40]] })
    expect(entry.rect).toEqual([8, 8, 32, 42])
  })
})

describe('simplifyStrokeBlock', () => {
  it('drops collinear samples but keeps the endpoints', () => {
    const straight = Array.from({ length: 40 }, (_, index) => ({ x: index, y: 0 }))
    const simplified = simplifyStrokeBlock(straight)
    expect(simplified).toEqual([{ x: 0, y: 0 }, { x: 39, y: 0 }])
  })

  it('keeps a corner', () => {
    const corner = [
      { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 },
      { x: 20, y: 10 }, { x: 20, y: 20 },
    ]
    const simplified = simplifyStrokeBlock(corner)
    expect(simplified.length).toBeGreaterThan(2)
    expect(simplified).toContainEqual({ x: 20, y: 0 })
  })

  it('leaves short strokes alone', () => {
    expect(simplifyStrokeBlock([{ x: 1, y: 1 }, { x: 2, y: 2 }]))
      .toEqual([{ x: 1, y: 1 }, { x: 2, y: 2 }])
  })
})
