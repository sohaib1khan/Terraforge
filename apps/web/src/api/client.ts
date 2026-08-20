export type User = {
  id: string
  email: string
  is_admin: boolean
  created_at: string
  disabled_at?: string | null
}

export type StateView = {
  exists: boolean
  updated_at?: string | null
  terraform_version?: string
  serial?: number
  lineage?: string
  resource_count: number
  resources: Array<{
    address: string
    mode: string
    type: string
    name: string
    provider?: string
    module?: string
    index_key?: unknown
    id?: string
    dependencies?: string[]
    attr_keys?: string[]
  }>
  outputs: Array<{
    name: string
    type?: string
    sensitive: boolean
    value?: unknown
  }>
  providers?: Array<{ name: string; count: number }>
  modules?: Array<{ name: string; count: number }>
  locked: boolean
  lock?: {
    ID?: string
    Operation?: string
    Who?: string
    Info?: string
  } | null
}

export type GraphNode = {
  id: string
  kind: 'resource' | 'data' | 'module' | 'variable' | 'output' | 'local'
  label: string
  type?: string
  name: string
  file?: string
  in_state: boolean
  provider?: string
}

export type ConfigEnvironment = {
  summary: string
  primary?: string
  providers: Array<{
    name: string
    label: string
    source?: string
    version?: string
    category: string
    declared: boolean
    in_config: boolean
    in_state: boolean
    resource_count: number
    data_count: number
  }>
  clouds: string[]
  has_local: boolean
  empty: boolean
  note?: string
}

export type ConfigGraph = {
  nodes: GraphNode[]
  edges: Array<{ from: string; to: string; kind: string }>
  files_scanned: number
  note?: string
  has_state: boolean
  environment?: ConfigEnvironment
}

export type VersionSuggestion = {
  kind: 'provider' | 'module'
  name: string
  label: string
  source: string
  current?: string
  latest?: string
  update_available: boolean
  newer_outside_constraint: boolean
  constraint_satisfied: boolean
  message: string
  docs_url?: string
  file?: string
}

export type Suggestions = {
  providers: VersionSuggestion[]
  modules: VersionSuggestion[]
  update_count: number
  bump_count: number
  checked_at: string
  note?: string
}

export type NamespaceSecret = {
  id: string
  namespace_id: string
  key: string
  created_at: string
  updated_at: string
}

export type AuthResponse = {
  token: string
  expires_at: string
  user: User
}

export type NamespaceStatus = 'never_run' | 'running' | 'healthy' | 'failed'

export type Namespace = {
  id: string
  name: string
  slug: string
  terraform_version: string
  has_remote: boolean
  remote_url: string | null
  default_branch: string
  require_approval: boolean
  drift_interval_minutes: number | null
  has_drift: boolean
  drift_detected_at?: string | null
  created_at: string
  status: NamespaceStatus
}

export type FileNode = {
  name: string
  path: string
  type: 'file' | 'dir'
  children?: FileNode[]
}

export type ConfigManifest = {
  digest: string
  commit_sha?: string
  updated_at?: string | null
  files: Array<{ path: string; sha256: string; bytes: number }>
  count: number
}

export type FileContent = {
  path: string
  content: string
  commit_sha?: string
}

export type RunType = 'init' | 'plan' | 'apply' | 'destroy'
export type RunStatus = 'queued' | 'running' | 'success' | 'failed' | 'canceled'

export type Run = {
  id: string
  namespace_id: string
  type: RunType
  status: RunStatus
  source: string
  commit_sha: string | null
  triggered_by: string | null
  started_at: string | null
  finished_at: string | null
  log_path: string | null
  created_at: string
  duration_ms?: number | null
  summary?: Record<string, unknown> | null
  awaiting_approval: boolean
  approved_by?: string | null
  approved_at?: string | null
}

export type Member = {
  namespace_id: string
  user_id: string
  email: string
  role: 'admin' | 'writer' | 'viewer'
  created_at: string
}

export type AuditEntry = {
  id: string
  actor: string
  action: string
  target: string | null
  metadata?: Record<string, unknown>
  created_at: string
}

