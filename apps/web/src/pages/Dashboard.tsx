import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { api, ApiError, type Namespace } from '../api/client'
import { AppShell } from '../components/AppShell'
import { StatusBadge } from '../components/StatusBadge/StatusBadge'

export function Dashboard() {
  const [namespaces, setNamespaces] = useState<Namespace[]>([])
  const [name, setName] = useState('')
  const [remoteURL, setRemoteURL] = useState('')
  const [pat, setPat] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)

  async function load() {
    setLoading(true)
    try {
      const res = await api.listNamespaces()
      setNamespaces(res.namespaces)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load namespaces')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  async function createNamespace(e: FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    setBusy(true)
    setError('')
    try {
      const ns = await api.createNamespace({
        name: name.trim(),
        remote_url: remoteURL.trim() || undefined,
        pat: pat || undefined,
      })
      setNamespaces((prev) => [ns, ...prev])
      setName('')
      setRemoteURL('')
      setPat('')
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
      setNamespaces((prev) => prev.filter((n) => n.id !== id))
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Delete failed')
    }
  }

  return (
    <AppShell title="Namespaces" subtitle="Local workspaces with editor, runs, and history">
      <section className="surface mb-6 flex flex-wrap items-center justify-between gap-3 px-4 py-4">
        <div>
          <p className="text-lg font-bold text-ink">Working from your laptop?</p>
          <p className="mt-1 text-base text-ink-muted">
            Open a namespace → <strong>Connect with curl</strong> (one-time command, no zip).
          </p>
        </div>
        <button
          type="button"
          onClick={() => window.dispatchEvent(new CustomEvent('terraforge:open-connect-guide'))}
          className="btn-primary shrink-0"
        >
          How to connect
        </button>
      </section>

      <section>
        <form onSubmit={createNamespace} className="space-y-3">
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
        {error && (
          <p className="mt-3 text-base font-medium text-danger" role="alert">
            {error}
          </p>
        )}
      </section>

      <section className="mt-8">
        {loading ? (
          <p className="text-lg text-ink-muted">Loading…</p>
        ) : namespaces.length === 0 ? (
          <p className="surface border-dashed px-4 py-10 text-center text-lg text-ink-muted">
            No namespaces yet. Create one to open the editor.
          </p>
        ) : (
          <ul className="surface divide-y-2 divide-line">
            {namespaces.map((ns) => (
              <li key={ns.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-4">
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
                  </p>
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
            ))}
          </ul>
        )}
      </section>
    </AppShell>
  )
}
