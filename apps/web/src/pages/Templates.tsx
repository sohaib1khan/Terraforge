import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, ApiError, type Namespace } from '../api/client'
import { AppShell } from '../components/AppShell'
import { EnvIcon } from '../components/EnvironmentPanel/envVisuals'
import {
  nextTemplate,
  previousTemplate,
  TF_TEMPLATES,
  TRACK_META,
  templateFilesMap,
  templatesForTrack,
  type TemplateTrack,
  type TfTemplate,
} from '../lib/templates'

const LEVEL_LABEL: Record<TfTemplate['level'], string> = {
  'start-here': 'Start here',
  beginner: 'Beginner',
  'next-step': 'Next step',
}

const CLOUD_PROVIDER: Record<TfTemplate['cloud'], string> = {
  local: 'local',
  aws: 'aws',
  azure: 'azurerm',
  google: 'google',
  docker: 'docker',
  virtualbox: 'virtualbox',
  qemu: 'qemu',
  multi: 'local',
}

const FILTERS: Array<{ id: 'all' | TemplateTrack; label: string }> = [
  { id: 'all', label: 'All tracks' },
  { id: 'foundation', label: TRACK_META.foundation.label },
  { id: 'language', label: TRACK_META.language.label },
  { id: 'docker', label: TRACK_META.docker.label },
  { id: 'virtualbox', label: TRACK_META.virtualbox.label },
  { id: 'qemu', label: TRACK_META.qemu.label },
  { id: 'cloud', label: TRACK_META.cloud.label },
]

function FilePreview({ path, content }: { path: string; content: string }) {
  const [copied, setCopied] = useState(false)
  async function copy() {
    try {
      await navigator.clipboard.writeText(content)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      /* ignore */
    }
  }
  return (
    <div className="border border-line bg-panel/90">
      <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2">
        <p className="font-mono text-sm font-medium text-ink">{path}</p>
        <button type="button" onClick={() => void copy()} className="btn-secondary btn-compact px-3 text-base">
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="max-h-72 overflow-auto bg-ink p-4 font-mono text-sm leading-relaxed text-panel">
        {content}
      </pre>
    </div>
  )
}

