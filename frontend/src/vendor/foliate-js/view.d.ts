/* Hand-written types for the parts of foliate-js the EPUB reader uses. */

export interface FoliateTocItem {
  label: string
  href: string
  subitems?: FoliateTocItem[]
}

export interface FoliateBook {
  metadata?: { title?: unknown; author?: unknown; language?: unknown }
  toc?: FoliateTocItem[]
  sections: unknown[]
  /** Present for EPUB: fires 'data' (detail: { data, type, name }) before
   *  each resource becomes a blob URL, and 'load' (detail: { type, isScript,
   *  allow }) before each manifest item loads. */
  transformTarget?: EventTarget
}

export interface FoliateRelocateDetail {
  fraction?: number
  cfi?: string
  tocItem?: { label?: string; href?: string } | null
  location?: { current: number; next: number; total: number }
}

export interface FoliateRenderer extends HTMLElement {
  setStyles?(css: string | [string, string]): void
  next(): Promise<void>
  prev(): Promise<void>
}

export class View extends HTMLElement {
  book: FoliateBook
  renderer: FoliateRenderer
  lastLocation: FoliateRelocateDetail | null
  open(book: FoliateBook | File | Blob): Promise<void>
  close(): void
  init(options: { lastLocation?: string | null; showTextStart?: boolean }): Promise<void>
  goTo(target: string | number): Promise<unknown>
  goToFraction(fraction: number): Promise<void>
  prev(distance?: number): Promise<void>
  next(distance?: number): Promise<void>
  goLeft(): Promise<void>
  goRight(): Promise<void>
}

export function makeBook(file: File | Blob): Promise<FoliateBook>
export class UnsupportedTypeError extends Error {}
