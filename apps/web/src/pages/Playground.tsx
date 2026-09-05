import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  api,
  ApiError,
  type ConfigGraph,
  type FileNode,
  type Namespace,
  type PlaygroundTemplate,
  type Run,
  type RunType,
} from '../api/client'
import { AppShell } from '../components/AppShell'
import { CodeEditor } from '../components/Editor/Editor'
import { collectFilePaths } from '../components/Editor/FileTree'
import {
  applyLogLineToDeploy,
  DeployMap,
  parsePlanResources,
  type NodeDeployState,
} from '../components/Playground/DeployMap'
import { VerticalSplit } from '../components/Playground/ResizableLayout'
import {
  EmptyWorkspaceCard,
  NewFileDialog,
  SaveTemplateDialog,
} from '../components/Playground/StarterFiles'
import { TerraformCLI } from '../components/Playground/TerraformCLI'
import {
  detectNonLocalProviders,
  playgroundStarters,
  templateFilesMap,
  type TfTemplate,
} from '../lib/templates'
import { RUNNABLE_SET, scaffoldFiles, type Scaffold } from '../lib/tfScaffolds'

type HoodStep = 'idle' | 'queue' | 'lock' | 'runner' | 'state'

function hoodFromRun(run: Run | null): HoodStep {
  if (!run) return 'idle'
  if (run.status === 'queued') return 'queue'
  if (run.status === 'running') return 'runner'
  if (run.status === 'success') return 'state'
  if (run.status === 'failed' || run.status === 'canceled') return 'idle'
  return 'idle'
}

function UnderTheHood({ step }: { step: HoodStep }) {
  const steps: Array<{ id: HoodStep; label: string; blurb: string }> = [
    { id: 'queue', label: 'Queue', blurb: 'Redis' },
    { id: 'lock', label: 'Lock', blurb: 'Worker' },
    { id: 'runner', label: 'Runner', blurb: 'Docker TF' },
    { id: 'state', label: 'State', blurb: 'Backend' },
  ]
  const order: HoodStep[] = ['queue', 'lock', 'runner', 'state']
  const activeIdx = order.indexOf(step)
  return (
    <div className="flex flex-wrap items-center gap-2 border border-line/60 bg-panel/70 px-3 py-2">
      <p className="shrink-0 text-xs font-bold uppercase tracking-wide text-ink-muted">Pipeline</p>
      <ol className="flex min-w-0 flex-1 flex-wrap gap-1.5">
        {steps.map((s, i) => {
          const done = activeIdx > i || (step === 'state' && s.id === 'state')
          const active = step === s.id || (step === 'runner' && s.id === 'lock')
          return (
            <li
              key={s.id}
              className={`playground-hood-step flex items-center gap-1.5 rounded border px-2 py-1 text-xs ${
                active ? 'playground-hood-step-active' : done ? 'playground-hood-step-done' : 'border-line/50'
              }`}
            >
              <span className="font-semibold text-ink">{s.label}</span>
              <span className="text-ink-muted">{s.blurb}</span>
            </li>
          )
        })}
      </ol>
    </div>
  )
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48)
}

