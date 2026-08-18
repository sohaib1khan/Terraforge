import type { Run, RunStatus } from '../../api/client'
import { RunStatusBadge } from '../StatusBadge/StatusBadge'

type Props = {
  runs: Run[]
  activeRunId: string | null
  busy: boolean
  onSelect: (id: string) => void
  onApprove: (id: string) => void
  onCancel: (id: string) => void
}

function failureReason(run: Run): string | null {
  const s = run.summary
  if (!s) return null
  if (typeof s.error === 'string' && s.error.trim()) return s.error
  if (typeof s.message === 'string' && s.message.trim()) return s.message
  if (typeof s.exit_code === 'number') return `exit code ${s.exit_code}`
  return null
}

function planDelta(run: Run): string | null {
  const s = run.summary
  if (!s || typeof s.added !== 'number') return null
  return `+${s.added} ~${String(s.changed ?? 0)} -${String(s.destroyed ?? 0)}`
}

function statusLabel(run: Run): { status: RunStatus; label?: string } {
  if (run.awaiting_approval) return { status: 'queued', label: 'awaiting approval' }
  return { status: run.status }
}

export function RunsList({ runs, activeRunId, busy, onSelect, onApprove, onCancel }: Props) {
  if (runs.length === 0) {
    return (
      <div className="border-2 border-line bg-panel/80 px-4 py-8 text-base text-ink-muted">
        No runs yet — use Init / Plan / Apply / Destroy above.
      </div>
    )
  }

  return (
    <ul className="divide-y divide-line/70 border-2 border-line bg-panel/80">
      {runs.map((run) => {
        const active = run.id === activeRunId
        const live = run.status === 'queued' || run.status === 'running'
        const reason = run.status === 'failed' ? failureReason(run) : null
        const delta = planDelta(run)
        const badge = statusLabel(run)
        return (
          <li
            key={run.id}
            className={`px-4 py-3 ${
              active ? 'bg-ember/10 ring-2 ring-inset ring-ember/40' : 'hover:bg-panel'
            } ${live ? 'run-row-live' : ''} ${run.status === 'failed' ? 'border-l-4 border-l-danger' : ''}`}
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <button
                type="button"
                onClick={() => onSelect(run.id)}
                className="min-w-0 flex-1 text-left"
              >
                <div className="flex flex-wrap items-center gap-2">
                  {live && <span className="run-live-dot" aria-hidden />}
                  <span className="font-bold uppercase tracking-wide text-ink">{run.type}</span>
                  <span className="rounded bg-paper-deep px-1.5 py-0.5 text-[0.7rem] font-bold uppercase text-ink-muted">
                    {run.source}
                  </span>
                  {run.summary && run.summary.drift === true && (
                    <span className="text-xs font-bold text-ember-deep">drift</span>
                  )}
                  <span className="font-mono text-sm text-ink-muted">
                    {new Date(run.created_at).toLocaleString()}
                    {run.duration_ms != null ? ` · ${(run.duration_ms / 1000).toFixed(1)}s` : live ? ' · …' : ''}
                  </span>
                  {delta && (
                    <span className="font-mono text-sm text-ink-muted">{delta}</span>
                  )}
                </div>
                {reason && (
                  <p className="mt-1.5 line-clamp-2 font-mono text-sm text-danger" title={reason}>
                    {reason}
                  </p>
                )}
                {!reason && run.status === 'failed' && (
                  <p className="mt-1.5 text-sm text-danger">Failed — open console for details</p>
                )}
                {live && (
                  <p className="mt-1.5 text-sm font-bold uppercase tracking-wide text-warn">
                    {run.status === 'queued' ? 'Queued — waiting for worker…' : 'Running — watch console above'}
                  </p>
                )}
              </button>
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                {run.awaiting_approval && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => onApprove(run.id)}
                    className="bg-moss-deep px-3 py-1 text-sm font-bold text-paper hover:bg-moss disabled:opacity-60"
                  >
                    Approve
                  </button>
                )}
                {(run.status === 'queued' || run.status === 'running') && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => onCancel(run.id)}
                    className="border-2 border-line px-3 py-1 text-sm font-bold text-ink-muted hover:border-danger hover:text-danger disabled:opacity-60"
                  >
                    Cancel
                  </button>
                )}
                <RunStatusBadge status={badge.status} label={badge.label} />
              </div>
            </div>
          </li>
        )
      })}
    </ul>
  )
}
