import { useMemo, useState } from 'react'
import type { ConfigGraph, GraphNode } from '../../api/client'

type Props = {
  graph: ConfigGraph | null
  loading: boolean
  onRefresh: () => void
}

const KIND_ORDER = ['variable', 'local', 'data', 'module', 'resource', 'output'] as const

const KIND_COLOR: Record<string, string> = {
  variable: '#5c6d7c',
  local: '#6a7a88',
  data: '#3d6f7c',
  module: '#4a7264',
  resource: '#2d5661',
  output: '#8a6a28',
}

type Pos = { x: number; y: number; w: number; h: number }

function layout(nodes: GraphNode[]): { positions: Record<string, Pos>; width: number; height: number } {
  const byKind = new Map<string, GraphNode[]>()
  for (const k of KIND_ORDER) byKind.set(k, [])
  for (const n of nodes) {
    const list = byKind.get(n.kind) ?? byKind.get('resource')!
    list.push(n)
  }

  const colW = 200
  const rowH = 52
  const gapX = 48
  const gapY = 14
  const pad = 24
  const positions: Record<string, Pos> = {}
  let maxRows = 1
  let col = 0
  for (const kind of KIND_ORDER) {
    const list = byKind.get(kind) ?? []
    if (list.length === 0) continue
    maxRows = Math.max(maxRows, list.length)
    list.forEach((n, i) => {
      positions[n.id] = {
        x: pad + col * (colW + gapX),
        y: pad + i * (rowH + gapY),
        w: colW,
        h: rowH,
      }
    })
    col++
  }
  const width = Math.max(pad * 2 + col * (colW + gapX) - gapX, 480)
  const height = Math.max(pad * 2 + maxRows * (rowH + gapY) - gapY, 220)
  return { positions, width, height }
}

