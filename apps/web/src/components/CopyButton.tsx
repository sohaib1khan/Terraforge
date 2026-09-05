import { useEffect, useRef, useState } from 'react'
import { copyText, selectElementContents } from '../lib/clipboard'

type Status = 'idle' | 'ok' | 'fail'

type Props = {
  text: string
  /** Label in the resting state. */
  label?: string
  className?: string
  /** Selected automatically when the clipboard is unavailable, so Ctrl+C works. */
  selectRef?: React.RefObject<HTMLElement | null>
  onCopied?: (ok: boolean) => void
}

/** Copy-to-clipboard button that reports success, failure, and offers a manual fallback. */
export function CopyButton({
  text,
  label = 'Copy',
  className = 'btn-secondary btn-compact px-3 text-base',
  selectRef,
  onCopied,
}: Props) {
  const [status, setStatus] = useState<Status>('idle')
  const timer = useRef<number | undefined>(undefined)

  useEffect(() => () => window.clearTimeout(timer.current), [])

  async function run() {
    const ok = await copyText(text)
    setStatus(ok ? 'ok' : 'fail')
    if (!ok && selectRef) selectElementContents(selectRef.current)
    onCopied?.(ok)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setStatus('idle'), ok ? 1800 : 4000)
  }

  return (
    <button
      type="button"
      onClick={() => void run()}
      aria-live="polite"
      title={status === 'fail' ? 'Clipboard blocked — text selected, press Ctrl+C' : `Copy ${label}`}
      className={`copy-btn ${status === 'ok' ? 'copy-btn-ok' : ''} ${
        status === 'fail' ? 'copy-btn-fail' : ''
      } ${className}`}
    >
      {status === 'ok' ? '✓ Copied' : status === 'fail' ? 'Press Ctrl+C' : label}
    </button>
  )
}
