import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import '@xterm/xterm/css/xterm.css'
import { isElectron, isEmbeddedTerminalSupported } from '@/services/orchestrators/runtimeOrch'

const ITERM2_THEME = {
  background: '#1a1d24',
  foreground: '#ffffff',
  cursor: '#d20a5d',
  cursorAccent: '#ffffff',
  selectionBackground: '#1d89b4',
  black: '#073642',
  red: '#dc322f',
  green: '#409900',
  yellow: '#b58900',
  blue: '#268bd2',
  magenta: '#d33682',
  cyan: '#2aa198',
  white: '#eee8d5',
  brightBlack: '#002b36',
  brightRed: '#cb4b16',
  brightGreen: '#586e75',
  brightYellow: '#657b83',
  brightBlue: '#839496',
  brightMagenta: '#6c71c4',
  brightCyan: '#93a1a1',
  brightWhite: '#fdf6e3',
}

// Module-level session store: sessionKey → terminalId
// Survives React unmount/remount within the same Electron window JS context,
// so navigating away and back reattaches to the same live PTY.
const sessions = new Map<string, string>()
const executedInitialCommands = new Set<string>()

/**
 * Explicitly kill a terminal session (e.g. when closing a tab).
 * Call this before removing the sessionKey from the DOM so the PTY is cleaned up.
 */
export function releaseTerminalSession(sessionKey: string): void {
  const terminalId = sessions.get(sessionKey)
  if (terminalId) {
    sessions.delete(sessionKey)
    executedInitialCommands.delete(sessionKey)
    void window.electronAPI?.terminalKill?.(terminalId)
  }
}

export interface TerminalBlockProps {
  cwd?: string
  className?: string
  onExit?: (exitCode: number) => void
  envPatch?: Record<string, string>
  initialCommand?: string
  /**
   * Stable key for this terminal session. When provided, the PTY is kept alive
   * across React unmount/remount (e.g. page navigation) and reattached on return.
   * If omitted, the PTY is killed when the component unmounts.
   */
  sessionKey?: string
}

