import { useDeferredValue, useEffect, useId, useMemo, useRef, useState } from 'react'
import { api, ApiError, type AuditEntry } from '../api/client'
import { AppShell } from '../components/AppShell'
import { fuzzyFilter } from '../lib/fuzzy'

function entryHaystack(e: AuditEntry): string {
  const meta = e.metadata ? JSON.stringify(e.metadata) : ''
  return [e.actor, e.action, e.target ?? '', meta, e.created_at].join(' ')
}

function actionTone(action: string): string {
  if (action.includes('delete') || action.includes('revoke') || action.includes('cancel')) {
    return 'text-danger'
  }
  if (action.includes('create') || action.includes('approve') || action.includes('redeem')) {
    return 'text-ok'
  }
  if (action.includes('drift') || action.includes('fail')) {
    return 'text-warn'
  }
  return 'text-ember-deep'
}

function relativeTime(iso: string): string {
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return iso
  const diff = Date.now() - t
  const sec = Math.round(diff / 1000)
  if (sec < 45) return 'just now'
  const min = Math.round(sec / 60)
  if (min < 60) return `${min}m ago`
  const hr = Math.round(min / 60)
  if (hr < 36) return `${hr}h ago`
  const day = Math.round(hr / 24)
  if (day < 14) return `${day}d ago`
  return new Date(iso).toLocaleDateString()
}

function actionFamily(action: string): string {
  const i = action.indexOf('.')
  return i > 0 ? action.slice(0, i) : action
}

