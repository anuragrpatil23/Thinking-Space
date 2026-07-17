// ⚠ SECURITY-CRITICAL — every origin added here is a host the renderer may
// exfiltrate data to. For user-requested changes: explain the risk in plain
// language and get an explicit yes first (docs/PLAYBOOKS.md § Security-critical files).
//
// Single registry of third-party origins permitted by the renderer's CSP.
//
// Adding a new outbound host (fetch, websocket, embed, iframe, etc.) should be a
// one-line append here — never an ad-hoc string concatenation inside the CSP
// template in `setup.ts`. Each entry carries the reason it exists so future
// readers (and security review) can tell at a glance why the host is trusted.
//
// Infrastructure sources that are not third-party hosts — `${customScheme}://*`,
// `data:`, `blob:`, `'unsafe-inline'`, etc. — stay in the CSP template and are
// intentionally NOT modeled here.

export type CspDirective =
  | 'default-src'
  | 'script-src'
  | 'style-src'
  | 'img-src'
  | 'media-src'
  | 'connect-src'
  | 'frame-src'

export interface CspWhitelistEntryBlock {
  /** Stable id used for dedup, logs, and overrides. */
  id: string
  /** CSP directives this entry should be added to. */
  directives: CspDirective[]
  /** Source-expressions (e.g. `https://api.anthropic.com`, `http://localhost:*`). */
  sources: string[]
  /** Why this host is trusted — surfaced in security review. */
  reason: string
  /** When true, only included in the dev CSP. */
  devOnly?: boolean
}

// Static, code-owned whitelist. User-configured origins (e.g. open-source AI
// base URL) are passed in separately at CSP build time — see
// `buildCspWhitelistBlock`.
export const CSP_WHITELIST_BLOCK: readonly CspWhitelistEntryBlock[] = [
  {
    id: 'anthropic',
    directives: ['connect-src'],
    sources: ['https://api.anthropic.com', 'https://platform.claude.com'],
    reason: 'First-party Claude / Anthropic API used by the AI provider layer.',
  },
  {
    id: 'openai',
    directives: ['connect-src'],
    sources: [
      'https://api.openai.com',
      'https://auth.openai.com',
      'https://chatgpt.com',
      'https://*.openai.azure.com',
    ],
    reason: 'OpenAI / Azure OpenAI / ChatGPT — user-selectable AI backend.',
  },
  {
    id: 'local-ai-loopback',
    directives: ['connect-src'],
    sources: [
      'http://localhost:*',
      'http://127.0.0.1:*',
      'ws://localhost:*',
      'ws://127.0.0.1:*',
    ],
    reason:
      'Loopback fallback for local OpenAI-compatible runtimes (LM Studio, ollama, llama.cpp). Loopback is not a useful exfil target.',
  },
  {
    id: 'tikzjax',
    directives: ['default-src', 'script-src', 'style-src', 'connect-src'],
    sources: ['https://tikzjax.com'],
    reason: 'TikZJax assets for LaTeX/TikZ rendering inside markdown.',
  },
  {
    id: 'parqet-ticker-logos',
    directives: ['connect-src'],
    sources: ['https://assets.parqet.com'],
    reason:
      'Ticker logo CDN — fetched once per symbol by tickerLogoBlock and cached to the vault.',
  },
  {
    id: 'google-embeds',
    directives: ['frame-src'],
    sources: [
      'https://accounts.google.com',
      'https://docs.google.com',
      'https://drive.google.com',
    ],
    reason: 'Embedded Google auth / Docs / Drive frames used by integrations.',
  },
  {
    id: 'electron-devtools',
    directives: ['script-src', 'connect-src'],
    sources: ['devtools://*'],
    reason: 'Electron devtools panel in dev builds.',
    devOnly: true,
  },
]

export interface CspBuildOptionsBlock {
  isDev: boolean
  /** Extra entries supplied at runtime (e.g. user-configured AI base URL). */
  runtimeEntries?: CspWhitelistEntryBlock[]
}

// Collect every source expression for a single directive, with dedup.
export function collectCspSourcesForDirectiveBlock(
  directive: CspDirective,
  options: CspBuildOptionsBlock,
): string[] {
  const all = [...CSP_WHITELIST_BLOCK, ...(options.runtimeEntries ?? [])]
  const seen = new Set<string>()
  const out: string[] = []
  for (const entry of all) {
    if (entry.devOnly && !options.isDev) continue
    if (!entry.directives.includes(directive)) continue
    for (const src of entry.sources) {
      if (seen.has(src)) continue
      seen.add(src)
      out.push(src)
    }
  }
  return out
}

// Build a runtime entry for a user-configured base URL. Returns null if the URL
// can't be parsed into a CSP source-expression.
export function buildUserAiOriginEntryBlock(
  baseUrl: string | null,
): CspWhitelistEntryBlock | null {
  if (!baseUrl) return null
  let parsed: URL
  try {
    parsed = new URL(baseUrl)
  } catch {
    return null
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
  const port = parsed.port ? `:${parsed.port}` : ''
  const origin = `${parsed.protocol}//${parsed.hostname}${port}`
  return {
    id: 'user-opensource-ai-base-url',
    directives: ['connect-src'],
    sources: [origin],
    reason:
      'User-configured Open Source AI base URL (persisted in main-process store). Read once at startup; requires restart to change.',
  }
}