export type WebhookConfig = {
  id: string
  namespace_id: string
  enabled: boolean
  last_delivery: string | null
  created_at: string
  secret?: string
}

export type BackendToken = {
  id: string
  namespace_id: string
  label: string
  created_at: string
  revoked_at: string | null
  token?: string
}

export type CLIToken = {
  id: string
  namespace_id: string
  label: string
  created_at: string
  expires_at: string
  revoked_at: string | null
  token?: string
}

export type ProviderSummary = {
  id: string
  namespace: string
  name: string
  full_name: string
  description: string
  source: string
  tier: string
  downloads: number
  version?: string
  logo_url?: string
}

export type ProviderDetail = {
  provider: ProviderSummary
  snippets: {
    required_providers: string
    provider_block: string
    combined: string
  }
  docs_url: string
}

export type ModuleSummary = {
  id: string
  namespace: string
  name: string
  provider: string
  full_name: string
  description: string
  source: string
  downloads: number
  version?: string
  verified: boolean
  logo_url?: string
}

export type ModuleInput = {
  name: string
  type: string
  description: string
  default?: string
  required: boolean
}

export type ModuleExample = {
  name: string
  path: string
  readme?: string
  source_line: string
  snippet: string
  inputs?: ModuleInput[]
  outputs?: { name: string; description: string }[]
  resource_count: number
}

export type ModuleDetail = {
  module: ModuleSummary
  snippet: string
  docs_url: string
  readme?: string
  inputs?: ModuleInput[]
  outputs?: { name: string; description: string }[]
  examples: ModuleExample[]
  example_count: number
}

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

const TOKEN_KEY = 'terraforge_token'

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

export function setToken(token: string | null) {
  if (token) localStorage.setItem(TOKEN_KEY, token)
  else localStorage.removeItem(TOKEN_KEY)
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  if (!headers.has('Content-Type') && init.body) {
    headers.set('Content-Type', 'application/json')
  }
  const token = getToken()
  if (token) headers.set('Authorization', `Bearer ${token}`)

  const res = await fetch(path, { ...init, headers })
  if (res.status === 204) return undefined as T

  const text = await res.text()
  let data: unknown = null
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      data = { error: text }
    }
  }

  if (!res.ok) {
    const msg =
      data && typeof data === 'object' && data !== null && 'error' in data
        ? String((data as { error: string }).error)
        : res.statusText
    throw new ApiError(res.status, msg)
  }
  return data as T
}

