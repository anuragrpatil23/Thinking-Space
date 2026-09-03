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

/* pdf.js only treats storage entries as new annotations when their key carries
   this prefix; see the note in savePdfAnnotationsOrch. */
const PDF_EDITOR_STORAGE_PREFIX_BLOCK = 'pdfjs_internal_editor_'

export interface PdfAnnotationSaveRequestOrch {
  doc: PDFDocumentProxy
  path: string
  drafts: readonly PdfAnnotationDraftBlock[]
  /** Size of the file as loaded, to prove the save actually added something. */
  originalByteLength: number
}

export async function savePdfAnnotationsOrch(
  request: PdfAnnotationSaveRequestOrch,
): Promise<PdfAnnotationSaveOutcomeOrch> {
  const { doc, path, drafts, originalByteLength } = request
  if (drafts.length === 0) return { status: 'saved', byteLength: 0 }

  const storage = doc.annotationStorage
  const now = new Date()

  for (const draft of drafts) {
    /* The prefix is not decoration. pdf.js's worker builds its list of new
       annotations with `getNewAnnotationsMap`, which does:

           if (!key.startsWith(AnnotationEditorPrefix)) continue

       where the prefix is "pdfjs_internal_editor_". Keys without it are skipped
       silently, `saveDocument()` returns the document unchanged, and the write
       succeeds — so every mark was discarded while the UI reported success.
       The suffix is still our own id, so a key stays unique and stable across
       saves and a second save cannot duplicate an earlier mark. */
    storage.setValue(`${PDF_EDITOR_STORAGE_PREFIX_BLOCK}${draft.id}`, toPdfStorageEntryBlock(draft, now) as never)
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

  /* Never report a save we cannot evidence. A serializer that silently drops
     its input returns the original bytes and every downstream signal — the
     resolved promise, the successful write, the toolbar — reads as success.
     That is exactly how the missing-prefix bug survived a session of testing,
     so the length check is the guard against the whole class. */
  if (bytes.byteLength <= originalByteLength) {
    return {
      status: 'unwritable',
      reason: 'The PDF was written but gained no annotation data — the marks were not stored.',
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