export function ConfigMap({ graph, loading, onRefresh }: Props) {
  const [selected, setSelected] = useState<string | null>(null)
  const [showOnlyLinked, setShowOnlyLinked] = useState(false)

  const filtered = useMemo(() => {
    if (!graph) return null
    if (!showOnlyLinked) return graph
    const linked = new Set<string>()
    for (const e of graph.edges) {
      linked.add(e.from)
      linked.add(e.to)
    }
    return {
      ...graph,
      nodes: graph.nodes.filter((n) => linked.has(n.id)),
      edges: graph.edges,
    }
  }, [graph, showOnlyLinked])

  const { positions, width, height } = useMemo(
    () => layout(filtered?.nodes ?? []),
    [filtered],
  )

  const related = useMemo(() => {
    if (!selected || !graph) return new Set<string>()
    const s = new Set<string>([selected])
    for (const e of graph.edges) {
      if (e.from === selected) s.add(e.to)
      if (e.to === selected) s.add(e.from)
    }
    return s
  }, [selected, graph])

  return (
    <section className="space-y-3 border-2 border-line/70 bg-panel/80 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-bold">Config map</h2>
          <p className="mt-1 text-base text-ink-muted">
            How blocks in this namespace’s Terraform files reference each other
            {graph?.has_state ? ' · state overlay' : ''}.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-base text-ink">
            <input
              type="checkbox"
              checked={showOnlyLinked}
              onChange={(e) => setShowOnlyLinked(e.target.checked)}
              className="size-4 accent-moss-deep"
            />
            Linked only
          </label>
          <button
            type="button"
            disabled={loading}
            onClick={onRefresh}
            className="btn-compact text-base font-medium text-ember-deep hover:underline disabled:opacity-60"
          >
            {loading ? 'Scanning…' : 'Refresh map'}
          </button>
        </div>
      </div>

      {loading && !graph ? (
        <p className="text-base text-ink-muted">Reading Terraform files…</p>
      ) : !filtered || filtered.nodes.length === 0 ? (
        <p className="text-base text-ink-muted">
          No resources, modules, or variables found yet. Add <code className="font-mono text-sm">.tf</code>{' '}
          files in the editor (or connect a remote) and refresh.
        </p>
      ) : (
        <>
          <div className="flex flex-wrap gap-3 text-sm text-ink-muted">
            {KIND_ORDER.map((k) => (
              <span key={k} className="inline-flex items-center gap-1.5">
                <span
                  className="inline-block size-3 border border-line/50"
                  style={{ background: KIND_COLOR[k] }}
                />
                {k}
              </span>
            ))}
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block size-3 border-2 border-ok bg-ok/20" />
              in state
            </span>
          </div>

          <div className="overflow-auto border border-line/60 bg-[#cfd9e2]/50">
            <svg
              width={width}
              height={height}
              viewBox={`0 0 ${width} ${height}`}
              role="img"
              aria-label="Terraform configuration relationship map"
              className="min-w-full"
            >
              <defs>
                <marker
                  id="arrow"
                  viewBox="0 0 10 10"
                  refX="9"
                  refY="5"
                  markerWidth="6"
                  markerHeight="6"
                  orient="auto-start-reverse"
                >
                  <path d="M 0 0 L 10 5 L 0 10 z" fill="#5c6d7c" />
                </marker>
              </defs>
              {filtered.edges.map((e) => {
                const a = positions[e.from]
                const b = positions[e.to]
                if (!a || !b) return null
                const x1 = a.x + a.w / 2
                const y1 = a.y + a.h / 2
                const x2 = b.x + b.w / 2
                const y2 = b.y + b.h / 2
                const midX = (x1 + x2) / 2
                const active =
                  !selected || related.has(e.from) || related.has(e.to)
                return (
                  <path
                    key={`${e.from}->${e.to}`}
                    d={`M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`}
                    fill="none"
                    stroke={active ? '#5c6d7c' : '#5c6d7c33'}
                    strokeWidth={active ? 1.75 : 1}
                    markerEnd={active ? 'url(#arrow)' : undefined}
                  />
                )
              })}
              {filtered.nodes.map((n) => {
                const p = positions[n.id]
                if (!p) return null
                const dim = selected && !related.has(n.id)
                const fill = KIND_COLOR[n.kind] ?? '#2d5661'
                return (
                  <g
                    key={n.id}
                    transform={`translate(${p.x}, ${p.y})`}
                    opacity={dim ? 0.28 : 1}
                    style={{ cursor: 'pointer' }}
                    onClick={() => setSelected((cur) => (cur === n.id ? null : n.id))}
                  >
                    <rect
                      width={p.w}
                      height={p.h}
                      rx={2}
                      fill={fill}
                      stroke={n.in_state ? '#3d6e55' : '#2a3846'}
                      strokeWidth={n.in_state ? 3 : 1}
                    />
                    <text
                      x={10}
                      y={20}
                      fill="#e8f0f4"
                      fontSize={11}
                      fontFamily="IBM Plex Mono, monospace"
                    >
                      {n.kind}
                      {n.in_state ? ' · state' : ''}
                    </text>
                    <text
                      x={10}
                      y={38}
                      fill="#f4f8fa"
                      fontSize={13}
                      fontWeight={700}
                      fontFamily="Atkinson Hyperlegible, sans-serif"
                    >
                      {n.label.length > 22 ? `${n.label.slice(0, 20)}…` : n.label}
                    </text>
                    <title>
                      {n.label}
                      {n.file ? `\n${n.file}` : ''}
                      {n.in_state ? '\nPresent in remote state' : ''}
                    </title>
                  </g>
                )
              })}
            </svg>
          </div>

          {selected && (
            <p className="text-base text-ink">
              Selected <code className="font-mono text-sm">{selected}</code>
              {filtered.nodes.find((n) => n.id === selected)?.file
                ? ` · ${filtered.nodes.find((n) => n.id === selected)?.file}`
                : ''}
              {' · '}
              <button
                type="button"
                className="font-bold text-ember-deep hover:underline"
                onClick={() => setSelected(null)}
              >
                clear
              </button>
            </p>
          )}

          <p className="text-sm text-ink-muted">
            Scanned {graph?.files_scanned ?? 0} file(s) · {filtered.nodes.length} nodes ·{' '}
            {filtered.edges.length} links. {graph?.note}
          </p>
        </>
      )}
    </section>
  )
}
