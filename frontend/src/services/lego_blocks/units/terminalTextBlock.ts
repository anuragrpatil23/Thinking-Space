// A program's saved output (a job log) as a terminal would have left it on
// screen: a carriage return rewrites its line, so a progress bar keeps only
// its last state, and colour and cursor codes are dropped.

// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-?]*[ -/]*[@-~]|\u001b[@-Z\\-_]/g

export function terminalTextBlock(text: string): string {
  return text
    .replace(ANSI, '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => {
      const parts = line.split('\r').filter(part => part.length > 0)
      return parts.length > 0 ? parts[parts.length - 1].trimEnd() : ''
    })
    .join('\n')
}
