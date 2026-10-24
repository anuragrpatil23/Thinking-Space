import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => '/tmp' }, session: { fromPartition: () => ({}) } }))

import { metaRefreshTargetBlock, proxiedUrlBlock } from '../electron/src/lego_blocks/librarySessionBlock'

describe('library session helpers', () => {
  it('names a database the way the proxy serves it', () => {
    expect(proxiedUrlBlock('https://research.valueline.com/secure/research')).toBe('https://research-valueline-com.atxlibrary.idm.oclc.org/secure/research')
    expect(proxiedUrlBlock('http://go.gale.com/ps/i.do?p=ITOF')).toBe('https://go-gale-com.atxlibrary.idm.oclc.org/ps/i.do?p=ITOF')
    expect(proxiedUrlBlock('https://research-valueline-com.atxlibrary.idm.oclc.org/x')).toBe('https://research-valueline-com.atxlibrary.idm.oclc.org/x')
  })

  it('finds a refresh page target', () => {
    const page = '<html><head><meta http-equiv="refresh" content="0;url=https://research-valueline-com.atxlibrary.idm.oclc.org/secure/research&amp;x=1"></head></html>'
    expect(metaRefreshTargetBlock(page, 'https://atxlibrary.idm.oclc.org/login')).toBe('https://research-valueline-com.atxlibrary.idm.oclc.org/secure/research&x=1')
    expect(metaRefreshTargetBlock('<p>no refresh</p>', 'https://atxlibrary.idm.oclc.org/login')).toBeNull()
  })
})
