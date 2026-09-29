import { useEffect, useState, type FormEvent } from 'react'
import { Navigate } from 'react-router-dom'
import { api, ApiError, type User } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { AppShell } from '../components/AppShell'
import { ConfirmDialog } from '../components/ConfirmDialog'

export function Settings() {
  const { user } = useAuth()
  const [users, setUsers] = useState<User[]>([])
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isAdmin, setIsAdmin] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)

  const [editing, setEditing] = useState<User | null>(null)
  const [editEmail, setEditEmail] = useState('')
  const [editIsAdmin, setEditIsAdmin] = useState(false)
  const [editBusy, setEditBusy] = useState(false)

  const [resetTarget, setResetTarget] = useState<User | null>(null)
  const [resetPassword, setResetPassword] = useState('')
  const [resetBusy, setResetBusy] = useState(false)

  const [pendingDelete, setPendingDelete] = useState<User | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)

  useEffect(() => {
    if (!user?.is_admin) return
    void (async () => {
      setLoading(true)
      setError('')
      try {
        const res = await api.listUsers()
        setUsers(res.users)
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Failed to load users')
      } finally {
        setLoading(false)
      }
    })()
  }, [user?.is_admin])

  if (user && !user.is_admin) {
    return <Navigate to="/" replace />
  }

  async function onCreate(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    setSuccess('')
    try {
      const created = await api.createUser({
        email: email.trim(),
        password,
        is_admin: isAdmin,
      })
      setUsers((prev) => [...prev, created])
      setEmail('')
      setPassword('')
      setIsAdmin(false)
      setSuccess(`Created ${created.email}`)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create user')
    } finally {
      setBusy(false)
    }
  }

  function startEdit(u: User) {
    setEditing(u)
    setEditEmail(u.email)
    setEditIsAdmin(u.is_admin)
    setError('')
    setSuccess('')
  }

  async function saveEdit(e: FormEvent) {
    e.preventDefault()
    if (!editing) return
    setEditBusy(true)
    setError('')
    setSuccess('')
    try {
      const patch: { email?: string; is_admin?: boolean } = {}
      const nextEmail = editEmail.trim()
      if (nextEmail !== editing.email) patch.email = nextEmail
      if (editIsAdmin !== editing.is_admin) patch.is_admin = editIsAdmin
      if (!patch.email && patch.is_admin === undefined) {
        setEditing(null)
        return
      }
      const updated = await api.updateUser(editing.id, patch)
      setUsers((prev) => prev.map((x) => (x.id === updated.id ? updated : x)))
      setSuccess(`Updated ${updated.email}`)
      setEditing(null)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to update user')
    } finally {
      setEditBusy(false)
    }
  }

  async function savePassword(e: FormEvent) {
    e.preventDefault()
    if (!resetTarget) return
    setResetBusy(true)
    setError('')
    setSuccess('')
    try {
      await api.resetUserPassword(resetTarget.id, resetPassword)
      setSuccess(`Password reset for ${resetTarget.email}`)
      setResetTarget(null)
      setResetPassword('')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Reset failed')
    } finally {
      setResetBusy(false)
    }
  }

  async function confirmDelete() {
    if (!pendingDelete) return
    setDeleteBusy(true)
    setError('')
    setSuccess('')
    try {
      await api.deleteUser(pendingDelete.id)
      setUsers((prev) => prev.filter((x) => x.id !== pendingDelete.id))
      setSuccess(`Deleted ${pendingDelete.email}`)
      setPendingDelete(null)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Delete failed')
    } finally {
      setDeleteBusy(false)
    }
  }

  async function toggleDisabled(u: User) {
    setError('')
    setSuccess('')
    try {
      const updated = u.disabled_at ? await api.enableUser(u.id) : await api.disableUser(u.id)
      setUsers((prev) => prev.map((x) => (x.id === updated.id ? updated : x)))
      setSuccess(updated.disabled_at ? `Disabled ${updated.email}` : `Enabled ${updated.email}`)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Update failed')
    }
  }

  return (
    <AppShell title="Settings" subtitle="Admin user management">
      <section>
        <h2 className="font-display text-xl font-bold text-ink">Create user</h2>
        <p className="mt-1 text-sm text-ink-muted">
          New accounts can sign in immediately with the password you set.
        </p>

        <form
          onSubmit={onCreate}
          className="mt-5 max-w-lg space-y-4 border border-line bg-panel/90 p-5"
        >
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-ink-muted">Email</span>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full border border-line bg-paper px-3 py-2.5 outline-none ring-ember/30 focus:ring-2"
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-ink-muted">Password</span>
            <input
              type="password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full border border-line bg-paper px-3 py-2.5 outline-none ring-ember/30 focus:ring-2"
            />
          </label>
          <label className="flex items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              checked={isAdmin}
              onChange={(e) => setIsAdmin(e.target.checked)}
              className="size-4 accent-moss-deep"
            />
            Grant admin access
          </label>
          <button
            type="submit"
            disabled={busy}
            className="bg-moss-deep px-5 py-2.5 font-medium text-paper hover:bg-moss disabled:opacity-60"
          >
            {busy ? 'Creating…' : 'Create user'}
          </button>
        </form>
      </section>

      {(error || success) && (
        <p
          className={`mt-5 max-w-4xl border px-3 py-2 text-sm ${
            error
              ? 'border-danger/40 bg-danger/10 text-danger'
              : 'border-moss/40 bg-moss/10 text-ink'
          }`}
          role={error ? 'alert' : 'status'}
        >
          {error || success}
        </p>
      )}

      <section className="mt-10">
        <h2 className="font-display text-xl font-bold text-ink">Users</h2>
        {loading ? (
          <p className="mt-4 text-ink-muted">Loading…</p>
        ) : (
          <ul className="mt-4 max-w-4xl divide-y-2 divide-line border-2 border-line bg-panel/80">
            {users.map((u) => (
              <li
                key={u.id}
                className="grid grid-cols-1 gap-3 px-4 py-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-center"
              >
                <div className="min-w-0">
                  <p className="truncate text-lg font-bold text-ink">
                    {u.email}
                    {u.id === user?.id ? (
                      <span className="ml-2 text-sm font-medium text-ink-muted">(you)</span>
                    ) : null}
                  </p>
                  <p className="mt-0.5 text-sm text-ink-muted">
                    joined {new Date(u.created_at).toLocaleString()}
                    {u.disabled_at ? ' · disabled' : ''}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2 md:justify-end">
                  <span
                    className={`inline-flex min-w-[4.5rem] justify-center rounded border px-2 py-1 text-xs font-bold uppercase tracking-wide ${
                      u.is_admin
                        ? 'border-ember/50 bg-ember/10 text-ember-deep'
                        : 'border-line/70 bg-paper text-ink-muted'
                    }`}
                  >
                    {u.is_admin ? 'admin' : 'user'}
                  </span>
                  <button
                    type="button"
                    className="btn-secondary btn-compact px-3 text-sm"
                    onClick={() => startEdit(u)}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className="btn-secondary btn-compact px-3 text-sm"
                    onClick={() => {
                      setResetTarget(u)
                      setResetPassword('')
                      setError('')
                      setSuccess('')
                    }}
                  >
                    Reset password
                  </button>
                  {u.disabled_at ? (
                    <button
                      type="button"
                      className="btn-secondary btn-compact px-3 text-sm"
                      onClick={() => void toggleDisabled(u)}
                    >
                      Enable
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="btn-compact border-2 border-danger px-3 text-sm font-bold text-danger disabled:opacity-50"
                      disabled={u.id === user?.id}
                      onClick={() => void toggleDisabled(u)}
                    >
                      Disable
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn-compact border-2 border-danger px-3 text-sm font-bold text-danger hover:bg-danger/10 disabled:opacity-50"
                    disabled={u.id === user?.id}
                    onClick={() => setPendingDelete(u)}
                  >
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {editing && (
        <div
          className="fixed inset-0 z-[90] flex items-end justify-center bg-[#2a3846]/45 p-3 sm:items-center sm:p-6"
          role="presentation"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget && !editBusy) setEditing(null)
          }}
        >
          <form
            role="dialog"
            aria-modal="true"
            aria-label="Edit user"
            onSubmit={saveEdit}
            className="w-full max-w-lg space-y-4 border-2 border-line bg-panel p-4 shadow-xl"
          >
            <h2 className="font-display text-lg font-bold text-ink">Edit user</h2>
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-ink-muted">Email</span>
              <input
                type="email"
                required
                autoFocus
                value={editEmail}
                onChange={(e) => setEditEmail(e.target.value)}
                className="w-full border border-line bg-paper px-3 py-2.5 outline-none ring-ember/30 focus:ring-2"
              />
            </label>
            <label className="flex items-center gap-2 text-sm text-ink">
              <input
                type="checkbox"
                checked={editIsAdmin}
                disabled={editing.id === user?.id}
                onChange={(e) => setEditIsAdmin(e.target.checked)}
                className="size-4 accent-moss-deep disabled:opacity-50"
              />
              Admin access
              {editing.id === user?.id ? (
                <span className="text-ink-muted">(you can’t remove your own admin access)</span>
              ) : null}
            </label>
            <div className="flex flex-wrap justify-end gap-2">
              <button
                type="button"
                disabled={editBusy}
                onClick={() => setEditing(null)}
                className="btn-secondary"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={editBusy}
                className="bg-moss-deep px-4 py-2 text-base font-medium text-paper hover:bg-moss disabled:opacity-60"
              >
                {editBusy ? 'Saving…' : 'Save'}
              </button>
            </div>
          </form>
        </div>
      )}

      {resetTarget && (
        <div
          className="fixed inset-0 z-[90] flex items-end justify-center bg-[#2a3846]/45 p-3 sm:items-center sm:p-6"
          role="presentation"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget && !resetBusy) setResetTarget(null)
          }}
        >
          <form
            role="dialog"
            aria-modal="true"
            aria-label="Reset password"
            onSubmit={savePassword}
            className="w-full max-w-lg space-y-4 border-2 border-line bg-panel p-4 shadow-xl"
          >
            <h2 className="font-display text-lg font-bold text-ink">
              Reset password for {resetTarget.email}
            </h2>
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-ink-muted">New password</span>
              <input
                type="password"
                required
                minLength={8}
                autoFocus
                value={resetPassword}
                onChange={(e) => setResetPassword(e.target.value)}
                className="w-full border border-line bg-paper px-3 py-2.5 outline-none ring-ember/30 focus:ring-2"
              />
            </label>
            <div className="flex flex-wrap justify-end gap-2">
              <button
                type="button"
                disabled={resetBusy}
                onClick={() => setResetTarget(null)}
                className="btn-secondary"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={resetBusy || resetPassword.length < 8}
                className="bg-moss-deep px-4 py-2 text-base font-medium text-paper hover:bg-moss disabled:opacity-60"
              >
                {resetBusy ? 'Saving…' : 'Set password'}
              </button>
            </div>
          </form>
        </div>
      )}

      {pendingDelete && (
        <ConfirmDialog
          title={`Delete “${pendingDelete.email}”?`}
          busy={deleteBusy}
          requireText={pendingDelete.email}
          confirmLabel="Delete user"
          message={
            <>
              <p>
                This permanently removes the account. Namespace memberships and playground templates
                owned by this user are also removed. Runs they triggered keep their history.
              </p>
              <p>They will no longer be able to sign in.</p>
            </>
          }
          onCancel={() => setPendingDelete(null)}
          onConfirm={() => void confirmDelete()}
        />
      )}
    </AppShell>
  )
}
