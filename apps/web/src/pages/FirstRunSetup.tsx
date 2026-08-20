import { useState, type FormEvent } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { ApiError } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { GitHubLink } from '../components/GitHubLink'

export function FirstRunSetup() {
  const { user, loading, needsSetup, setup } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  if (loading) {
    return (
      <div className="flex min-h-dvh items-center justify-center text-lg text-ink-muted">
        Loading Terraforge…
      </div>
    )
  }
  if (user) return <Navigate to="/" replace />
  // Admin already exists — setup is closed.
  if (!needsSetup) return <Navigate to="/login" replace />

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      await setup(email, password)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Setup failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <p className="sidebar-brand-title text-4xl sm:text-5xl">Terraforge</p>
        <p className="mt-3 text-lg text-[#c4b6e0]">
          Create the first admin account to unlock the control plane.
        </p>

        <form onSubmit={onSubmit} className="surface mt-8 space-y-5 p-6">
          <label className="block">
            <span className="mb-2 block text-base font-bold text-ink">Admin email</span>
            <input
              type="email"
              required
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="field"
            />
          </label>
          <label className="block">
            <span className="mb-2 block text-base font-bold text-ink">Password</span>
            <input
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="field"
            />
            <span className="mt-2 block text-base text-ink-muted">At least 8 characters.</span>
          </label>
          {error && (
            <p className="text-base font-medium text-danger" role="alert">
              {error}
            </p>
          )}
          <button type="submit" disabled={busy} className="btn-primary w-full text-lg">
            {busy ? 'Creating…' : 'Create admin'}
          </button>
        </form>

        <p className="mt-6 text-base text-[#c4b6e0]">
          Already set up?{' '}
          <Link className="font-bold text-[#b8f0d4]" to="/login">
            Sign in
          </Link>
        </p>

        <div className="mt-8 flex justify-center">
          <GitHubLink tone="onDark" />
        </div>
      </div>
    </div>
  )
}
