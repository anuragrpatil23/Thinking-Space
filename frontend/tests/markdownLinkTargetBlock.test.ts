import { describe, expect, it } from 'vitest'
import { classifyMarkdownLinkTargetBlock } from '@/services/lego_blocks/units/markdownLinkTargetBlock'
import { isStrayAppNavigationBlock } from '../electron/src/lego_blocks/appNavigationGuardBlock'

describe('classifyMarkdownLinkTargetBlock', () => {
  it('treats relative hrefs as vault paths', () => {
    expect(classifyMarkdownLinkTargetBlock('gpt-with-sparse-network.html'))
      .toEqual({ kind: 'vault', path: 'gpt-with-sparse-network.html' })
    expect(classifyMarkdownLinkTargetBlock('../../../Experiential/training-the-sparse-autoencoder.md'))
      .toEqual({ kind: 'vault', path: '../../../Experiential/training-the-sparse-autoencoder.md' })
  })

  it('decodes the path and drops query and fragment', () => {
    expect(classifyMarkdownLinkTargetBlock('AI%20Synthesis/note.md#heading'))
      .toEqual({ kind: 'vault', path: 'AI Synthesis/note.md' })
    expect(classifyMarkdownLinkTargetBlock('page.html?x=1'))
      .toEqual({ kind: 'vault', path: 'page.html' })
    expect(classifyMarkdownLinkTargetBlock('100%.md')).toEqual({ kind: 'vault', path: '100%.md' })
  })

  it('separates web links, in-page anchors and other schemes', () => {
    expect(classifyMarkdownLinkTargetBlock('https://example.com/a'))
      .toEqual({ kind: 'external', url: 'https://example.com/a' })
    expect(classifyMarkdownLinkTargetBlock('//example.com/a'))
      .toEqual({ kind: 'external', url: 'https://example.com/a' })
    expect(classifyMarkdownLinkTargetBlock('#the-question')).toEqual({ kind: 'anchor', fragment: 'the-question' })
    expect(classifyMarkdownLinkTargetBlock('mailto:a@b.c')).toEqual({ kind: 'other' })
    expect(classifyMarkdownLinkTargetBlock('')).toEqual({ kind: 'other' })
    expect(classifyMarkdownLinkTargetBlock(undefined)).toEqual({ kind: 'other' })
  })
})

describe('isStrayAppNavigationBlock', () => {
  const scheme = 'capacitor-electron'
  const app = 'capacitor-electron://-/#/thinking-space?file=a.md'

  it('flags a same-scheme navigation that leaves the app document', () => {
    expect(isStrayAppNavigationBlock(app, 'capacitor-electron://-/gpt-with-sparse-network.html', scheme)).toBe(true)
  })

  it('allows reloads, index.html and other schemes', () => {
    expect(isStrayAppNavigationBlock(app, 'capacitor-electron://-/#/settings', scheme)).toBe(false)
    expect(isStrayAppNavigationBlock(app, 'capacitor-electron://-/index.html', scheme)).toBe(false)
    expect(isStrayAppNavigationBlock(app, 'obsidian://open?vault=x', scheme)).toBe(false)
    expect(isStrayAppNavigationBlock('http://localhost:5173/', 'http://localhost:5173/x.html', scheme)).toBe(false)
  })
})