export default function TerminalBlock({ cwd, className = '', onExit, envPatch, initialCommand, sessionKey }: TerminalBlockProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const cwdRef = useRef(cwd)
  const onExitRef = useRef(onExit)
  useEffect(() => { cwdRef.current = cwd }, [cwd])
  useEffect(() => { onExitRef.current = onExit }, [onExit])

  useEffect(() => {
    if (!isElectron() || !isEmbeddedTerminalSupported() || !containerRef.current) return

    const api = window.electronAPI!
    const container = containerRef.current

    // -- xterm setup --
    const term = new Terminal({
      theme: ITERM2_THEME,
      fontFamily: "'MesloLGS NF', 'MesloLGS-NF-Regular', 'Menlo', 'Cascadia Code', 'Courier New', monospace",
      fontSize: 15,
      lineHeight: 1.2,
      cursorBlink: true,
      cursorStyle: 'block',
      scrollback: 5000,
      allowProposedApi: true,
    })

    const fitAddon = new FitAddon()
    const webLinksAddon = new WebLinksAddon()
    term.loadAddon(fitAddon)
    term.loadAddon(webLinksAddon)
    term.open(container)

    let terminalId: string | null = null
    let unsubData: (() => void) | null = null
    let unsubExit: (() => void) | null = null
    let inputDisposable: { dispose(): void } | null = null
    let resizeDisposable: { dispose(): void } | null = null
    let destroyed = false

    const fitTerminal = () => {
      fitAddon.fit()
      return { cols: term.cols, rows: term.rows }
    }

    const syncTerminalSize = (id: string) => {
      const { cols, rows } = fitTerminal()
      void api.terminalResize!(id, cols, rows)
    }

    const maybeRunInitialCommand = (id: string) => {
      if (!initialCommand?.trim() || !sessionKey || executedInitialCommands.has(sessionKey)) return
      executedInitialCommands.add(sessionKey)
      window.setTimeout(() => {
        void api.terminalInput!(id, `${initialCommand}\n`)
      }, 60)
    }

    const attach = (id: string) => {
      terminalId = id
      if (sessionKey) sessions.set(sessionKey, id)

      unsubData = api.onTerminalData!(id, (data) => { term.write(data) })
      unsubExit = api.onTerminalExit!(id, (exitCode) => {
        term.writeln(`\r\n\x1b[2m[Process exited with code ${exitCode}]\x1b[0m`)
        if (sessionKey) sessions.delete(sessionKey)
        onExitRef.current?.(exitCode)
      })
      inputDisposable = term.onData((data) => { void api.terminalInput!(id, data) })
      resizeDisposable = term.onResize(({ cols: c, rows: r }) => { void api.terminalResize!(id, c, r) })
      syncTerminalSize(id)
      maybeRunInitialCommand(id)
    }

    const existingId = sessionKey ? sessions.get(sessionKey) : undefined
    const reattachTerminal = api.terminalReattach
    const detachTerminal = api.terminalDetach

    if (existingId && reattachTerminal && detachTerminal) {
      // Reattach to live PTY and replay buffered output into the fresh xterm
      reattachTerminal(existingId).then((result: { buffer: string } | null) => {
        if (destroyed) {
          // Unmounted before reattach resolved — detach again to keep PTY idle
          void detachTerminal(existingId)
          return
        }
        if (!result) {
          // PTY exited while we were away — start a fresh one
          sessions.delete(sessionKey!)
          return api.terminalCreate!({ cwd: cwdRef.current, env: envPatch, ...fitTerminal() }).then(({ id }) => {
            if (destroyed) { void api.terminalKill!(id); return }
            attach(id)
          })
        }
        // Replay history so the terminal looks exactly as left
        if (result.buffer) term.write(result.buffer)
        attach(existingId)
      }).catch((err: unknown) => {
        term.writeln(`\r\n\x1b[31m[Failed to reattach terminal: ${err instanceof Error ? err.message : String(err)}]\x1b[0m`)
      })
    } else {
      api.terminalCreate!({ cwd: cwdRef.current, env: envPatch, ...fitTerminal() }).then(({ id }) => {
        if (destroyed) { void api.terminalKill!(id); return }
        attach(id)
      }).catch((err: unknown) => {
        term.writeln(`\r\n\x1b[31m[Failed to create terminal: ${err instanceof Error ? err.message : String(err)}]\x1b[0m`)
      })
    }

    // Drop a file/folder (from the vault explorer or another app) to type its
    // path into the shell, like dragging from Finder into Terminal.
    const shellQuotePath = (value: string) =>
      /[^A-Za-z0-9_\-./~]/.test(value) ? `'${value.replace(/'/g, `'\\''`)}'` : value
    const handleDragOver = (event: DragEvent) => {
      if (!event.dataTransfer) return
      const types = Array.from(event.dataTransfer.types)
      if (!types.includes('text/plain') && !types.includes('Files')) return
      event.preventDefault()
      event.dataTransfer.dropEffect = 'copy'
    }
    const handleDrop = (event: DragEvent) => {
      if (!event.dataTransfer || !terminalId) return
      event.preventDefault()
      const lines = event.dataTransfer.getData('text/plain')
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(Boolean)
      if (lines.length === 0) return
      term.focus()
      void api.terminalInput!(terminalId, `${lines.map(shellQuotePath).join(' ')} `)
    }
    container.addEventListener('dragover', handleDragOver)
    container.addEventListener('drop', handleDrop)

    // Resize observer: refit when container dimensions change
    const resizeObserver = new ResizeObserver(() => {
      if (!terminalId) {
        fitTerminal()
        return
      }
      syncTerminalSize(terminalId)
    })
    resizeObserver.observe(container)

    if ('fonts' in document) {
      void document.fonts.ready.then(() => {
        if (!destroyed && terminalId) syncTerminalSize(terminalId)
      })
    }

    return () => {
      destroyed = true
      container.removeEventListener('dragover', handleDragOver)
      container.removeEventListener('drop', handleDrop)
      resizeObserver.disconnect()
      inputDisposable?.dispose()
      resizeDisposable?.dispose()
      unsubData?.()
      unsubExit?.()
      if (terminalId) {
        // With sessionKey: detach (keep PTY alive for reattach on return)
        // Without: kill (no one will reclaim this PTY)
        if (sessionKey && detachTerminal) void detachTerminal(terminalId)
        else void api.terminalKill!(terminalId)
      }
      term.dispose()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // intentionally empty — terminal mounts once

  if (!isElectron()) {
    return (
      <div className={`flex items-center justify-center text-sm text-muted-foreground ${className}`}>
        Terminal is only available in the desktop app.
      </div>
    )
  }

  if (!isEmbeddedTerminalSupported()) {
    return (
      <div className={`flex items-center justify-center text-sm text-muted-foreground ${className}`}>
        Terminal is not available in this build.
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      className={className}
      style={{ overflow: 'hidden' }}
    />
  )
}
