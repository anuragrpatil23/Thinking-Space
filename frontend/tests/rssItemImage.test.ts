import { describe, expect, it } from 'vitest'
import {
  extractFirstHtmlImageBlock,
  extractRssItemImageBlock,
} from '@/services/lego_blocks/units/rssFeedBlock'

const LINK = 'https://example.com/posts/hello'

describe('extractRssItemImageBlock', () => {
  it('prefers a Media RSS thumbnail', () => {
    const entry = {
      media: {
        thumbnails: [{ url: 'https://cdn.example.com/thumb.jpg' }],
        contents: [{ url: 'https://cdn.example.com/full.jpg' }],
      },
    }
    expect(extractRssItemImageBlock(entry, LINK)).toBe('https://cdn.example.com/thumb.jpg')
  })

  it('falls back to a Media RSS content object', () => {
    const entry = { media: { contents: [{ url: 'https://cdn.example.com/full.jpg' }] } }
    expect(extractRssItemImageBlock(entry, LINK)).toBe('https://cdn.example.com/full.jpg')
  })

  it('accepts a media entry marked as an image even without an image extension', () => {
    const entry = { media: { contents: [{ url: 'https://cdn.example.com/render?id=9', medium: 'image' }] } }
    expect(extractRssItemImageBlock(entry, LINK)).toBe('https://cdn.example.com/render?id=9')
  })

  it('skips media explicitly marked as video', () => {
    const entry = { media: { contents: [{ url: 'https://cdn.example.com/clip.jpg', medium: 'video' }] } }
    expect(extractRssItemImageBlock(entry, LINK)).toBeNull()
  })

  it('reads an image enclosure', () => {
    const entry = { enclosures: [{ url: 'https://cdn.example.com/cover.png', type: 'image/png' }] }
    expect(extractRssItemImageBlock(entry, LINK)).toBe('https://cdn.example.com/cover.png')
  })

  it('never treats podcast audio as a lead image', () => {
    const entry = { enclosures: [{ url: 'https://cdn.example.com/ep12.mp3', type: 'audio/mpeg' }] }
    expect(extractRssItemImageBlock(entry, LINK)).toBeNull()
  })

  it('resolves a feed-relative url against the article link', () => {
    const entry = { media: { thumbnails: [{ url: '/img/lead.jpg' }] } }
    expect(extractRssItemImageBlock(entry, LINK)).toBe('https://example.com/img/lead.jpg')
  })

  it('rejects non-http schemes', () => {
    const entry = { media: { thumbnails: [{ url: 'data:image/png;base64,AAAA', medium: 'image' }] } }
    expect(extractRssItemImageBlock(entry, LINK)).toBeNull()
  })

  it('returns null for a text-only entry rather than guessing', () => {
    expect(extractRssItemImageBlock({}, LINK)).toBeNull()
    expect(extractRssItemImageBlock({ media: {} }, LINK)).toBeNull()
  })
})

describe('extractFirstHtmlImageBlock', () => {
  it('takes the first img src in the body', () => {
    const html = '<p>Intro</p><img src="https://cdn.example.com/a.jpg"><img src="https://cdn.example.com/b.jpg">'
    expect(extractFirstHtmlImageBlock(html, LINK)).toBe('https://cdn.example.com/a.jpg')
  })

  it('handles single quotes and extra attributes before src', () => {
    const html = "<img class='lead' loading='lazy' src='/img/x.png' alt='x'>"
    expect(extractFirstHtmlImageBlock(html, LINK)).toBe('https://example.com/img/x.png')
  })

  it('returns null when the body has no image', () => {
    expect(extractFirstHtmlImageBlock('<p>Just words</p>', LINK)).toBeNull()
  })

  it('does not match a bare "src" inside another attribute value', () => {
    // `data-srcset` must not be mistaken for the real src attribute.
    const html = '<img data-srcset="https://cdn.example.com/wrong.jpg 2x">'
    expect(extractFirstHtmlImageBlock(html, LINK)).toBeNull()
  })
})
