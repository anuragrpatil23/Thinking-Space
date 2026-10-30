// Which gap a Webull position belongs to, from the gaps' positions logs (read
// by the private Gaps folder when it is present). A leg that carries the
// position's Webull id is the match; otherwise an option leg of the same
// contract, or a stock leg of the same company. One contract can sit on
// several gaps, bought for each at a different time, so a position can show
// more than one.

export interface GapPositionLinkBlock {
  gapId: string
  title: string
  filePath: string
  webullId: string | null
  symbol: string
  kind: 'option' | 'stock'
  strike: number | null
  right: 'call' | 'put'
  expiry: string | null
  account: string
}

export interface WebullPositionKeyBlock {
  /** The position's id, as the sync files it: "account::id" or the bare id */
  id: string | null
  symbol: string | null
  instrumentType: string | null
  optionType: string | null
  optionExpireDate: string | null
  optionExercisePrice: string | number | null
}

export interface GapOfPositionBlock {
  gapId: string
  title: string
  filePath: string
}

export function gapsForPositionBlock(links: GapPositionLinkBlock[], p: WebullPositionKeyBlock): GapOfPositionBlock[] {
  const bareId = p.id ? p.id.split('::').pop() ?? null : null
  const byId = bareId ? links.filter(l => l.webullId === bareId) : []
  const symbol = (p.symbol ?? '').toUpperCase()
  const type = (p.instrumentType ?? '').toUpperCase()
  const isOption = type === 'OPTION' || Boolean(p.optionExpireDate)
  const strike = p.optionExercisePrice === null || p.optionExercisePrice === '' ? null : Number(p.optionExercisePrice)
  const right = (p.optionType ?? '').toUpperCase() === 'PUT' ? 'put' : 'call'
  const matched = byId.length > 0
    ? byId
    : !symbol || type === 'CASH'
      ? []
      : links.filter(l => l.symbol.toUpperCase() === symbol && (isOption
        ? l.kind === 'option' && l.expiry === p.optionExpireDate && l.right === right && strike !== null && l.strike !== null && Math.abs(l.strike - strike) < 1e-6
        : l.kind === 'stock'))
  const seen = new Map<string, GapOfPositionBlock>()
  for (const l of matched) if (!seen.has(l.gapId)) seen.set(l.gapId, { gapId: l.gapId, title: l.title, filePath: l.filePath })
  // Newest gap first
  return [...seen.values()].sort((a, b) => b.gapId.localeCompare(a.gapId))
}
