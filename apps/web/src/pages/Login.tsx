import { useState, type FormEvent } from 'react'
import { Navigate } from 'react-router-dom'
import { ApiError } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { GitHubLink } from '../components/GitHubLink'

export function Login() {
  const { user, loading, needsSetup, login } = useAuth()
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
  // Fresh install: send people to setup — do not show a setup tease on the login form.
  if (needsSetup) return <Navigate to="/setup" replace />
  if (user) return <Navigate to="/" replace />

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      await login(email, password)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Login failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <p className="sidebar-brand-title text-4xl sm:text-5xl">Terraforge</p>
        <p className="mt-3 text-lg text-[#c4b6e0]">
          Sign in to manage namespaces and Terraform runs.
        </p>

        <form onSubmit={onSubmit} className="surface mt-8 space-y-5 p-6">
          <label className="block">
            <span className="mb-2 block text-base font-bold text-ink">Email</span>
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
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="field"
            />
          </label>
          {error && (
            <p className="text-base font-medium text-danger" role="alert">
              {error}
            </p>
          )}
          <button type="submit" disabled={busy} className="btn-primary w-full text-lg">
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <div className="mt-8 flex justify-center">
          <GitHubLink tone="onDark" />
        </div>
      </div>
    </div>
  )
}
