import type { ReactNode } from 'react'

/**
 * The shape every phone Home tile shares: a small caption naming the section,
 * and the tile's own two or three lines — the whole thing one
 * button that opens the section's full page.
 *
 * Home on a phone is a column of things to glance at. A long section there is
 * a tile that says the one thing worth knowing and leaves the rest a tap away
 * (see docs/contracts/IOS-NATIVE-CHROME.md, "Home on iPhone is tiles").
 */
export default function HomeTileBlock({
  label,
  onOpen,
  accessory,
  children,
}: {
  label: string
  onOpen: () => void
  /** A small mark on the caption's line, at the trailing edge — something of
   *  the tile's own (the board's note colours), not a generic chevron. */
  accessory?: ReactNode
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      // A flex column pinned to the top: a plain <button> centres its content
      // vertically, so the shorter of two side-by-side tiles sat lower than
      // its neighbour and their captions did not line up.
      className="flex h-full w-full flex-col justify-start text-left outline-none focus-visible:ring-1 focus-visible:ring-foreground/40"
    >
      {/* No chevron: three of them down the right edge were the loudest
          repeated mark on the screen, and a card this size already reads as
          something to tap. */}
      <span className="flex h-4 items-center justify-between gap-2">
        <span className="truncate text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground/60">
          {label}
        </span>
        {accessory}
      </span>
      {children}
    </button>
  )
}

/** The shadow a phone tile sits on: wide and faint, so the card lifts off the
 *  backdrop without the tight grey edge the desktop panel shadow gives a
 *  small card. Paired with a 22px radius by whoever draws the tile's box. */
export const HOME_TILE_SHADOW_BLOCK = '0 1px 2px rgba(20,20,24,0.04), 0 10px 28px rgba(20,20,24,0.07)'

/** A tile's headline figure and the quieter line under it. */
export function HomeTileFigureBlock({ figure, line }: { figure: ReactNode; line: ReactNode }) {
  return (
    <>
      <span className="mt-4 block text-[28px] font-semibold leading-none tracking-[-0.03em] tabular-nums text-foreground">
        {figure}
      </span>
      <span className="mt-2.5 block truncate text-[13px] text-muted-foreground">{line}</span>
    </>
  )
}
