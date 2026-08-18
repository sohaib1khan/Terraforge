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
        <div className="flex items-start justify-between gap-3 px-4 py-4 lg:block">
          <div>
            <p className="font-display text-2xl font-bold tracking-tight text-ink">Terraforge</p>
            <p className="mt-1 text-base text-ink-muted">Control plane</p>
          </div>
          <div className="shrink-0 text-right lg:mt-5 lg:text-left">
            <p className="max-w-[12rem] truncate text-base text-ink-muted" title={user?.email}>
              {user?.email}
            </p>
            <button type="button" onClick={logout} className="btn-secondary btn-compact mt-2 px-3 text-base">
              Sign out
            </button>
          </div>
        </div>

        <nav
          className="flex gap-1 overflow-x-auto px-2 pb-3 lg:flex-1 lg:flex-col lg:gap-1 lg:overflow-visible lg:px-2 lg:pb-6"
          aria-label="App"
        >
          <NavLink to="/" end className={linkClass}>
            Namespaces
          </NavLink>
          <NavLink to="/providers" className={linkClass}>
            Providers
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

        <div className="mt-auto hidden border-t-2 border-line/50 px-3 py-4 lg:block">
          <button
            type="button"
            onClick={() => setGuideOpen(true)}
            className="w-full text-left text-base font-bold text-ember-deep hover:underline"
          >
            Connect local Terraform
          </button>
          <p className="mt-1 text-sm text-ink-muted">HTTP backend or companion CLI</p>
          <div className="mt-4">
            <GitHubLink />
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
                <button
                  type="button"
                  onClick={() => setGuideOpen(true)}
                  className="btn-secondary btn-compact shrink-0 px-3 text-base lg:hidden"
                >
                  Connect local TF
                </button>
              </div>
            </header>
          )}
          {children}
        </div>
      </main>

      <ConnectLocalGuide
        open={guideOpen}
        onClose={() => setGuideOpen(false)}
        namespaceId={routeNamespaceId}
        namespaceName={title}
      />
    </div>
  )
}
