import { useEffect, useMemo, useState } from 'react'
import {
  api,
  ApiError,
  type ModuleDetail,
  type ModuleExample,
  type ModuleSummary,
} from '../api/client'
import { AppShell } from '../components/AppShell'

function formatDownloads(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

function SnippetCard({ title, code }: { title: string; code: string }) {
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
        <button type="button" onClick={() => void copy()} className="btn-secondary btn-compact px-3 text-base">
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="overflow-auto bg-ink p-4 font-mono text-base leading-relaxed text-panel">{code}</pre>
    </div>
  )
}

function ExamplePanel({ example }: { example: ModuleExample }) {
  const [openReadme, setOpenReadme] = useState(false)

  return (
    <div className="border border-line bg-panel/90">
      <div className="border-b border-line px-4 py-3">
        <p className="font-medium text-ink">{example.name}</p>
        <p className="mt-0.5 font-mono text-xs text-ink-muted">{example.path}</p>
        <p className="mt-1 text-xs text-ink-muted">
          {example.resource_count > 0 ? `${example.resource_count} resources` : 'example'}
          {example.inputs && example.inputs.length > 0 ? ` · ${example.inputs.length} inputs` : ''}
        </p>
      </div>
      <div className="space-y-3 p-3">
        <SnippetCard title="module block (this example)" code={example.snippet} />
        {example.readme && (
          <div>
            <button
              type="button"
              onClick={() => setOpenReadme((v) => !v)}
              className="text-sm font-bold text-ember-deep hover:underline"
            >
              {openReadme ? 'Hide example readme' : 'Show example readme'}
            </button>
            {openReadme && (
              <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap border border-line bg-paper/80 p-3 font-mono text-xs leading-relaxed text-ink">
                {example.readme}
              </pre>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export function Documentation() {
  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')
  const [items, setItems] = useState<ModuleSummary[]>([])
  const [selected, setSelected] = useState<ModuleDetail | null>(null)
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
        const res = await api.searchModules(debounced, 30)
        if (cancelled) return
        setItems(res.modules)
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : 'Failed to load modules')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [debounced])

  async function openModule(m: ModuleSummary) {
    setDetailLoading(true)
    setError('')
    try {
      const detail = await api.getModule(m.namespace, m.name, m.provider)
      setSelected(detail)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load module')
    } finally {
      setDetailLoading(false)
    }
  }

  const subtitle = useMemo(
    () =>
      debounced
        ? `Module results for “${debounced}” — examples from the Terraform Registry`
        : 'Popular modules and every published example from the Terraform Registry',
    [debounced],
  )

  return (
    <AppShell title="Documentation" subtitle={subtitle} wide>
      <div className="mb-5">
        <label className="block">
          <span className="mb-1.5 block text-base font-bold text-ink">Search modules</span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="vpc, terraform-aws-modules/vpc/aws, eks…"
            className="field w-full max-w-xl"
            autoFocus
          />
        </label>
        <p className="mt-2 text-sm text-ink-muted">
          Select a module to load its registry docs snippet and every example folder the publisher
          registered.
        </p>
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
            <p className="text-sm text-ink-muted">No modules matched.</p>
          ) : (
            <ul className="divide-y divide-line border border-line bg-panel/80">
              {items.map((m) => {
                const active =
                  selected?.module.namespace === m.namespace &&
                  selected?.module.name === m.name &&
                  selected?.module.provider === m.provider
                return (
                  <li key={m.full_name}>
                    <button
                      type="button"
                      onClick={() => void openModule(m)}
                      className={`flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-paper-deep/70 ${
                        active ? 'bg-paper-deep/90' : ''
                      }`}
                    >
                      {m.logo_url ? (
                        <img
                          src={m.logo_url}
                          alt=""
                          className="mt-0.5 size-8 object-contain"
                          loading="lazy"
                        />
                      ) : (
                        <span className="mt-0.5 flex size-8 items-center justify-center bg-paper-deep text-xs font-bold text-ink-muted">
                          {m.provider.slice(0, 2).toUpperCase()}
                        </span>
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium text-ink">{m.full_name}</span>
                        <span className="mt-0.5 block text-xs text-ink-muted">
                          {m.version ? `v${m.version}` : 'latest'}
                          {m.verified ? ' · verified' : ''}
                          {` · ${formatDownloads(m.downloads)} downloads`}
                        </span>
                        {m.description && (
                          <span className="mt-1 line-clamp-2 block text-xs text-ink-muted">
                            {m.description}
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
          {detailLoading && <p className="text-sm text-ink-muted">Loading examples…</p>}
          {!detailLoading && !selected && (
            <p className="border border-dashed border-line bg-panel/50 px-4 py-10 text-center text-sm text-ink-muted">
              Select a module to view its usage snippet and every registry example.
            </p>
          )}
          {selected && !detailLoading && (
            <>
              <div className="border border-line bg-panel/90 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-display text-xl font-bold text-ink">
                      {selected.module.full_name}
                    </p>
                    <p className="mt-1 text-sm text-ink-muted">
                      {selected.module.version
                        ? `Latest ${selected.module.version}`
                        : 'Latest version'}
                      {selected.module.verified ? ' · verified' : ''}
                      {` · ${selected.example_count} example${selected.example_count === 1 ? '' : 's'}`}
                    </p>
                    {selected.module.description && (
                      <p className="mt-2 text-sm text-ink-muted">{selected.module.description}</p>
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

              <SnippetCard title="module block (root)" code={selected.snippet} />

              <div>
                <h2 className="mb-3 font-display text-xl font-bold text-ink">
                  Examples ({selected.example_count})
                </h2>
                {selected.examples.length === 0 ? (
                  <p className="border border-dashed border-line bg-panel/50 px-4 py-6 text-sm text-ink-muted">
                    This module has no registered examples in the Terraform Registry.
                  </p>
                ) : (
                  <div className="space-y-4">
                    {selected.examples.map((ex) => (
                      <ExamplePanel key={ex.path || ex.name} example={ex} />
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </section>
      </div>
    </AppShell>
  )
}
