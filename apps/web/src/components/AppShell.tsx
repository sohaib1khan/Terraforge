import { NavLink, useParams } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { useAuth } from '../auth/AuthContext'
import { ConnectLocalGuide } from './ConnectLocalGuide'
import { GitHubLink } from './GitHubLink'

const linkClass = ({ isActive }: { isActive: boolean }) =>
  `nav-link ${isActive ? 'nav-link-active' : ''}`

export function AppShell({
  children,
  title,
  subtitle,
  wide = false,
}: {
  children: React.ReactNode
  title?: string
  subtitle?: string
  wide?: boolean
}) {
  const { user, logout } = useAuth()
  const { id: routeNamespaceId } = useParams<{ id?: string }>()
  const [guideOpen, setGuideOpen] = useState(false)

  useEffect(() => {
    const open = () => setGuideOpen(true)
    window.addEventListener('terraforge:open-connect-guide', open)
    return () => window.removeEventListener('terraforge:open-connect-guide', open)
  }, [])

  return (
    <div className="app-frame">
      <a href="#main-content" className="skip-link">
        Skip to content
      </a>

      <aside className="app-sidebar" aria-label="Primary">
        <div className="sidebar-brand">
          <p className="sidebar-brand-title">Terraforge</p>
          <p className="sidebar-brand-sub">Control plane</p>
        </div>

        <nav className="sidebar-nav" aria-label="App">
          <NavLink to="/" end className={linkClass}>
            Dashboard
          </NavLink>
          <NavLink to="/templates" className={linkClass}>
            Templates
          </NavLink>
          <NavLink to="/providers" className={linkClass}>
            Providers
          </NavLink>
          <NavLink to="/docs" className={linkClass}>
            Documentation
          </NavLink>
          {user?.is_admin && (
            <>
              <NavLink to="/audit" className={linkClass}>
                Audit log
              </NavLink>
              <NavLink to="/settings" className={linkClass}>
                Settings
              </NavLink>
            </>
          )}
        </nav>

        <div className="sidebar-foot">
          <button type="button" onClick={() => setGuideOpen(true)} className="sidebar-foot-btn">
            Connect local Terraform
          </button>
          <p className="sidebar-foot-hint">HTTP backend or companion CLI</p>
          <div className="mt-4">
            <GitHubLink tone="onDark" />
          </div>
          <div className="mt-5 border-t border-white/10 pt-4">
            <p className="sidebar-user-email" title={user?.email}>
              {user?.email}
            </p>
            <button
              type="button"
              onClick={logout}
              className="btn-sidebar btn-compact mt-2 w-full px-3 text-base"
            >
              Sign out
            </button>
          </div>
        </div>
      </aside>

      <main id="main-content" className="app-main" tabIndex={-1}>
        <div className={wide ? 'app-content app-content-wide' : 'app-content'}>
          {(title || subtitle) && (
            <header className="mb-6 border-b-2 border-line pb-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  {title && (
                    <h1 className="font-display text-3xl font-bold tracking-tight text-ink sm:text-4xl">
                      {title}
                    </h1>
                  )}
                  {subtitle && <p className="mt-2 text-lg text-ink-muted">{subtitle}</p>}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setGuideOpen(true)}
                    className="btn-secondary btn-compact shrink-0 px-3 text-base lg:hidden"
                  >
                    Connect local TF
                  </button>
                </div>
              </div>
            </header>
          )}
          {children}
        </div>
      </main>

      {/* Mobile: account strip when page has no AppShell title header */}
      <div className="sidebar-mobile-account lg:hidden">
        <p className="truncate text-sm text-[#c4b6e0]" title={user?.email}>
          {user?.email}
        </p>
        <button type="button" onClick={logout} className="btn-sidebar btn-compact px-3 text-sm">
          Sign out
        </button>
      </div>

      <ConnectLocalGuide
        open={guideOpen}
        onClose={() => setGuideOpen(false)}
        namespaceId={routeNamespaceId}
        namespaceName={title}
      />
    </div>
  )
}
