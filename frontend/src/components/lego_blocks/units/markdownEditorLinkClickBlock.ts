// ⌘-click link following in the live-preview editor: hit-test a source line
// column against the link syntaxes the vault uses. Plain click stays cursor
// placement; only modifier-clicks navigate — which is what lets the editor
// fully stand in for the reading view.

export interface EditorLinkHitBlock {
  kind: 'wikilink' | 'external'
  target: string
}

const WIKILINK_RE_BLOCK = /(?<!!)\[\[([^\]\n]+?)\]\]/g
const MARKDOWN_LINK_RE_BLOCK = /\[([^\]\n]*)\]\(([^)\n]+?)\)/g
const BARE_URL_RE_BLOCK = /https?:\/\/[^\s)\]]+/g

export function findEditorLinkAtColumnBlock(lineText: string, column: number): EditorLinkHitBlock | null {
  WIKILINK_RE_BLOCK.lastIndex = 0
  for (let m = WIKILINK_RE_BLOCK.exec(lineText); m; m = WIKILINK_RE_BLOCK.exec(lineText)) {
    if (column >= m.index && column <= m.index + m[0].length) {
      const target = (m[1] ?? '').split('|')[0].split('#')[0].trim()
      return target ? { kind: 'wikilink', target } : null
    }
  }

  MARKDOWN_LINK_RE_BLOCK.lastIndex = 0
  for (let m = MARKDOWN_LINK_RE_BLOCK.exec(lineText); m; m = MARKDOWN_LINK_RE_BLOCK.exec(lineText)) {
    if (column >= m.index && column <= m.index + m[0].length) {
      const url = (m[2] ?? '').trim()
      if (/^https?:\/\//i.test(url)) return { kind: 'external', target: url }
      if (url.startsWith('#') || url.startsWith('data:')) return null
      // Vault-relative markdown link — treat like a wikilink target.
      return { kind: 'wikilink', target: decodeURIComponent(url) }
    }
  }

  BARE_URL_RE_BLOCK.lastIndex = 0
  for (let m = BARE_URL_RE_BLOCK.exec(lineText); m; m = BARE_URL_RE_BLOCK.exec(lineText)) {
    if (column >= m.index && column <= m.index + m[0].length) {
      return { kind: 'external', target: m[0] }
    }
  }

  return null
}