export const api = {
  setupStatus: () => request<{ needs_setup: boolean }>('/api/setup/status'),
  setup: (email: string, password: string) =>
    request<AuthResponse>('/api/setup', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),
  login: (email: string, password: string) =>
    request<AuthResponse>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),
  me: () => request<User>('/api/auth/me'),

  listUsers: () => request<{ users: User[] }>('/api/users'),
  createUser: (body: { email: string; password: string; is_admin?: boolean }) =>
    request<User>('/api/users', { method: 'POST', body: JSON.stringify(body) }),
  resetUserPassword: (id: string, password: string) =>
    request<void>(`/api/users/${id}/reset-password`, {
      method: 'POST',
      body: JSON.stringify({ password }),
    }),
  disableUser: (id: string) =>
    request<User>(`/api/users/${id}/disable`, { method: 'POST' }),
  enableUser: (id: string) =>
    request<User>(`/api/users/${id}/enable`, { method: 'POST' }),

  listNamespaces: () => request<{ namespaces: Namespace[] }>('/api/namespaces'),
  createNamespace: (body: {
    name: string
    slug?: string
    terraform_version?: string
    remote_url?: string
    pat?: string
  }) => request<Namespace>('/api/namespaces', { method: 'POST', body: JSON.stringify(body) }),
  getNamespace: (id: string) => request<Namespace>(`/api/namespaces/${id}`),
  updateNamespaceSettings: (
    id: string,
    body: { require_approval?: boolean; drift_interval_minutes?: number | null },
  ) =>
    request<Namespace>(`/api/namespaces/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  deleteNamespace: (id: string) =>
    request<void>(`/api/namespaces/${id}`, { method: 'DELETE' }),

  connectRemote: (id: string, body: { remote_url: string; pat?: string; push?: boolean }) =>
    request<Namespace>(`/api/namespaces/${id}/remote`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  pushRemote: (id: string, pat?: string) =>
    request<void>(`/api/namespaces/${id}/remote/push`, {
      method: 'POST',
      body: JSON.stringify({ pat }),
    }),
  pullRemote: (id: string, pat?: string) =>
    request<void>(`/api/namespaces/${id}/remote/pull`, {
      method: 'POST',
      body: JSON.stringify({ pat }),
    }),
  fetchRemote: (id: string, pat?: string) =>
    request<void>(`/api/namespaces/${id}/remote/fetch`, {
      method: 'POST',
      body: JSON.stringify({ pat }),
    }),

  listFiles: (id: string) => request<FileNode>(`/api/namespaces/${id}/files`),
  readFile: (id: string, path: string) =>
    request<FileContent>(`/api/namespaces/${id}/files/${path}`),
  writeFile: (id: string, path: string, content: string, message?: string) =>
    request<FileContent>(`/api/namespaces/${id}/files/${path}`, {
      method: 'PUT',
      body: JSON.stringify({ content, message }),
    }),
  importArchive: async (id: string, file: File) => {
    const token = getToken()
    const form = new FormData()
    form.append('archive', file)
    const res = await fetch(`/api/namespaces/${id}/import`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: form,
    })
    if (!res.ok) {
      let message = res.statusText
      try {
        const body = (await res.json()) as { error?: string }
        if (body.error) message = body.error
      } catch {
        /* ignore */
      }
      throw new ApiError(res.status, message)
    }
    return (await res.json()) as { files: number; paths: string[]; message: string }
  },
  importFiles: (id: string, files: Record<string, string>, message?: string) =>
    request<{ files: number; paths: string[]; message: string }>(
      `/api/namespaces/${id}/import-files`,
      {
        method: 'POST',
        body: JSON.stringify({ files, message }),
      },
    ),
  getConfigManifest: (id: string) =>
    request<ConfigManifest>(`/api/namespaces/${id}/config-manifest`),

  listRuns: (id: string) => request<{ runs: Run[] }>(`/api/namespaces/${id}/runs`),
  createRun: (id: string, type: RunType) =>
    request<Run>(`/api/namespaces/${id}/runs`, {
      method: 'POST',
      body: JSON.stringify({ type }),
    }),
  approveRun: (id: string, runId: string) =>
    request<Run>(`/api/namespaces/${id}/runs/${runId}/approve`, { method: 'POST' }),
  cancelRun: (id: string, runId: string) =>
    request<Run>(`/api/namespaces/${id}/runs/${runId}/cancel`, { method: 'POST' }),
  getRun: (id: string, runId: string) =>
    request<Run>(`/api/namespaces/${id}/runs/${runId}`),

  listMembers: (id: string) => request<{ members: Member[] }>(`/api/namespaces/${id}/members`),
  addMember: (id: string, email: string, role: Member['role']) =>
    request<Member>(`/api/namespaces/${id}/members`, {
      method: 'POST',
      body: JSON.stringify({ email, role }),
    }),
  updateMember: (id: string, userId: string, role: Member['role']) =>
    request<Member>(`/api/namespaces/${id}/members/${userId}`, {
      method: 'PUT',
      body: JSON.stringify({ role }),
    }),
  removeMember: (id: string, userId: string) =>
    request<void>(`/api/namespaces/${id}/members/${userId}`, { method: 'DELETE' }),

  getWebhook: (id: string) =>
    request<{ configured: boolean; webhook?: WebhookConfig; url?: string }>(
      `/api/namespaces/${id}/webhook`,
    ),
  rotateWebhook: (id: string) =>
    request<{ webhook: WebhookConfig; url: string; note: string }>(
      `/api/namespaces/${id}/webhook`,
      { method: 'POST' },
    ),

  listAudit: (limit = 500) =>
    request<{ entries: AuditEntry[] }>(`/api/audit?limit=${limit}`),

  searchProviders: (q = '', limit = 25, offset = 0) =>
    request<{ providers: ProviderSummary[]; total: number }>(
      `/api/providers?q=${encodeURIComponent(q)}&limit=${limit}&offset=${offset}`,
    ),
  getProvider: (namespace: string, name: string) =>
    request<ProviderDetail>(
      `/api/providers/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`,
    ),

  searchModules: (q = '', limit = 50, offset = 0) =>
    request<{ modules: ModuleSummary[]; total: number }>(
      `/api/modules?q=${encodeURIComponent(q)}&limit=${limit}&offset=${offset}`,
    ),
  getModule: (namespace: string, name: string, provider: string) =>
    request<ModuleDetail>(
      `/api/modules/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}/${encodeURIComponent(provider)}`,
    ),

  listBackendTokens: (id: string) =>
    request<{ tokens: BackendToken[] }>(`/api/namespaces/${id}/backend-tokens`),
  createBackendToken: (id: string, label?: string) =>
    request<BackendToken>(`/api/namespaces/${id}/backend-tokens`, {
      method: 'POST',
      body: JSON.stringify({ label: label || 'default' }),
    }),
  revokeBackendToken: (id: string, tokenId: string) =>
    request<void>(`/api/namespaces/${id}/backend-tokens/${tokenId}`, { method: 'DELETE' }),

  listCLITokens: (id: string) =>
    request<{ tokens: CLIToken[] }>(`/api/namespaces/${id}/cli-tokens`),
  revokeCLIToken: (id: string, tokenId: string) =>
    request<void>(`/api/namespaces/${id}/cli-tokens/${tokenId}`, { method: 'DELETE' }),

  downloadConnectPack: async (id: string) => {
    const token = getToken()
    const res = await fetch(`/api/namespaces/${id}/connect-pack`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
    if (!res.ok) {
      let message = res.statusText
      try {
        const body = (await res.json()) as { error?: string }
        if (body.error) message = body.error
      } catch {
        /* ignore */
      }
      throw new ApiError(res.status, message)
    }
    const blob = await res.blob()
    const dispo = res.headers.get('Content-Disposition') ?? ''
    const match = /filename="([^"]+)"/.exec(dispo)
    const filename = match?.[1] ?? `terraforge-connect-${id.slice(0, 8)}.zip`
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  },

  createConnectInstall: (id: string) =>
    request<{
      code: string
      expires_at: string
      curl: string
      wget: string
      note: string
    }>(`/api/namespaces/${id}/connect-install`, { method: 'POST' }),

  listSecrets: (id: string) =>
    request<{ secrets: NamespaceSecret[] }>(`/api/namespaces/${id}/secrets`),
  upsertSecret: (id: string, key: string, value: string) =>
    request<NamespaceSecret>(`/api/namespaces/${id}/secrets`, {
      method: 'PUT',
      body: JSON.stringify({ key, value }),
    }),
  deleteSecret: (id: string, secretId: string) =>
    request<void>(`/api/namespaces/${id}/secrets/${secretId}`, { method: 'DELETE' }),

  getState: (id: string) => request<StateView>(`/api/namespaces/${id}/state`),
  getGraph: (id: string) => request<ConfigGraph>(`/api/namespaces/${id}/graph`),
  getSuggestions: (id: string) =>
    request<Suggestions>(`/api/namespaces/${id}/suggestions`),
}

export function runLogsWsUrl(namespaceId: string, runId: string): string {
  const token = getToken() ?? ''
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
  // Prefer same-origin (nginx proxies /api, including WS). Override only for local Vite dev.
  const apiHost = import.meta.env.VITE_API_WS_HOST || window.location.host
  return `${proto}://${apiHost}/api/namespaces/${namespaceId}/runs/${runId}/logs/ws?token=${encodeURIComponent(token)}`
}