export function Templates() {
  const navigate = useNavigate()
  const [filter, setFilter] = useState<'all' | TemplateTrack>('all')
  const [selectedId, setSelectedId] = useState(TF_TEMPLATES[0]?.id ?? '')
  const [namespaces, setNamespaces] = useState<Namespace[]>([])
  const [targetId, setTargetId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [note, setNote] = useState('')
  const [loadedNs, setLoadedNs] = useState(false)

  const list = useMemo(() => templatesForTrack(filter), [filter])

  const selected = useMemo(() => {
    const fromList = list.find((t) => t.id === selectedId)
    if (fromList) return fromList
    return list[0] ?? TF_TEMPLATES[0]
  }, [list, selectedId])

  const prev = selected ? previousTemplate(selected) : undefined
  const next = selected ? nextTemplate(selected) : undefined
  const trackMeta = selected ? TRACK_META[selected.track] : null
  const trackLen = selected
    ? TF_TEMPLATES.filter((t) => t.track === selected.track).length
    : 0

  async function ensureNamespaces() {
    if (loadedNs) return
    try {
      const res = await api.listNamespaces()
      setNamespaces(res.namespaces)
      if (res.namespaces[0]) setTargetId(res.namespaces[0].id)
      setLoadedNs(true)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load namespaces')
    }
  }

  async function useInNewNamespace() {
    if (!selected) return
    setBusy(true)
    setError('')
    setNote('')
    try {
      const ns = await api.createNamespace({ name: selected.title })
      await api.importFiles(ns.id, templateFilesMap(selected), `Seed template: ${selected.id}`)
      setNote(`Created “${ns.name}” and loaded the template.`)
      navigate(`/namespaces/${ns.id}`)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create namespace from template')
    } finally {
      setBusy(false)
    }
  }

  async function useInExisting() {
    if (!selected || !targetId) return
    if (
      !confirm(
        `Import “${selected.title}” into this namespace?\n\nExisting files with the same paths will be overwritten.`,
      )
    ) {
      return
    }
    setBusy(true)
    setError('')
    setNote('')
    try {
      await api.importFiles(targetId, templateFilesMap(selected), `Import template: ${selected.id}`)
      setNote('Template imported.')
      navigate(`/namespaces/${targetId}`)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to import template')
    } finally {
      setBusy(false)
    }
  }

  async function copyAll() {
    if (!selected) return
    const blob = selected.files.map((f) => `// ===== ${f.path} =====\n${f.content}`).join('\n\n')
    try {
      await navigator.clipboard.writeText(blob)
      setNote('All template files copied to clipboard.')
    } catch {
      setError('Clipboard copy failed')
    }
  }

  return (
    <AppShell
      title="Templates"
      subtitle="Learning tracks that build on each other — local first, then Docker, VirtualBox, QEMU/libvirt, then tiny cloud starters"
      wide
    >
      <p className="mb-4 text-sm text-ink-muted">
        Providers come from the public Terraform Registry (kreuzwerker/docker, terra-farm/virtualbox,
        dmacvicar/libvirt, HashiCorp local/aws/…). Lessons are intentionally small — not production
        blueprints.
      </p>

      <div className="mb-5 flex flex-wrap gap-2" role="group" aria-label="Filter by learning track">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => {
              setFilter(f.id)
              const first = templatesForTrack(f.id)[0]
              if (first) setSelectedId(first.id)
            }}
            className={`border px-3 py-1.5 text-sm font-bold transition-colors ${
              filter === f.id
                ? 'border-ember-deep bg-ember-deep text-panel'
                : 'border-line bg-panel/80 text-ink hover:bg-paper-deep'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {filter !== 'all' && (
        <p className="mb-4 text-sm text-ink-muted">{TRACK_META[filter].blurb}</p>
      )}

      {error && (
        <p className="mb-4 text-base font-medium text-danger" role="alert">
          {error}
        </p>
      )}
      {note && (
        <p className="mb-4 text-base font-medium text-ok" role="status">
          {note}
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.25fr)]">
        <section className="min-w-0">
          <ul className="max-h-[70vh] divide-y divide-line overflow-y-auto border-2 border-line bg-panel/90">
            {list.map((t) => {
              const active = t.id === selected?.id
              return (
                <li key={t.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(t.id)}
                    className={`flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-paper-deep/70 ${
                      active ? 'bg-paper-deep/90' : ''
                    }`}
                  >
                    <EnvIcon name={CLOUD_PROVIDER[t.cloud]} size={32} />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-xs font-bold text-ember-deep">
                          {TRACK_META[t.track].label.split('·')[0].trim()} · {t.step}
                        </span>
                        <span className="font-bold text-ink">{t.title}</span>
                      </span>
                      <span className="mt-1 flex flex-wrap items-center gap-2">
                        <span className="border border-line bg-paper px-2 py-0.5 text-xs font-bold text-ink-muted">
                          {LEVEL_LABEL[t.level]}
                        </span>
                        <span className="text-xs text-ink-muted">{t.time}</span>
                        {t.buildsOn && (
                          <span className="text-xs text-ink-muted">builds on prior lesson</span>
                        )}
                      </span>
                      <span className="mt-1 block text-sm text-ink-muted">{t.blurb}</span>
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        </section>

        <section className="min-w-0 space-y-4">
          {selected && trackMeta && (
            <>
              <div className="border-2 border-line bg-panel/90 p-4">
                <div className="flex flex-wrap items-start gap-3">
                  <EnvIcon name={CLOUD_PROVIDER[selected.cloud]} size={40} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold text-ember-deep">
                      {trackMeta.label} · lesson {selected.step} of {trackLen}
                    </p>
                    <h2 className="mt-1 font-display text-2xl font-bold text-ink">{selected.title}</h2>
                    <p className="mt-1 text-base text-ink-muted">{selected.blurb}</p>
                    <p className="mt-2 text-sm text-ink-muted">
                      {LEVEL_LABEL[selected.level]} · {selected.time} · {selected.files.length} files
                    </p>
                  </div>
                </div>

                {(prev || next) && (
                  <div className="mt-4 flex flex-wrap gap-2">
                    {prev && (
                      <button
                        type="button"
                        className="btn-secondary btn-compact"
                        onClick={() => setSelectedId(prev.id)}
                      >
                        ← {prev.title}
                      </button>
                    )}
                    {next && (
                      <button
                        type="button"
                        className="btn-secondary btn-compact"
                        onClick={() => setSelectedId(next.id)}
                      >
                        Next: {next.title} →
                      </button>
                    )}
                  </div>
                )}

                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <div>
                    <p className="text-sm font-bold text-ink">What you will learn</p>
                    <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-ink-muted">
                      {selected.whatYouLearn.map((x) => (
                        <li key={x}>{x}</li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <p className="text-sm font-bold text-ink">Prerequisites</p>
                    <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-ink-muted">
                      {selected.prerequisites.map((x) => (
                        <li key={x}>{x}</li>
                      ))}
                    </ul>
                  </div>
                </div>

                <div className="mt-4">
                  <p className="text-sm font-bold text-ink">After you load it</p>
                  <ol className="mt-1 list-decimal space-y-1 pl-5 text-sm text-ink-muted">
                    {selected.nextSteps.map((x) => (
                      <li key={x}>{x}</li>
                    ))}
                  </ol>
                </div>

                <div className="mt-5 flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void useInNewNamespace()}
                    className="btn-primary"
                  >
                    {busy ? 'Working…' : 'Create namespace with this template'}
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void copyAll()}
                    className="btn-secondary"
                  >
                    Copy all files
                  </button>
                </div>

                <div className="mt-4 border-t border-line pt-4">
                  <p className="mb-2 text-sm font-bold text-ink">Or import into an existing namespace</p>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <select
                      className="field min-w-0 flex-1"
                      value={targetId}
                      onFocus={() => void ensureNamespaces()}
                      onClick={() => void ensureNamespaces()}
                      onChange={(e) => setTargetId(e.target.value)}
                    >
                      {!loadedNs && <option value="">Click to load namespaces…</option>}
                      {loadedNs && namespaces.length === 0 && (
                        <option value="">No namespaces yet</option>
                      )}
                      {namespaces.map((ns) => (
                        <option key={ns.id} value={ns.id}>
                          {ns.name}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      disabled={busy || !targetId}
                      onClick={() => void useInExisting()}
                      className="btn-secondary shrink-0"
                    >
                      Import here
                    </button>
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                <h3 className="font-display text-xl font-bold text-ink">Files in this template</h3>
                {selected.files.map((f) => (
                  <FilePreview key={f.path} path={f.path} content={f.content} />
                ))}
              </div>
            </>
          )}
        </section>
      </div>
    </AppShell>
  )
}
