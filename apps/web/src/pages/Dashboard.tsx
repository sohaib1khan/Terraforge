import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import {
  api,
  ApiError,
  type ConfigEnvironment,
  type Namespace,
  type Run,
  type Suggestions,
} from '../api/client'
import { AppShell } from '../components/AppShell'
import { EnvBadge, EnvBadgeRow, EnvIcon } from '../components/EnvironmentPanel/envVisuals'
import { RunStatusBadge, StatusBadge } from '../components/StatusBadge/StatusBadge'

type NsPulse = {
  ns: Namespace
  env: ConfigEnvironment | null
  runs: Run[]
  suggestions: Suggestions | null
}

function StatTile({
  label,
  value,
  hint,
  tone = 'default',
}: {
  label: string
  value: number | string
  hint?: string
  tone?: 'default' | 'ok' | 'warn' | 'danger' | 'active'
}) {
  const styles =
    tone === 'ok'
      ? 'border-ok/50 bg-ok/10'
      : tone === 'warn'
        ? 'border-warn/50 bg-warn/10'
        : tone === 'danger'
          ? 'border-danger/50 bg-danger/10'
          : tone === 'active'
            ? 'border-ember-deep bg-ember/15'
            : 'border-line bg-panel/90'
  return (
    <div className={`border-2 px-4 py-3 ${styles}`}>
      <p className="text-xs font-bold uppercase tracking-wide text-ink-muted">{label}</p>
      <p className="mt-1 font-display text-3xl font-bold text-ink">{value}</p>
      {hint && <p className="mt-1 text-xs text-ink-muted">{hint}</p>}
    </div>
  )
}

