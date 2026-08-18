import { useCallback, useEffect, useState } from 'react'
import { api, ApiError, type ConfigManifest } from '../../api/client'
import {
  canLinkLocalFolder,
  getLinkedFolderInfo,
  linkLocalFolder,
  localManifestDigest,
  unlinkLocalFolder,
  type LinkedFolder,
} from '../../lib/localFolder'

type Props = {
  namespaceId: string
  refreshKey?: number
}

type SyncStatus = 'synced' | 'local_ahead' | 'remote_ahead' | 'diverged' | 'unknown' | 'no_local'

export function ConfigSyncPanel({ namespaceId, refreshKey = 0 }: Props) {
  const [remote, setRemote] = useState<ConfigManifest | null>(null)
  const [linked, setLinked] = useState<LinkedFolder | null>(null)
  const [localDigest, setLocalDigest] = useState<string | null>(null)
  const [localCount, setLocalCount] = useState(0)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    setError('')
    try {
      const m = await api.getConfigManifest(namespaceId)
      setRemote(m)
      const info = await getLinkedFolderInfo(namespaceId)
      setLinked(info)
      if (info) {
        const loc = await localManifestDigest(namespaceId)
        setLocalDigest(loc?.digest ?? null)
        setLocalCount(loc?.count ?? 0)
      } else {
        setLocalDigest(null)
        setLocalCount(0)
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load sync status')
    }
  }, [namespaceId])

  useEffect(() => {
    void refresh()
  }, [refresh, refreshKey])

  useEffect(() => {
    const t = window.setInterval(() => void refresh(), 8000)
    return () => window.clearInterval(t)
  }, [refresh])

  const status: SyncStatus = (() => {
    if (!remote) return 'unknown'
    if (!linked || !localDigest) return 'no_local'
    if (localDigest === remote.digest) return 'synced'
    return 'diverged'
  })()

  async function onLink() {
    setBusy(true)
    setError('')
    try {
      const info = await linkLocalFolder(namespaceId)
      setLinked(info)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not link folder')
    } finally {
      setBusy(false)
    }
  }

  async function onUnlink() {
    await unlinkLocalFolder(namespaceId)
    setLinked(null)
    setLocalDigest(null)
    await refresh()
  }

  const banner =
    status === 'synced'
      ? {
          cls: 'border-ok/40 bg-ok/10 text-ok',
          title: 'Hey — Terraforge and the local project folder are synced.',
        }
      : status === 'no_local'
        ? {
            cls: 'border-line/70 bg-panel text-ink',
            title: 'Link a local folder (or run terraforge watch) to keep both sides in sync.',
          }
        : {
            cls: 'border-warn/50 bg-warn/10 text-warn',
            title: 'Out of sync — pull/push or leave terraforge watch running.',
          }

  return (
    <section className={`mb-4 space-y-3 border-2 px-4 py-3 ${banner.cls}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-bold">{banner.title}</p>
          <p className="mt-1 text-sm opacity-90">
            Remote digest {remote ? `${remote.digest.slice(0, 12)}… · ${remote.count} files` : '…'}
            {linked && localDigest
              ? ` · local ${localDigest.slice(0, 12)}… · ${localCount} files · folder “${linked.name}”`
              : ''}
          </p>
        </div>
        <button
          type="button"
          className="btn-compact text-sm font-bold underline"
          onClick={() => void refresh()}
        >
          Recheck
        </button>
      </div>

      <ul className="space-y-1.5 text-base">
        <Check
          ok={!!remote && remote.count > 0}
          label="Terraforge has configuration files"
          detail={remote ? `${remote.count} tracked file(s)` : 'empty / loading'}
        />
        <Check
          ok={!!linked}
          label="Local folder linked in this browser"
          detail={
            linked
              ? linked.name
              : canLinkLocalFolder()
                ? 'Chromium: use Link local folder'
                : 'use CLI watch on this machine'
          }
        />
        <Check
          ok={status === 'synced'}
          label="Local ↔ Terraforge digests match"
          detail={
            status === 'synced'
              ? 'identical content fingerprint'
              : status === 'no_local'
                ? 'link folder or run terraforge status'
                : 'run terraforge pull / sync'
          }
        />
        <Check
          ok
          label="Auto sync while editing in the dashboard"
          detail="terraforge watch in the project (or linked folder writes on Save)"
        />
      </ul>

      <div className="flex flex-wrap gap-2 pt-1">
        {canLinkLocalFolder() && (
          linked ? (
            <button type="button" className="btn-secondary btn-compact px-3 text-sm" onClick={() => void onUnlink()}>
              Unlink local folder
            </button>
          ) : (
            <button
              type="button"
              disabled={busy}
              className="btn-primary btn-compact px-3 text-sm"
              onClick={() => void onLink()}
            >
              {busy ? 'Linking…' : 'Link local folder'}
            </button>
          )
        )}
      </div>

      <p className="font-mono text-sm opacity-90">
        terraforge status · terraforge pull · terraforge sync · terraforge watch
      </p>
      {error && (
        <p className="text-sm text-danger" role="alert">
          {error}
        </p>
      )}
    </section>
  )
}

function Check({ ok, label, detail }: { ok: boolean; label: string; detail: string }) {
  return (
    <li className="flex flex-wrap items-baseline gap-2">
      <span className="font-mono font-bold">{ok ? '[x]' : '[ ]'}</span>
      <span className="font-medium">{label}</span>
      <span className="text-sm opacity-80">— {detail}</span>
    </li>
  )
}
