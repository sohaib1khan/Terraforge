import type { RunType } from '../../api/client'

type Props = {
  busy: boolean
  live?: boolean
  onRun: (type: RunType) => void
}

const actions: { type: RunType; label: string; kind: 'secondary' | 'primary' | 'danger' }[] = [
  { type: 'init', label: 'Init', kind: 'secondary' },
  { type: 'plan', label: 'Plan', kind: 'secondary' },
  { type: 'apply', label: 'Apply', kind: 'primary' },
  { type: 'destroy', label: 'Destroy', kind: 'danger' },
]

export function RunPanel({ busy, live, onRun }: Props) {
  const blocked = busy || !!live
  return (
    <div className="flex flex-wrap gap-2">
      {actions.map((a) => (
        <button
          key={a.type}
          type="button"
          disabled={blocked}
          title={live ? 'A run is already in progress' : undefined}
          onClick={() => onRun(a.type)}
          className={
            a.kind === 'primary'
              ? 'btn-primary px-4 text-base'
              : a.kind === 'danger'
                ? 'border-2 border-danger bg-danger px-4 text-base font-bold text-panel hover:opacity-90 disabled:opacity-50'
                : 'btn-secondary px-4 text-base'
          }
        >
          {a.label}
        </button>
      ))}
    </div>
  )
}
