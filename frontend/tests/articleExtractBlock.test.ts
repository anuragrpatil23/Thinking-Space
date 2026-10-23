// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { extractArticleTextBlock } from '@/services/lego_blocks/units/articleExtractBlock'
import { webviewSiteCleanupCssBlock } from '@/services/lego_blocks/units/webviewSiteCleanupBlock'

const para = (n: number) => `<p>${'This paragraph says something real about the story at hand. '.repeat(3)}(${n})</p>`

describe('the reader view', () => {
  it('keeps the article as plain paragraphs and drops the rest of the page', async () => {
    const html = `<html><head><title>Story</title></head><body>
      <nav><a href="/">Home</a><a href="/world">World</a></nav>
      <aside class="support">This is the catch. Support us.</aside>
      <article><h1>Story</h1>${[1, 2, 3, 4, 5, 6].map(para).join('')}<ul><li><p>A point in a list.</p></li></ul></article>
      <footer>Footer links</footer></body></html>`
    const text = await extractArticleTextBlock(html, 'https://example.com/story')
    expect(text).not.toBeNull()
    expect(text!.split('\n\n').length).toBeGreaterThanOrEqual(6)
    expect(text).toContain('(6)')
    expect(text).not.toMatch(/Support us|Footer links|<p>/)
  })

  it('gives nothing for a teaser or a page without an article', async () => {
    expect(await extractArticleTextBlock('<html><body><p>Subscribe to read.</p></body></html>', 'https://example.com/x')).toBeNull()
  })

  it("hides The Guardian's own boxes in the page view, and nothing on other sites", () => {
    expect(webviewSiteCleanupCssBlock('https://www.theguardian.com/world/x')).toContain('StickyBottomBanner')
    expect(webviewSiteCleanupCssBlock('https://example.com/')).toBeNull()
  })
})
