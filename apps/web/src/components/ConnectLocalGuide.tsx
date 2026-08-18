import { useEffect, useId, useRef, useState } from 'react'
import { api, ApiError } from '../api/client'

type Props = {
  open: boolean
  onClose: () => void
  namespaceId?: string
  namespaceName?: string
  onInstalled?: () => void
}

async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText && window.isSecureContext) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    /* fall through */
  }
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.setAttribute('readonly', '')
    ta.style.position = 'fixed'
    ta.style.left = '-9999px'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch {
    return false
  }
}

function CopyBlock({ label, text }: { label: string; text: string }) {
  const [status, setStatus] = useState<'idle' | 'ok' | 'fail'>('idle')
  const preRef = useRef<HTMLPreElement>(null)
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-bold uppercase tracking-wide text-ink-muted">{label}</span>
        <div className="flex gap-2">
          <button
            type="button"
            className="btn-secondary btn-compact px-3 text-sm"
            onClick={() => {
              const el = preRef.current
              if (!el) return
              const range = document.createRange()
              range.selectNodeContents(el)
              const sel = window.getSelection()
              sel?.removeAllRanges()
              sel?.addRange(range)
            }}
          >
            Select all
          </button>
          <button
            type="button"
            className="btn-primary btn-compact px-3 text-sm"
            onClick={async () => {
              const ok = await copyText(text)
              setStatus(ok ? 'ok' : 'fail')
              window.setTimeout(() => setStatus('idle'), 2000)
            }}
          >
            {status === 'ok' ? 'Copied!' : status === 'fail' ? 'Select all + Ctrl+C' : 'Copy'}
          </button>
        </div>
      </div>
      <pre
        ref={preRef}
        className="overflow-auto bg-[#2f3d4a] p-3 font-mono text-sm leading-relaxed text-[#d8e1e9]"
      >
        {text}
      </pre>
    </div>
  )
}

export function ConnectLocalGuide({ open, onClose, namespaceId, namespaceName, onInstalled }: Props) {
  const titleId = useId()
  const closeRef = useRef<HTMLButtonElement>(null)
  const onCloseRef = useRef(onClose)
  const onInstalledRef = useRef(onInstalled)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [curl, setCurl] = useState('')
  const [wget, setWget] = useState('')
  const [safeCLI, setSafeCLI] = useState('')
  const [expires, setExpires] = useState('')

  onCloseRef.current = onClose
  onInstalledRef.current = onInstalled

  // Reset only when the dialog opens — not when parent re-renders (unstable callbacks).
  useEffect(() => {
    if (!open) return
    setError('')
    setCurl('')
    setWget('')
    setSafeCLI('')
    setExpires('')
    setBusy(false)
    const prev = document.activeElement as HTMLElement | null
    closeRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current()
    }
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
      prev?.focus()
    }
  }, [open])

  async function generate() {
    if (!namespaceId) {
      setError('Open a namespace first, then use Connect with curl.')
      return
    }
    setBusy(true)
    setError('')
    try {
      const res = await api.createConnectInstall(namespaceId)
      setCurl(res.curl)
      setWget(res.wget)
      setExpires(res.expires_at)
      const base = window.location.origin
      setSafeCLI(`terraforge connect '${base}/api/connect/install/${res.code}/pack.tar.gz'`)
      // Defer parent refresh so it cannot race this dialog's state paint.
      queueMicrotask(() => onInstalledRef.current?.())
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create install command')
    } finally {
      setBusy(false)
    }
  }

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-[#2a3846]/45 p-3 sm:items-center sm:p-6"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="surface max-h-[min(94dvh,46rem)] w-full max-w-2xl overflow-auto p-5 sm:p-6"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 id={titleId} className="font-display text-2xl font-bold text-ink">
              Connect local Terraform
            </h2>
            <p className="mt-2 text-base text-ink-muted">
              {namespaceName
                ? `Run one command in your “${namespaceName}” project folder — no zip download.`
                : 'Run one command in your Terraform project folder — no zip download.'}
            </p>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="btn-secondary btn-compact px-3 text-base"
          >
            Close
          </button>
        </div>

        <div className="mt-4 border-2 border-ember/30 bg-ember/10 px-3 py-3 text-base text-ink">
          <p className="font-bold text-ember-deep">Secure one-liner</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-ink-muted">
            <li>Creates a one-time code (15 minutes, single use)</li>
            <li>
              Writes <code className="font-mono text-sm">terraforge_connect/</code> (secrets + CLI
              config) and a tiny <code className="font-mono text-sm">terraforge_connect.tf</code>{' '}
              stub — delete both to disconnect
            </li>
            <li>Uses scoped tokens — not your browser login JWT</li>
          </ul>
        </div>

        {!namespaceId && (
          <p className="mt-4 border-2 border-danger/40 bg-danger/10 px-3 py-2 text-base text-danger" role="alert">
            Open a namespace first, then click <strong>Connect with curl</strong> on that page.
          </p>
        )}

        <ol className="mt-6 list-decimal space-y-4 pl-5 text-base text-ink">
          <li>
            <p className="font-bold">Generate the command (on this page)</p>
            <button
              type="button"
              disabled={busy || !namespaceId}
              onClick={() => void generate()}
              className="btn-primary mt-2 disabled:opacity-50"
            >
              {busy ? 'Generating…' : curl ? 'Generate a new code' : 'Generate curl command'}
            </button>
            {error && (
              <p className="mt-2 text-danger" role="alert">
                {error}
              </p>
            )}
            {expires && (
              <p className="mt-2 text-sm text-ink-muted">
                Code expires {new Date(expires).toLocaleString()} · use once only
              </p>
            )}
          </li>

          {curl && (
            <>
              <li>
                <p className="font-bold">In your Terraform project folder, paste this (easiest)</p>
                <CopyBlock label="curl | sh" text={curl} />
                <p className="mt-2 text-sm text-ink-muted">Or with wget:</p>
                <CopyBlock label="wget | sh" text={wget} />
              </li>
              <li>
                <p className="font-bold">Safer alternative (no shell pipe)</p>
                <p className="mt-1 text-ink-muted">
                  If you already built the companion CLI, use the same one-time code via tarball:
                </p>
                <CopyBlock label="terraforge connect" text={safeCLI} />
              </li>
              <li>
                <p className="font-bold">Initialize</p>
                <CopyBlock
                  label="next"
                  text={`terraform init -reconfigure -backend-config=terraforge_connect/backend.hcl\nterraform plan`}
                />
                <p className="mt-3 text-sm text-ink-muted">Disconnect later:</p>
                <CopyBlock label="disconnect" text={`rm -rf terraforge_connect terraforge_connect.tf`} />
              </li>
            </>
          )}
        </ol>

        <p className="mt-6 border-t-2 border-line/60 pt-4 text-sm text-ink-muted">
          Website/API: <code className="font-mono">{window.location.origin}</code> — use this
          origin for connect and the companion CLI (not the direct API host port).
        </p>
      </div>
    </div>
  )
}
