import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import {
  api,
  ApiError,
  type BackendToken,
  type CLIToken,
  type FileNode,
  type Member,
  type Namespace,
  type NamespaceSecret,
  type Run,
  type RunType,
  type StateView,
  type ConfigGraph,
} from '../api/client'
import { AppShell } from '../components/AppShell'
import { ConnectLocalGuide } from '../components/ConnectLocalGuide'
import { ConfigMap } from '../components/ConfigMap/ConfigMap'
import { ConfigSyncPanel } from '../components/ConfigSync/ConfigSyncPanel'
import { StateMap } from '../components/StateMap/StateMap'
import { writeLocalFile } from '../lib/localFolder'
import { CodeEditor } from '../components/Editor/Editor'
import { collectFilePaths } from '../components/Editor/FileTree'
import { LogConsole } from '../components/LogConsole/LogConsole'
import { RunPanel } from '../components/RunPanel/RunPanel'
import { RunsList } from '../components/RunPanel/RunsList'
import { StatusBadge } from '../components/StatusBadge/StatusBadge'

export function NamespaceView() {
  const { id = '' } = useParams()
  const [ns, setNs] = useState<Namespace | null>(null)
  const [tree, setTree] = useState<FileNode | null>(null)
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [content, setContent] = useState('')
  const [savedContent, setSavedContent] = useState('')
  const [saving, setSaving] = useState(false)
  const [runs, setRuns] = useState<Run[]>([])
  const [activeRunId, setActiveRunId] = useState<string | null>(null)
  const [runBusy, setRunBusy] = useState(false)
  const [error, setError] = useState('')
  const [tokens, setTokens] = useState<BackendToken[]>([])
  const [cliTokens, setCliTokens] = useState<CLIToken[]>([])
  const [newToken, setNewToken] = useState<string | null>(null)
  const [tokenBusy, setTokenBusy] = useState(false)
  const [remoteURL, setRemoteURL] = useState('')
  const [remotePAT, setRemotePAT] = useState('')
  const [remoteBusy, setRemoteBusy] = useState(false)
  const [members, setMembers] = useState<Member[]>([])
  const [memberEmail, setMemberEmail] = useState('')
  const [memberRole, setMemberRole] = useState<Member['role']>('writer')
  const [memberBusy, setMemberBusy] = useState(false)
  const [webhookURL, setWebhookURL] = useState('')
  const [webhookSecret, setWebhookSecret] = useState<string | null>(null)
  const [webhookConfigured, setWebhookConfigured] = useState(false)
  const [webhookBusy, setWebhookBusy] = useState(false)
  const [settingsBusy, setSettingsBusy] = useState(false)
  const [driftMinutes, setDriftMinutes] = useState('')
  const [secrets, setSecrets] = useState<NamespaceSecret[]>([])
  const [secretKey, setSecretKey] = useState('')
  const [secretValue, setSecretValue] = useState('')
  const [secretBusy, setSecretBusy] = useState(false)
  const [stateView, setStateView] = useState<StateView | null>(null)
  const [stateBusy, setStateBusy] = useState(false)
  const [guideOpen, setGuideOpen] = useState(false)
  const [graph, setGraph] = useState<ConfigGraph | null>(null)
  const [graphBusy, setGraphBusy] = useState(false)
  const [importBusy, setImportBusy] = useState(false)
  const [syncKey, setSyncKey] = useState(0)

  const dirty = content !== savedContent
  const activeRun = runs.find((r) => r.id === activeRunId) ?? null
  const liveRun = runs.some((r) => r.status === 'queued' || r.status === 'running')

  const refreshMeta = useCallback(async () => {
    const [namespace, files, runList, tokenList, cliTokenList, memberList, webhook, secretList, state, graphData] =
      await Promise.all([
        api.getNamespace(id),
        api.listFiles(id),
        api.listRuns(id),
        api.listBackendTokens(id).catch(() => ({ tokens: [] as BackendToken[] })),
        api.listCLITokens(id).catch(() => ({ tokens: [] as CLIToken[] })),
        api.listMembers(id).catch(() => ({ members: [] as Member[] })),
        api.getWebhook(id).catch(() => ({ configured: false as boolean, url: undefined as string | undefined })),
        api.listSecrets(id).catch(() => ({ secrets: [] as NamespaceSecret[] })),
        api.getState(id).catch(() => null),
        api.getGraph(id).catch(() => null),
      ])
    setNs(namespace)
    setDriftMinutes(
      namespace.drift_interval_minutes != null ? String(namespace.drift_interval_minutes) : '',
    )
    setTree(files)
    setRuns(runList.runs)
    setTokens(tokenList.tokens)
    setCliTokens(cliTokenList.tokens)
    setMembers(memberList.members)
    setWebhookConfigured(webhook.configured)
    if ('url' in webhook && webhook.url) setWebhookURL(webhook.url)
    setSecrets(secretList.secrets)
    setStateView(state)
    setGraph(graphData)
  }, [id])

  useEffect(() => {
    refreshMeta().catch((err) => {
      setError(err instanceof ApiError ? err.message : 'Failed to load namespace')
    })
  }, [refreshMeta])

  // Auto-open first Terraform file for inspect when nothing selected.
  useEffect(() => {
    if (selectedPath || !tree?.children?.length) return
    const paths = collectFilePaths(tree.children)
    const first = paths.find((p) => p.endsWith('.tf')) ?? paths[0]
    if (first) void openFile(first, { force: true })
    // Intentionally only when tree identity changes and nothing is selected yet.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tree])

  useEffect(() => {
    const hasActive = runs.some(
      (r) => r.awaiting_approval || r.status === 'queued' || r.status === 'running',
    )
    if (!hasActive) return
    const t = window.setInterval(() => {
      void api.listRuns(id).then((res) => {
        setRuns(res.runs)
        void api.getNamespace(id).then(setNs)
      })
    }, 2000)
    return () => window.clearInterval(t)
  }, [id, runs])

  async function openFile(path: string, opts?: { force?: boolean }) {
    if (!opts?.force && dirty && !confirm('Discard unsaved changes?')) return
    try {
      const file = await api.readFile(id, path)
      setSelectedPath(path)
      setContent(file.content)
      setSavedContent(file.content)
      setError('')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to open file')
    }
  }

  async function refreshFiles() {
    try {
      const files = await api.listFiles(id)
      setTree(files)
      if (selectedPath) {
        await openFile(selectedPath, { force: !dirty })
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to refresh files')
    }
  }

  async function saveFile() {
    if (!selectedPath) return
    if (
      !confirm(
        `Save changes to ${selectedPath}?\n\nThis commits into the namespace repo used by dashboard Init/Plan/Apply.`,
      )
    ) {
      return
    }
    setSaving(true)
    setError('')
    try {
      const file = await api.writeFile(id, selectedPath, content)
      setSavedContent(file.content)
      const files = await api.listFiles(id)
      setTree(files)
      // Mirror to linked local folder so dashboard edits stay in sync without conflict.
      try {
        await writeLocalFile(id, selectedPath, content)
      } catch {
        /* local link optional */
      }
      setSyncKey((k) => k + 1)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  async function importProjectFiles(files: Record<string, string>) {
    setImportBusy(true)
    setError('')
    try {
      const res = await api.importFiles(id, files)
      const treeRes = await api.listFiles(id)
      setTree(treeRes)
      const firstTf = res.paths.find((p) => p.endsWith('.tf')) ?? res.paths[0]
      if (firstTf) await openFile(firstTf, { force: true })
      void refreshGraph()
      setSyncKey((k) => k + 1)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Import failed')
    } finally {
      setImportBusy(false)
    }
  }

  function newFile() {
    const path = prompt('New file path (e.g. main.tf)')
    if (!path) return
    if (dirty && !confirm('Discard unsaved changes?')) return
    setSelectedPath(path)
    setContent('')
    setSavedContent('__new__')
  }

  async function triggerRun(type: RunType) {
    if (dirty) {
      alert('Save your changes before running Terraform.')
      return
    }
    setRunBusy(true)
    setError('')
    try {
      const run = await api.createRun(id, type)
      setActiveRunId(run.id)
      setRuns((prev) => [run, ...prev])
      if (run.awaiting_approval) {
        setError('Apply queued — waiting for approval.')
      }
      window.requestAnimationFrame(() => {
        document.getElementById('runs-dashboard')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to start run')
    } finally {
      setRunBusy(false)
    }
  }

  async function approveRun(runId: string) {
    setRunBusy(true)
    setError('')
    try {
      const run = await api.approveRun(id, runId)
      setRuns((prev) => prev.map((r) => (r.id === run.id ? run : r)))
      setActiveRunId(run.id)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Approve failed')
    } finally {
      setRunBusy(false)
    }
  }

  async function cancelRun(runId: string) {
    if (!confirm('Cancel this run?')) return
    setRunBusy(true)
    setError('')
    try {
      const run = await api.cancelRun(id, runId)
      setRuns((prev) => prev.map((r) => (r.id === run.id ? run : r)))
      void api.getNamespace(id).then(setNs)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Cancel failed')
    } finally {
      setRunBusy(false)
    }
  }

  async function createToken() {
    setTokenBusy(true)
    setError('')
    try {
      const token = await api.createBackendToken(id, 'http-backend')
      setNewToken(token.token ?? null)
      setTokens((prev) => [{ ...token, token: undefined }, ...prev])
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create token')
    } finally {
      setTokenBusy(false)
    }
  }

  async function revokeToken(tokenId: string) {
    if (!confirm('Revoke this backend token?')) return
    try {
      await api.revokeBackendToken(id, tokenId)
      setTokens((prev) =>
        prev.map((t) =>
          t.id === tokenId ? { ...t, revoked_at: new Date().toISOString() } : t,
        ),
      )
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to revoke token')
    }
  }

  async function connectRemote() {
    if (!remoteURL.trim()) return
    setRemoteBusy(true)
    setError('')
    try {
      const updated = await api.connectRemote(id, {
        remote_url: remoteURL.trim(),
        pat: remotePAT || undefined,
        push: true,
      })
      setNs(updated)
      setRemotePAT('')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to connect remote')
    } finally {
      setRemoteBusy(false)
    }
  }

  async function remoteAction(kind: 'push' | 'pull' | 'fetch') {
    setRemoteBusy(true)
    setError('')
    try {
      if (kind === 'push') await api.pushRemote(id, remotePAT || undefined)
      if (kind === 'pull') await api.pullRemote(id, remotePAT || undefined)
      if (kind === 'fetch') await api.fetchRemote(id, remotePAT || undefined)
      const files = await api.listFiles(id)
      setTree(files)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : `${kind} failed`)
    } finally {
      setRemoteBusy(false)
    }
  }

  async function saveSettings(patch: {
    require_approval?: boolean
    drift_interval_minutes?: number | null
  }) {
    setSettingsBusy(true)
    setError('')
    try {
      const updated = await api.updateNamespaceSettings(id, patch)
      setNs(updated)
      setDriftMinutes(
        updated.drift_interval_minutes != null ? String(updated.drift_interval_minutes) : '',
      )
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to update settings')
    } finally {
      setSettingsBusy(false)
    }
  }

  async function addMember() {
    if (!memberEmail.trim()) return
    setMemberBusy(true)
    setError('')
    try {
      const m = await api.addMember(id, memberEmail.trim(), memberRole)
      setMembers((prev) => [...prev.filter((x) => x.user_id !== m.user_id), m])
      setMemberEmail('')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to add member')
    } finally {
      setMemberBusy(false)
    }
  }

  async function changeMemberRole(userId: string, role: Member['role']) {
    try {
      const m = await api.updateMember(id, userId, role)
      setMembers((prev) => prev.map((x) => (x.user_id === userId ? m : x)))
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to update role')
    }
  }

  async function removeMember(userId: string) {
    if (!confirm('Remove this member?')) return
    try {
      await api.removeMember(id, userId)
      setMembers((prev) => prev.filter((m) => m.user_id !== userId))
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to remove member')
    }
  }

  async function rotateWebhook() {
    setWebhookBusy(true)
    setError('')
    try {
      const res = await api.rotateWebhook(id)
      setWebhookConfigured(true)
      setWebhookURL(res.url)
      setWebhookSecret(res.webhook.secret ?? null)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create webhook')
    } finally {
      setWebhookBusy(false)
    }
  }

  async function saveSecret() {
    if (!secretKey.trim() || !secretValue) return
    setSecretBusy(true)
    setError('')
    try {
      const sec = await api.upsertSecret(id, secretKey.trim(), secretValue)
      setSecrets((prev) => {
        const rest = prev.filter((s) => s.key !== sec.key)
        return [...rest, sec].sort((a, b) => a.key.localeCompare(b.key))
      })
      setSecretKey('')
      setSecretValue('')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to save secret')
    } finally {
      setSecretBusy(false)
    }
  }

  async function removeSecret(secretId: string, key: string) {
    if (!confirm(`Delete secret ${key}?`)) return
    try {
      await api.deleteSecret(id, secretId)
      setSecrets((prev) => prev.filter((s) => s.id !== secretId))
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to delete secret')
    }
  }

  async function refreshGraph() {
    setGraphBusy(true)
    try {
      setGraph(await api.getGraph(id))
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to build config map')
    } finally {
      setGraphBusy(false)
    }
  }

  async function openConnect() {
    setGuideOpen(true)
  }

  async function revokeCliToken(tokenId: string) {
    if (!confirm('Revoke this CLI token? Local companion CLI will stop working until you download a new pack.'))
      return
    try {
      await api.revokeCLIToken(id, tokenId)
      setCliTokens((prev) =>
        prev.map((t) => (t.id === tokenId ? { ...t, revoked_at: new Date().toISOString() } : t)),
      )
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to revoke CLI token')
    }
  }

  const stateURL = `${window.location.origin}/api/state/${id}`
  const fullWebhookURL = webhookURL ? `${window.location.origin}${webhookURL}` : ''

  return (
    <AppShell wide>
      <header className="mb-6">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-display text-2xl font-bold text-ink sm:text-3xl">
            {ns?.name ?? '…'}
          </h1>
          {ns && <StatusBadge status={ns.status} />}
          {ns?.has_drift && (
            <span className="border-2 border-ember bg-ember/15 px-2 py-0.5 text-sm font-bold text-ember-deep">
              drift detected
            </span>
          )}
          {ns?.require_approval && (
            <span className="text-xs font-medium text-ember-deep">approval required</span>
          )}
          <div className="ml-auto flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => openConnect()}
              className="btn-primary btn-compact px-3 text-base"
            >
              Connect with curl
            </button>
          </div>
        </div>
        {ns && (
          <p className="mt-1 text-xs text-ink-muted">
            {ns.slug} · terraform {ns.terraform_version} · {ns.default_branch}
          </p>
        )}
      </header>

      {error && <p className="mb-4 text-sm text-danger">{error}</p>}

      <div className="mb-6">
        {stateView ? (
          <StateMap
            state={stateView}
            busy={stateBusy}
            onRefresh={() => {
              setStateBusy(true)
              api
                .getState(id)
                .then(setStateView)
                .catch((err) =>
                  setError(err instanceof ApiError ? err.message : 'Failed to load state'),
                )
                .finally(() => setStateBusy(false))
            }}
          />
        ) : (
          <section className="space-y-3 border-2 border-line bg-panel/80 p-4">
            <h2 className="font-display text-xl font-bold">State map</h2>
            <p className="text-base text-ink-muted">
              {stateBusy ? 'Loading state…' : 'No state loaded yet.'}{' '}
              <button
                type="button"
                className="font-bold text-ember-deep hover:underline"
                onClick={() => {
                  setStateBusy(true)
                  api
                    .getState(id)
                    .then(setStateView)
                    .catch((err) =>
                      setError(err instanceof ApiError ? err.message : 'Failed to load state'),
                    )
                    .finally(() => setStateBusy(false))
                }}
              >
                Load state
              </button>
              {' · '}
              <button
                type="button"
                onClick={() => setGuideOpen(true)}
                className="font-bold text-ember-deep hover:underline"
              >
                Connect local Terraform
              </button>
            </p>
          </section>
        )}
      </div>

      <div className="mb-6">
        <ConfigMap
          graph={graph}
          loading={graphBusy}
          onRefresh={() => void refreshGraph()}
        />
      </div>

      <div className="mb-6">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="font-display text-xl font-bold text-ink sm:text-2xl">Configuration</h2>
            <p className="mt-1 text-base text-ink-muted">
              Server-side Terraform files. Link a local folder or run terraforge watch so dashboard
              edits stay mirrored locally.
            </p>
          </div>
        </div>
        <ConfigSyncPanel namespaceId={id} refreshKey={syncKey} />
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
          onRefresh={() => void refreshFiles()}
          onRevert={() => {
            if (selectedPath) void openFile(selectedPath, { force: true })
          }}
          onImportFiles={importProjectFiles}
        />
      </div>
      <section
        id="runs-dashboard"
        className="mt-6 flex min-h-[min(85dvh,58rem)] flex-col gap-3 border-2 border-line bg-panel/70 p-3 sm:p-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-xl font-bold text-ink sm:text-2xl">Terraform lifecycle</h2>
            <p className="mt-1 text-base text-ink-muted">
              Full console + history. Failed runs show the error reason when available.
            </p>
          </div>
          <RunPanel busy={runBusy} live={liveRun} onRun={(t) => void triggerRun(t)} />
        </div>

        {liveRun && activeRun && (activeRun.status === 'queued' || activeRun.status === 'running') && (
          <div className="run-live-banner flex flex-wrap items-center gap-3 px-4 py-3 text-base font-bold text-[#1f2a33]">
            <span className="run-live-dot" aria-hidden />
            <span className="uppercase tracking-wide">
              Working — {activeRun.type} ({activeRun.status})
            </span>
            <span className="font-mono text-sm font-semibold opacity-90">
              Watch the console — output streams live
            </span>
          </div>
        )}

        <div className="flex min-h-0 flex-1 flex-col gap-3">
          {activeRun?.source === 'cli' && !activeRun.log_path ? (
            <div className="border-2 border-line bg-panel px-4 py-6 text-base text-ink-muted">
              No logs available — run via CLI wrapper for full output.
              {activeRun.summary && (
                <pre className="mt-3 overflow-auto font-mono text-sm text-ink">
                  {JSON.stringify(activeRun.summary, null, 2)}
                </pre>
              )}
            </div>
          ) : (
            <LogConsole namespaceId={id} runId={activeRunId} run={activeRun} fill />
          )}

          <div className="max-h-[min(40dvh,22rem)] overflow-y-auto">
            <RunsList
              runs={runs}
              activeRunId={activeRunId}
              busy={runBusy}
              onSelect={setActiveRunId}
              onApprove={(rid) => void approveRun(rid)}
              onCancel={(rid) => void cancelRun(rid)}
            />
          </div>
        </div>
      </section>

      <section className="mt-8 space-y-3 border border-line bg-panel/80 p-4">
        <h2 className="font-display text-lg font-bold">Namespace settings</h2>
        <label className="flex items-center gap-2 text-sm text-ink">
          <input
            type="checkbox"
            checked={!!ns?.require_approval}
            disabled={settingsBusy || !ns}
            onChange={(e) => void saveSettings({ require_approval: e.target.checked })}
            className="size-4 accent-moss-deep"
          />
          Require approval for apply / destroy
        </label>
        <div className="flex flex-wrap items-end gap-2">
          <label className="block text-sm">
            <span className="mb-1 block text-ink-muted">Drift check interval (minutes)</span>
            <input
              type="number"
              min={0}
              value={driftMinutes}
              onChange={(e) => setDriftMinutes(e.target.value)}
              placeholder="0 = off"
              className="w-40 border border-line bg-paper px-3 py-2 outline-none ring-ember/30 focus:ring-2"
            />
          </label>
          <button
            type="button"
            disabled={settingsBusy}
            onClick={() => {
              const n = Number(driftMinutes)
              void saveSettings({
                drift_interval_minutes: !driftMinutes || Number.isNaN(n) || n <= 0 ? 0 : n,
              })
            }}
            className="border border-line bg-panel px-3 py-2 text-sm hover:bg-paper-deep disabled:opacity-60"
          >
            Save drift
          </button>
        </div>
      </section>

      <section className="mt-8 space-y-3 border border-line bg-panel/80 p-4">
        <h2 className="font-display text-lg font-bold">Members</h2>
        <div className="flex flex-wrap gap-2">
          <input
            type="email"
            value={memberEmail}
            onChange={(e) => setMemberEmail(e.target.value)}
            placeholder="user@example.com"
            className="min-w-[220px] flex-1 border border-line bg-paper px-3 py-2 text-sm outline-none ring-ember/30 focus:ring-2"
          />
          <select
            value={memberRole}
            onChange={(e) => setMemberRole(e.target.value as Member['role'])}
            className="border border-line bg-paper px-3 py-2 text-sm"
          >
            <option value="admin">admin</option>
            <option value="writer">writer</option>
            <option value="viewer">viewer</option>
          </select>
          <button
            type="button"
            disabled={memberBusy || !memberEmail.trim()}
            onClick={() => void addMember()}
            className="bg-moss-deep px-4 py-2 text-sm font-medium text-paper hover:bg-moss disabled:opacity-60"
          >
            Add
          </button>
        </div>
        <ul className="divide-y divide-line border border-line">
          {members.length === 0 ? (
            <li className="px-3 py-4 text-sm text-ink-muted">No members listed.</li>
          ) : (
            members.map((m) => (
              <li key={m.user_id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                <span>{m.email}</span>
                <div className="flex items-center gap-2">
                  <select
                    value={m.role}
                    onChange={(e) =>
                      void changeMemberRole(m.user_id, e.target.value as Member['role'])
                    }
                    className="border border-line bg-paper px-2 py-1 text-xs"
                  >
                    <option value="admin">admin</option>
                    <option value="writer">writer</option>
                    <option value="viewer">viewer</option>
                  </select>
                  <button
                    type="button"
                    onClick={() => void removeMember(m.user_id)}
                    className="text-xs text-danger hover:underline"
                  >
                    Remove
                  </button>
                </div>
              </li>
            ))
          )}
        </ul>
      </section>

      <section className="mt-8 space-y-3 border border-line bg-panel/80 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-lg font-bold">Webhook</h2>
            <p className="mt-1 text-sm text-ink-muted">
              Git push events enqueue an automatic plan.
            </p>
          </div>
          <button
            type="button"
            disabled={webhookBusy}
            onClick={() => void rotateWebhook()}
            className="bg-moss-deep px-4 py-2 text-sm font-medium text-paper hover:bg-moss disabled:opacity-60"
          >
            {webhookBusy
              ? 'Working…'
              : webhookConfigured
                ? 'Rotate secret'
                : 'Enable webhook'}
          </button>
        </div>
        {webhookConfigured && fullWebhookURL && (
          <div className="space-y-2 text-sm">
            <p className="text-ink-muted">POST to:</p>
            <code className="block break-all bg-paper px-3 py-2 text-xs">{fullWebhookURL}</code>
            <p className="text-ink-muted">Header: X-Terraforge-Secret</p>
          </div>
        )}
        {webhookSecret && (
          <div className="border border-ember/40 bg-paper p-3 text-sm">
            <p className="font-medium text-ember-deep">Secret — copy now</p>
            <code className="mt-2 block break-all text-xs">{webhookSecret}</code>
          </div>
        )}
      </section>

      <section className="mt-8 space-y-3 border-2 border-line bg-panel/80 p-4">
        <div>
          <h2 className="font-display text-lg font-bold">Secrets</h2>
          <p className="mt-1 text-base text-ink-muted">
            Encrypted at rest. Injected into runner containers as env vars (use{' '}
            <code className="font-mono">TF_VAR_*</code> for Terraform variables). Optional:{' '}
            <code className="font-mono">GITHUB_TOKEN</code> for PR comments,{' '}
            <code className="font-mono">SLACK_WEBHOOK_URL</code> for run notifications.
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            value={secretKey}
            onChange={(e) => setSecretKey(e.target.value)}
            placeholder="KEY or TF_VAR_name"
            className="field sm:max-w-[14rem]"
          />
          <input
            type="password"
            value={secretValue}
            onChange={(e) => setSecretValue(e.target.value)}
            placeholder="Value"
            className="field min-w-0 flex-1"
          />
          <button
            type="button"
            disabled={secretBusy || !secretKey.trim() || !secretValue}
            onClick={() => void saveSecret()}
            className="btn-primary shrink-0"
          >
            {secretBusy ? 'Saving…' : 'Save'}
          </button>
        </div>
        <ul className="divide-y-2 divide-line border-2 border-line">
          {secrets.length === 0 ? (
            <li className="px-3 py-4 text-base text-ink-muted">No secrets yet.</li>
          ) : (
            secrets.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-base">
                <span className="font-mono font-bold">{s.key}</span>
                <button
                  type="button"
                  onClick={() => void removeSecret(s.id, s.key)}
                  className="text-base font-bold text-danger hover:underline"
                >
                  Delete
                </button>
              </li>
            ))
          )}
        </ul>
      </section>

      <section className="mt-8 space-y-3 border border-line bg-panel/80 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-lg font-bold">Local connect & tokens</h2>
            <p className="mt-1 text-sm text-ink-muted">
            Prefer <strong>Get curl command</strong> — one-time install in your project folder (no
            zip). API URL is this site: {window.location.origin}
            </p>
          </div>
          <button
            type="button"
            onClick={() => openConnect()}
            className="bg-moss-deep px-4 py-2 text-sm font-medium text-paper hover:bg-moss"
          >
            Get curl command
          </button>
        </div>

        <h3 className="pt-2 text-base font-bold text-ink">HTTP backend tokens</h3>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={tokenBusy}
            onClick={() => void createToken()}
            className="border border-line bg-panel px-3 py-1.5 text-sm hover:bg-paper-deep disabled:opacity-60"
          >
            {tokenBusy ? 'Generating…' : 'Generate backend token'}
          </button>
          <button
            type="button"
            onClick={() => setGuideOpen(true)}
            className="text-sm font-bold text-ember-deep hover:underline"
          >
            How to connect?
          </button>
        </div>

        {newToken && (
          <div className="border border-ember/40 bg-paper p-3 text-sm">
            <p className="font-medium text-ember-deep">Copy now — shown once</p>
            <code className="mt-2 block break-all text-xs">{newToken}</code>
            <pre className="mt-3 overflow-auto bg-[#2f3d4a] p-3 font-mono text-sm text-[#d8e1e9]">{`terraform {
  backend "http" {
    address        = "${stateURL}"
    lock_address   = "${stateURL}"
    unlock_address = "${stateURL}"
    username       = "terraforge"
    password       = "${newToken}"
  }
}`}</pre>
          </div>
        )}

        <ul className="divide-y divide-line border border-line">
          {tokens.length === 0 ? (
            <li className="px-3 py-4 text-sm text-ink-muted">No backend tokens yet.</li>
          ) : (
            tokens.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                <span>
                  {t.label}
                  <span className="ml-2 text-xs text-ink-muted">
                    {t.revoked_at ? 'revoked' : 'active'} · {new Date(t.created_at).toLocaleString()}
                  </span>
                </span>
                {!t.revoked_at && (
                  <button
                    type="button"
                    onClick={() => void revokeToken(t.id)}
                    className="text-xs text-danger hover:underline"
                  >
                    Revoke
                  </button>
                )}
              </li>
            ))
          )}
        </ul>

        <h3 className="pt-4 text-base font-bold text-ink">Companion CLI tokens</h3>
        <p className="text-sm text-ink-muted">
          Created by the connect pack. Scoped to this namespace; not your browser login.
        </p>
        <ul className="divide-y divide-line border border-line">
          {cliTokens.length === 0 ? (
            <li className="px-3 py-4 text-sm text-ink-muted">No CLI tokens yet — download a connect pack.</li>
          ) : (
            cliTokens.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                <span>
                  {t.label}
                  <span className="ml-2 text-xs text-ink-muted">
                    {t.revoked_at ? 'revoked' : 'active'} · expires{' '}
                    {new Date(t.expires_at).toLocaleString()}
                  </span>
                </span>
                {!t.revoked_at && (
                  <button
                    type="button"
                    onClick={() => void revokeCliToken(t.id)}
                    className="text-xs text-danger hover:underline"
                  >
                    Revoke
                  </button>
                )}
              </li>
            ))
          )}
        </ul>
      </section>

      <section className="mt-8 space-y-3 border border-line bg-panel/80 p-4">
        <h2 className="font-display text-lg font-bold">Git remote</h2>
        {ns?.has_remote && ns.remote_url ? (
          <>
            <p className="truncate text-sm text-ink-muted">{ns.remote_url}</p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={remoteBusy}
                onClick={() => void remoteAction('push')}
                className="border border-line bg-panel px-3 py-1.5 text-sm hover:bg-paper-deep disabled:opacity-60"
              >
                Push
              </button>
              <button
                type="button"
                disabled={remoteBusy}
                onClick={() => void remoteAction('pull')}
                className="border border-line bg-panel px-3 py-1.5 text-sm hover:bg-paper-deep disabled:opacity-60"
              >
                Pull
              </button>
              <button
                type="button"
                disabled={remoteBusy}
                onClick={() => void remoteAction('fetch')}
                className="border border-line bg-panel px-3 py-1.5 text-sm hover:bg-paper-deep disabled:opacity-60"
              >
                Fetch
              </button>
            </div>
            <input
              type="password"
              value={remotePAT}
              onChange={(e) => setRemotePAT(e.target.value)}
              placeholder="PAT (optional, for private remotes)"
              className="w-full border border-line bg-paper px-3 py-2 text-sm outline-none ring-ember/30 focus:ring-2"
            />
          </>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-ink-muted">
              Connect this local namespace to GitHub / GitLab / Gitea.
            </p>
            <input
              value={remoteURL}
              onChange={(e) => setRemoteURL(e.target.value)}
              placeholder="https://github.com/org/repo.git"
              className="w-full border border-line bg-paper px-3 py-2 text-sm outline-none ring-ember/30 focus:ring-2"
            />
            <input
              type="password"
              value={remotePAT}
              onChange={(e) => setRemotePAT(e.target.value)}
              placeholder="PAT (optional)"
              className="w-full border border-line bg-paper px-3 py-2 text-sm outline-none ring-ember/30 focus:ring-2"
            />
            <button
              type="button"
              disabled={remoteBusy || !remoteURL.trim()}
              onClick={() => void connectRemote()}
              className="bg-moss-deep px-4 py-2 text-sm font-medium text-paper hover:bg-moss disabled:opacity-60"
            >
              {remoteBusy ? 'Connecting…' : 'Connect & push'}
            </button>
          </div>
        )}
      </section>

      <ConnectLocalGuide
        open={guideOpen}
        onClose={() => setGuideOpen(false)}
        namespaceId={id}
        namespaceName={ns?.name}
        onInstalled={() => {
          void api.listBackendTokens(id).then((r) => setTokens(r.tokens)).catch(() => {})
          void api.listCLITokens(id).then((r) => setCliTokens(r.tokens)).catch(() => {})
        }}
      />
    </AppShell>
  )
}
