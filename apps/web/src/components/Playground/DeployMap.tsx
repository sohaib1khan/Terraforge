import { useMemo } from 'react'
import type { ConfigGraph, GraphNode } from '../../api/client'

export type DeployPhase = 'idle' | 'planned' | 'creating' | 'created' | 'destroying' | 'destroyed'

export type NodeDeployState = {
  phase: DeployPhase
  action?: 'create' | 'update' | 'destroy'
}

type Pos = { x: number; y: number; w: number; h: number }

const KIND_ORDER = ['variable', 'local', 'data', 'module', 'resource', 'output'] as const

function layout(nodes: GraphNode[]): { positions: Record<string, Pos>; width: number; height: number } {
  const byKind = new Map<string, GraphNode[]>()
  for (const k of KIND_ORDER) byKind.set(k, [])
  for (const n of nodes) {
    const list = byKind.get(n.kind) ?? byKind.get('resource')!
    list.push(n)
  }

  const colW = 188
  const rowH = 48
  const gapX = 40
  const gapY = 12
  const pad = 20
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
  const width = Math.max(pad * 2 + col * (colW + gapX) - gapX, 420)
  const height = Math.max(pad * 2 + maxRows * (rowH + gapY) - gapY, 180)
  return { positions, width, height }
}

/** Parse plan summary resource lines like "+ local_file.hello". */
export function parsePlanResources(resources: unknown): Record<string, NodeDeployState> {
  const out: Record<string, NodeDeployState> = {}
  if (!Array.isArray(resources)) return out
  for (const raw of resources) {
    if (typeof raw !== 'string' || raw === '…') continue
    const m = raw.match(/^([+~/-]+|~\/\+)\s+(\S+)/)
    if (!m) continue
    const mark = m[1]
    const address = m[2]
    if (mark.includes('-') && !mark.includes('+')) {
      out[address] = { phase: 'planned', action: 'destroy' }
    } else if (mark.includes('~')) {
      out[address] = { phase: 'planned', action: 'update' }
    } else {
      out[address] = { phase: 'planned', action: 'create' }
    }
  }
  return out
}

