import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => '/tmp' }, session: { fromPartition: () => ({}) } }))

import { metaRefreshTargetBlock, pageHopBlock, proxiedUrlBlock } from '../electron/src/lego_blocks/librarySessionBlock'

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

  it('follows a page that moves on by itself, only within the proxy', () => {
    const base = 'https://atxlibrary.idm.oclc.org/login'
    const form = '<form method="post" action="https://research-valueline-com.atxlibrary.idm.oclc.org/sso"><input type="hidden" name="SAMLResponse" value="abc&amp;d"><input type="hidden" name="RelayState" value="x"></form><script>document.forms[0].submit()</script>'
    expect(pageHopBlock(form, base)).toEqual({ kind: 'form', action: 'https://research-valueline-com.atxlibrary.idm.oclc.org/sso', method: 'POST', fields: [['SAMLResponse', 'abc&d'], ['RelayState', 'x']] })
    expect(pageHopBlock('<script>window.location.href = "/connect?session=1"</script>', 'https://research-valueline-com.atxlibrary.idm.oclc.org/secure/research'))
      .toEqual({ kind: 'script', url: 'https://research-valueline-com.atxlibrary.idm.oclc.org/connect?session=1' })
    expect(pageHopBlock('<script>location.replace("https://evil.example.com/x")</script>', base)).toBeNull()
    // A login form is for a person, never submitted by itself
    expect(pageHopBlock('<form action="/login" method="post"><input type="hidden" name="url" value="u"><input name="user" type="text"><input type="password" name="pass"></form>', base)).toBeNull()
  })
})
