import { useEffect, useState } from 'react'
import { RUNNABLE_SET, scaffoldById, TF_SCAFFOLDS, type Scaffold } from '../../lib/tfScaffolds'

function Modal({
  title,
  subtitle,
  onClose,
  children,
}: {
  title: string
  subtitle?: string
  onClose: () => void
  children: React.ReactNode
}) {
  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onEsc)
    return () => window.removeEventListener('keydown', onEsc)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-[80] flex items-end justify-center bg-[#2a3846]/45 p-3 sm:items-center sm:p-6"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="max-h-full w-full max-w-xl overflow-auto border-2 border-line bg-panel p-4 shadow-xl"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-lg font-bold text-ink">{title}</h2>
            {subtitle && <p className="mt-0.5 text-sm text-ink-muted">{subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 border border-line/60 px-2 py-0.5 font-mono text-sm text-ink-muted hover:border-ember hover:text-ink"
          >
            ✕
          </button>
        </div>
        <div className="mt-3">{children}</div>
      </div>
    </div>
  )
}

/** Shown in a playground that has no .tf files yet. */
export function EmptyWorkspaceCard({
  busy,
  onSeedRunnable,
  onAddScaffold,
  onNewFile,
}: {
  busy: boolean
  onSeedRunnable: () => void
  onAddScaffold: (s: Scaffold) => void
  onNewFile: () => void
}) {
  const quick = ['versions', 'main-minimal', 'variables', 'outputs']
  return (
    <div className="border-2 border-ember/40 bg-ember/5 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-display text-base font-bold text-ink">
            This playground is empty — add some Terraform
          </h2>
          <p className="mt-1 text-sm text-ink-muted">
            Terraform reads every <code className="font-mono text-xs">.tf</code> file in the folder as
            one configuration, so you can start with a single file. Files are saved to this session and
            run in the Docker runner immediately.
          </p>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={onSeedRunnable}
          className="btn-primary btn-compact shrink-0 disabled:opacity-60"
        >
          Create a runnable starter
        </button>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <span className="text-[0.65rem] font-bold uppercase tracking-wide text-ink-muted">
          Or add one file
        </span>
        {quick.map((id) => {
          const s = scaffoldById(id)
          if (!s) return null
          return (
            <button
              key={id}
              type="button"
              disabled={busy}
              onClick={() => onAddScaffold(s)}
              title={s.blurb}
              className="rounded border border-line/60 px-2 py-0.5 font-mono text-xs text-ink-muted hover:border-ember hover:text-ink disabled:opacity-60"
            >
              + {s.path}
            </button>
          )
        })}
        <button
          type="button"
          disabled={busy}
          onClick={onNewFile}
          className="rounded border border-line/60 px-2 py-0.5 font-mono text-xs text-ink-muted hover:border-ember hover:text-ink disabled:opacity-60"
        >
          + custom…
        </button>
      </div>

      <p className="mt-2 text-xs text-ink-muted">
        The runnable starter writes <code className="font-mono">versions.tf</code>,{' '}
        <code className="font-mono">main.tf</code> and <code className="font-mono">outputs.tf</code>, so{' '}
        <code className="font-mono">terraform init</code> works right away.
      </p>
    </div>
  )
}

/** Create a file: pick a scaffold, confirm the path. */
export function NewFileDialog({
  existingPaths,
  onClose,
  onCreate,
}: {
  existingPaths: string[]
  onClose: () => void
  onCreate: (path: string, content: string) => void
}) {
  const [scaffoldId, setScaffoldId] = useState<string>('blank')
  const [path, setPath] = useState('main.tf')
  const [touchedPath, setTouchedPath] = useState(false)

  const selected = scaffoldId === 'blank' ? null : scaffoldById(scaffoldId)
  const exists = existingPaths.includes(path.trim())
  const invalid = path.trim() === '' || path.trim().startsWith('/') || path.includes('..')

  function pick(id: string) {
    setScaffoldId(id)
    const s = id === 'blank' ? null : scaffoldById(id)
    if (s && !touchedPath) setPath(s.path)
  }

  function submit() {
    const p = path.trim()
    if (!p || invalid) return
    onCreate(p, selected?.content ?? '')
  }

  return (
    <Modal
      title="New Terraform file"
      subtitle="Start from a scaffold or an empty file. It is written to this session right away."
      onClose={onClose}
    >
      <fieldset className="space-y-1.5">
        <legend className="text-[0.65rem] font-bold uppercase tracking-wide text-ink-muted">
          Contents
        </legend>
        <label className="flex cursor-pointer items-start gap-2 border border-line/60 px-2 py-1.5 hover:border-ember">
          <input
            type="radio"
            name="scaffold"
            checked={scaffoldId === 'blank'}
            onChange={() => pick('blank')}
            className="mt-1"
          />
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-ink">Empty file</span>
            <span className="block text-xs text-ink-muted">Write it yourself.</span>
          </span>
        </label>
        {TF_SCAFFOLDS.map((s) => (
          <label
            key={s.id}
            className="flex cursor-pointer items-start gap-2 border border-line/60 px-2 py-1.5 hover:border-ember"
          >
            <input
              type="radio"
              name="scaffold"
              checked={scaffoldId === s.id}
              onChange={() => pick(s.id)}
              className="mt-1"
            />
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-ink">{s.label}</span>
              <span className="block text-xs text-ink-muted">{s.blurb}</span>
            </span>
          </label>
        ))}
      </fieldset>

      <label className="mt-3 block">
        <span className="text-[0.65rem] font-bold uppercase tracking-wide text-ink-muted">
          File path
        </span>
        <input
          value={path}
          onChange={(e) => {
            setPath(e.target.value)
            setTouchedPath(true)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit()
          }}
          spellCheck={false}
          autoComplete="off"
          className="mt-1 w-full border border-line/70 bg-paper px-2 py-1.5 font-mono text-sm text-ink outline-none focus:border-ember"
        />
      </label>
      {exists && (
        <p className="mt-1 text-xs text-warn">
          {path} already exists — creating it will overwrite the current contents.
        </p>
      )}
      {invalid && <p className="mt-1 text-xs text-danger">Enter a relative path such as main.tf.</p>}

      <div className="mt-4 flex justify-end gap-2">
        <button type="button" onClick={onClose} className="btn-secondary btn-compact">
          Cancel
        </button>
        <button
          type="button"
          disabled={invalid}
          onClick={submit}
          className="btn-primary btn-compact disabled:opacity-60"
        >
          Create file
        </button>
      </div>
    </Modal>
  )
}

/** Save the current session as a reusable playground template. */
export function SaveTemplateDialog({
  defaultName,
  files,
  saving,
  onClose,
  onSave,
}: {
  defaultName: string
  files: string[]
  saving: boolean
  onClose: () => void
  onSave: (name: string, description: string) => void
}) {
  const [name, setName] = useState(defaultName)
  const [description, setDescription] = useState('')

  return (
    <Modal
      title="Save this playground"
      subtitle="Stores the current files as a template you can relaunch for a demo later."
      onClose={onClose}
    >
      <label className="block">
        <span className="text-[0.65rem] font-bold uppercase tracking-wide text-ink-muted">Name</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="mt-1 w-full border border-line/70 bg-paper px-2 py-1.5 text-sm text-ink outline-none focus:border-ember"
        />
      </label>
      <label className="mt-3 block">
        <span className="text-[0.65rem] font-bold uppercase tracking-wide text-ink-muted">
          Description (optional)
        </span>
        <input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What this demo shows"
          className="mt-1 w-full border border-line/70 bg-paper px-2 py-1.5 text-sm text-ink outline-none focus:border-ember"
        />
      </label>

      <div className="mt-3 border border-line/60 bg-panel/70 p-2">
        <p className="text-[0.65rem] font-bold uppercase tracking-wide text-ink-muted">
          Files included ({files.length})
        </p>
        {files.length === 0 ? (
          <p className="mt-1 text-xs text-warn">
            This playground has no files yet — add some before saving.
          </p>
        ) : (
          <ul className="mt-1 max-h-40 overflow-auto font-mono text-xs text-ink-muted">
            {files.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        )}
      </div>

      <p className="mt-2 text-xs text-ink-muted">
        State and run history are not copied — a relaunch starts clean from these files.
      </p>

      <div className="mt-4 flex justify-end gap-2">
        <button type="button" onClick={onClose} className="btn-secondary btn-compact">
          Cancel
        </button>
        <button
          type="button"
          disabled={saving || name.trim() === '' || files.length === 0}
          onClick={() => onSave(name.trim(), description.trim())}
          className="btn-primary btn-compact disabled:opacity-60"
        >
          {saving ? 'Saving…' : 'Save template'}
        </button>
      </div>
    </Modal>
  )
}

export { RUNNABLE_SET }
