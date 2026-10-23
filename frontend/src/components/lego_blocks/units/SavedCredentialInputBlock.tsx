import { useState, type InputHTMLAttributes } from 'react'

// A credential field that reads as filled once something is saved: the masked
// hint ("824…13c") or dots for a secret. The saved value itself never reaches
// the page; focusing the field clears it for typing a replacement, and leaving
// it empty shows the saved state again.
export function SavedCredentialInputBlock({
  saved,
  savedDisplay,
  value,
  onValueChange,
  secret = false,
  ...rest
}: {
  saved: boolean
  /** What to show while saved; secrets show dots. */
  savedDisplay?: string | null
  value: string
  onValueChange: (next: string) => void
  secret?: boolean
} & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'>) {
  const [editing, setEditing] = useState(false)
  const showSaved = saved && !editing && value === ''
  return (
    <input
      {...rest}
      type={secret ? 'password' : 'text'}
      autoComplete="off"
      value={showSaved ? (secret ? '••••••••' : (savedDisplay ?? 'Saved')) : value}
      readOnly={showSaved}
      onFocus={(event) => { setEditing(true); rest.onFocus?.(event) }}
      onBlur={(event) => { setEditing(false); rest.onBlur?.(event) }}
      onChange={(event) => onValueChange(event.target.value)}
      placeholder={saved ? 'Type to replace' : rest.placeholder}
      title={showSaved ? 'Saved. Click to replace.' : rest.title}
    />
  )
}