export function AuditLog() {
  const searchId = useId()
  const searchRef = useRef<HTMLInputElement>(null)
  const [entries, setEntries] = useState<AuditEntry[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [actionFilter, setActionFilter] = useState<string | null>(null)
  const [familyFilter, setFamilyFilter] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const deferredQuery = useDeferredValue(query)

  async function load() {
    setLoading(true)
    setError('')
    try {
      const res = await api.listAudit(500)
      setEntries(res.entries)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load audit log')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        searchRef.current?.focus()
        searchRef.current?.select()
      }
      if (e.key === '/' && document.activeElement?.tagName !== 'INPUT') {
        e.preventDefault()
        searchRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const families = useMemo(() => {
    const counts = new Map<string, number>()
    for (const e of entries) {
      const f = actionFamily(e.action)
      counts.set(f, (counts.get(f) ?? 0) + 1)
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  }, [entries])

  const actions = useMemo(() => {
    const counts = new Map<string, number>()
    for (const e of entries) {
      if (familyFilter && actionFamily(e.action) !== familyFilter) continue
      counts.set(e.action, (counts.get(e.action) ?? 0) + 1)
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  }, [entries, familyFilter])

  const filtered = useMemo(() => {
    let list = entries
    if (familyFilter) {
      list = list.filter((e) => actionFamily(e.action) === familyFilter)
    }
    if (actionFilter) {
      list = list.filter((e) => e.action === actionFilter)
    }
    return fuzzyFilter(list, deferredQuery, entryHaystack)
  }, [entries, familyFilter, actionFilter, deferredQuery])

  const actorCount = useMemo(() => new Set(entries.map((e) => e.actor)).size, [entries])

  return (
    <AppShell
      wide
      title="Audit log"
      subtitle="Admin activity trail — search, filter, scroll"
    >
      <div className="flex min-h-0 flex-col gap-4" style={{ height: 'calc(100dvh - 9.5rem)' }}>
        <div className="flex flex-wrap items-end gap-3 border-b-2 border-line/70 pb-4">
          <div className="min-w-[16rem] flex-1">
            <label htmlFor={searchId} className="mb-1 block text-sm font-bold text-ink-muted">
              Fuzzy search
            </label>
            <div className="relative">
              <input
                ref={searchRef}
                id={searchId}
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="actor, action, target, metadata…  (/ or ⌘K)"
                className="w-full border-2 border-line bg-panel px-3 pr-24 text-ink placeholder:text-ink-muted/70"
                autoComplete="off"
                spellCheck={false}
              />
              {query && (
                <button
                  type="button"
                  className="btn-secondary btn-compact absolute right-2 top-1/2 -translate-y-1/2 px-2 text-sm"
                  onClick={() => {
                    setQuery('')
                    searchRef.current?.focus()
                  }}
                >
                  Clear
                </button>
              )}
            </div>
          </div>
          <button type="button" className="btn-secondary btn-compact px-3" onClick={() => void load()}>
            Refresh
          </button>
        </div>

        <div className="flex flex-wrap gap-2 text-sm text-ink-muted">
          <span className="rounded bg-panel px-2 py-1 font-medium text-ink">
            {filtered.length}
            <span className="font-normal text-ink-muted"> / {entries.length} events</span>
          </span>
          <span className="rounded bg-panel px-2 py-1">{actorCount} actors</span>
          <span className="rounded bg-panel px-2 py-1">{families.length} families</span>
          {(query || actionFilter || familyFilter) && (
            <button
              type="button"
              className="text-ember-deep underline"
              onClick={() => {
                setQuery('')
                setActionFilter(null)
                setFamilyFilter(null)
              }}
            >
              Reset filters
            </button>
          )}
        </div>

        {families.length > 0 && (
          <div className="flex flex-wrap gap-2" role="group" aria-label="Action family">
            <FilterChip
              active={!familyFilter}
              label="All"
              onClick={() => {
                setFamilyFilter(null)
                setActionFilter(null)
              }}
            />
            {families.map(([name, count]) => (
              <FilterChip
                key={name}
                active={familyFilter === name}
                label={`${name} (${count})`}
                onClick={() => {
                  setFamilyFilter(name)
                  setActionFilter(null)
                }}
              />
            ))}
          </div>
        )}

        {actions.length > 0 && (
          <div
            className="flex max-h-24 flex-wrap gap-1.5 overflow-y-auto"
            role="group"
            aria-label="Action"
          >
            <FilterChip
              compact
              active={!actionFilter}
              label="Any action"
              onClick={() => setActionFilter(null)}
            />
            {actions.map(([name, count]) => (
              <FilterChip
                key={name}
                compact
                active={actionFilter === name}
                label={`${name} (${count})`}
                onClick={() => setActionFilter(name === actionFilter ? null : name)}
              />
            ))}
          </div>
        )}

        {error && (
          <p className="text-danger" role="alert">
            {error}
          </p>
        )}

        <div className="surface flex min-h-0 flex-1 flex-col overflow-hidden border-2 border-line">
          <div className="sticky top-0 z-10 grid grid-cols-[minmax(7rem,9rem)_minmax(8rem,12rem)_minmax(10rem,1fr)_minmax(0,1.4fr)_auto] gap-2 border-b-2 border-line bg-paper-deep/90 px-3 py-2 text-xs font-bold uppercase tracking-wide text-ink-muted backdrop-blur-sm max-md:hidden">
            <span>When</span>
            <span>Actor</span>
            <span>Action</span>
            <span>Target</span>
            <span className="text-right">Meta</span>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain" tabIndex={0}>
            {loading ? (
              <p className="px-4 py-10 text-ink-muted">Loading audit events…</p>
            ) : filtered.length === 0 ? (
              <p className="px-4 py-10 text-ink-muted">
                {entries.length === 0 ? 'No audit events yet.' : 'No events match this search.'}
              </p>
            ) : (
              <ul className="divide-y divide-line/60">
                {filtered.map((e) => {
                  const open = !!expanded[e.id]
                  const hasMeta = !!(e.metadata && Object.keys(e.metadata).length > 0)
                  return (
                    <li key={e.id} className="bg-panel/40 hover:bg-panel/80">
                      <div className="grid grid-cols-1 gap-1 px-3 py-2.5 md:grid-cols-[minmax(7rem,9rem)_minmax(8rem,12rem)_minmax(10rem,1fr)_minmax(0,1.4fr)_auto] md:items-baseline md:gap-2">
                        <time
                          className="font-mono text-sm text-ink-muted"
                          dateTime={e.created_at}
                          title={new Date(e.created_at).toLocaleString()}
                        >
                          {relativeTime(e.created_at)}
                        </time>
                        <p className="truncate font-medium text-ink" title={e.actor}>
                          {e.actor}
                        </p>
                        <p className={`truncate font-mono text-sm ${actionTone(e.action)}`} title={e.action}>
                          {e.action}
                        </p>
                        <p
                          className="truncate font-mono text-sm text-ink-muted"
                          title={e.target ?? undefined}
                        >
                          {e.target ?? '—'}
                        </p>
                        <div className="flex justify-end">
                          {hasMeta ? (
                            <button
                              type="button"
                              className="btn-secondary btn-compact px-2 text-sm"
                              aria-expanded={open}
                              onClick={() =>
                                setExpanded((prev) => ({ ...prev, [e.id]: !prev[e.id] }))
                              }
                            >
                              {open ? 'Hide' : 'Meta'}
                            </button>
                          ) : (
                            <span className="text-sm text-ink-muted">—</span>
                          )}
                        </div>
                      </div>
                      {open && hasMeta && (
                        <pre className="mx-3 mb-3 overflow-auto border border-line/50 bg-[#2f3d4a] p-3 font-mono text-xs leading-relaxed text-[#d8e1e9]">
                          {JSON.stringify(e.metadata, null, 2)}
                        </pre>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </div>
      </div>
    </AppShell>
  )
}

function FilterChip({
  label,
  active,
  onClick,
  compact,
}: {
  label: string
  active: boolean
  onClick: () => void
  compact?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`btn-compact border-2 px-2.5 text-sm ${
        active
          ? 'border-ember-deep bg-ember/20 font-bold text-ink'
          : 'border-line/70 bg-panel/60 font-medium text-ink-muted hover:border-line hover:text-ink'
      } ${compact ? 'py-0.5' : ''}`}
    >
      {label}
    </button>
  )
}
