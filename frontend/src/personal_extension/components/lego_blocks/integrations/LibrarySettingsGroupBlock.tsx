import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/lego_blocks/units/ui/button'
import { SavedCredentialInputBlock } from '@/components/lego_blocks/units/SavedCredentialInputBlock'
import {
  SETTINGS_CONTROL_CLASS_BLOCK,
  SettingsGroupBlock,
  SettingsRowBlock,
} from '@/components/lego_blocks/units/SettingsGroupBlock'

type LibraryStatusBlock = Awaited<ReturnType<NonNullable<NonNullable<typeof window.electronAPI>['libraryStatus']>>>

function statusLineBlock(status: LibraryStatusBlock | null): string {
  if (!status) return 'Checking…'
  if (status.source === 'saved') return `Saved · username ${status.cardHint ?? ''}`.trim()
  if (status.source === 'keychain') return `Using the Keychain item atxlibrary-austin · username ${status.cardHint ?? ''}`.trim()
  return 'Not set'
}

// The library login behind Feed full text (Gale) and Value Line reports. Like
// the Webull keys: saved encrypted on this Mac by main, never synced, and never
// read back — only a masked username comes back.
export function LibrarySettingsGroupBlock() {
  const api = typeof window === 'undefined' ? undefined : window.electronAPI
  const supported = Boolean(api?.isElectron && api.libraryStatus && api.librarySaveCard && api.libraryClearCard)
  const [status, setStatus] = useState<LibraryStatusBlock | null>(null)
  const [card, setCard] = useState('')
  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<{ text: string; error: boolean } | null>(null)

  useEffect(() => {
    if (!supported) return
    void api!.libraryStatus!().then(setStatus).catch(() => setStatus(null))
  }, [api, supported])

  const run = async (work: () => Promise<LibraryStatusBlock>, done: string) => {
    setBusy(true)
    setNote(null)
    try {
      setStatus(await work())
      setCard('')
      setPin('')
      setNote({ text: done, error: false })
    } catch (err) {
      setNote({ text: err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : 'Failed', error: true })
    } finally {
      setBusy(false)
    }
  }

  return (
    <SettingsGroupBlock
      heading="Library login"
      description={!supported
        ? 'The library is reached from the desktop app only.'
        : status && !status.secureStorageAvailable
          ? 'Secure storage is unavailable on this device — the login cannot be saved safely.'
          : 'Austin Public Library. Fills paywalled Feed articles with their full text and fetches Value Line reports. Stored encrypted on this Mac, never synced.'}
    >
      <SettingsRowBlock
        as="label"
        htmlFor="ltm-settings-library-card"
        label="Username"
        control={(
          <SavedCredentialInputBlock
            id="ltm-settings-library-card"
            saved={Boolean(status?.source)}
            savedDisplay={status?.cardHint}
            value={card}
            onValueChange={setCard}
            placeholder="Enter username"
            disabled={!supported}
            className={cn(SETTINGS_CONTROL_CLASS_BLOCK, 'w-[280px] disabled:cursor-not-allowed disabled:opacity-60')}
          />
        )}
      />
      <SettingsRowBlock
        as="label"
        htmlFor="ltm-settings-library-pin"
        label="Password"
        control={(
          <SavedCredentialInputBlock
            id="ltm-settings-library-pin"
            secret
            saved={Boolean(status?.source)}
            value={pin}
            onValueChange={setPin}
            placeholder="Enter password"
            disabled={!supported}
            className={cn(SETTINGS_CONTROL_CLASS_BLOCK, 'w-[280px] disabled:cursor-not-allowed disabled:opacity-60')}
          />
        )}
      />
      <SettingsRowBlock
        label="Status"
        description={(
          <>
            {supported ? statusLineBlock(status) : 'Not available here'}
            {note && <span className={cn('ml-2', note.error ? 'text-red-600 dark:text-red-400' : 'text-emerald-700 dark:text-emerald-400')}>{note.text}</span>}
          </>
        )}
        control={(
          <>
            <Button
              type="button"
              size="sm"
              className="h-8"
              disabled={!supported || busy || !card.trim() || !pin}
              onClick={() => { void run(() => api!.librarySaveCard!({ card, pin }), 'Saved.') }}
            >
              {busy ? 'Saving…' : 'Save'}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8"
              disabled={!supported || busy || status?.source !== 'saved'}
              onClick={() => { void run(() => api!.libraryClearCard!(), 'Cleared.') }}
            >
              Clear
            </Button>
          </>
        )}
      />
    </SettingsGroupBlock>
  )
}
