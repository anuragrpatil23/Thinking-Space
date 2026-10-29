// The status line names where a save landed ("Saved to iCloud"), because that
// — not "something happened" — is the reassurance a long note needs.

import { describe, it, expect } from 'vitest'

import { saveLocationBlock, saveStatusLabelBlock } from '@/services/lego_blocks/units/saveLocationBlock'

const mac = { isMac: true }

describe('saveLocationBlock', () => {
  it('names the provider from the vault path', () => {
    expect(saveLocationBlock('/Users/a/Library/Mobile Documents/iCloud~md~obsidian/Documents/V', mac).phrase).toBe('to iCloud')
    expect(saveLocationBlock('/Users/a/Library/CloudStorage/GoogleDrive-a@x.com/My Drive/V', mac).phrase).toBe('to Google Drive')
    expect(saveLocationBlock('/Users/a/Library/CloudStorage/Dropbox/V', mac).phrase).toBe('to Dropbox')
    expect(saveLocationBlock('/Users/a/Library/CloudStorage/OneDrive-Personal/V', mac).phrase).toBe('to OneDrive')
  })

  it('calls any other synced folder the cloud', () => {
    expect(saveLocationBlock('/Users/a/Library/CloudStorage/Box-Box/V', mac)).toMatchObject({ kind: 'cloud', synced: true })
  })

  // The web build's folder: the browser hides its real path, so don't guess.
  it('does not claim a location for a browser-opened folder', () => {
    expect(saveLocationBlock('browser-fs', mac)).toMatchObject({ kind: 'folder', phrase: 'to your folder' })
  })

  it('says the note is on this machine otherwise', () => {
    expect(saveLocationBlock('/Users/a/Notes', mac).phrase).toBe('on this Mac')
    expect(saveLocationBlock(null, { isMac: false }).phrase).toBe('on this device')
  })
})

describe('saveStatusLabelBlock', () => {
  const icloud = saveLocationBlock('/x/Mobile Documents/V', mac)
  it('reads like Docs', () => {
    expect(saveStatusLabelBlock('pending', icloud)).toBe('Saving…')
    expect(saveStatusLabelBlock('saving', icloud)).toBe('Saving…')
    expect(saveStatusLabelBlock('saved', icloud)).toBe('Saved to iCloud')
    expect(saveStatusLabelBlock('failed', icloud)).toBe('Not saved — retrying')
    expect(saveStatusLabelBlock('idle', icloud)).toBe('')
  })
})
