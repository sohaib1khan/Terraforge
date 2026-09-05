import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { api, ApiError, type Namespace } from '../api/client'
import { AppShell } from '../components/AppShell'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { StatusBadge } from '../components/StatusBadge/StatusBadge'

function relativeTime(iso: string): string {
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return ''
  const sec = Math.round((Date.now() - t) / 1000)
  if (sec < 60) return `${sec}s ago`
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`
  return `${Math.floor(sec / 86400)}d ago`
}

export function Namespaces() {
  const [rows, setRows] = useState<Namespace[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [note, setNote] = useState('')
  const [query, setQuery] = useState('')
  const [showPlaygrounds, setShowPlaygrounds] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [renaming, setRenaming] = useState<{ id: string; value: string } | null>(null)
  const [pendingDelete, setPendingDelete] = useState<Namespace | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)

  const [name, setName] = useState('')
  const [remoteURL, setRemoteURL] = useState('')
  const [pat, setPat] = useState('')
  const [creating, setCreating] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api.listNamespaces()
      setRows(res.namespaces)
      setError('')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load namespaces')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return rows
      .filter((ns) => (showPlaygrounds ? true : !ns.is_playground))
      .filter((ns) => !q || ns.name.toLowerCase().includes(q) || ns.slug.toLowerCase().includes(q))
  }, [rows, query, showPlaygrounds])

  const playgroundCount = rows.filter((ns) => ns.is_playground).length

  async function createNamespace(e: FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    setCreating(true)
    setError('')
    setNote('')
    try {
      const created = await api.createNamespace({
        name: name.trim(),
        remote_url: remoteURL.trim() || undefined,
        pat: pat || undefined,
      })
      setName('')
      setRemoteURL('')
      setPat('')
      setNote(`Created “${created.name}”. Open it to connect local Terraform.`)
      await load()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create namespace')
    } finally {
      setCreating(false)
    }
  }

  async function saveRename() {
    if (!renaming) return
    const next = renaming.value.trim()
    const current = rows.find((r) => r.id === renaming.id)
    if (!next || next === current?.name) {
      setRenaming(null)
      return
    }
    setBusyId(renaming.id)
    setError('')
    setNote('')
    try {
      const updated = await api.updateNamespaceSettings(renaming.id, { name: next })
      setRows((prev) => prev.map((row) => (row.id === updated.id ? updated : row)))
      setNote(`Renamed to “${updated.name}”. The slug ${updated.slug} stays the same.`)
      setRenaming(null)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Rename failed')
    } finally {
      setBusyId(null)
    }
  }

  async function confirmDelete() {
    if (!pendingDelete) return
    setDeleteBusy(true)
    setError('')
    setNote('')
    try {
      await api.deleteNamespace(pendingDelete.id)
      setRows((prev) => prev.filter((row) => row.id !== pendingDelete.id))
      setNote(`Deleted “${pendingDelete.name}”.`)
      setPendingDelete(null)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Delete failed')
    } finally {
      setDeleteBusy(false)
    }
  }

  async function togglePlayground(ns: Namespace) {
    setBusyId(ns.id)
    setError('')
    setNote('')
    try {
      const updated = await api.updateNamespaceSettings(ns.id, {
        is_playground: !ns.is_playground,
      })
      setRows((prev) => prev.map((row) => (row.id === ns.id ? updated : row)))
      setNote(
        updated.is_playground
          ? `“${updated.name}” moved back to the Playground and hidden from the Dashboard.`
          : `“${updated.name}” now appears on the Dashboard.`,
      )
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not update this namespace')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <AppShell
      title="Namespaces"
      subtitle="Every isolated Terraform control plane — create one, then attach your local environment"
      wide
    >
      {error && (
        <p className="mb-4 border border-danger/40 bg-danger/10 px-3 py-2 text-base text-danger">
          {error}
        </p>
      )}
      {note && (
        <p className="mb-4 border border-moss/40 bg-moss/10 px-3 py-2 text-base text-ink">{note}</p>
      )}

      <form onSubmit={createNamespace} className="surface mb-5 space-y-3 px-4 py-4">
        <div className="flex flex-col gap-3 sm:flex-row">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="New namespace name"
            className="field min-w-0 flex-1"
          />
          <button type="submit" disabled={creating || !name.trim()} className="btn-primary shrink-0">
            {creating ? 'Creating…' : 'Create namespace'}
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

      <div className="mb-3 flex flex-wrap items-center gap-3">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter by name or slug"
          className="field max-w-xs"
        />
        <label className="flex items-center gap-2 text-base text-ink-muted">
          <input
            type="checkbox"
            checked={showPlaygrounds}
            onChange={(e) => setShowPlaygrounds(e.target.checked)}
          />
          Include playgrounds ({playgroundCount})
        </label>
        <button
          type="button"
          onClick={() => void load()}
          className="btn-secondary btn-compact ml-auto"
        >
          Refresh
        </button>
      </div>

      {loading ? (
        <p className="surface px-4 py-10 text-center text-lg text-ink-muted">Loading namespaces…</p>
      ) : visible.length === 0 ? (
        <p className="surface border-dashed px-4 py-10 text-center text-lg text-ink-muted">
          No namespaces match. Create one above to get started.
        </p>
      ) : (
        <ul className="surface divide-y-2 divide-line">
          {visible.map((ns) => (
            <li key={ns.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-4">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  {renaming?.id === ns.id ? (
                    <>
                      <input
                        autoFocus
                        value={renaming.value}
                        onChange={(e) => setRenaming({ id: ns.id, value: e.target.value })}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') void saveRename()
                          if (e.key === 'Escape') setRenaming(null)
                        }}
                        className="field max-w-xs py-1"
                      />
                      <button
                        type="button"
                        disabled={busyId === ns.id}
                        onClick={() => void saveRename()}
                        className="btn-primary btn-compact"
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        onClick={() => setRenaming(null)}
                        className="btn-secondary btn-compact"
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <Link
                      to={`/namespaces/${ns.id}`}
                      className="text-lg font-bold text-ink hover:text-ember-deep"
                    >
                      {ns.name}
                    </Link>
                  )}
                  {ns.is_playground && (
                    <span className="rounded border border-ember/50 bg-ember/10 px-1.5 py-0.5 font-mono text-xs font-bold uppercase text-ember-deep">
                      playground
                    </span>
                  )}
                  {ns.has_drift && (
                    <span className="rounded border border-warn/50 bg-warn/10 px-1.5 py-0.5 font-mono text-xs font-bold uppercase text-ink">
                      drift
                    </span>
                  )}
                </div>
                <p className="mt-1 truncate text-base text-ink-muted">
                  {ns.slug} · tf {ns.terraform_version}
                  {ns.has_remote ? ' · remote' : ''} · created {relativeTime(ns.created_at)}
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                <StatusBadge status={ns.status} />
                <button
                  type="button"
                  onClick={() => setRenaming({ id: ns.id, value: ns.name })}
                  className="btn-secondary btn-compact"
                >
                  Rename
                </button>
                <button
                  type="button"
                  disabled={busyId === ns.id}
                  onClick={() => void togglePlayground(ns)}
                  title={
                    ns.is_playground
                      ? 'Track this namespace on the Dashboard'
                      : 'Hide from the Dashboard and treat as scratch space'
                  }
                  className="btn-secondary btn-compact disabled:opacity-60"
                >
                  {busyId === ns.id
                    ? '…'
                    : ns.is_playground
                      ? 'Show on Dashboard'
                      : 'Mark as playground'}
                </button>
                <Link to={`/namespaces/${ns.id}`} className="btn-primary btn-compact">
                  Open
                </Link>
                <button
                  type="button"
                  onClick={() => setPendingDelete(ns)}
                  title="Delete this namespace and everything in it"
                  className="btn-compact border-2 border-danger/50 px-3 text-base font-medium text-danger hover:bg-danger/10"
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {pendingDelete && (
        <ConfirmDialog
          title={`Delete “${pendingDelete.name}”?`}
          busy={deleteBusy}
          requireText={pendingDelete.name}
          confirmLabel="Delete namespace"
          message={
            <>
              <p>
                This permanently removes the namespace, its Terraform files, stored state, run
                history and backend tokens. It cannot be undone.
              </p>
              <p>
                Real infrastructure is <span className="font-bold text-ink">not</span> destroyed —
                run <span className="font-mono text-sm text-ink">terraform destroy</span> first if
                you want the resources gone too, otherwise they keep running untracked.
              </p>
            </>
          }
          onCancel={() => setPendingDelete(null)}
          onConfirm={() => void confirmDelete()}
        />
      )}
    </AppShell>
  )
}
