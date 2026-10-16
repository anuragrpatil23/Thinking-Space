// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { act, render } from '@testing-library/react'
import { useState } from 'react'
import { useNoteFindInViewBlock } from '@/components/lego_blocks/hooks/units/useNoteFindInViewBlock'
import { literalFindQueryBlock, wordsFindQueryBlock, type NoteFindQuery } from '@/services/lego_blocks/units/searchHighlightTermsBlock'

const nextFrame = () => act(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())))

let report = ''
let load: (text: string) => void = () => undefined

function Note({ query }: { query: NoteFindQuery | null }) {
  const [text, setText] = useState<string | null>(null)
  load = setText
  const { ref, matches } = useNoteFindInViewBlock(true, query)
  report = matches ? `${matches.count}:${matches.current}` : 'none'
  // Mirrors the note view: the prose element only exists once text has loaded.
  return text === null ? <div>Loading…</div> : <div ref={ref}><p>{text}</p></div>
}

describe('useNoteFindInViewBlock', () => {
  it('finds matches in a note whose text arrives after the query', async () => {
    Element.prototype.scrollIntoView = () => undefined
    render(<Note query={wordsFindQueryBlock(['mission'])} />)
    await nextFrame()
    expect(report).toBe('none') // nothing rendered yet — no false "not in the text"

    act(() => load('Nobody cares about the mission. Missions end. Permission denied.'))
    await nextFrame()
    await nextFrame()
    expect(report).toBe('2:0') // word starts only: not "Permission"
  })

  it('finds a typed phrase literally', async () => {
    const query = literalFindQueryBlock('swap of promises')
    render(<Note query={query} />)
    act(() => load('What happened is a Swap of promises, and a swap of favours.'))
    await nextFrame()
    await nextFrame()
    expect(report).toBe('1:0')
  })
  it('settles when every render rebuilds the note text (no re-scan loop)', async () => {
    let renders = 0
    function Rebuilding() {
      renders++
      const { ref, matches } = useNoteFindInViewBlock(true, wordsFindQueryBlock(['mission']))
      report = matches ? `${matches.count}:${matches.current}` : 'none'
      // A fresh key per render replaces the text node — a DOM mutation the
      // observer sees after every single render.
      return <div ref={ref}><p key={renders}>the mission</p></div>
    }
    render(<Rebuilding />)
    for (let i = 0; i < 6; i++) await nextFrame()
    expect(report).toBe('1:0')
    const settled = renders
    for (let i = 0; i < 6; i++) await nextFrame()
    expect(renders).toBe(settled)
  })
})
