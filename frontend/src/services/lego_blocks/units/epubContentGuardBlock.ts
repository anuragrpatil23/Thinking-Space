/* Makes an EPUB section inert before it is rendered.

   Book content is untrusted HTML. foliate-js turns each section into a blob:
   URL and loads it into an iframe whose sandbox must include
   `allow-same-origin allow-scripts` (WebKit will not deliver events to the
   reader otherwise), and a blob: document shares the app's origin. So the
   sandbox blocks nothing: a script in a book would run with the app's origin
   and could read the vault (docs/contracts/SECURITY.md, the same hazard as
   vault HTML pages).

   Two independent layers, so one mistake is not enough:
   1. Strip: script elements, inline event handlers, javascript: URLs, and
      the elements that load other active content (iframe, object, embed,
      frame, meta refresh).
   2. Forbid: a Content-Security-Policy meta as the first element of <head>,
      with `script-src 'none'`. It also keeps the book from reaching the
      network — every resource the book legitimately uses has already been
      rewritten to a blob: URL by the time this runs.

   Pure apart from DOMParser/XMLSerializer, so it runs (and is tested) without
   a reader. */

export const EPUB_SECTION_CSP_BLOCK = [
  "default-src 'none'",
  "script-src 'none'",
  "object-src 'none'",
  "frame-src 'none'",
  "img-src blob: data:",
  "media-src blob: data:",
  "font-src blob: data:",
  "style-src 'unsafe-inline' blob:",
].join('; ')

const MARKUP_TYPES_BLOCK = new Set(['application/xhtml+xml', 'text/html', 'image/svg+xml'])
const REMOVED_ELEMENTS_BLOCK = ['script', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet', 'portal']
const URL_ATTRIBUTES_BLOCK = ['href', 'src', 'action', 'formaction', 'data', 'xlink:href', 'poster']
const XHTML_NS_BLOCK = 'http://www.w3.org/1999/xhtml'

export function isEpubMarkupTypeBlock(type: string): boolean {
  return MARKUP_TYPES_BLOCK.has(type.split(';')[0].trim().toLowerCase())
}

function isScriptUrlBlock(value: string): boolean {
  /* Browsers ignore embedded whitespace and control characters in a scheme. */
  let normalized = ''
  for (const char of value) if (char.charCodeAt(0) > 0x20) normalized += char
  normalized = normalized.toLowerCase()
  return normalized.startsWith('javascript:') || normalized.startsWith('vbscript:')
    || normalized.startsWith('data:text/html') || normalized.startsWith('data:application/xhtml')
}

function neutralizeBlock(doc: Document): void {
  for (const name of REMOVED_ELEMENTS_BLOCK) {
    for (const element of Array.from(doc.getElementsByTagName(name))) element.remove()
  }
  for (const meta of Array.from(doc.getElementsByTagName('meta'))) {
    if ((meta.getAttribute('http-equiv') ?? '').toLowerCase() === 'refresh') meta.remove()
  }
  for (const element of Array.from(doc.getElementsByTagName('*'))) {
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase()
      if (name.startsWith('on')) {
        element.removeAttributeNode(attribute)
      } else if (URL_ATTRIBUTES_BLOCK.includes(name) && isScriptUrlBlock(attribute.value)) {
        element.removeAttributeNode(attribute)
      }
    }
  }
}

function injectCspBlock(doc: Document, xml: boolean): void {
  const root = doc.documentElement
  if (!root || root.localName !== 'html') return
  const ns = xml ? (root.namespaceURI ?? XHTML_NS_BLOCK) : null
  const create = (tag: string) => (ns ? doc.createElementNS(ns, tag) : doc.createElement(tag))
  let head = Array.from(root.children).find((child) => child.localName === 'head')
  if (!head) {
    head = create('head')
    root.insertBefore(head, root.firstChild)
  }
  const meta = create('meta')
  meta.setAttribute('http-equiv', 'Content-Security-Policy')
  meta.setAttribute('content', EPUB_SECTION_CSP_BLOCK)
  head.insertBefore(meta, head.firstChild)
}

/* Last resort when the markup does not parse: no DOM to walk, so strip by
   pattern. Crude, which is why the CSP still goes in front of it. */
function fallbackGuardBlock(markup: string): string {
  const stripped = markup
    .replace(/<script\b[\s\S]*?<\/script\s*>/gi, '')
    .replace(/<script\b[^>]*\/?>/gi, '')
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
  const meta = `<meta http-equiv="Content-Security-Policy" content="${EPUB_SECTION_CSP_BLOCK}"/>`
  if (/<head\b[^>]*>/i.test(stripped)) return stripped.replace(/<head\b[^>]*>/i, (tag) => `${tag}${meta}`)
  return `${meta}${stripped}`
}

/** The section's markup, made inert. Non-markup resources pass through. */
export function guardEpubMarkupBlock(markup: string, type: string): string {
  const mime = type.split(';')[0].trim().toLowerCase()
  if (!MARKUP_TYPES_BLOCK.has(mime)) return markup
  const xml = mime !== 'text/html'
  const doc = new DOMParser().parseFromString(markup, mime as DOMParserSupportedType)
  if (xml && doc.getElementsByTagName('parsererror').length > 0) return fallbackGuardBlock(markup)

  neutralizeBlock(doc)
  injectCspBlock(doc, xml)
  if (xml) return new XMLSerializer().serializeToString(doc)
  return `<!DOCTYPE html>\n${doc.documentElement.outerHTML}`
}
