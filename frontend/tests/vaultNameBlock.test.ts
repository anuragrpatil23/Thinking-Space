import { describe, expect, it } from 'vitest'
import { vaultNameFromRootBlock } from '@/services/lego_blocks/units/vaultNameBlock'

describe('vaultNameBlock', () => {
  it('names the vault after its last path segment', () => {
    expect(vaultNameFromRootBlock('/Users/x/iCloud/Long-Term-Memory-iCloud'))
      .toBe('Long-Term-Memory-iCloud')
  })

  it('ignores a trailing slash', () => {
    expect(vaultNameFromRootBlock('/Users/x/Vault/')).toBe('Vault')
  })

  it('normalizes windows separators', () => {
    expect(vaultNameFromRootBlock('C:\\Users\\x\\Vault')).toBe('Vault')
  })

  it('has no name for a rootless path', () => {
    expect(vaultNameFromRootBlock('/')).toBeNull()
    expect(vaultNameFromRootBlock('')).toBeNull()
  })
})
