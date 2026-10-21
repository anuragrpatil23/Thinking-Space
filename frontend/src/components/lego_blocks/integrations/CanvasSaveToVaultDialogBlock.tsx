import { useEffect, useMemo, useState } from 'react'
import { FolderInput, Loader2 } from 'lucide-react'
import FolderTreePickerBlock from '@/components/lego_blocks/integrations/FolderTreePickerBlock'
import { useCanvasThemeBlock } from '@/components/lego_blocks/hooks/shared/useCanvasThemeBlock'
import { postItSaveDefaultsOrch } from '@/services/orchestrators/postItVaultSaveOrch'

// "Save to vault" for a canvas post-it: pick a folder, confirm the name.
//
// Deliberately small. The New Note composer composes `<project>/<kind folder>`
// because it is *starting* a note; a post-it already has its text and only needs
// a home, so this is the tree plus the folders you actually save to (the same
// recents/usage the composer keeps, so both surfaces learn from each other).

interface Props {
  text: string
  onSave: (folderPath: string, filename: string) => Promise<void>
  onClose: () => void
}

export default function CanvasSaveToVaultDialogBlock({ text, onSave, onClose }: Props) {
  const theme = useCanvasThemeBlock()
  const defaults = useMemo(() => postItSaveDefaultsOrch(text), [text])
  const [folder, setFolder] = useState(defaults.quickFolders[0] ?? '')
  const [filename, setFilename] = useState(defaults.filename)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !saving) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, saving])

  const canSave = !saving && folder.trim().length > 0 && filename.trim().length > 0

  const handleSave = async () => {
    if (!canSave) return
    setSaving(true)
    setError(null)
    try {
      await onSave(folder, filename)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setSaving(false)
    }
  }

  return (
    <div
      onMouseDown={e => {
        if (e.target === e.currentTarget && !saving) onClose()
      }}
      style={{
        position: 'absolute',
        inset: 0,
        background: 'rgba(0,0,0,0.35)',
        zIndex: 250,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
    >
      <div
        role="dialog"
        aria-label="Save to vault"
        onMouseDown={e => e.stopPropagation()}
        data-canvas-own-scroll
        className="flex flex-col gap-3"
        style={{
          width: 420,
          maxWidth: '100%',
          maxHeight: '90%',
          padding: 16,
          background: theme.popoverBg,
          border: `1px solid ${theme.popoverBorder}`,
          borderRadius: 12,
          color: theme.popoverText,
          boxShadow: theme.isDark ? '0 24px 60px rgba(0,0,0,0.6)' : '0 24px 60px rgba(20,20,24,0.2)',
        }}
      >
        <div className="flex items-center gap-2 text-sm font-medium">
          <FolderInput size={16} />
          Save to vault
        </div>

        {defaults.quickFolders.length > 0 && (
          <div className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-wide" style={{ color: theme.popoverTextMuted }}>
              Recent folders
            </span>
            <div className="flex flex-col">
              {defaults.quickFolders.map(path => (
                <button
                  key={path}
                  type="button"
                  onClick={() => setFolder(path)}
                  className="truncate rounded-md px-2 py-1 text-left font-mono text-xs"
                  style={{ background: path === folder ? theme.popoverHighlight : 'transparent' }}
                  title={path}
                >
                  {path}
                </button>
              ))}
            </div>
          </div>
        )}

        <FolderTreePickerBlock value={folder} onChange={setFolder} maxHeightClassName="max-h-[34vh]" />

        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-wide" style={{ color: theme.popoverTextMuted }}>
            File name
          </span>
          <input
            value={filename}
            onChange={e => setFilename(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') void handleSave()
            }}
            className="h-9 w-full rounded-lg border border-input bg-background px-2.5 font-mono text-sm text-foreground outline-none focus:border-foreground/30"
          />
        </label>

        <div className="break-all font-mono text-[11px]" style={{ color: theme.popoverTextMuted }}>
          {folder ? `→ ${folder}/${filename.trim() || '…'}` : 'Pick a folder'}
        </div>

        {error && <div className="text-xs text-red-500">{error}</div>}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-md px-3 py-1.5 text-sm"
            style={{ color: theme.popoverTextMuted }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={!canSave}
            className="flex items-center gap-1.5 rounded-md bg-foreground px-3 py-1.5 text-sm text-background disabled:opacity-40"
          >
            {saving && <Loader2 size={14} className="animate-spin" />}
            Save
          </button>
        </div>
      </div>
    </div>
  )
}
