import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import { getVaultFS } from '@/services/lego_blocks/integrations/fsBlock'
import { parseWebullPriceSeriesBlock, type WebullPricePointBlock } from '@/personal_extension/services/lego_blocks/units/webullCompanyDossierBlock'
import { parsePriceBandsBlock, type PriceBandBlock } from '@/personal_extension/services/lego_blocks/units/priceBandsBlock'
import { F9PriceChartBlock } from './F9PriceChartBlock'

/** Trading days shown: about the last four months, as the bands are drawn on. */
const TRADING_DAYS_SHOWN = 90

interface TickerChartBlockProps {
  ticker: string
  executionRoot: string
  className?: string
}

/**
 * A company's recent price with its bands, live from prices.csv and
 * bands.yaml (it used to be a picture, bands.png, rendered by a script).
 * Shows nothing when the company has no prices yet.
 */
export default function TickerChartBlock({ ticker, executionRoot, className }: TickerChartBlockProps) {
  const [data, setData] = useState<{ points: WebullPricePointBlock[]; bands: PriceBandBlock[] } | null>(null)

  useEffect(() => {
    let cancelled = false
    setData(null)
    if (!executionRoot || !ticker) return
    const folder = `${executionRoot.replace(/\/+$/, '')}/${ticker.toUpperCase()}`
    const fs = getVaultFS()
    void Promise.all([fs.read(`${folder}/prices.csv`).catch(() => null), fs.read(`${folder}/bands.yaml`).catch(() => null)]).then(([prices, bands]) => {
      if (cancelled) return
      setData({
        points: prices ? parseWebullPriceSeriesBlock(prices).slice(-TRADING_DAYS_SHOWN) : [],
        bands: parsePriceBandsBlock(bands)?.bands ?? [],
      })
    })
    return () => { cancelled = true }
  }, [executionRoot, ticker])

  if (!data || data.points.length < 2) return null
  return (
    <div className={cn('flex h-[220px] w-full', className)}>
      <F9PriceChartBlock points={data.points} bands={data.bands} idKey={`study-${ticker}`} className="h-full w-full" />
    </div>
  )
}
