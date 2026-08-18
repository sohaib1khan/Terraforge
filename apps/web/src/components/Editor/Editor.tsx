import Editor from '@monaco-editor/react'
import { useMemo, useRef, useState } from 'react'
import type { FileNode } from '../../api/client'
import { collectFilePaths, FileTree } from './FileTree'
import { languageForPath, registerHCL } from './hclMonaco'

type Mode = 'inspect' | 'edit'

type Props = {
  tree: FileNode | null
  selectedPath: string | null
  content: string
  dirty: boolean
  saving: boolean
  importBusy?: boolean
  onSelect: (path: string) => void
  onChange: (value: string) => void
  onSave: () => void
  onNewFile: () => void
  onRefresh?: () => void
  onRevert?: () => void
  onImportFiles?: (files: Record<string, string>) => Promise<void>
}

function isSeedOnly(paths: string[]): boolean {
  const meaningful = paths.filter((p) => !p.endsWith('README.md'))
  return meaningful.length === 0
}

export function CodeEditor({
  tree,
  selectedPath,
  content,
  dirty,
  saving,
  importBusy,
  onSelect,
  onChange,
  onSave,
  onNewFile,
  onRefresh,
  onRevert,
  onImportFiles,
}: Props) {
  const [mode, setMode] = useState<Mode>('inspect')
  const dirInputRef = useRef<HTMLInputElement>(null)
  const language = languageForPath(selectedPath)
  const readOnly = mode === 'inspect'
  const roots = tree?.children ?? []
  const allPaths = useMemo(() => collectFilePaths(roots), [roots])
  const fileCount = allPaths.length
  const lineCount = content ? content.split('\n').length : 0
  const needsImport = isSeedOnly(allPaths)

  function switchMode(next: Mode) {
    if (next === mode) return
    if (next === 'inspect' && dirty) {
      if (!confirm('Discard unsaved edits and switch to read-only inspect?')) return
      onRevert?.()
    }
    setMode(next)
  }

  async function handleDirectoryPick(list: FileList | null) {
    if (!list || !onImportFiles) return
    const files: Record<string, string> = {}
    for (const file of Array.from(list)) {
      const rel = (file.webkitRelativePath || file.name).replace(/^[^/]+\//, '')
      // Keep nested paths; strip only the top folder name from webkitdirectory.
      const path = file.webkitRelativePath
        ? file.webkitRelativePath.split('/').slice(1).join('/')
        : file.name
      const usePath = path || rel || file.name
      const lower = usePath.toLowerCase()
      if (
        !(
          lower.endsWith('.tf') ||
          lower.endsWith('.tfvars') ||
          lower.endsWith('.hcl') ||
          lower.endsWith('.md') ||
          lower.endsWith('.json') ||
          lower.endsWith('.yml') ||
          lower.endsWith('.yaml') ||
          lower.endsWith('.tpl') ||
          lower.endsWith('.sh') ||
          lower.endsWith('.txt') ||
          usePath.endsWith('.gitignore')
        )
      ) {
        continue
      }
      if (usePath.includes('.terraform/') || usePath.includes('terraforge_connect/')) continue
      files[usePath] = await file.text()
    }
    if (Object.keys(files).length === 0) {
      alert('No importable Terraform files found in that folder.')
      return
    }
    await onImportFiles(files)
  }

  return (
    <section className="flex min-h-[min(75dvh,40rem)] flex-col border-2 border-line bg-panel/80 lg:flex-row">
      <aside className="flex w-full shrink-0 flex-col border-b-2 border-line/60 lg:w-72 lg:border-b-0 lg:border-r-2">
        <div className="flex items-center justify-between gap-2 border-b-2 border-line/60 px-3 py-2">
          <div>
            <p className="text-sm font-bold uppercase tracking-wide text-ink-muted">Repository</p>
            <p className="font-mono text-xs text-ink-muted">{fileCount} files</p>
          </div>
          <div className="flex gap-2">
            {onRefresh && (
              <button
                type="button"
                onClick={onRefresh}
                className="btn-compact text-sm font-bold text-ember-deep hover:underline"
              >
                Refresh
              </button>
            )}
            {!readOnly && (
              <button
                type="button"
                onClick={onNewFile}
                className="btn-compact text-sm font-bold text-ember-deep hover:underline"
              >
                New
              </button>
            )}
          </div>
        </div>
        <div className="min-h-48 flex-1 overflow-auto p-2 lg:min-h-0 lg:max-h-none">
          {roots.length > 0 ? (
            <FileTree nodes={roots} selectedPath={selectedPath} onSelect={onSelect} />
          ) : (
            <p className="px-2 py-3 text-base text-ink-muted">No files yet.</p>
          )}
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b-2 border-line/60 px-3 py-2">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`rounded px-2 py-0.5 text-xs font-bold uppercase tracking-wide ${
                  readOnly
                    ? 'border border-ember/40 bg-ember/15 text-ember-deep'
                    : 'border border-warn/50 bg-warn/15 text-warn'
                }`}
              >
                {readOnly ? 'Read only' : 'Editing'}
              </span>
              <span className="truncate font-mono text-base text-ink">
                {selectedPath ?? 'Select a file'}
              </span>
              {dirty && !readOnly && (
                <span className="text-sm font-bold text-warn">unsaved</span>
              )}
            </div>
            {selectedPath && (
              <p className="mt-0.5 font-mono text-xs text-ink-muted">
                {language} · {lineCount} lines
                {readOnly ? ' · syntax highlighted · not editable from here' : ' · Save asks for confirmation'}
              </p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex border-2 border-line" role="group" aria-label="File mode">
              <button
                type="button"
                onClick={() => switchMode('inspect')}
                className={`btn-compact px-3 text-sm ${
                  readOnly ? 'bg-ember/20 font-bold text-ink' : 'bg-panel/50 text-ink-muted'
                }`}
              >
                Inspect
              </button>
              <button
                type="button"
                onClick={() => switchMode('edit')}
                className={`btn-compact border-l-2 border-line px-3 text-sm ${
                  !readOnly ? 'bg-warn/20 font-bold text-ink' : 'bg-panel/50 text-ink-muted'
                }`}
              >
                Edit
              </button>
            </div>
            {!readOnly && (
              <button
                type="button"
                disabled={!selectedPath || !dirty || saving}
                onClick={onSave}
                className="btn-primary btn-compact px-3 text-base"
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
            )}
          </div>
        </div>

        {needsImport && onImportFiles && (
          <div className="border-b-2 border-ember/30 bg-ember/10 px-4 py-3 text-base text-ink">
            <p className="font-bold text-ember-deep">No Terraform config in this namespace yet</p>
            <p className="mt-1 text-ink-muted">
              Curl connect only wires remote state on your laptop. To inspect/edit and run from the
              dashboard, sync your project folder into this namespace.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={importBusy}
                className="btn-primary btn-compact px-3"
                onClick={() => dirInputRef.current?.click()}
              >
                {importBusy ? 'Importing…' : 'Import project folder'}
              </button>
              <input
                ref={(el) => {
                  dirInputRef.current = el
                  if (el) el.setAttribute('webkitdirectory', '')
                }}
                type="file"
                className="hidden"
                multiple
                onChange={(e) => void handleDirectoryPick(e.target.files)}
              />
            </div>
            <p className="mt-2 font-mono text-sm text-ink-muted">
              or from your project: terraforge sync
            </p>
          </div>
        )}

        <div className="min-h-[min(60dvh,28rem)] flex-1">
          {selectedPath ? (
            <Editor
              height="100%"
              path={`tf-view:${mode}:${selectedPath}`}
              language={language}
              theme={readOnly ? 'terraforge-inspect' : 'terraforge-calm'}
              beforeMount={registerHCL}
              value={content}
              onChange={(v) => {
                if (!readOnly) onChange(v ?? '')
              }}
              options={{
                readOnly,
                domReadOnly: readOnly,
                readOnlyMessage: { value: 'Inspect mode — switch to Edit to change files.' },
                minimap: { enabled: readOnly },
                fontSize: readOnly ? 15 : 16,
                lineHeight: readOnly ? 24 : 26,
                fontFamily: 'IBM Plex Mono, ui-monospace, monospace',
                scrollBeyondLastLine: false,
                automaticLayout: true,
                wordWrap: 'on',
                renderLineHighlight: readOnly ? 'all' : 'line',
                folding: true,
                stickyScroll: { enabled: true },
                padding: { top: 12, bottom: 12 },
                scrollbar: {
                  verticalScrollbarSize: 12,
                  horizontalScrollbarSize: 12,
                },
                cursorStyle: readOnly ? 'underline-thin' : 'line',
                contextmenu: !readOnly,
              }}
            />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-base text-ink-muted">
              <p className="font-bold text-ink">Inspect Terraform as stored in this namespace</p>
              <p>Import a project folder (or run terraforge sync), then pick a .tf file.</p>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