/** Apply Terraform log line to node states (Creating… / Creation complete / etc.). */
export function applyLogLineToDeploy(
  prev: Record<string, NodeDeployState>,
  line: string,
): Record<string, NodeDeployState> {
  const creating = line.match(/^\s*([a-zA-Z0-9_.\[\]"-]+):\s*Creating\.\.\./)
  const created = line.match(/^\s*([a-zA-Z0-9_.\[\]"-]+):\s*Creation complete/)
  const destroying = line.match(/^\s*([a-zA-Z0-9_.\[\]"-]+):\s*Destroying\.\.\./)
  const destroyed = line.match(/^\s*([a-zA-Z0-9_.\[\]"-]+):\s*Destruction complete/)
  const modifying = line.match(/^\s*([a-zA-Z0-9_.\[\]"-]+):\s*Modifying\.\.\./)
  const modified = line.match(/^\s*([a-zA-Z0-9_.\[\]"-]+):\s*Modifications complete/)

  const next = { ...prev }
  const set = (addr: string, phase: DeployPhase, action?: NodeDeployState['action']) => {
    const base = stripInstance(addr)
    next[base] = {
      phase,
      action: action ?? next[base]?.action,
    }
    if (base !== addr) {
      next[addr] = { phase, action: action ?? next[addr]?.action }
    }
  }

  if (creating?.[1]) set(creating[1], 'creating', 'create')
  else if (created?.[1]) set(created[1], 'created', 'create')
  else if (destroying?.[1]) set(destroying[1], 'destroying', 'destroy')
  else if (destroyed?.[1]) set(destroyed[1], 'destroyed', 'destroy')
  else if (modifying?.[1]) set(modifying[1], 'creating', 'update')
  else if (modified?.[1]) set(modified[1], 'created', 'update')

  return next
}

function stripInstance(addr: string): string {
  // local_file.notes[0] → local_file.notes for graph matching
  return addr.replace(/\[.*?\]/g, '').replace(/"/g, '')
}

function phaseForNode(
  node: GraphNode,
  deploy: Record<string, NodeDeployState>,
): NodeDeployState {
  const direct = deploy[node.id]
  if (direct) return direct
  // Match count/for_each instances to the parent resource node
  for (const [addr, st] of Object.entries(deploy)) {
    if (stripInstance(addr) === node.id) return st
  }
  if (node.in_state && node.kind === 'resource') {
    return { phase: 'created' }
  }
  return { phase: 'idle' }
}

function fillFor(state: NodeDeployState): string {
  switch (state.phase) {
    case 'planned':
      return state.action === 'destroy' ? '#c4892d33' : '#7b42bc33'
    case 'creating':
    case 'destroying':
      return '#3ecf8e55'
    case 'created':
      return '#2f9b7a44'
    case 'destroyed':
      return '#b03a5a33'
    default:
      return '#ebe4f6'
  }
}

function strokeFor(state: NodeDeployState): string {
  switch (state.phase) {
    case 'planned':
      return state.action === 'destroy' ? '#c4892d' : '#7b42bc'
    case 'creating':
    case 'destroying':
      return '#3ecf8e'
    case 'created':
      return '#2f9b7a'
    case 'destroyed':
      return '#b03a5a'
    default:
      return '#9b8eb8'
  }
}

type Props = {
  graph: ConfigGraph | null
  loading: boolean
  deployStates: Record<string, NodeDeployState>
  onRefresh: () => void
}

export function DeployMap({ graph, loading, deployStates, onRefresh }: Props) {
  const resourceNodes = useMemo(
    () => (graph?.nodes ?? []).filter((n) => n.kind === 'resource' || n.kind === 'module' || n.kind === 'data'),
    [graph],
  )
  const { positions, width, height } = useMemo(() => layout(resourceNodes), [resourceNodes])

  return (
    <section className="deploy-map space-y-3 border-2 border-line/70 bg-panel/80 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-bold">Deploy map</h2>
          <p className="mt-1 text-base text-ink-muted">
            Resources animate as plan and apply progress through the runner.
          </p>
        </div>
        <button
          type="button"
          disabled={loading}
          onClick={onRefresh}
          className="btn-compact text-base font-medium text-ember-deep hover:underline disabled:opacity-60"
        >
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      <div className="flex flex-wrap gap-3 text-sm text-ink-muted">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block size-3 border-2 border-ember bg-ember/20" />
          planned
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="deploy-pulse inline-block size-3 border-2 border-aurora-green bg-aurora-green/40" />
          creating / destroying
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block size-3 border-2 border-ok bg-ok/30" />
          created
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block size-3 border-2 border-danger bg-danger/20" />
          destroyed
        </span>
      </div>

      {loading && !graph ? (
        <p className="text-base text-ink-muted">Reading configuration…</p>
      ) : resourceNodes.length === 0 ? (
        <p className="text-base text-ink-muted">
          No resources yet. Seed a starter or write a <code className="font-mono text-sm">.tf</code> file,
          then Plan.
        </p>
      ) : (
        <div className="overflow-auto border border-line/60 bg-[linear-gradient(160deg,#cfd4e8_0%,#d5e8df_100%)]">
          <svg
            width={width}
            height={height}
            viewBox={`0 0 ${width} ${height}`}
            role="img"
            aria-label="Playground deploy resource map"
            className="min-w-full"
          >
            {resourceNodes.map((n) => {
              const p = positions[n.id]
              if (!p) return null
              const st = phaseForNode(n, deployStates)
              const pulsing = st.phase === 'creating' || st.phase === 'destroying'
              return (
                <g key={n.id} className={pulsing ? 'deploy-node-pulse' : undefined}>
                  <rect
                    x={p.x}
                    y={p.y}
                    width={p.w}
                    height={p.h}
                    rx={4}
                    fill={fillFor(st)}
                    stroke={strokeFor(st)}
                    strokeWidth={pulsing ? 2.5 : 1.5}
                  />
                  <text
                    x={p.x + 10}
                    y={p.y + 20}
                    className="fill-ink font-mono text-[11px]"
                    style={{ fontSize: 11 }}
                  >
                    {n.kind}
                  </text>
                  <text
                    x={p.x + 10}
                    y={p.y + 36}
                    className="fill-ink font-sans text-[12px] font-semibold"
                    style={{ fontSize: 12 }}
                  >
                    {n.label.length > 22 ? `${n.label.slice(0, 20)}…` : n.label}
                  </text>
                </g>
              )
            })}
          </svg>
        </div>
      )}
    </section>
  )
}
