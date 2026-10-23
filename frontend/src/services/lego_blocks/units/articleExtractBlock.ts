// The article inside a web page, as plain paragraphs: what the reader view
// shows instead of the site (no ads, no banners, no layout). Mozilla's
// Readability (Firefox's reader view) finds the article; only the text of its
// paragraphs, headings, list items and quotes is kept, so nothing from the page
// is ever rendered as HTML. Loaded on first use, never at startup.

/** Less than this is a teaser, a paywall or a page that is not an article. */
export const ARTICLE_EXTRACT_MIN_CHARS_BLOCK = 800

const BLOCK_SELECTOR = 'p, h1, h2, h3, h4, li, blockquote, pre'

export function articleParagraphsBlock(root: ParentNode): string[] {
  const out: string[] = []
  for (const el of Array.from(root.querySelectorAll(BLOCK_SELECTOR))) {
    // A list item or quote holding paragraphs is read through its paragraphs
    if (el.querySelector(BLOCK_SELECTOR)) continue
    const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim()
    if (text) out.push(text)
  }
  return out
}

/** The article's text (paragraphs separated by blank lines), or null when the page has no article worth showing. */
export async function extractArticleTextBlock(html: string, url: string): Promise<string | null> {
  const { Readability } = await import('@mozilla/readability')
  const doc = new DOMParser().parseFromString(html, 'text/html')
  // Relative links resolve against the article, not the app
  const base = doc.createElement('base')
  base.href = url
  doc.head.prepend(base)
  const article = new Readability(doc, { charThreshold: 400 }).parse()
  if (!article?.content) return null
  const content = new DOMParser().parseFromString(article.content, 'text/html')
  const paragraphs = articleParagraphsBlock(content.body)
  const text = paragraphs.join('\n\n')
  return text.length >= ARTICLE_EXTRACT_MIN_CHARS_BLOCK && paragraphs.length >= 3 ? text : null
}
