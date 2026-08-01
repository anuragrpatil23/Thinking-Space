import { useNavigate } from 'react-router-dom'
import { ChevronDown } from 'lucide-react'
import { useCanvasThemeBlock } from '@/components/lego_blocks/hooks/shared/useCanvasThemeBlock'
import { useCanvasProjectBindingBlock } from '@/components/lego_blocks/hooks/shared/useCanvasProjectBindingBlock'

interface CanvasProjectPickerBlockProps {
  /** Canvas surface id (`home`, `webull-f9`, etc.) — keyed in canvas-bindings.json. */
  surfaceId: string
}

/**
 * Inline picker that lets the user pick which project's mission appears on the
 * current canvas surface. Uses a native `<select>` for accessibility / mobile
 * pickers; "Manage projects…" jumps into Settings.
 */
export default function CanvasProjectPickerBlock({ surfaceId }: CanvasProjectPickerBlockProps) {
  const theme = useCanvasThemeBlock()
  const navigate = useNavigate()
  const { projects, boundProjectId, project, setBoundProjectId } = useCanvasProjectBindingBlock(surfaceId)

  const MANAGE_VALUE = '__manage__'

  const onChange = (value: string) => {
    if (value === MANAGE_VALUE) {
      navigate('/settings?tab=projects')
      return
    }
    void setBoundProjectId(value || null)
  }

  const currentValue = boundProjectId ?? project?.uuid ?? ''

  return (
    <div
      onMouseDown={e => e.stopPropagation()}
      onDoubleClick={e => e.stopPropagation()}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '4px 8px',
        borderRadius: 999,
        background: theme.toolbarBg,
        border: `1px solid ${theme.toolbarBorder}`,
        color: theme.toolbarText,
        fontSize: 11,
        cursor: 'pointer',
      }}
    >
      <select
        value={currentValue}
        onChange={e => onChange(e.target.value)}
        style={{
          appearance: 'none',
          background: 'transparent',
          border: 'none',
          color: 'inherit',
          font: 'inherit',
          outline: 'none',
          cursor: 'pointer',
          paddingRight: 2,
        }}
      >
        {projects.length === 0 && <option value="">No projects yet</option>}
        {projects.map(p => (
          <option key={p.uuid} value={p.uuid}>{p.name}</option>
        ))}
        <option value={MANAGE_VALUE}>Manage projects…</option>
      </select>
      <ChevronDown style={{ width: 12, height: 12, color: theme.toolbarTextMuted }} />
    </div>
  )
}
