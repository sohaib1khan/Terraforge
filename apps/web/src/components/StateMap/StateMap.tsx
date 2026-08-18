import { useMemo, useState } from 'react'
import type { StateView } from '../../api/client'

type Props = {
  state: StateView
  busy?: boolean
  onRefresh: () => void
}

type TreeNode = {
  id: string
  label: string
  kind: 'root' | 'module' | 'provider' | 'type' | 'resource' | 'outputs' | 'output'
  meta?: string
  count?: number
  resource?: StateView['resources'][number]
  output?: StateView['outputs'][number]
  children?: TreeNode[]
}

function buildStateTree(state: StateView): TreeNode {
  const root: TreeNode = {
    id: 'root',
    label: 'terraform state',
    kind: 'root',
    count: state.resource_count,
    children: [],
  }

  // module → provider → type → resources
  type Bucket = Map<string, Map<string, StateView['resources']>>
  const byModule: Bucket = new Map()

  for (const r of state.resources) {
    const mod = r.module?.trim() || '(root)'
    const prov = r.provider?.trim() || '(unknown)'
    if (!byModule.has(mod)) byModule.set(mod, new Map())
    const byProv = byModule.get(mod)!
    if (!byProv.has(prov)) byProv.set(prov, [])
    byProv.get(prov)!.push(r)
  }

  const modules = [...byModule.keys()].sort((a, b) => {
    if (a === '(root)') return -1
    if (b === '(root)') return 1
    return a.localeCompare(b)
  })

  for (const mod of modules) {
    const provMap = byModule.get(mod)!
    const modNode: TreeNode = {
      id: `mod:${mod}`,
      label: mod === '(root)' ? 'root module' : mod,
      kind: 'module',
      count: [...provMap.values()].reduce((n, list) => n + list.length, 0),
      children: [],
    }
    const providers = [...provMap.keys()].sort()
    for (const prov of providers) {
      const resources = provMap.get(prov)!
      const byType = new Map<string, typeof resources>()
      for (const r of resources) {
        const key = `${r.mode}:${r.type}`
        if (!byType.has(key)) byType.set(key, [])
        byType.get(key)!.push(r)
      }
      const provNode: TreeNode = {
        id: `mod:${mod}|prov:${prov}`,
        label: prov,
        kind: 'provider',
        count: resources.length,
        children: [],
      }
      for (const [key, list] of [...byType.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
        const [mode, typ] = key.split(':')
        const typeNode: TreeNode = {
          id: `mod:${mod}|prov:${prov}|type:${key}`,
          label: typ || key,
          kind: 'type',
          meta: mode,
          count: list.length,
          children: list
            .slice()
            .sort((a, b) => a.address.localeCompare(b.address))
            .map((r) => ({
              id: `res:${r.address}`,
              label: r.address,
              kind: 'resource' as const,
              meta: r.id ? `id ${r.id}` : undefined,
              resource: r,
            })),
        }
        provNode.children!.push(typeNode)
      }
      modNode.children!.push(provNode)
    }
    root.children!.push(modNode)
  }

  if (state.outputs.length > 0) {
    root.children!.push({
      id: 'outputs',
      label: 'outputs',
      kind: 'outputs',
      count: state.outputs.length,
      children: state.outputs.map((o) => ({
        id: `out:${o.name}`,
        label: o.name,
        kind: 'output' as const,
        meta: o.sensitive ? 'sensitive' : o.type || undefined,
        output: o,
      })),
    })
  }

  return root
}

function formatValue(v: unknown): string {
  if (v == null) return 'null'
  if (typeof v === 'string') return v
  try {
    return JSON.stringify(v, null, 2)
  } catch {
    return String(v)
  }
}

function kindBadge(kind: TreeNode['kind']): string {
  switch (kind) {
    case 'module':
      return 'mod'
    case 'provider':
      return 'prov'
    case 'type':
      return 'type'
    case 'resource':
      return 'res'
    case 'outputs':
    case 'output':
      return 'out'
    default:
      return 'state'
  }
}

function TreeRows({
  node,
  depth,
  open,
  toggle,
  selected,
  onSelect,
  query,
}: {
  node: TreeNode
  depth: number
  open: Record<string, boolean>
  toggle: (id: string) => void
  selected: string | null
  onSelect: (id: string) => void
  query: string
}) {
  const kids = node.children ?? []
  const hasKids = kids.length > 0
  const isOpen = open[node.id] ?? depth < 2
  const q = query.trim().toLowerCase()
  const selfMatch =
    !q ||
    node.label.toLowerCase().includes(q) ||
    (node.meta ?? '').toLowerCase().includes(q) ||
    (node.resource?.id ?? '').toLowerCase().includes(q)

  const childRows = hasKids
    ? kids
        .map((c) => (
          <TreeRows
            key={c.id}
            node={c}
            depth={depth + 1}
            open={open}
            toggle={toggle}
            selected={selected}
            onSelect={onSelect}
            query={query}
          />
        ))
        .filter(Boolean)
    : null

  // Hide non-matching leaves when searching; keep parents that have visible kids.
  if (q && !selfMatch && (node.kind === 'resource' || node.kind === 'output')) return null
  if (q && !selfMatch && hasKids && (!childRows || childRows.length === 0)) return null

  const active = selected === node.id

  return (
    <>
      <li>
        <div
          className={`flex w-full items-center gap-2 border-b border-line/40 px-2 py-1.5 text-left hover:bg-paper-deep/70 ${
            active ? 'bg-ember/15' : ''
          }`}
          style={{ paddingLeft: 8 + depth * 14 }}
        >
          {hasKids ? (
            <button
              type="button"
              className="inline-flex w-5 shrink-0 justify-center font-mono text-ink-muted"
              aria-expanded={isOpen}
              onClick={() => toggle(node.id)}
            >
              {isOpen ? '▾' : '▸'}
            </button>
          ) : (
            <span className="inline-block w-5 shrink-0" />
          )}
          <button
            type="button"
            className="flex min-w-0 flex-1 items-center gap-2 text-left"
            onClick={() => onSelect(node.id)}
          >
            <span className="shrink-0 rounded bg-paper-deep px-1.5 py-0.5 font-mono text-[0.65rem] font-bold uppercase text-ink-muted">
              {kindBadge(node.kind)}
            </span>
            <span className="truncate font-mono text-sm text-ink sm:text-base">{node.label}</span>
            {node.meta && (
              <span className="hidden truncate font-mono text-xs text-ink-muted sm:inline">
                {node.meta}
              </span>
            )}
            {node.count != null && (
              <span className="ml-auto shrink-0 font-mono text-xs text-ink-muted">{node.count}</span>
            )}
          </button>
        </div>
      </li>
      {hasKids && isOpen && childRows}
    </>
  )
}

function findNode(root: TreeNode, id: string): TreeNode | null {
  if (root.id === id) return root
  for (const c of root.children ?? []) {
    const f = findNode(c, id)
    if (f) return f
  }
  return null
}

export function StateMap({ state, busy, onRefresh }: Props) {
  const tree = useMemo(() => buildStateTree(state), [state])
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const [open, setOpen] = useState<Record<string, boolean>>({ root: true, outputs: true })

  const selectedNode = selected ? findNode(tree, selected) : null

  function toggle(id: string) {
    setOpen((prev) => ({ ...prev, [id]: !(prev[id] ?? true) }))
  }

  function expandAll() {
    const next: Record<string, boolean> = {}
    const walk = (n: TreeNode) => {
      next[n.id] = true
      n.children?.forEach(walk)
    }
    walk(tree)
    setOpen(next)
  }

  function collapseAll() {
    setOpen({ root: true })
  }

  return (
    <section className="space-y-3 border-2 border-line bg-panel/80 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-xl font-bold text-ink sm:text-2xl">State map</h2>
          <p className="mt-1 text-base text-ink-muted">
            Tree of what’s in remote state — modules, providers, resources, and outputs.
          </p>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={onRefresh}
          className="btn-compact text-base font-medium text-ember-deep hover:underline disabled:opacity-60"
        >
          {busy ? 'Refreshing…' : 'Refresh state'}
        </button>
      </div>

      {!state.exists ? (
        <p className="text-base text-ink-muted">No state stored yet for this namespace.</p>
      ) : (
        <>
          <div className="flex flex-wrap gap-2 text-sm">
            <StatChip
              label="resources"
              value={String(state.resource_count)}
            />
            {state.terraform_version && <StatChip label="tf" value={state.terraform_version} />}
            {state.serial != null && <StatChip label="serial" value={String(state.serial)} />}
            {state.updated_at && (
              <StatChip label="updated" value={new Date(state.updated_at).toLocaleString()} />
            )}
            {state.locked && <StatChip label="lock" value="held" danger />}
            {state.lineage && (
              <StatChip label="lineage" value={`${state.lineage.slice(0, 8)}…`} mono />
            )}
          </div>

          {state.locked && state.lock && (
            <p className="border-2 border-warn/40 bg-warn/10 px-3 py-2 text-base text-ink">
              Locked{state.lock.Operation ? `: ${state.lock.Operation}` : ''}
              {state.lock.Who ? ` by ${state.lock.Who}` : ''}
            </p>
          )}

          {(state.providers?.length ?? 0) > 0 && (
            <div className="flex flex-wrap gap-2">
              {state.providers!.map((p) => (
                <span
                  key={p.name}
                  className="rounded border border-line/70 bg-paper px-2 py-1 font-mono text-xs text-ink"
                >
                  {p.name} · {p.count}
                </span>
              ))}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter address, provider, id…"
              className="field min-w-[14rem] flex-1"
            />
            <button type="button" className="btn-secondary btn-compact px-3 text-sm" onClick={expandAll}>
              Expand
            </button>
            <button type="button" className="btn-secondary btn-compact px-3 text-sm" onClick={collapseAll}>
              Collapse
            </button>
          </div>

          <div className="grid min-h-[20rem] gap-3 lg:grid-cols-[minmax(0,1.4fr)_minmax(16rem,1fr)]">
            <div className="max-h-[min(55dvh,32rem)] overflow-auto border-2 border-line bg-paper/80">
              <ul>
                <TreeRows
                  node={tree}
                  depth={0}
                  open={open}
                  toggle={toggle}
                  selected={selected}
                  onSelect={setSelected}
                  query={query}
                />
              </ul>
            </div>

            <aside className="border-2 border-line bg-paper/80 p-3">
              {!selectedNode || selectedNode.kind === 'root' ? (
                <div className="space-y-2 text-base text-ink-muted">
                  <p className="font-bold text-ink">Details</p>
                  <p>Select a module, provider, or resource in the tree.</p>
                  {(state.modules?.length ?? 0) > 0 && (
                    <ul className="mt-3 space-y-1 font-mono text-sm">
                      {state.modules!.map((m) => (
                        <li key={m.name}>
                          {m.name} · {m.count}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ) : selectedNode.kind === 'resource' && selectedNode.resource ? (
                <ResourceDetail r={selectedNode.resource} />
              ) : selectedNode.kind === 'output' && selectedNode.output ? (
                <OutputDetail o={selectedNode.output} />
              ) : (
                <div className="space-y-2">
                  <p className="text-sm font-bold uppercase tracking-wide text-ink-muted">
                    {selectedNode.kind}
                  </p>
                  <p className="font-mono text-base font-bold text-ink">{selectedNode.label}</p>
                  {selectedNode.count != null && (
                    <p className="text-base text-ink-muted">{selectedNode.count} items</p>
                  )}
                </div>
              )}
            </aside>
          </div>
        </>
      )}
    </section>
  )
}

function StatChip({
  label,
  value,
  mono,
  danger,
}: {
  label: string
  value: string
  mono?: boolean
  danger?: boolean
}) {
  return (
    <span
      className={`inline-flex items-baseline gap-1.5 rounded border px-2 py-1 ${
        danger ? 'border-danger/50 bg-danger/10 text-danger' : 'border-line/70 bg-paper text-ink'
      }`}
    >
      <span className="text-xs font-bold uppercase tracking-wide text-ink-muted">{label}</span>
      <span className={mono ? 'font-mono text-sm' : 'text-sm font-semibold'}>{value}</span>
    </span>
  )
}

function ResourceDetail({ r }: { r: StateView['resources'][number] }) {
  return (
    <div className="space-y-3 text-base">
      <div>
        <p className="text-sm font-bold uppercase tracking-wide text-ink-muted">Resource</p>
        <p className="break-all font-mono text-sm font-bold text-ink">{r.address}</p>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 font-mono text-sm">
        <dt className="text-ink-muted">mode</dt>
        <dd>{r.mode}</dd>
        <dt className="text-ink-muted">type</dt>
        <dd>{r.type}</dd>
        <dt className="text-ink-muted">name</dt>
        <dd>{r.name}</dd>
        {r.provider && (
          <>
            <dt className="text-ink-muted">provider</dt>
            <dd className="break-all">{r.provider}</dd>
          </>
        )}
        {r.module && (
          <>
            <dt className="text-ink-muted">module</dt>
            <dd className="break-all">{r.module}</dd>
          </>
        )}
        {r.id && (
          <>
            <dt className="text-ink-muted">id</dt>
            <dd className="break-all">{r.id}</dd>
          </>
        )}
      </dl>
      {r.dependencies && r.dependencies.length > 0 && (
        <div>
          <p className="mb-1 text-sm font-bold uppercase tracking-wide text-ink-muted">Depends on</p>
          <ul className="max-h-40 space-y-1 overflow-auto font-mono text-xs text-ink">
            {r.dependencies.map((d) => (
              <li key={d} className="break-all">
                {d}
              </li>
            ))}
          </ul>
        </div>
      )}
      {r.attr_keys && r.attr_keys.length > 0 && (
        <div>
          <p className="mb-1 text-sm font-bold uppercase tracking-wide text-ink-muted">
            Attributes (names)
          </p>
          <p className="font-mono text-xs leading-relaxed text-ink-muted">{r.attr_keys.join(', ')}</p>
        </div>
      )}
    </div>
  )
}

function OutputDetail({ o }: { o: StateView['outputs'][number] }) {
  return (
    <div className="space-y-3 text-base">
      <div>
        <p className="text-sm font-bold uppercase tracking-wide text-ink-muted">Output</p>
        <p className="font-mono text-base font-bold text-ink">{o.name}</p>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 font-mono text-sm">
        {o.type && (
          <>
            <dt className="text-ink-muted">type</dt>
            <dd>{o.type}</dd>
          </>
        )}
        <dt className="text-ink-muted">sensitive</dt>
        <dd>{o.sensitive ? 'yes' : 'no'}</dd>
      </dl>
      <div>
        <p className="mb-1 text-sm font-bold uppercase tracking-wide text-ink-muted">Value</p>
        <pre className="max-h-64 overflow-auto border border-line/50 bg-[#2f3d4a] p-3 font-mono text-xs leading-relaxed text-[#d8e1e9]">
          {o.sensitive ? '(sensitive)' : formatValue(o.value)}
        </pre>
      </div>
    </div>
  )
}
