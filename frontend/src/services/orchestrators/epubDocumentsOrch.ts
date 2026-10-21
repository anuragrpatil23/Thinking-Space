import { getVaultFS } from '@/services/lego_blocks/integrations/fsBlock'

/* An EPUB's bytes from the vault, as a File foliate-js can unzip. The name
   carries the extension, which is how foliate tells EPUB from its other
   zip-based formats. */
export async function readEpubDocumentOrch(path: string): Promise<File> {
  const bytes = await getVaultFS().readBytes(path)
  const name = path.split('/').pop() || 'book.epub'
  /* The vault hands back a plain ArrayBuffer view; the cast only satisfies
     TS's SharedArrayBuffer-aware BlobPart type, without copying the book. */
  return new File([bytes as Uint8Array<ArrayBuffer>], name, { type: 'application/epub+zip' })
}
