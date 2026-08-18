/** Chromium File System Access API helpers for linking a local project folder. */

const DB_NAME = 'terraforge-local-folders'
const STORE = 'handles'

export type LinkedFolder = {
  name: string
  linkedAt: string
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export function canLinkLocalFolder(): boolean {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window
}

export async function linkLocalFolder(namespaceId: string): Promise<LinkedFolder> {
  // @ts-expect-error showDirectoryPicker is Chromium-only
  const handle = (await window.showDirectoryPicker({
    mode: 'readwrite',
    id: `terraforge-${namespaceId}`,
  })) as FileSystemDirectoryHandle
  const db = await openDB()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(handle, namespaceId)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
  db.close()
  return { name: handle.name, linkedAt: new Date().toISOString() }
}

export async function unlinkLocalFolder(namespaceId: string): Promise<void> {
  const db = await openDB()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).delete(namespaceId)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
  db.close()
}

async function getHandle(namespaceId: string): Promise<FileSystemDirectoryHandle | null> {
  const db = await openDB()
  const handle = await new Promise<FileSystemDirectoryHandle | null>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly')
    const req = tx.objectStore(STORE).get(namespaceId)
    req.onsuccess = () => resolve((req.result as FileSystemDirectoryHandle) ?? null)
    req.onerror = () => reject(req.error)
  })
  db.close()
  if (!handle) return null
  // Re-verify permission
  // @ts-expect-error queryPermission
  const perm = await handle.queryPermission({ mode: 'readwrite' })
  if (perm === 'granted') return handle
  // @ts-expect-error requestPermission
  const next = await handle.requestPermission({ mode: 'readwrite' })
  return next === 'granted' ? handle : null
}

export async function getLinkedFolderInfo(namespaceId: string): Promise<LinkedFolder | null> {
  const handle = await getHandle(namespaceId)
  if (!handle) return null
  return { name: handle.name, linkedAt: '' }
}

async function ensurePath(
  root: FileSystemDirectoryHandle,
  relPath: string,
): Promise<{ dir: FileSystemDirectoryHandle; name: string }> {
  const parts = relPath.split('/').filter(Boolean)
  const name = parts.pop()!
  let dir = root
  for (const p of parts) {
    dir = await dir.getDirectoryHandle(p, { create: true })
  }
  return { dir, name }
}

/** Write a file into the linked local folder (creates parents). */
export async function writeLocalFile(
  namespaceId: string,
  relPath: string,
  content: string,
): Promise<boolean> {
  const root = await getHandle(namespaceId)
  if (!root) return false
  // Never write into connect secrets / terraform internals from the dashboard mirror.
  if (
    relPath.startsWith('terraforge_connect/') ||
    relPath.startsWith('.terraform/') ||
    relPath.endsWith('.tfstate')
  ) {
    return false
  }
  const { dir, name } = await ensurePath(root, relPath)
  const file = await dir.getFileHandle(name, { create: true })
  const writable = await file.createWritable()
  await writable.write(content)
  await writable.close()
  return true
}

export async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text)
  const buf = await crypto.subtle.digest('SHA-256', data)
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

const TRACK_EXT = ['.tf', '.tfvars', '.hcl', '.md', '.json', '.yml', '.yaml', '.tpl', '.tmpl', '.sh', '.txt']

function trackPath(path: string): boolean {
  const base = path.split('/').pop() ?? path
  if (base === '.gitignore' || base === '.terraform.lock.hcl') return true
  return TRACK_EXT.some((e) => base.toLowerCase().endsWith(e))
}

export async function localManifestDigest(
  namespaceId: string,
): Promise<{ digest: string; count: number } | null> {
  const root = await getHandle(namespaceId)
  if (!root) return null
  const entries: Array<{ path: string; hash: string }> = []

  async function walk(dir: FileSystemDirectoryHandle, prefix: string) {
    const iter = dir as FileSystemDirectoryHandle & {
      entries: () => AsyncIterableIterator<[string, FileSystemHandle]>
    }
    for await (const [name, handle] of iter.entries()) {
      const path = prefix ? `${prefix}/${name}` : name
      if (handle.kind === 'directory') {
        if (['.git', '.terraform', '.terraforge', 'terraforge_connect', 'node_modules'].includes(name)) {
          continue
        }
        await walk(handle as FileSystemDirectoryHandle, path)
      } else if (handle.kind === 'file' && trackPath(path)) {
        const file = await (handle as FileSystemFileHandle).getFile()
        const text = await file.text()
        entries.push({ path, hash: await sha256Hex(text) })
      }
    }
  }

  await walk(root, '')
  entries.sort((a, b) => a.path.localeCompare(b.path))
  const joined = entries.map((e) => `${e.path}\n${e.hash}\n`).join('')
  const digest = await sha256Hex(joined)
  return { digest, count: entries.length }
}
