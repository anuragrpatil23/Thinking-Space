import { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'

// Any JSON value as a readable list: each key in words beside its value,
// nested objects and lists indented and foldable, short lists of plain values
// on one line, empty values shown as "none". For reading data, not editing it.

type JsonValue = unknown

const isPlain = (value: JsonValue) => value === null || ['string', 'number', 'boolean'].includes(typeof value)
const isObject = (value: JsonValue): value is Record<string, JsonValue> => Boolean(value) && typeof value === 'object' && !Array.isArray(value)

/** `recoloured_is_usual` gives "recoloured is usual"; camelCase is split too. */
export function jsonKeyWordsBlock(key: string): string {
  return key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').trim()
}

/** A one-word colour name ("yellow", "brown") gets a swatch beside it. */
function isColourWordBlock(text: string): boolean {
  if (!/^[a-z]{3,20}$/i.test(text)) return false
  try { return typeof CSS !== 'undefined' && CSS.supports('color', text) } catch { return false }
}

function PlainValueBlock({ value }: { value: JsonValue }) {
  if (value === null || value === undefined || value === '') return <span className="text-muted-foreground">none</span>
  if (typeof value === 'boolean') {
    return <span className={cn('rounded px-1.5 py-px text-[11.5px] font-medium', value ? 'bg-emerald-500/15 text-emerald-800 dark:text-emerald-300' : 'bg-zinc-500/10 text-zinc-600 dark:text-zinc-400')}>{value ? 'yes' : 'no'}</span>
  }
  if (typeof value === 'number') return <span className="font-medium tabular-nums text-sky-700 dark:text-sky-300">{Math.abs(value) >= 10000 ? value.toLocaleString() : String(value)}</span>
  const text = String(value)
  return (
    <span className="whitespace-pre-wrap break-words text-emerald-800 dark:text-emerald-300">
      {isColourWordBlock(text) && <span aria-hidden className="mr-1.5 inline-block h-2.5 w-2.5 rounded-full border border-black/15 align-[-1px]" style={{ backgroundColor: text }} />}
      {text}
    </span>
  )
}

function NodeBlock({ value, depth, foldAt }: { value: JsonValue; depth: number; foldAt: number }) {
  if (isPlain(value)) return <PlainValueBlock value={value} />
  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="text-muted-foreground">none</span>
    if (value.every(isPlain) && value.join(', ').length < 120) {
      return <span>{value.map((item, index) => <span key={index}>{index > 0 && <span className="text-muted-foreground">, </span>}<PlainValueBlock value={item} /></span>)}</span>
    }
    return (
      <ol className="space-y-1.5">
        {value.map((item, index) => (
          <li key={index} className="flex gap-2">
            <span className="w-5 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">{index + 1}</span>
            <div className="min-w-0 flex-1"><NodeBlock value={item} depth={depth + 1} foldAt={foldAt} /></div>
          </li>
        ))}
      </ol>
    )
  }
  if (isObject(value)) return <FieldsBlock value={value} depth={depth} foldAt={foldAt} />
  return <PlainValueBlock value={String(value)} />
}

function FieldBlock({ name, value, depth, foldAt }: { name: string; value: JsonValue; depth: number; foldAt: number }) {
  const nested = (isObject(value) && Object.keys(value).length > 0) || (Array.isArray(value) && !(value.every(isPlain) && value.join(', ').length < 120))
  const [open, setOpen] = useState(depth < foldAt)
  if (!nested) {
    return (
      <div className="grid grid-cols-[minmax(110px,32%)_minmax(0,1fr)] gap-3 py-1.5">
        <dt className="text-muted-foreground first-letter:uppercase" title={name}>{jsonKeyWordsBlock(name)}</dt>
        <dd className="min-w-0"><NodeBlock value={value} depth={depth + 1} foldAt={foldAt} /></dd>
      </div>
    )
  }
  const Chevron = open ? ChevronDown : ChevronRight
  const size = Array.isArray(value) ? `${value.length} items` : `${Object.keys(value as object).length} fields`
  return (
    <div className="py-1.5">
      <button type="button" aria-expanded={open} onClick={() => setOpen(current => !current)} className="flex items-center gap-1 text-left text-muted-foreground hover:text-foreground" title={name}>
        <Chevron className="h-3.5 w-3.5" />
        <span className="first-letter:uppercase">{jsonKeyWordsBlock(name)}</span>
        {!open && <span className="text-[11px]">· {size}</span>}
      </button>
      {open && <div className="ml-[7px] mt-1 border-l border-border pl-3"><NodeBlock value={value} depth={depth + 1} foldAt={foldAt} /></div>}
    </div>
  )
}

function FieldsBlock({ value, depth, foldAt }: { value: Record<string, JsonValue>; depth: number; foldAt: number }) {
  const entries = Object.entries(value)
  if (entries.length === 0) return <span className="text-muted-foreground">none</span>
  return (
    <dl className="divide-y divide-border/60">
      {entries.map(([name, item]) => <FieldBlock key={name} name={name} value={item} depth={depth} foldAt={foldAt} />)}
    </dl>
  )
}

export default function JsonViewBlock({ value, foldAt = 2, className }: {
  value: JsonValue
  /** Nested parts deeper than this start folded. */
  foldAt?: number
  className?: string
}) {
  return <div className={cn('text-[12.5px] leading-snug', className)}><NodeBlock value={value} depth={0} foldAt={foldAt} /></div>
}
