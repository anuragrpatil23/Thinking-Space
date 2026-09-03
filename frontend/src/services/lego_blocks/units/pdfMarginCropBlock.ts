/* The margin box a PDF page is rendered with.

   Automatic margin trimming was built and then removed on request (2026-09-03);
   the detection machinery — text-item bounding boxes, an evenly spread page
   sample, union merging — is recoverable from git history at b3ec59b if it is
   ever wanted again.

   What remains is the crop box itself, because the annotation coordinate
   conversions are expressed in terms of it. Keeping the term makes the
   screen <-> PDF transform explicit about the offset it is or is not applying,
   rather than silently assuming the rendered region starts at the page origin.
   Today that offset is always zero. */

export interface PdfCropBoxBlock {
  /** Offsets from each edge, in PDF units. */
  left: number
  top: number
  right: number
  bottom: number
}

export const EMPTY_PDF_CROP_BOX_BLOCK: PdfCropBoxBlock = { left: 0, top: 0, right: 0, bottom: 0 }
