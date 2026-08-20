import type { ConfigEnvironment } from '../../api/client'
import { EnvBadgeRow, EnvIcon, envStyle } from './envVisuals'

const CATEGORY_HINT: Record<string, string> = {
  cloud: 'Cloud',
  local: 'Local / files',
  kubernetes: 'Cluster',
  utility: 'Utility',
  vcs: 'VCS',
  other: 'Other',
}

function evidence(p: ConfigEnvironment['providers'][number]): string {
  const bits: string[] = []
  if (p.declared) bits.push('declared')
  if (p.in_config) bits.push('in config')
  if (p.in_state) bits.push('in state')
  if (p.resource_count > 0) bits.push(`${p.resource_count} resource${p.resource_count === 1 ? '' : 's'}`)
  if (p.data_count > 0) bits.push(`${p.data_count} data`)
  return bits.join(' · ')
}

export function EnvironmentPanel({
  environment,
  loading,
}: {
  environment?: ConfigEnvironment | null
  loading?: boolean
}) {
  if (loading && !environment) {
    return (
      <section className="mb-6 border-2 border-dashed border-line bg-panel/80 px-4 py-3">
        <p className="text-sm text-ink-muted">Detecting Terraform environment…</p>
      </section>
    )
  }

  if (!environment) return null

  const primary = environment.primary
    ? environment.providers.find((p) => p.name === environment.primary)
    : null
  const stripe = primary ? envStyle(primary.name).accent : 'var(--color-line)'

  return (
    <section
      className="mb-6 overflow-hidden border-2 border-line bg-panel/90"
      aria-label="Terraform environment"
      style={{ boxShadow: `inset 6px 0 0 0 ${stripe}` }}
    >
      <div className="px-4 py-4 sm:px-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold uppercase tracking-wide text-ink-muted">Environment</p>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              {primary && <EnvIcon name={primary.name} size={40} />}
              <p className="font-display text-2xl font-bold text-ink sm:text-3xl">
                {environment.summary}
              </p>
            </div>
            <p className="mt-2 text-sm text-ink-muted">
              {environment.empty
                ? environment.note ||
                  'No providers found yet — add required_providers or resources to the configuration.'
                : 'Detected from required_providers, provider blocks, resources in config, and remote state when present.'}
            </p>
          </div>
          {!environment.empty && (
            <div className="w-full sm:w-auto sm:max-w-md">
              <EnvBadgeRow environment={environment} size="lg" />
            </div>
          )}
        </div>

        {!environment.empty && environment.providers.length > 0 && (
          <ul className="mt-4 divide-y divide-line border-2 border-line bg-paper/70">
            {environment.providers.map((p) => {
              const s = envStyle(p.name)
              return (
                <li
                  key={p.name}
                  className="flex flex-wrap items-center gap-3 px-3 py-3"
                  style={{
                    borderLeft: `5px solid ${s.accent}`,
                    background: `linear-gradient(90deg, ${s.bg}, transparent 55%)`,
                  }}
                >
                  <EnvIcon name={p.name} size={32} />
                  <div className="min-w-0 flex-1">
                    <p className="font-bold text-ink" style={{ color: s.text }}>
                      {p.label}{' '}
                      <span className="font-mono text-sm font-normal text-ink-muted">({p.name})</span>
                    </p>
                    <p className="mt-0.5 text-xs text-ink-muted">
                      {CATEGORY_HINT[p.category] ?? p.category}
                      {p.source ? ` · ${p.source}` : ''}
                      {p.version ? ` · ${p.version}` : ''}
                    </p>
                  </div>
                  <p className="text-xs font-medium text-ink-muted">{evidence(p) || 'referenced'}</p>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </section>
  )
}

export { EnvBadgeRow } from './envVisuals'
