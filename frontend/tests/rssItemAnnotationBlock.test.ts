import { describe, expect, it } from 'vitest'
import {
  registerRssItemAnnotationProviderBlock,
  rssItemAnnotationsBlock,
  rssItemAnnotationsVersionBlock,
  subscribeRssItemAnnotationsBlock,
} from '@/services/lego_blocks/units/rssItemAnnotationBlock'

describe('rss item annotations', () => {
  it('collects marks from registered providers and notifies on change', () => {
    let changed = 0
    const stop = subscribeRssItemAnnotationsBlock(() => { changed += 1 })
    let notify: () => void = () => {}
    const marked = new Set(['feed::1'])
    const unregister = registerRssItemAnnotationProviderBlock({
      id: 'test',
      annotate: (id) => (marked.has(id) ? { label: 'Note', onOpen: () => {} } : null),
      subscribe: (onChange) => { notify = onChange; return () => { notify = () => {} } },
    })
    expect(rssItemAnnotationsBlock('feed::1').map((m) => m.label)).toEqual(['Note'])
    expect(rssItemAnnotationsBlock('feed::2')).toEqual([])
    const before = rssItemAnnotationsVersionBlock()
    marked.add('feed::2')
    notify()
    expect(rssItemAnnotationsVersionBlock()).toBe(before + 1)
    expect(rssItemAnnotationsBlock('feed::2')).toHaveLength(1)
    unregister()
    expect(rssItemAnnotationsBlock('feed::1')).toEqual([])
    expect(changed).toBeGreaterThanOrEqual(3)
    stop()
  })

  it('a provider that throws never breaks the reader', () => {
    const unregister = registerRssItemAnnotationProviderBlock({ id: 'bad', annotate: () => { throw new Error('x') } })
    expect(rssItemAnnotationsBlock('any')).toEqual([])
    unregister()
  })
})
