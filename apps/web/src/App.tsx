import { Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from './auth/AuthContext'
import { AuditLog } from './pages/AuditLog'
import { Dashboard } from './pages/Dashboard'
import { FirstRunSetup } from './pages/FirstRunSetup'
import { Login } from './pages/Login'
import { NamespaceView } from './pages/NamespaceView'
import { Providers } from './pages/Providers'
import { Settings } from './pages/Settings'

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, loading, needsSetup } = useAuth()
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-ink-muted">
        Loading Terraforge…
      </div>
    )
  }
  if (needsSetup) return <Navigate to="/setup" replace />
  if (!user) return <Navigate to="/login" replace />
  return children
}

function RequireAdmin({ children }: { children: React.ReactNode }) {
  const { user } = useAuth()
  if (!user?.is_admin) return <Navigate to="/" replace />
  return children
}

export default function App() {
  return (
    <Routes>
      <Route path="/setup" element={<FirstRunSetup />} />
      <Route path="/login" element={<Login />} />
      <Route
        path="/"
        element={
          <RequireAuth>
            <Dashboard />
          </RequireAuth>
        }
      />
      <Route
        path="/providers"
        element={
          <RequireAuth>
            <Providers />
          </RequireAuth>
        }
      />
      <Route
        path="/settings"
        element={
          <RequireAuth>
            <RequireAdmin>
              <Settings />
            </RequireAdmin>
          </RequireAuth>
        }
      />
      <Route
        path="/audit"
        element={
          <RequireAuth>
            <RequireAdmin>
              <AuditLog />
            </RequireAdmin>
          </RequireAuth>
        }
      />
      <Route
        path="/namespaces/:id"
        element={
          <RequireAuth>
            <NamespaceView />
          </RequireAuth>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