function relativeTime(iso: string | null | undefined): string {
  if (!iso) return ''
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return ''
  const sec = Math.round((Date.now() - t) / 1000)
  if (sec < 60) return `${sec}s ago`
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`
  return `${Math.floor(sec / 86400)}d ago`
}

export function Dashboard() {
  const [pulses, setPulses] = useState<NsPulse[]>([])
  const [name, setName] = useState('')
  const [remoteURL, setRemoteURL] = useState('')
  const [pat, setPat] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async (opts?: { soft?: boolean }) => {
    if (opts?.soft) setRefreshing(true)
    else setLoading(true)
    try {
      const res = await api.listNamespaces()
      const rows = await Promise.all(
        res.namespaces.map(async (ns) => {
          const [graph, runs, suggestions] = await Promise.all([
            api.getGraph(ns.id).catch(() => null),
            api.listRuns(ns.id).catch(() => ({ runs: [] as Run[] })),
            api.getSuggestions(ns.id).catch(() => null),
          ])
          return {
            ns,
            env: graph?.environment && !graph.environment.empty ? graph.environment : null,
            runs: runs.runs.slice(0, 8),
            suggestions,
          } satisfies NsPulse
        }),
      )
      setPulses(rows)
      setError('')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load dashboard')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const hasLive = pulses.some(
    (p) =>
      p.ns.status === 'running' ||
      p.runs.some((r) => r.status === 'queued' || r.status === 'running' || r.awaiting_approval),
  )

  useEffect(() => {
    if (!hasLive) return
    const t = window.setInterval(() => void load({ soft: true }), 12_000)
    return () => window.clearInterval(t)
  }, [hasLive, load])

  const stats = useMemo(() => {
    const total = pulses.length
    const running = pulses.filter((p) => p.ns.status === 'running').length
    const healthy = pulses.filter((p) => p.ns.status === 'healthy').length
    const failed = pulses.filter((p) => p.ns.status === 'failed').length
    const drift = pulses.filter((p) => p.ns.has_drift).length
    const awaiting = pulses.filter((p) => p.runs.some((r) => r.awaiting_approval)).length
    const bumps = pulses.reduce((n, p) => n + (p.suggestions?.bump_count ?? 0), 0)
    const liveRuns = pulses.reduce(
      (n, p) => n + p.runs.filter((r) => r.status === 'queued' || r.status === 'running').length,
      0,
    )
    return { total, running, healthy, failed, drift, awaiting, bumps, liveRuns }
  }, [pulses])

  const active = useMemo(() => {
    return pulses
      .map((p) => {
        const live = p.runs.filter(
          (r) => r.status === 'queued' || r.status === 'running' || r.awaiting_approval,
        )
        return { ...p, live }
      })
      .filter((p) => p.live.length > 0 || p.ns.status === 'running')
      .sort((a, b) => b.live.length - a.live.length)
  }, [pulses])

  const attention = useMemo(() => {
    type Item = { key: string; tone: 'danger' | 'warn' | 'active'; title: string; detail: string; href: string }
    const items: Item[] = []
    for (const p of pulses) {
      if (p.ns.has_drift) {
        items.push({
          key: `drift-${p.ns.id}`,
          tone: 'warn',
          title: `${p.ns.name}: drift detected`,
          detail: p.ns.drift_detected_at
            ? `Seen ${relativeTime(p.ns.drift_detected_at)}`
            : 'Config may differ from remote state',
          href: `/namespaces/${p.ns.id}`,
        })
      }
      if (p.ns.status === 'failed') {
        items.push({
          key: `fail-${p.ns.id}`,
          tone: 'danger',
          title: `${p.ns.name}: last run failed`,
          detail: 'Open the namespace to inspect logs and re-run',
          href: `/namespaces/${p.ns.id}`,
        })
      }
      for (const r of p.runs.filter((x) => x.awaiting_approval)) {
        items.push({
          key: `appr-${r.id}`,
          tone: 'active',
          title: `${p.ns.name}: ${r.type} awaiting approval`,
          detail: `Queued ${relativeTime(r.created_at)}`,
          href: `/namespaces/${p.ns.id}`,
        })
      }
      if ((p.suggestions?.bump_count ?? 0) > 0) {
        items.push({
          key: `bump-${p.ns.id}`,
          tone: 'warn',
          title: `${p.ns.name}: ${p.suggestions!.bump_count} version bump${p.suggestions!.bump_count === 1 ? '' : 's'}`,
          detail: 'Provider/module pins are behind the public registry',
          href: `/namespaces/${p.ns.id}`,
        })
      }
    }
    return items.slice(0, 12)
  }, [pulses])

  const recentRuns = useMemo(() => {
    const flat: Array<{ run: Run; ns: Namespace; env: ConfigEnvironment | null }> = []
    for (const p of pulses) {
      for (const run of p.runs) {
        flat.push({ run, ns: p.ns, env: p.env })
      }
    }
    return flat
      .sort((a, b) => new Date(b.run.created_at).getTime() - new Date(a.run.created_at).getTime())
      .slice(0, 10)
  }, [pulses])

  const fleetClouds = useMemo(() => {
    const counts = new Map<string, { label: string; count: number }>()
    for (const p of pulses) {
      if (!p.env) continue
      const names = new Set<string>()
      for (const c of p.env.clouds) names.add(c)
      if (p.env.has_local) names.add('local')
      for (const name of names) {
        const label =
          p.env.providers.find((x) => x.name === name)?.label ??
          (name === 'local' ? 'Local' : name)
        const cur = counts.get(name) ?? { label, count: 0 }
        cur.count++
        counts.set(name, cur)
      }
    }
    return [...counts.entries()]
      .map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => b.count - a.count)
  }, [pulses])

  async function createNamespace(e: FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    setBusy(true)
    setError('')
    try {
      await api.createNamespace({
        name: name.trim(),
        remote_url: remoteURL.trim() || undefined,
        pat: pat || undefined,
      })
      setName('')
      setRemoteURL('')
      setPat('')
      await load({ soft: true })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Create failed')
    } finally {
      setBusy(false)
    }
  }

  async function removeNamespace(id: string, label: string) {
    if (!confirm(`Delete namespace "${label}"? This cannot be undone.`)) return
    try {
      await api.deleteNamespace(id)
      setPulses((prev) => prev.filter((p) => p.ns.id !== id))
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Delete failed')
    }
  }

  return (
    <AppShell
      title="Dashboard"
      subtitle="Hawk-eye view of namespaces, runs, drift, environments, and registry freshness"
      wide
    >
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-muted">
          {refreshing ? 'Refreshing live activity…' : 'Fleet overview across this Terraforge instance'}
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => window.dispatchEvent(new CustomEvent('terraforge:open-connect-guide'))}
            className="btn-secondary btn-compact"
          >
            How to connect
          </button>
          <button
            type="button"
            onClick={() => void load({ soft: true })}
            disabled={loading || refreshing}
            className="btn-secondary btn-compact"
          >
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <p className="mb-4 text-base font-medium text-danger" role="alert">
          {error}
        </p>
      )}

      {loading ? (
        <p className="text-lg text-ink-muted">Building hawk-eye…</p>
      ) : (
        <>
          <section className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8">
            <StatTile label="Namespaces" value={stats.total} />
            <StatTile label="Active runs" value={stats.liveRuns} tone={stats.liveRuns ? 'active' : 'default'} />
            <StatTile label="Running NS" value={stats.running} tone={stats.running ? 'active' : 'default'} />
            <StatTile label="Healthy" value={stats.healthy} tone="ok" />
            <StatTile label="Failed" value={stats.failed} tone={stats.failed ? 'danger' : 'default'} />
            <StatTile label="Drift" value={stats.drift} tone={stats.drift ? 'warn' : 'default'} />
            <StatTile label="Approvals" value={stats.awaiting} tone={stats.awaiting ? 'active' : 'default'} />
            <StatTile label="Version bumps" value={stats.bumps} tone={stats.bumps ? 'warn' : 'default'} />
          </section>

          <div className="mb-6 grid gap-6 lg:grid-cols-2">
            <section className="border-2 border-line bg-panel/90">
              <header className="border-b-2 border-line px-4 py-3">
                <h2 className="font-display text-xl font-bold text-ink">Active now</h2>
                <p className="text-sm text-ink-muted">Queued, running, or waiting on approval</p>
              </header>
              {active.length === 0 ? (
                <p className="px-4 py-8 text-sm text-ink-muted">No live Terraform activity right now.</p>
              ) : (
                <ul className="divide-y divide-line">
                  {active.map((p) => (
                    <li key={p.ns.id} className="px-4 py-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <Link
                          to={`/namespaces/${p.ns.id}`}
                          className="font-bold text-ink hover:text-ember-deep"
                        >
                          {p.ns.name}
                        </Link>
                        <StatusBadge status={p.ns.status} />
                      </div>
                      <ul className="mt-2 space-y-1.5">
                        {p.live.map((r) => (
                          <li key={r.id} className="flex flex-wrap items-center gap-2 text-sm">
                            <RunStatusBadge
                              status={r.awaiting_approval ? 'queued' : r.status}
                              label={r.awaiting_approval ? 'awaiting approval' : r.status}
                            />
                            <span className="font-mono font-bold text-ink">{r.type}</span>
                            <span className="text-ink-muted">{relativeTime(r.created_at)}</span>
                          </li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="border-2 border-line bg-panel/90">
              <header className="border-b-2 border-line px-4 py-3">
                <h2 className="font-display text-xl font-bold text-ink">Needs attention</h2>
                <p className="text-sm text-ink-muted">Drift, failures, approvals, registry bumps</p>
              </header>
              {attention.length === 0 ? (
                <p className="px-4 py-8 text-sm text-ink-muted">
                  All clear — no drift, failures, or pending bumps flagged.
                </p>
              ) : (
                <ul className="divide-y divide-line">
                  {attention.map((item) => (
                    <li key={item.key}>
                      <Link
                        to={item.href}
                        className={`block border-l-[5px] px-4 py-3 transition-colors hover:bg-paper-deep/60 ${
                          item.tone === 'danger'
                            ? 'border-danger bg-danger/5'
                            : item.tone === 'warn'
                              ? 'border-warn bg-warn/5'
                              : 'border-ember-deep bg-ember/5'
                        }`}
                      >
                        <p className="font-bold text-ink">{item.title}</p>
                        <p className="mt-0.5 text-sm text-ink-muted">{item.detail}</p>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          <section className="mb-6 border-2 border-line bg-panel/90 px-4 py-4">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="font-display text-xl font-bold text-ink">Environments in use</h2>
                <p className="mt-1 text-sm text-ink-muted">
                  Clouds and local providers detected across workspace configs
                </p>
              </div>
            </div>
            {fleetClouds.length === 0 ? (
              <p className="mt-4 text-sm text-ink-muted">
                No providers detected yet — import or write Terraform config in a namespace.
              </p>
            ) : (
              <div className="mt-4 flex flex-wrap gap-3">
                {fleetClouds.map((c) => (
                  <div key={c.name} className="flex items-center gap-2">
                    <EnvBadge name={c.name} label={`${c.label} · ${c.count}`} size="md" />
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="mb-8 border-2 border-line bg-panel/90">
            <header className="border-b-2 border-line px-4 py-3">
              <h2 className="font-display text-xl font-bold text-ink">Recent runs</h2>
              <p className="text-sm text-ink-muted">Latest lifecycle activity across the fleet</p>
            </header>
            {recentRuns.length === 0 ? (
              <p className="px-4 py-8 text-sm text-ink-muted">No runs yet.</p>
            ) : (
              <ul className="divide-y divide-line">
                {recentRuns.map(({ run, ns, env }) => (
                  <li key={run.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                    {env?.primary ? <EnvIcon name={env.primary} size={24} /> : null}
                    <div className="min-w-0 flex-1">
                      <Link
                        to={`/namespaces/${ns.id}`}
                        className="font-bold text-ink hover:text-ember-deep"
                      >
                        {ns.name}
                      </Link>
                      <p className="text-sm text-ink-muted">
                        <span className="font-mono font-bold text-ink">{run.type}</span>
                        {' · '}
                        {relativeTime(run.created_at)}
                        {run.source ? ` · ${run.source}` : ''}
                      </p>
                    </div>
                    <RunStatusBadge status={run.status} />
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="mb-6">
            <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="font-display text-2xl font-bold text-ink">Workspaces</h2>
                <p className="mt-1 text-sm text-ink-muted">
                  Create and open namespaces — each is an isolated Terraform control plane
                </p>
              </div>
            </div>

            <form onSubmit={createNamespace} className="surface mb-4 space-y-3 px-4 py-4">
              <div className="flex flex-col gap-3 sm:flex-row">
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="New namespace name"
                  className="field min-w-0 flex-1"
                />
                <button
                  type="submit"
                  disabled={busy || !name.trim()}
                  className="btn-primary shrink-0"
                >
                  {busy ? 'Creating…' : 'Create'}
                </button>
              </div>
              <input
                value={remoteURL}
                onChange={(e) => setRemoteURL(e.target.value)}
                placeholder="Optional: clone from remote URL"
                className="field"
              />
              {remoteURL.trim() && (
                <input
                  type="password"
                  value={pat}
                  onChange={(e) => setPat(e.target.value)}
                  placeholder="PAT for private remotes"
                  className="field"
                />
              )}
            </form>

            {pulses.length === 0 ? (
              <p className="surface border-dashed px-4 py-10 text-center text-lg text-ink-muted">
                No namespaces yet. Create one to open the editor.
              </p>
            ) : (
              <ul className="surface divide-y-2 divide-line">
                {pulses.map(({ ns, env, runs, suggestions }) => {
                  const latest = runs[0]
                  return (
                    <li
                      key={ns.id}
                      className="flex flex-wrap items-center justify-between gap-3 px-4 py-4"
                    >
                      <div className="min-w-0">
                        <Link
                          to={`/namespaces/${ns.id}`}
                          className="text-lg font-bold text-ink hover:text-ember-deep"
                        >
                          {ns.name}
                        </Link>
                        <p className="mt-1 truncate text-base text-ink-muted">
                          {ns.slug} · tf {ns.terraform_version}
                          {ns.has_remote ? ' · remote' : ''}
                          {latest
                            ? ` · last ${latest.type} ${latest.status} ${relativeTime(latest.created_at)}`
                            : ' · never run'}
                        </p>
                        {env && (
                          <div className="mt-2">
                            <EnvBadgeRow environment={env} size="sm" />
                          </div>
                        )}
                        {(suggestions?.bump_count ?? 0) > 0 && (
                          <p className="mt-2 text-sm font-bold text-warn">
                            {suggestions!.bump_count} registry bump
                            {suggestions!.bump_count === 1 ? '' : 's'} suggested
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-3">
                        {ns.has_drift && (
                          <span className="border border-ember bg-ember/15 px-2 py-0.5 text-sm font-bold text-ember-deep">
                            drift
                          </span>
                        )}
                        <StatusBadge status={ns.status} />
                        <button
                          type="button"
                          onClick={() => void removeNamespace(ns.id, ns.name)}
                          className="btn-compact text-base font-medium text-ink-muted hover:text-danger"
                        >
                          Delete
                        </button>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
        </>
      )}
    </AppShell>
  )
}
