import type { NamespaceStatus, RunStatus } from '../../api/client'

const nsStyles: Record<NamespaceStatus, string> = {
  never_run: 'bg-paper-deep/80 text-ink-muted border border-line/70',
  running: 'bg-warn/15 text-warn border border-warn/50',
  healthy: 'bg-ok/15 text-ok border border-ok/45',
  failed: 'bg-danger/15 text-danger border border-danger/45',
}

const runStyles: Record<RunStatus, string> = {
  queued: 'bg-paper-deep/80 text-ink-muted border border-line/70',
  running: 'bg-warn/15 text-warn border border-warn/50',
  success: 'bg-ok/15 text-ok border border-ok/45',
  failed: 'bg-danger/15 text-danger border border-danger/45',
  canceled: 'bg-paper-deep/80 text-ink-muted border border-line/60',
}

const nsLabels: Record<NamespaceStatus, string> = {
  never_run: 'never run',
  running: 'running',
  healthy: 'healthy',
  failed: 'failed',
}

export function StatusBadge({ status }: { status: NamespaceStatus }) {
  return (
    <span
      className={`inline-flex items-center px-2.5 py-1 text-sm font-bold tracking-wide ${nsStyles[status]}`}
    >
      {nsLabels[status]}
    </span>
  )
}

export function RunStatusBadge({ status, label }: { status: RunStatus; label?: string }) {
  return (
    <span
      className={`inline-flex items-center px-2.5 py-1 text-sm font-bold tracking-wide ${runStyles[status]}`}
    >
      {label ?? status}
    </span>
  )
}
