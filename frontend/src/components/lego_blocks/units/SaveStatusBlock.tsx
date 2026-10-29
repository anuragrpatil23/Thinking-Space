import { useEffect, useId, useState } from 'react'
import { RefreshCw, TriangleAlert } from 'lucide-react'

import { cn } from '@/lib/utils'
import { getStoredVaultRoot } from '@/services/lego_blocks/units/storageKeyBlock'
import {
  saveLocationBlock,
  saveStatusLabelBlock,
  type SaveStatusKindBlock,
} from '@/services/lego_blocks/units/saveLocationBlock'

// The one save indicator, shared by the New-note composer and the Explorer
// editor. It never changes a setting (it used to toggle manual saving, which
// nobody expected); clicking it does what ⌘S does — save now. Grey in every normal
// state — the icon changes shape, not colour, so it can flip between
// "Saving…" and "Saved" every sentence without pulling the eye. Only a failure
// gets colour. Auto-save is the only mode; ⌘S just saves sooner.

/** A balanced cloud — flat base, small left bump, big crown — rather than
 *  Lucide's lopsided one, which read off beside the drive (2026-10-29). Same
 *  solid check badge, widened viewBox, sizing and nudge as the drive (below),
 *  so the two "saved" icons are one family. The badge sits clear of the crown. */
function CloudCheckIcon() {
  const badgeMask = `${useId()}-badge`
  return (
    <svg
      viewBox="0 -5 31.5 29"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-[16.9px] w-[18.4px] shrink-0 -translate-y-[1.45px]"
      aria-hidden="true"
    >
      <defs>
        <mask id={badgeMask}>
          <rect x="0" y="-5" width="31.5" height="29" fill="white" />
          <path d="m21.5 3.1 1.75 1.75 3.25-3.35" stroke="black" strokeWidth={1.9} fill="none" />
        </mask>
      </defs>
      <path d="M6.5 19h11.5a4.5 4.5 0 0 0 .5-8.97A6.5 6.5 0 0 0 6.1 10.3 4.4 4.4 0 0 0 6.5 19Z" />
      <circle cx="24" cy="3" r="5.5" fill="currentColor" stroke="none" mask={`url(#${badgeMask})`} />
    </svg>
  )
}

/** Lucide's hard drive at full size, with a solid check badge just past its
 *  top-right corner. A check drawn *inside* the drive vanished at 14px, and
 *  shrinking the drive to make room made the drive unreadable (2026-10-28) —
 *  so the viewBox grows instead: the drive keeps its 0–24 box and the badge
 *  lives in the extra margin, clear of the drive's outline. The svg is sized
 *  to keep 24 units = 14px, and nudged up so the drive sits where a plain
 *  icon would. The check is knocked out of the disc (mask ⇒ `useId`). */
function HardDriveCheckIcon({ className }: { className?: string }) {
  const badgeMask = `${useId()}-badge`
  return (
    <svg
      viewBox="0 -5 31.5 29"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn('h-[16.9px] w-[18.4px] shrink-0 -translate-y-[1.45px]', className)}
      aria-hidden="true"
    >
      <defs>
        <mask id={badgeMask}>
          <rect x="0" y="-5" width="31.5" height="29" fill="white" />
          <path d="m22.5 1.6 1.75 1.75 3.25-3.35" stroke="black" strokeWidth={1.9} fill="none" />
        </mask>
      </defs>
      <line x1="22" x2="2" y1="12" y2="12" />
      <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
      <line x1="6" x2="6.01" y1="16" y2="16" />
      <line x1="10" x2="10.01" y1="16" y2="16" />
      <circle cx="25" cy="1.5" r="5.5" fill="currentColor" stroke="none" mask={`url(#${badgeMask})`} />
    </svg>
  )
}

/** The ⌘S answer: circle draws, then the check (`.ltm-save-confirm`). */
function SaveConfirmIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.25} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <circle cx="12" cy="12" r="10" transform="rotate(-90 12 12)" />
      <path d="m8 12.5 2.5 2.5 5.5-5.5" />
    </svg>
  )
}

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)

