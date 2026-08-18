import { useEffect, useMemo, useState } from 'react'
import {
  api,
  ApiError,
  type ProviderDetail,
  type ProviderSummary,
} from '../api/client'
import { AppShell } from '../components/AppShell'

function formatDownloads(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

function SnippetCard({
  title,
  code,
}: {
  title: string
  code: string
}) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      // ignore
    }
  }

  return (
    <div className="border border-line bg-panel/90">
      <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2">
        <p className="text-sm font-medium text-ink">{title}</p>
        <button
          type="button"
          onClick={() => void copy()}
          className="btn-secondary btn-compact px-3 text-base"
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="overflow-auto bg-ink p-4 font-mono text-base leading-relaxed text-panel">{code}</pre>
    </div>
  )
}

export function Providers() {
  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')
  const [items, setItems] = useState<ProviderSummary[]>([])
  const [selected, setSelected] = useState<ProviderDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [detailLoading, setDetailLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(query.trim()), 280)
    return () => window.clearTimeout(t)
  }, [query])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      setLoading(true)
      setError('')
      try {
        const res = await api.searchProviders(debounced, 30)
        if (cancelled) return
        setItems(res.providers)
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : 'Failed to load providers')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [debounced])

  async function openProvider(p: ProviderSummary) {
    setDetailLoading(true)
    setError('')
    try {
      const detail = await api.getProvider(p.namespace, p.name)
      setSelected(detail)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load provider')
    } finally {
      setDetailLoading(false)
    }
  }

  const subtitle = useMemo(
    () =>
      debounced
        ? `Results for “${debounced}” from the Terraform Registry`
        : 'Popular providers from the Terraform Registry',
    [debounced],
  )

  return (
    <AppShell title="Providers" subtitle={subtitle} wide>
      <div className="mb-5">
        <label className="block">
          <span className="mb-1.5 block text-base font-bold text-ink">Search providers</span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="aws, hashicorp/random, azurerm…"
            className="field w-full max-w-xl"
            autoFocus
          />
        </label>
      </div>

      {error && (
        <p className="mb-4 text-base font-medium text-danger" role="alert">
          {error}
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <section className="min-w-0">
          {loading ? (
            <p className="text-sm text-ink-muted">Searching registry…</p>
          ) : items.length === 0 ? (
            <p className="text-sm text-ink-muted">No providers matched.</p>
          ) : (
            <ul className="divide-y divide-line border border-line bg-panel/80">
              {items.map((p) => {
                const active =
                  selected?.provider.namespace === p.namespace &&
                  selected?.provider.name === p.name
                return (
                  <li key={`${p.namespace}/${p.name}`}>
                    <button
                      type="button"
                      onClick={() => void openProvider(p)}
                      className={`flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-paper-deep/70 ${
                        active ? 'bg-paper-deep/90' : ''
                      }`}
                    >
                      {p.logo_url ? (
                        <img
                          src={p.logo_url}
                          alt=""
                          className="mt-0.5 size-8 object-contain"
                          loading="lazy"
                        />
                      ) : (
                        <span className="mt-0.5 flex size-8 items-center justify-center bg-paper-deep text-xs font-bold text-ink-muted">
                          {p.name.slice(0, 2).toUpperCase()}
                        </span>
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium text-ink">{p.full_name}</span>
                        <span className="mt-0.5 block text-xs text-ink-muted">
                          {p.version ? `v${p.version}` : 'latest'}
                          {p.tier ? ` · ${p.tier}` : ''}
                          {` · ${formatDownloads(p.downloads)} downloads`}
                        </span>
                        {p.description && (
                          <span className="mt-1 line-clamp-2 block text-xs text-ink-muted">
                            {p.description}
                          </span>
                        )}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </section>

        <section className="min-w-0 space-y-4">
          {detailLoading && <p className="text-sm text-ink-muted">Loading snippets…</p>}
          {!detailLoading && !selected && (
            <p className="border border-dashed border-line bg-panel/50 px-4 py-10 text-center text-sm text-ink-muted">
              Select a provider to view copyable Terraform snippets.
            </p>
          )}
          {selected && !detailLoading && (
            <>
              <div className="border border-line bg-panel/90 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-display text-xl font-bold text-ink">
                      {selected.provider.full_name}
                    </p>
                    <p className="mt-1 text-sm text-ink-muted">
                      {selected.provider.version
                        ? `Latest ${selected.provider.version}`
                        : 'Latest version'}
                      {selected.provider.tier ? ` · ${selected.provider.tier}` : ''}
                    </p>
                    {selected.provider.description && (
                      <p className="mt-2 text-sm text-ink-muted">{selected.provider.description}</p>
                    )}
                  </div>
                  <a
                    href={selected.docs_url}
                    target="_blank"
                    rel="noreferrer"
                    className="border border-line bg-paper px-3 py-1.5 text-sm hover:bg-paper-deep"
                  >
                    Registry docs ↗
                  </a>
                </div>
              </div>

              <SnippetCard title="required_providers" code={selected.snippets.required_providers} />
              <SnippetCard title="provider block" code={selected.snippets.provider_block} />
              <SnippetCard title="combined" code={selected.snippets.combined} />
            </>
          )}
        </section>
      </div>
    </AppShell>
  )
}
