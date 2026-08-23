import { useMemo, useState } from 'react'
import { Rss } from 'lucide-react'
import { rssSourceHueBlock } from '@/services/lego_blocks/units/rssFeedBlock'
import { cn } from '@/lib/utils'

/** Origins whose favicon already 404'd. Module-level so one failure is paid
 *  once per session rather than once per card that shows the same source. */
const failedFaviconOrigins = new Set<string>()

/** The source mark for an article: favicon when the origin serves one, a hued
 *  monogram when it does not. Shared by every RSS surface. */
export default function RssSourceAvatarBlock({
  link, feedTitle, className, imgClassName,
}: {
  link: string
  feedTitle: string
  /** Sizing/shape of the mark itself — callers pick the scale they need. */
  className?: string
  imgClassName?: string
}) {
  const origin = useMemo(() => {
    try { return new URL(link).origin } catch { return null }
  }, [link])
  const [failed, setFailed] = useState(() => (origin ? failedFaviconOrigins.has(origin) : true))
  const monogram = feedTitle.trim().slice(0, 1).toUpperCase()
  const hue = useMemo(() => rssSourceHueBlock(feedTitle), [feedTitle])

  return (
    <span
      title={feedTitle}
      className={cn(
        'grid h-9 w-9 place-items-center overflow-hidden rounded-full border border-border/60 text-[13px] font-semibold',
        className,
      )}
      style={failed ? { backgroundColor: `hsl(${hue} 55% 92%)`, color: `hsl(${hue} 55% 28%)` } : undefined}
    >
      {origin && !failed ? (
        <img
          src={`${origin}/favicon.ico`}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => {
            failedFaviconOrigins.add(origin)
            setFailed(true)
          }}
          className={cn('h-5 w-5', imgClassName)}
        />
      ) : (monogram || <Rss className="h-4 w-4 text-muted-foreground" />)}
    </span>
  )
}
