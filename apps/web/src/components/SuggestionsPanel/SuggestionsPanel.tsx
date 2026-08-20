import type { Suggestions, VersionSuggestion } from '../../api/client'
import { EnvIcon } from '../EnvironmentPanel/envVisuals'

function Row({ item }: { item: VersionSuggestion }) {
  const bump = item.newer_outside_constraint
  const soft = item.update_available && !bump
  const ok = !item.update_available && item.constraint_satisfied && !!item.latest

  let tone = {
    border: 'var(--color-line)',
    bg: 'transparent',
    badge: 'Current',
    badgeBg: 'color-mix(in srgb, var(--color-line) 35%, transparent)',
    badgeFg: 'var(--color-ink-muted)',
  }
  if (bump) {
    tone = {
      border: 'var(--color-warn)',
      bg: 'color-mix(in srgb, var(--color-warn) 14%, transparent)',
      badge: 'Bump available',
      badgeBg: 'color-mix(in srgb, var(--color-warn) 35%, transparent)',
      badgeFg: '#5C4518',
    }
  } else if (soft) {
    tone = {
      border: '#3d6f7c',
      bg: 'color-mix(in srgb, #3d6f7c 12%, transparent)',
      badge: 'Newer release',
      badgeBg: 'color-mix(in srgb, #3d6f7c 28%, transparent)',
      badgeFg: '#2d5661',
    }
  } else if (ok) {
    tone = {
      border: 'var(--color-ok)',
      bg: 'color-mix(in srgb, var(--color-ok) 10%, transparent)',
      badge: 'Up to date',
      badgeBg: 'color-mix(in srgb, var(--color-ok) 28%, transparent)',
      badgeFg: '#244836',
    }
  }

  return (
    <li
      className="flex flex-wrap items-start gap-3 border-l-[5px] px-3 py-3"
      style={{ borderLeftColor: tone.border, background: tone.bg }}
    >
      {item.kind === 'provider' ? (
        <EnvIcon name={item.name} size={28} />
      ) : (
        <span
          className="inline-flex size-7 shrink-0 items-center justify-center rounded-md bg-ink font-mono text-[10px] font-bold text-panel"
          aria-hidden
        >
          mod
        </span>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-bold text-ink">
            {item.label}{' '}
            <span className="font-mono text-sm font-normal text-ink-muted">
              {item.kind === 'provider' ? item.source : item.source}
            </span>
          </p>
          <span
            className="px-2 py-0.5 text-xs font-bold"
            style={{ background: tone.badgeBg, color: tone.badgeFg }}
          >
            {tone.badge}
          </span>
        </div>
        <p className="mt-1 font-mono text-sm text-ink">
          {item.current ? (
            <>
              <span className="text-ink-muted">config</span> {item.current}
            </>
          ) : (
            <span className="text-ink-muted">no version pin</span>
          )}
          {item.latest && (
            <>
              {' → '}
              <span className="text-ink-muted">latest</span> {item.latest}
            </>
          )}
        </p>
        <p className="mt-1 text-xs text-ink-muted">{item.message}</p>
        {item.file && <p className="mt-0.5 font-mono text-xs text-ink-muted">{item.file}</p>}
      </div>
      {item.docs_url && (
        <a
          href={item.docs_url}
          target="_blank"
          rel="noreferrer"
          className="shrink-0 border border-line bg-paper px-2 py-1 text-xs font-bold hover:bg-paper-deep"
        >
          Registry ↗
        </a>
      )}
    </li>
  )
}

export function SuggestionsPanel({
  suggestions,
  loading,
  onRefresh,
}: {
  suggestions: Suggestions | null
  loading: boolean
  onRefresh: () => void
}) {
  const hasItems =
    (suggestions?.providers.length ?? 0) > 0 || (suggestions?.modules.length ?? 0) > 0

  return (
    <section className="mb-6 border-2 border-line bg-panel/90" aria-label="Registry suggestions">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b-2 border-line px-4 py-3">
        <div>
          <p className="text-sm font-bold uppercase tracking-wide text-ink-muted">
            Registry suggestions
          </p>
          <p className="mt-1 font-display text-xl font-bold text-ink">
            {loading && !suggestions
              ? 'Checking public registry…'
              : suggestions
                ? suggestions.bump_count > 0
                  ? `${suggestions.bump_count} bump${suggestions.bump_count === 1 ? '' : 's'} outside your constraints`
                  : suggestions.update_count > 0
                    ? `${suggestions.update_count} newer release${suggestions.update_count === 1 ? '' : 's'} on the registry`
                    : hasItems
                      ? 'Providers and modules look current'
                      : 'No pinned providers or registry modules found'
                : 'Registry suggestions'}
          </p>
          <p className="mt-1 text-sm text-ink-muted">
            Reads required_providers and module blocks from this namespace, then compares to
            registry.terraform.io.
          </p>
        </div>
        <button type="button" onClick={onRefresh} disabled={loading} className="btn-secondary btn-compact">
          {loading ? 'Checking…' : 'Re-check'}
        </button>
      </div>

      {suggestions?.note && (
        <p className="border-b border-line px-4 py-2 text-xs text-ink-muted">{suggestions.note}</p>
      )}

      {!loading && suggestions && !hasItems && (
        <p className="px-4 py-6 text-sm text-ink-muted">
          Add <code className="font-mono">required_providers</code> version pins or Registry{' '}
          <code className="font-mono">module</code> sources to get update hints.
        </p>
      )}

      {suggestions && suggestions.providers.length > 0 && (
        <div className="px-4 py-3">
          <h3 className="mb-2 text-sm font-bold text-ink">Providers</h3>
          <ul className="divide-y divide-line border border-line bg-paper/60">
            {suggestions.providers.map((p) => (
              <Row key={`p-${p.source}-${p.file}`} item={p} />
            ))}
          </ul>
        </div>
      )}

      {suggestions && suggestions.modules.length > 0 && (
        <div className="px-4 py-3">
          <h3 className="mb-2 text-sm font-bold text-ink">Modules</h3>
          <ul className="divide-y divide-line border border-line bg-paper/60">
            {suggestions.modules.map((m) => (
              <Row key={`m-${m.name}-${m.source}-${m.file}`} item={m} />
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
