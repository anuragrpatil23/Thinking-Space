export type RuntimeErrorSourceBlock =
  | 'window-error'
  | 'unhandledrejection'
  | 'react-boundary'
  | 'clipboard'
  | 'session-recovery'

export interface RuntimeErrorReportBlock {
  id: string
  source: RuntimeErrorSourceBlock
  title: string
  message: string
  detail: string
  stack: string | null
  componentStack: string | null
  location: string | null
  capturedAt: number
}

interface RuntimeErrorOptionsBlock {
  source: RuntimeErrorSourceBlock
  title: string
  location?: string | null
  componentStack?: string | null
}

function createRuntimeErrorId(): string {
  return `runtime-error-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function stringifyRuntimeValue(value: unknown): string {
  if (typeof value === 'string') return value
  if (value instanceof Error) return value.message || value.name || 'Unknown error'
  if (value === null) return 'null'
  if (value === undefined) return 'undefined'
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value)
  }
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return Object.prototype.toString.call(value)
  }
}

function normalizeStack(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function normalizeComponentStack(value: string | null | undefined): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function readRuntimeErrorParts(value: unknown): {
  message: string
  detail: string
  stack: string | null
} {
  if (value instanceof Error) {
    return {
      message: value.message?.trim() || value.name || 'Unknown error',
      detail: `${value.name}: ${value.message || 'Unknown error'}`.trim(),
      stack: normalizeStack(value.stack),
    }
  }

  if (typeof value === 'string') {
    const message = value.trim() || 'Unknown error'
    return { message, detail: message, stack: null }
  }

  const detail = stringifyRuntimeValue(value).trim() || 'Unknown error'
  return {
    message: detail.split('\n')[0]?.trim() || 'Unknown error',
    detail,
    stack: null,
  }
}

export function createRuntimeErrorReportBlock(
  value: unknown,
  options: RuntimeErrorOptionsBlock,
): RuntimeErrorReportBlock {
  const parts = readRuntimeErrorParts(value)
  return {
    id: createRuntimeErrorId(),
    source: options.source,
    title: options.title,
    message: parts.message,
    detail: parts.detail,
    stack: parts.stack,
    componentStack: normalizeComponentStack(options.componentStack),
    location: options.location?.trim() || null,
    capturedAt: Date.now(),
  }
}

/* Window errors that are not failures. "ResizeObserver loop completed with
   undelivered notifications" means an observer's callback changed layout and
   the browser deferred the follow-up notifications to the next frame — which
   it then delivers. Paginating layout engines (the EPUB reader's) trigger it
   routinely; surfacing it told the reader something had broken when nothing
   had. */
const BENIGN_WINDOW_ERRORS_BLOCK = [
  /^ResizeObserver loop completed with undelivered notifications\.?$/,
  /^ResizeObserver loop limit exceeded\.?$/,
]

export function isBenignWindowErrorBlock(event: Event): boolean {
  const message = (event as ErrorEvent).message
  return typeof message === 'string' && BENIGN_WINDOW_ERRORS_BLOCK.some((pattern) => pattern.test(message.trim()))
}

export function captureWindowErrorReportBlock(
  event: Event,
  location?: string | null,
): RuntimeErrorReportBlock {
  const candidate = event as ErrorEvent
  const locationParts = [candidate.filename, candidate.lineno, candidate.colno]
    .filter((part) => part !== undefined && part !== null && String(part).trim() !== '')
  const sourceLocation = locationParts.length > 0 ? locationParts.join(':') : null
  const report = createRuntimeErrorReportBlock(candidate.error ?? candidate.message ?? event.type, {
    source: 'window-error',
    title: 'Runtime error',
    location,
  })
  return {
    ...report,
    detail: sourceLocation ? `${report.detail}\n\nSource: ${sourceLocation}` : report.detail,
  }
}

export function captureUnhandledRejectionReportBlock(
  event: PromiseRejectionEvent,
  location?: string | null,
): RuntimeErrorReportBlock {
  return createRuntimeErrorReportBlock(event.reason, {
    source: 'unhandledrejection',
    title: 'Unhandled promise rejection',
    location,
  })
}

export function formatRuntimeErrorReportForClipboardBlock(report: RuntimeErrorReportBlock): string {
  const sections = [
    `Title: ${report.title}`,
    `Source: ${report.source}`,
    `Captured At: ${new Date(report.capturedAt).toISOString()}`,
    report.location ? `Route: ${report.location}` : null,
    '',
    'Message:',
    report.message,
    '',
    'Detail:',
    report.detail,
    report.stack ? `\nStack:\n${report.stack}` : null,
    report.componentStack ? `\nComponent Stack:\n${report.componentStack}` : null,
  ]

  return sections.filter((part): part is string => typeof part === 'string' && part.length > 0).join('\n')
}

export function formatRuntimeErrorReportsForClipboardBlock(
  reports: readonly RuntimeErrorReportBlock[],
): string {
  return reports
    .map((report, index) => `Error ${index + 1}\n${formatRuntimeErrorReportForClipboardBlock(report)}`)
    .join('\n\n---\n\n')
}
