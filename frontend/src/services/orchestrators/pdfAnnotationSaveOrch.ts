import type { PDFDocumentProxy } from 'pdfjs-dist'
import { getVaultFS } from '@/services/lego_blocks/integrations/fsBlock'
import {
  toPdfStorageEntryBlock,
  type PdfAnnotationDraftBlock,
} from '@/services/lego_blocks/units/pdfAnnotationGeometryBlock'

/* Writes session annotations into the PDF itself.

   Decision record TP-PA-T-386: marks live in the file as standard `/Highlight`
   and `/Ink` annotations, not in a sidecar. `saveDocument()` performs an
   **incremental update** — pdf.js appends the new objects and a fresh xref to
   the original bytes rather than re-serializing the document. The original
   bytes therefore survive unchanged at the head of the file, which is the
   Durability contract's "a write never truncates the previous version"
   satisfied by the file format itself.

   Not every PDF can be written. Encrypted files, signed files (annotating
   invalidates the signature), and read-only media all fail, and they fail at
   save time rather than at open time. That is the one case the sidecar still
   exists for; this orchestrator's job is to report the failure honestly so the
   caller can fall back rather than silently losing a reader's marks. */

export type PdfAnnotationSaveOutcomeOrch =
  | { status: 'saved'; byteLength: number }
  | { status: 'unwritable'; reason: string }

export interface PdfAnnotationSaveRequestOrch {
  doc: PDFDocumentProxy
  path: string
  drafts: readonly PdfAnnotationDraftBlock[]
}

export async function savePdfAnnotationsOrch(
  request: PdfAnnotationSaveRequestOrch,
): Promise<PdfAnnotationSaveOutcomeOrch> {
  const { doc, path, drafts } = request
  if (drafts.length === 0) return { status: 'saved', byteLength: 0 }

  const storage = doc.annotationStorage
  const now = new Date()

  for (const draft of drafts) {
    /* The key must be unique per annotation and stable across saves, or a
       second save duplicates every mark made before it. */
    storage.setValue(draft.id, toPdfStorageEntryBlock(draft, now) as never)
  }

  let bytes: Uint8Array
  try {
    bytes = await doc.saveDocument()
  } catch (error) {
    return {
      status: 'unwritable',
      reason: error instanceof Error ? error.message : 'This PDF could not be written.',
    }
  }

  try {
    await getVaultFS().writeBytes(path, bytes)
  } catch (error) {
    return {
      status: 'unwritable',
      reason: error instanceof Error ? error.message : 'The file could not be written.',
    }
  }

  return { status: 'saved', byteLength: bytes.byteLength }
}
