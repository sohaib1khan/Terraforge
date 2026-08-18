import { useEffect, useState, type FormEvent } from 'react'
import { Navigate } from 'react-router-dom'
import { api, ApiError, type User } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { AppShell } from '../components/AppShell'

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
          {error && <p className="text-sm text-danger">{error}</p>}
          {success && <p className="text-sm text-ok">{success}</p>}
          <button
            type="submit"
            disabled={busy}
            className="bg-moss-deep px-5 py-2.5 font-medium text-paper hover:bg-moss disabled:opacity-60"
          >
            {busy ? 'Creating…' : 'Create user'}
          </button>
        </form>
      </section>

      <section className="mt-10">
        <h2 className="font-display text-xl font-bold text-ink">Users</h2>
        {loading ? (
          <p className="mt-4 text-ink-muted">Loading…</p>
        ) : (
          <ul className="mt-4 max-w-2xl divide-y-2 divide-line border-2 border-line bg-panel/80">
            {users.map((u) => (
              <li key={u.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div>
                  <p className="text-lg font-bold text-ink">{u.email}</p>
                  <p className="text-base text-ink-muted">
                    joined {new Date(u.created_at).toLocaleString()}
                    {u.disabled_at ? ' · disabled' : ''}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`text-base font-bold ${u.is_admin ? 'text-ember-deep' : 'text-ink-muted'}`}
                  >
                    {u.is_admin ? 'admin' : 'user'}
                  </span>
                  <button
                    type="button"
                    className="btn-secondary btn-compact px-3 text-base"
                    onClick={() => {
                      const next = prompt(`New password for ${u.email} (min 8 chars)`)
                      if (!next) return
                      void (async () => {
                        try {
                          await api.resetUserPassword(u.id, next)
                          setSuccess(`Password reset for ${u.email}`)
                          setError('')
                        } catch (err) {
                          setError(err instanceof ApiError ? err.message : 'Reset failed')
                        }
                      })()
                    }}
                  >
                    Reset password
                  </button>
                  {u.disabled_at ? (
                    <button
                      type="button"
                      className="btn-secondary btn-compact px-3 text-base"
                      onClick={() => {
                        void (async () => {
                          try {
                            const updated = await api.enableUser(u.id)
                            setUsers((prev) => prev.map((x) => (x.id === u.id ? updated : x)))
                          } catch (err) {
                            setError(err instanceof ApiError ? err.message : 'Enable failed')
                          }
                        })()
                      }}
                    >
                      Enable
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="btn-compact border-2 border-danger px-3 text-base font-bold text-danger"
                      disabled={u.id === user?.id}
                      onClick={() => {
                        if (!confirm(`Disable ${u.email}?`)) return
                        void (async () => {
                          try {
                            const updated = await api.disableUser(u.id)
                            setUsers((prev) => prev.map((x) => (x.id === u.id ? updated : x)))
                          } catch (err) {
                            setError(err instanceof ApiError ? err.message : 'Disable failed')
                          }
                        })()
                      }}
                    >
                      Disable
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </AppShell>
  )
}