export function SaveStatusBlock({
  status,
  savedAt,
  compact = false,
  reserveWhenIdle = false,
  confirmToken,
  failureReason,
  onSaveNow,
  className,
}: {
  status: SaveStatusKindBlock
  /** Epoch ms of the last successful write, for the hover. */
  savedAt?: number | null
  /** Icon only (phone title bars); the label moves to the hover/aria. */
  compact?: boolean
  /** Hold the space even with nothing to say (a note not yet written), so
   *  the first keystroke doesn't shove the bar either. */
  reserveWhenIdle?: boolean
  /** Bump on an explicit ⌘S. Auto-save has usually written already, so the
   *  line would read "Saved" before and after — a keypress with no visible
   *  answer feels broken. A changed token plays the check animation. */
  confirmToken?: number
  /** Why saving failed, shown on hover instead of in a banner. */
  failureReason?: string | null
  /** Click = ⌘S: save now, then the check plays (the caller bumps
   *  `confirmToken`). Asked for as reassurance (2026-10-29) — the line used
   *  to *toggle a setting* on click, which nobody expected; saving is what a
   *  click on "Saved" should mean if it means anything. */
  onSaveNow?: () => void
  className?: string
}) {
  const [confirming, setConfirming] = useState(false)
  useEffect(() => {
    if (!confirmToken) return
    setConfirming(true)
    const timer = window.setTimeout(() => setConfirming(false), 1600)
    return () => window.clearTimeout(timer)
  }, [confirmToken])

  if (status === 'idle' && !reserveWhenIdle) return null
  const location = saveLocationBlock(getStoredVaultRoot(), { isMac: IS_MAC })
  const label = saveStatusLabelBlock(status, location)
  const iconClass = 'h-3.5 w-3.5 shrink-0'
  const iconFor = (kind: SaveStatusKindBlock) => kind === 'failed'
    ? <TriangleAlert className={iconClass} />
    : kind === 'saved'
      ? (location.synced ? <CloudCheckIcon /> : <HardDriveCheckIcon />)
      : <RefreshCw className={cn(iconClass, 'animate-spin [animation-duration:2s]')} />
  const title = status === 'saved' && savedAt
    ? `${label} at ${new Date(savedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
    : status === 'failed'
      ? `${failureReason ? `${failureReason}\n\n` : ''}Your text is kept safe on this device and will be written as soon as saving works again.`
      : label
  const clickable = Boolean(onSaveNow) && status !== 'idle'
  const shown: SaveStatusKindBlock = status === 'pending' ? 'saving' : status

  // Every state (icon + words) stacked in one grid cell, so the cell is as wide
  // as the widest and only the live one is visible. Right-aligned: the spare
  // width opens on the *left*, which is why callers put this first in their
  // cluster — the slack lands in the empty bar beside the title, and nothing
  // to its right ever moves.
  const Root = clickable ? 'button' : 'span'
  return (
    <Root
      {...(clickable ? { type: 'button' as const, onClick: onSaveNow } : {})}
      role={clickable ? undefined : status === 'idle' ? undefined : 'status'}
      aria-live="polite"
      aria-label={label ? (clickable ? `${label} — save now` : label) : undefined}
      title={title ? (clickable ? `${title}\nClick to save now (⌘S)` : title) : undefined}
      className={cn(
        'grid select-none justify-items-end whitespace-nowrap text-xs transition-colors duration-300',
        // The box reserves the widest label, so tinting *it* lit up empty
        // space beside short labels; the tint and the focus ring live on the
        // visible row instead (below), and the browser's own ring is off.
        clickable && 'group cursor-pointer outline-none hover:text-foreground',
        status === 'failed'
          ? 'font-medium text-amber-600 dark:text-amber-400'
          : confirming && status === 'saved'
            ? 'text-foreground'
            : 'text-muted-foreground',
        className,
      )}
    >
      {(['saving', 'saved', 'failed'] as const).map(kind => (
        <span
          key={kind}
          aria-hidden="true"
          className={cn(
            'col-start-1 row-start-1 inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 transition-colors',
            clickable && 'group-hover:bg-muted group-focus-visible:ring-1 group-focus-visible:ring-ring/50',
            kind !== shown && 'invisible',
          )}
        >
          {kind === 'saved' && confirming && status === 'saved'
            // Keyed so a second ⌘S mid-animation replays it from the start.
            ? <SaveConfirmIcon key={confirmToken} className={cn(iconClass, 'ltm-save-confirm text-emerald-500')} />
            : iconFor(kind)}
          {!compact && saveStatusLabelBlock(kind, location)}
        </span>
      ))}
    </Root>
  )
}