export function Playground() {
  const [searchParams, setSearchParams] = useSearchParams()
  const nsId = searchParams.get('ns') ?? ''

  const starters = useMemo(() => playgroundStarters(), [])
  const [savedTemplates, setSavedTemplates] = useState<PlaygroundTemplate[]>([])
  const [recent, setRecent] = useState<Namespace[]>([])
  const [ns, setNs] = useState<Namespace | null>(null)
  const [tree, setTree] = useState<FileNode | null>(null)
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [content, setContent] = useState('')
  const [savedContent, setSavedContent] = useState('')
  const [saving, setSaving] = useState(false)
  const [importBusy, setImportBusy] = useState(false)
  const [runBusy, setRunBusy] = useState(false)
  const [runs, setRuns] = useState<Run[]>([])
  const [activeRunId, setActiveRunId] = useState<string | null>(null)
  const [graph, setGraph] = useState<ConfigGraph | null>(null)
  const [graphBusy, setGraphBusy] = useState(false)
  const [deployStates, setDeployStates] = useState<Record<string, NodeDeployState>>({})
  const [providerWarning, setProviderWarning] = useState<string[]>([])
  const [error, setError] = useState('')
  const [note, setNote] = useState('')
  const [busyStart, setBusyStart] = useState(false)
  const [newFileOpen, setNewFileOpen] = useState(false)
  const [saveOpen, setSaveOpen] = useState(false)
  const [savingTemplate, setSavingTemplate] = useState(false)
  const [scaffoldBusy, setScaffoldBusy] = useState(false)
  const [editRequest, setEditRequest] = useState(0)

  const dirty = content !== savedContent
  const activeRun = runs.find((r) => r.id === activeRunId) ?? null
  const hoodStep = hoodFromRun(activeRun)

  const filePaths = useMemo(() => collectFilePaths(tree?.children ?? []), [tree])
  const tfFileCount = filePaths.filter((p) => p.endsWith('.tf')).length

  const refreshTemplates = useCallback(async () => {
    const res = await api.listPlaygroundTemplates()
    setSavedTemplates(res.templates)
  }, [])

  const refreshRecent = useCallback(async () => {
    const res = await api.listNamespaces({ playground: true })
    setRecent(res.namespaces)
  }, [])

  const refreshGraph = useCallback(async () => {
    if (!nsId) return
    setGraphBusy(true)
    try {
      setGraph(await api.getGraph(nsId))
    } catch {
      /* ignore */
    } finally {
      setGraphBusy(false)
    }
  }, [nsId])

  const loadWorkspace = useCallback(async (id: string) => {
    const [namespace, files, runList, graphData] = await Promise.all([
      api.getNamespace(id),
      api.listFiles(id),
      api.listRuns(id),
      api.getGraph(id).catch(() => null),
    ])
    setNs(namespace)
    setTree(files)
    setRuns(runList.runs)
    setGraph(graphData)
    const lastPlan = runList.runs.find((r) => r.type === 'plan' && r.summary)
    if (lastPlan?.summary?.resources) {
      setDeployStates(parsePlanResources(lastPlan.summary.resources))
    }
  }, [])

  useEffect(() => {
    void refreshTemplates().catch(() => undefined)
    void refreshRecent().catch(() => undefined)
  }, [refreshTemplates, refreshRecent])

  useEffect(() => {
    if (!nsId) {
      setNs(null)
      setTree(null)
      setSelectedPath(null)
      setContent('')
      setSavedContent('')
      setRuns([])
      setActiveRunId(null)
      setGraph(null)
      setDeployStates({})
      return
    }
    loadWorkspace(nsId).catch((err) => {
      setError(err instanceof ApiError ? err.message : 'Failed to load playground')
    })
  }, [nsId, loadWorkspace])

  useEffect(() => {
    if (!nsId || !tree?.children?.length || selectedPath) return
    const paths = collectFilePaths(tree.children)
    const first = paths.find((p) => p.endsWith('.tf')) ?? paths[0]
    if (first) void openFile(first, { force: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tree, nsId])

  useEffect(() => {
    if (!nsId) return
    const hasActive = runs.some((r) => r.status === 'queued' || r.status === 'running')
    if (!hasActive) return
    const t = window.setInterval(() => {
      void api.listRuns(nsId).then((res) => {
        setRuns(res.runs)
        const cur = res.runs.find((r) => r.id === activeRunId)
        if (cur?.summary?.resources && cur.type === 'plan') {
          setDeployStates(parsePlanResources(cur.summary.resources))
        }
        if (cur && (cur.status === 'success' || cur.status === 'failed')) {
          void refreshGraph()
        }
      })
    }, 2000)
    return () => window.clearInterval(t)
  }, [nsId, runs, activeRunId, refreshGraph])

  useEffect(() => {
    if (!activeRun || activeRun.status !== 'success') return
    void refreshGraph()
    if (activeRun.type === 'plan' && activeRun.summary?.resources) {
      setDeployStates(parsePlanResources(activeRun.summary.resources))
    }
    if (activeRun.type === 'apply' || activeRun.type === 'destroy') {
      // Settled: flip in_state from refreshed graph; clear transient phases after poll
      void api.getGraph(nsId).then((g) => {
        setGraph(g)
        setDeployStates((prev) => {
          const next = { ...prev }
          for (const n of g.nodes) {
            if (n.kind !== 'resource') continue
            if (n.in_state) next[n.id] = { phase: 'created', action: next[n.id]?.action }
            else if (next[n.id]?.action === 'destroy') next[n.id] = { phase: 'destroyed', action: 'destroy' }
          }
          return next
        })
      })
    }
  }, [activeRun?.id, activeRun?.status, activeRun?.type, nsId, refreshGraph])

  async function openFile(path: string, opts?: { force?: boolean }) {
    if (!nsId) return
    if (!opts?.force && dirty && !confirm('Discard unsaved changes?')) return
    try {
      const file = await api.readFile(nsId, path)
      setSelectedPath(path)
      setContent(file.content)
      setSavedContent(file.content)
      setError('')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to open file')
    }
  }

  async function saveFile() {
    if (!nsId || !selectedPath) return
    setSaving(true)
    setError('')
    try {
      const file = await api.writeFile(nsId, selectedPath, content)
      setSavedContent(file.content)
      setTree(await api.listFiles(nsId))
      void refreshGraph()
      scanProvidersFromTree()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  async function scanProvidersFromTree() {
    if (!nsId || !tree) return
    const paths = collectFilePaths(tree.children ?? [])
    const files: Record<string, string> = {}
    for (const p of paths.filter((x) => x.endsWith('.tf'))) {
      try {
        const f = await api.readFile(nsId, p)
        files[p] = f.content
      } catch {
        /* skip */
      }
    }
    if (selectedPath?.endsWith('.tf')) files[selectedPath] = content
    setProviderWarning(detectNonLocalProviders(files))
  }

  async function importProjectFiles(files: Record<string, string>) {
    if (!nsId) return
    setImportBusy(true)
    setError('')
    try {
      const res = await api.importFiles(nsId, files)
      const treeRes = await api.listFiles(nsId)
      setTree(treeRes)
      setProviderWarning(detectNonLocalProviders(files))
      const firstTf = res.paths.find((p) => p.endsWith('.tf')) ?? res.paths[0]
      if (firstTf) await openFile(firstTf, { force: true })
      void refreshGraph()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Import failed')
    } finally {
      setImportBusy(false)
    }
  }

  function newFile() {
    if (dirty && !confirm('Discard unsaved changes?')) return
    setNewFileOpen(true)
  }

  /** Write a file to the session immediately so it can be run right away. */
  async function createFile(path: string, fileContent: string) {
    if (!nsId) return
    setScaffoldBusy(true)
    setError('')
    try {
      await api.writeFile(nsId, path, fileContent, `Add ${path}`)
      setTree(await api.listFiles(nsId))
      await openFile(path, { force: true })
      setEditRequest((n) => n + 1)
      void refreshGraph()
      setNote(`Created ${path}. Run terraform init, then plan.`)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : `Could not create ${path}`)
    } finally {
      setScaffoldBusy(false)
    }
  }

  async function addScaffold(s: Scaffold) {
    await createFile(s.path, s.content)
  }

  async function seedRunnableStarter() {
    if (!nsId) return
    setScaffoldBusy(true)
    setError('')
    try {
      const files = scaffoldFiles(RUNNABLE_SET)
      await api.importFiles(nsId, files, 'Add runnable starter files')
      setTree(await api.listFiles(nsId))
      setProviderWarning(detectNonLocalProviders(files))
      await openFile('main.tf', { force: true })
      void refreshGraph()
      setNote('Starter files added. Run terraform init → plan → apply.')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not add starter files')
    } finally {
      setScaffoldBusy(false)
    }
  }

  async function triggerRun(type: RunType, command?: string) {
    if (!nsId) return
    if (dirty) {
      throw new Error('Save your changes before running Terraform.')
    }
    setRunBusy(true)
    setError('')
    setNote('')
    try {
      const run = await api.createRun(nsId, type)
      setActiveRunId(run.id)
      setRuns((prev) => [run, ...prev])
      if (command) {
        setNote(`CLI: ${command}`)
      }
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Failed to start run'
      setError(msg)
      throw err instanceof Error ? err : new Error(msg)
    } finally {
      setRunBusy(false)
    }
  }

  function onLogLine(line: string) {
    setDeployStates((prev) => applyLogLineToDeploy(prev, line))
  }

  async function startBlank(opts?: { seed?: boolean }) {
    setBusyStart(true)
    setError('')
    try {
      const stamp = Date.now().toString(36).slice(-4)
      const name = `Playground ${stamp}`
      const created = await api.createNamespace({
        name,
        slug: `pg-${stamp}`,
        is_playground: true,
      })
      if (opts?.seed) {
        await api.importFiles(created.id, scaffoldFiles(RUNNABLE_SET), 'Add runnable starter files')
      }
      setSearchParams({ ns: created.id })
      await refreshRecent()
      setNote(
        opts?.seed
          ? 'Playground ready with starter files — run terraform init → plan → apply.'
          : 'Blank playground ready — create your first .tf file to start.',
      )
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create playground')
    } finally {
      setBusyStart(false)
    }
  }

  async function startFromStarter(t: TfTemplate) {
    setBusyStart(true)
    setError('')
    try {
      const stamp = Date.now().toString(36).slice(-4)
      const files = templateFilesMap(t)
      const created = await api.createNamespace({
        name: `${t.title} (${stamp})`,
        slug: `pg-${slugify(t.id)}-${stamp}`,
        is_playground: true,
      })
      await api.importFiles(created.id, files, `Seed: ${t.title}`)
      setProviderWarning(detectNonLocalProviders(files))
      setSearchParams({ ns: created.id })
      await refreshRecent()
      setNote(`Seeded ${t.title}. Run Init → Plan → Apply.`)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not seed playground')
    } finally {
      setBusyStart(false)
    }
  }

  async function launchSaved(tpl: PlaygroundTemplate) {
    setBusyStart(true)
    setError('')
    try {
      const res = await api.launchPlaygroundTemplate(tpl.id)
      setProviderWarning(detectNonLocalProviders(tpl.files))
      setSearchParams({ ns: res.namespace.id })
      await refreshRecent()
      setNote(`Launched saved template “${tpl.name}”.`)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Launch failed')
    } finally {
      setBusyStart(false)
    }
  }

  async function saveAsTemplate(name: string, description: string) {
    if (!nsId) return
    setSavingTemplate(true)
    setError('')
    try {
      await api.savePlaygroundFromNamespace(nsId, { name, description })
      await refreshTemplates()
      setSaveOpen(false)
      setNote(`Saved “${name}” — relaunch it any time from the Playground start screen.`)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Save template failed')
    } finally {
      setSavingTemplate(false)
    }
  }

  async function deleteSaved(id: string) {
    if (!confirm('Delete this saved playground template?')) return
    try {
      await api.deletePlaygroundTemplate(id)
      await refreshTemplates()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Delete failed')
    }
  }

  if (!nsId) {
    return (
      <AppShell
        title="Playground"
        subtitle="Safe local Terraform sandbox — practice the real CLI (autocomplete + definitions)."
        wide
      >
        {error && (
          <p className="mb-4 border border-danger/40 bg-danger/10 px-3 py-2 text-base text-danger">{error}</p>
        )}
        {note && (
          <p className="mb-4 border border-moss/40 bg-moss/10 px-3 py-2 text-base text-ink">{note}</p>
        )}

        <section className="mb-8 space-y-3">
          <h2 className="font-display text-xl font-bold">Start</h2>
          <p className="text-base text-ink-muted">
            Pick a local starter, a saved template, or a blank workspace. In the workspace you’ll run{' '}
            <code className="font-mono text-sm">terraform</code> in a real CLI (no action buttons). Cloud /
            Docker / VBox templates stay on{' '}
            <Link to="/templates" className="text-ember-deep underline">
              Templates
            </Link>
            .
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busyStart}
              onClick={() => void startBlank()}
              className="btn-secondary"
              title="Empty workspace — you create the .tf files"
            >
              Blank playground
            </button>
            <button
              type="button"
              disabled={busyStart}
              onClick={() => void startBlank({ seed: true })}
              className="btn-secondary"
              title="Blank workspace pre-filled with versions.tf, main.tf and outputs.tf"
            >
              Blank + starter files
            </button>
          </div>
          <p className="text-sm text-ink-muted">
            Anything you build in a playground can be saved as a reusable template with{' '}
            <strong className="font-semibold text-ink">Save playground</strong>, then relaunched here for
            a demo later.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="font-display text-xl font-bold">Local starters</h2>
          <ul className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {starters.map((t) => (
              <li key={t.id} className="border border-line/70 bg-panel/80 p-4">
                <p className="font-display text-lg font-semibold text-ink">{t.title}</p>
                <p className="mt-1 text-base text-ink-muted">{t.blurb}</p>
                <p className="mt-2 text-sm text-ink-muted">
                  {TRACK_META_LABEL(t)} · {t.time}
                </p>
                <button
                  type="button"
                  disabled={busyStart}
                  onClick={() => void startFromStarter(t)}
                  className="btn-primary btn-compact mt-3"
                >
                  Open in playground
                </button>
              </li>
            ))}
          </ul>
        </section>

        {savedTemplates.length > 0 && (
          <section className="mb-8">
            <h2 className="font-display text-xl font-bold">Your saved templates</h2>
            <ul className="mt-3 space-y-2">
              {savedTemplates.map((t) => (
                <li
                  key={t.id}
                  className="flex flex-wrap items-center justify-between gap-2 border border-line/60 bg-panel/70 px-4 py-3"
                >
                  <div>
                    <p className="font-semibold text-ink">{t.name}</p>
                    {t.description && <p className="text-sm text-ink-muted">{t.description}</p>}
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={busyStart}
                      onClick={() => void launchSaved(t)}
                      className="btn-primary btn-compact"
                    >
                      Launch
                    </button>
                    <button
                      type="button"
                      onClick={() => void deleteSaved(t.id)}
                      className="btn-secondary btn-compact"
                    >
                      Delete
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        {recent.length > 0 && (
          <section>
            <h2 className="font-display text-xl font-bold">Recent playgrounds</h2>
            <ul className="mt-3 space-y-2">
              {recent.map((n) => (
                <li key={n.id}>
                  <button
                    type="button"
                    className="w-full border border-line/60 bg-panel/70 px-4 py-3 text-left hover:border-ember"
                    onClick={() => setSearchParams({ ns: n.id })}
                  >
                    <span className="font-semibold text-ink">{n.name}</span>
                    <span className="ml-2 font-mono text-sm text-ink-muted">{n.slug}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </AppShell>
    )
  }

  return (
    <AppShell
      title={ns?.name ?? 'Playground'}
      subtitle="CLI + live deploy + editor — same Docker runner."
      wide
    >
      <div className="playground-workspace space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="btn-secondary btn-compact" onClick={() => setSearchParams({})}>
            ← Start
          </button>
          <Link to={`/namespaces/${nsId}`} className="btn-secondary btn-compact">
            Namespace
          </Link>
          <button type="button" className="btn-secondary btn-compact" onClick={newFile}>
            New file
          </button>
          <button
            type="button"
            className="btn-secondary btn-compact"
            onClick={() => setSaveOpen(true)}
            title="Save these files as a reusable playground template"
          >
            Save playground
          </button>
          <span className="font-mono text-xs text-ink-muted">
            {tfFileCount} .tf file{tfFileCount === 1 ? '' : 's'}
          </span>
        </div>

        {error && (
          <p className="border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>
        )}
        {note && (
          <p className="border border-moss/40 bg-moss/10 px-3 py-2 text-sm text-ink">{note}</p>
        )}
        {providerWarning.length > 0 && (
          <p className="border border-warn/50 bg-warn/10 px-3 py-2 text-sm text-ink">
            Non-local providers ({providerWarning.join(', ')}). Starters stay on local/random.
          </p>
        )}

        {tree && tfFileCount === 0 && (
          <EmptyWorkspaceCard
            busy={scaffoldBusy}
            onSeedRunnable={() => void seedRunnableStarter()}
            onAddScaffold={(s) => void addScaffold(s)}
            onNewFile={newFile}
          />
        )}

        <UnderTheHood step={hoodStep} />

        <VerticalSplit
          storageKey="tf-pg-vsplit-deploy"
          initial={430}
          min={200}
          max={1000}
          className="min-h-[34rem] flex-1"
          handleLabel="Drag to resize the deploy dashboard"
          first={
            <DeployMap
              graph={graph}
              loading={graphBusy}
              deployStates={deployStates}
              run={activeRun}
              onRefresh={() => void refreshGraph()}
            />
          }
          second={
            <VerticalSplit
              storageKey="tf-pg-vsplit"
              initial={340}
              min={160}
              max={900}
              className="playground-vsplit-tight h-full min-h-0"
              secondMin="8rem"
              handleLabel="Drag to resize CLI height"
              first={
                <TerraformCLI
                  namespaceId={nsId}
                  runId={activeRunId}
                  run={activeRun}
                  busy={runBusy}
                  dirty={dirty}
                  onRun={(type, command) => triggerRun(type, command)}
                  onLogLine={onLogLine}
                />
              }
              second={
                <div className="playground-editor flex h-full min-h-[8rem] flex-col border-2 border-line/70 bg-panel/50">
                  <CodeEditor
                    tree={tree}
                    selectedPath={selectedPath}
                    content={content}
                    dirty={dirty}
                    saving={saving}
                    importBusy={importBusy}
                    onSelect={(p) => void openFile(p)}
                    onChange={setContent}
                    onSave={() => void saveFile()}
                    onNewFile={newFile}
                    onRefresh={() => void api.listFiles(nsId).then(setTree)}
                    onRevert={() => {
                      if (selectedPath) void openFile(selectedPath, { force: true })
                    }}
                    onImportFiles={importProjectFiles}
                    editRequest={editRequest}
                  />
                </div>
              }
            />
          }
        />
      </div>

      {newFileOpen && (
        <NewFileDialog
          existingPaths={filePaths}
          onClose={() => setNewFileOpen(false)}
          onCreate={(path, fileContent) => {
            setNewFileOpen(false)
            void createFile(path, fileContent)
          }}
        />
      )}

      {saveOpen && (
        <SaveTemplateDialog
          defaultName={ns?.name ?? 'My playground'}
          files={filePaths}
          saving={savingTemplate}
          onClose={() => setSaveOpen(false)}
          onSave={(name, description) => void saveAsTemplate(name, description)}
        />
      )}
    </AppShell>
  )
}

function TRACK_META_LABEL(t: TfTemplate): string {
  if (t.track === 'foundation') return `Foundation ${t.step}`
  if (t.track === 'language') return `Language ${t.step}`
  return t.track
}
