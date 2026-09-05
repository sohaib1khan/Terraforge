import { useEffect, useState } from 'react'

type Props = {
  title: string
  message: React.ReactNode
  confirmLabel?: string
  cancelLabel?: string
  busy?: boolean
  /** When set, the confirm button stays disabled until the user types this exactly. */
  requireText?: string
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel = 'Delete',
  cancelLabel = 'Cancel',
  busy = false,
  requireText,
  onConfirm,
  onCancel,
}: Props) {
  const [typed, setTyped] = useState('')

  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onCancel()
    }
    window.addEventListener('keydown', onEsc)
    return () => window.removeEventListener('keydown', onEsc)
  }, [onCancel, busy])

  const ready = !requireText || typed.trim() === requireText

  return (
    <div
      className="fixed inset-0 z-[90] flex items-end justify-center bg-[#2a3846]/45 p-3 sm:items-center sm:p-6"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onCancel()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="w-full max-w-lg border-2 border-danger/50 bg-panel p-4 shadow-xl"
      >
        <h2 className="font-display text-lg font-bold text-ink">{title}</h2>
        <div className="mt-2 space-y-2 text-base text-ink-muted">{message}</div>

        {requireText && (
          <label className="mt-3 block text-sm text-ink-muted">
            Type <span className="font-mono font-bold text-ink">{requireText}</span> to confirm
            <input
              autoFocus
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && ready && !busy) onConfirm()
              }}
              className="field mt-1 w-full"
            />
          </label>
        )}

        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <button type="button" onClick={onCancel} disabled={busy} className="btn-secondary">
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy || !ready}
            className="bg-danger px-4 py-2 text-base font-medium text-paper hover:opacity-90 disabled:opacity-50"
          >
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
