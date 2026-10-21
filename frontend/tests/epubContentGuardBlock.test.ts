// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import {
  EPUB_SECTION_CSP_BLOCK,
  guardEpubMarkupBlock,
  isEpubMarkupTypeBlock,
} from '@/services/lego_blocks/units/epubContentGuardBlock'

const XHTML = (body: string, head = '<title>t</title>') =>
  `<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head>${head}</head><body>${body}</body></html>`

describe('guardEpubMarkupBlock', () => {
  it('strips scripts, handlers and script URLs from an XHTML section', () => {
    const out = guardEpubMarkupBlock(XHTML(
      '<p onclick="steal()">Hi</p><script>steal()</script><a href=" java\tscript:steal()">x</a><img src="blob:ok" onerror="steal()"/>',
    ), 'application/xhtml+xml')
    expect(out).not.toMatch(/<script/i)
    expect(out).not.toMatch(/onclick|onerror/i)
    expect(out).not.toMatch(/javascript/i)
    expect(out).toContain('Hi')
    expect(out).toContain('src="blob:ok"')
  })

  it('injects the CSP as the first element of head', () => {
    const out = guardEpubMarkupBlock(XHTML('<p>x</p>'), 'application/xhtml+xml')
    const head = out.slice(out.indexOf('<head>') + 6)
    expect(head.startsWith('<meta http-equiv="Content-Security-Policy"')).toBe(true)
    expect(out).toContain("script-src 'none'")
  })

  it('creates a head when the section has none', () => {
    const out = guardEpubMarkupBlock(
      '<html xmlns="http://www.w3.org/1999/xhtml"><body><p>x</p></body></html>',
      'application/xhtml+xml',
    )
    expect(out).toContain(EPUB_SECTION_CSP_BLOCK)
    expect(out.indexOf('<head')).toBeLessThan(out.indexOf('<body'))
  })

  it('removes embedded active content and meta refresh', () => {
    const out = guardEpubMarkupBlock(XHTML(
      '<iframe src="blob:x"></iframe><object data="x"></object><embed src="x"/>',
      '<meta http-equiv="refresh" content="0;url=javascript:steal()"/>',
    ), 'application/xhtml+xml')
    expect(out).not.toMatch(/<iframe|<object|<embed|refresh/i)
  })

  it('guards HTML sections too', () => {
    const out = guardEpubMarkupBlock('<!DOCTYPE html><html><head></head><body><script>x()</script><p onmouseover="x()">ok</p></body></html>', 'text/html')
    expect(out).not.toMatch(/<script|onmouseover/i)
    expect(out).toContain("script-src 'none'")
  })

  it('strips scripts from SVG', () => {
    const out = guardEpubMarkupBlock('<svg xmlns="http://www.w3.org/2000/svg"><script>x()</script><rect onload="x()"/></svg>', 'image/svg+xml')
    expect(out).not.toMatch(/<script|onload/i)
  })

  it('falls back to pattern stripping when XHTML does not parse', () => {
    const out = guardEpubMarkupBlock('<html><head></head><body><p>broken <b></p><script>x()</script><p onclick="x()">y</p></body></html>', 'application/xhtml+xml')
    expect(out).not.toMatch(/<script|onclick/i)
    expect(out).toContain("script-src 'none'")
  })

  it('leaves non-markup resources alone', () => {
    expect(guardEpubMarkupBlock('body { color: red }', 'text/css')).toBe('body { color: red }')
    expect(isEpubMarkupTypeBlock('application/xhtml+xml; charset=utf-8')).toBe(true)
    expect(isEpubMarkupTypeBlock('text/css')).toBe(false)
  })
})
