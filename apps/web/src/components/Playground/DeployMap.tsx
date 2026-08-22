import { useId, useMemo } from 'react'
import type { ConfigGraph, GraphNode, Run } from '../../api/client'

export type DeployPhase = 'idle' | 'planned' | 'creating' | 'created' | 'destroying' | 'destroyed'

export type NodeDeployState = {
  phase: DeployPhase
  action?: 'create' | 'update' | 'destroy'
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
  return addr.replace(/\[.*?\]/g, '').replace(/"/g, '')
}

function phaseForNode(node: GraphNode, deploy: Record<string, NodeDeployState>): NodeDeployState {
  const direct = deploy[node.id]
  if (direct) return direct
  for (const [addr, st] of Object.entries(deploy)) {
    if (stripInstance(addr) === node.id) return st
  }
  if (node.in_state && node.kind === 'resource') {
    return { phase: 'created' }
  }
  return { phase: 'idle' }
}

/** Map Terraform types to plain-language “building materials”. */
function friendlyPart(node: GraphNode): { title: string; material: string } {
  const t = (node.type ?? '').toLowerCase()
  const name = node.name
  if (t.includes('local_file') || t === 'local_file') {
    return { title: `File “${name}”`, material: 'floorboards / finish work' }
  }
  if (t.includes('random_pet') || t === 'random_pet') {
    return { title: `Name tag “${name}”`, material: 'house number / nameplate' }
  }
  if (t.includes('random_id') || t === 'random_id') {
    return { title: `ID “${name}”`, material: 'serial plate on the door' }
  }
  if (t.includes('random_')) {
    return { title: `Random “${name}”`, material: 'unique fixture' }
  }
  if (node.kind === 'module') {
    return { title: `Module “${name}”`, material: 'prefabricated wing' }
  }
  if (node.kind === 'data') {
    return { title: `Data “${name}”`, material: 'survey / blueprint lookup' }
  }
  return { title: node.label, material: 'structural piece' }
}

function phaseLabel(st: NodeDeployState): string {
  switch (st.phase) {
    case 'planned':
      return st.action === 'destroy' ? 'On teardown list' : st.action === 'update' ? 'Marked for remodel' : 'On the blueprint'
    case 'creating':
      return st.action === 'update' ? 'Remodeling…' : 'Building now…'
    case 'created':
      return st.action === 'update' ? 'Remodel done' : 'Built'
    case 'destroying':
      return 'Tearing down…'
    case 'destroyed':
      return 'Removed'
    default:
      return 'Waiting'
  }
}

type BuildStory = {
  stage: 0 | 1 | 2 | 3 | 4 | 5
  headline: string
  detail: string
  mode: 'idle' | 'plan' | 'build' | 'remodel' | 'teardown' | 'done' | 'failed'
  progress: number
  activity: string | null
}

function deriveStory(
  nodes: GraphNode[],
  deploy: Record<string, NodeDeployState>,
  run: Run | null,
): BuildStory {
  const states = nodes.map((n) => phaseForNode(n, deploy))
  const total = Math.max(states.length, 1)
  const creating = states.filter((s) => s.phase === 'creating' || s.phase === 'destroying')
  const created = states.filter((s) => s.phase === 'created').length
  const destroyed = states.filter((s) => s.phase === 'destroyed').length
  const planned = states.filter((s) => s.phase === 'planned').length
  const live = run?.status === 'queued' || run?.status === 'running'
  const failed = run?.status === 'failed'
  const success = run?.status === 'success'

  const activeNode = nodes.find((n) => {
    const p = phaseForNode(n, deploy).phase
    return p === 'creating' || p === 'destroying'
  })
  const activity = activeNode
    ? `${friendlyPart(activeNode).title} — ${phaseLabel(phaseForNode(activeNode, deploy))}`
    : null

  const destroyHeavy =
    states.some((s) => s.action === 'destroy') || run?.type === 'destroy'

  if (failed) {
    return {
      stage: 2,
      headline: 'Construction paused — something went wrong',
      detail: 'Check the CLI output below. Fix the config, then try terraform plan / apply again.',
      mode: 'failed',
      progress: created / total,
      activity,
    }
  }

  if (run?.type === 'init' && live) {
    return {
      stage: 1,
      headline: 'Surveying the lot',
      detail: 'terraform init is downloading providers — like bringing tools and materials to the site.',
      mode: 'plan',
      progress: 0.15,
      activity: 'Fetching providers & modules…',
    }
  }

  if (run?.type === 'init' && success) {
    return {
      stage: 1,
      headline: 'Site is ready',
      detail: 'Tools are on site. Next: terraform plan to draw the blueprint.',
      mode: 'plan',
      progress: 0.25,
      activity: null,
    }
  }

  if (destroyHeavy && (live || destroyed > 0 || creating.length > 0)) {
    const done = destroyed
    const prog = Math.min(1, (done + creating.length * 0.5) / total)
    if (success && destroyed >= planned + created) {
      return {
        stage: 0,
        headline: 'Lot cleared',
        detail: 'Destroy finished — managed resources are gone, like the house taken down to bare ground.',
        mode: 'done',
        progress: 1,
        activity: null,
      }
    }
    return {
      stage: prog > 0.6 ? 1 : 2,
      headline: live ? 'Teardown in progress' : 'Teardown planned',
      detail: live
        ? 'Workers are removing pieces in reverse order — same idea as terraform destroy.'
        : 'Blueprint says these pieces will be removed. Run terraform destroy to start.',
      mode: 'teardown',
      progress: prog,
      activity: activity ?? (live ? 'Removing resources…' : null),
    }
  }

  if (planned > 0 && !live && created === 0 && creating.length === 0) {
    return {
      stage: 1,
      headline: 'Blueprint ready',
      detail: `Plan listed ${planned} change${planned === 1 ? '' : 's'}. Nothing is built yet — run terraform apply to start construction.`,
      mode: 'plan',
      progress: 0.2,
      activity: null,
    }
  }

  if (live && (run?.type === 'apply' || run?.type === 'plan')) {
    if (run.type === 'plan') {
      return {
        stage: 1,
        headline: 'Drawing the blueprint',
        detail: 'terraform plan compares your .tf files to state — architects sketching before anyone builds.',
        mode: 'plan',
        progress: 0.35,
        activity: 'Computing changes…',
      }
    }
    const prog = Math.min(0.95, (created + creating.length * 0.45) / total)
    let stage: BuildStory['stage'] = 2
    let headline = 'Pouring the foundation'
    if (prog >= 0.85) {
      stage = 5
      headline = 'Finishing touches'
    } else if (prog >= 0.55) {
      stage = 4
      headline = 'Putting on the roof'
    } else if (prog >= 0.25) {
      stage = 3
      headline = 'Raising the walls'
    }
    return {
      stage,
      headline,
      detail: 'Each Terraform resource is a piece of the house. Watch parts light up as Creation complete appears in the logs.',
      mode: creating.some((s) => s.action === 'update') ? 'remodel' : 'build',
      progress: prog,
      activity: activity ?? 'Applying configuration…',
    }
  }

  if (created > 0 && !live) {
    return {
      stage: 5,
      headline: 'House is up',
      detail: 'Resources are in state. Change .tf files, then plan / apply to remodel.',
      mode: 'done',
      progress: Math.max(created / total, success && run?.type === 'apply' ? 1 : created / total),
      activity: null,
    }
  }

  if (success && run?.type === 'apply') {
    return {
      stage: 5,
      headline: 'House is up',
      detail: 'Apply finished — like a finished building with a certificate of occupancy.',
      mode: 'done',
      progress: 1,
      activity: null,
    }
  }

  return {
    stage: 0,
    headline: 'Empty lot',
    detail: 'No build yet. terraform init → plan → apply — survey, blueprint, then build.',
    mode: 'idle',
    progress: 0,
    activity: null,
  }
}

/** SVG house that fills in as Terraform resources are created. */
function HouseScene({ story }: { story: BuildStory }) {
  const uid = useId().replace(/:/g, '')
  const { stage, mode, progress } = story
  const teardown = mode === 'teardown'
  const failed = mode === 'failed'
  const building = mode === 'build' || mode === 'remodel'
  const planning = mode === 'plan'
  const done = mode === 'done' && stage >= 5 && !teardown
  const liveSite = building || planning || (teardown && progress < 1)

  const showFoundation = stage >= 2 || done || (mode === 'done' && stage >= 1)
  const showWalls = stage >= 3 || done
  const showRoof = stage >= 4 || done
  const showDetails = stage >= 5 || done
  const showBlueprint = (stage >= 1 && stage < 5 && !teardown) || planning

  return (
    <svg
      viewBox="0 0 320 220"
      className={`deploy-house h-auto w-full max-w-md ${liveSite ? 'deploy-house-live' : ''} ${failed ? 'deploy-house-failed' : ''}`}
      role="img"
      aria-label={`Build illustration: ${story.headline}`}
    >
      <defs>
        <linearGradient id={`sky-${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={failed ? '#e8d0d8' : done ? '#b8d4f0' : '#c8d8e8'} />
          <stop offset="100%" stopColor={failed ? '#d9c4c8' : '#d5e4d8'} />
        </linearGradient>
        <linearGradient id={`roof-${uid}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={teardown ? '#b03a5a' : '#8a55c4'} />
          <stop offset="100%" stopColor={teardown ? '#8a2f48' : '#5c2d91'} />
        </linearGradient>
        <pattern id={`blueprint-${uid}`} width="12" height="12" patternUnits="userSpaceOnUse">
          <path d="M12 0H0V12" fill="none" stroke="#5c2d91" strokeOpacity="0.28" strokeWidth="0.8" />
        </pattern>
        <clipPath id={`ground-clip-${uid}`}>
          <rect x="0" y="0" width="320" height="220" />
        </clipPath>
      </defs>

      <rect width="320" height="220" fill={`url(#sky-${uid})`} />

      {/* drifting clouds */}
      <g className="deploy-clouds" opacity="0.55">
        <ellipse className="deploy-cloud deploy-cloud-a" cx="60" cy="36" rx="28" ry="10" fill="#fff" />
        <ellipse className="deploy-cloud deploy-cloud-a" cx="78" cy="36" rx="18" ry="8" fill="#fff" />
        <ellipse className="deploy-cloud deploy-cloud-b" cx="240" cy="28" rx="32" ry="11" fill="#fff" />
        <ellipse className="deploy-cloud deploy-cloud-b" cx="262" cy="28" rx="16" ry="7" fill="#fff" />
      </g>

      {/* sun / warning disc */}
      <circle
        className={failed ? 'deploy-sun-warn' : done ? 'deploy-sun-glow' : 'deploy-sun'}
        cx="278"
        cy="42"
        r="14"
        fill={failed ? '#c4892d' : '#f0d878'}
        opacity="0.9"
      />

      {/* ground */}
      <ellipse cx="160" cy="198" rx="130" ry="14" fill="#6a8f6a" opacity="0.55" />
      <rect x="40" y="190" width="240" height="30" fill="#7a9a72" opacity="0.35" />

      {/* surveyor stakes + measuring tape for empty / surveying */}
      {stage === 0 && (
        <g className="deploy-fade-in">
          <g className="deploy-stake-wiggle">
            <line x1="90" y1="155" x2="90" y2="190" stroke="#5c5278" strokeWidth="2.5" />
            <polygon points="90,155 98,162 90,162" fill="#c4892d" />
          </g>
          <g className="deploy-stake-wiggle" style={{ animationDelay: '0.35s' }}>
            <line x1="230" y1="155" x2="230" y2="190" stroke="#5c5278" strokeWidth="2.5" />
            <polygon points="230,155 222,162 230,162" fill="#c4892d" />
          </g>
          <path
            className="deploy-tape"
            d="M95 175 Q160 160 225 175"
            fill="none"
            stroke="#c4892d"
            strokeWidth="1.5"
            strokeDasharray="4 3"
          />
          <text x="160" y="150" textAnchor="middle" fill="#5c5278" fontSize="12" fontFamily="var(--font-sans)">
            vacant lot
          </text>
        </g>
      )}

      {/* blueprint — draw-on dash animation */}
      {showBlueprint && (
        <g
          className={stage === 1 || planning ? 'deploy-blueprint-active' : 'deploy-blueprint-ghost'}
          opacity={stage === 1 || planning ? 0.95 : 0.3}
        >
          <rect
            x="88"
            y="78"
            width="144"
            height="100"
            fill={`url(#blueprint-${uid})`}
            stroke="#5c2d91"
            strokeWidth="1.5"
            strokeDasharray="6 4"
            className="deploy-blueprint-draw"
          />
          <path
            d="M88 78 L160 38 L232 78"
            fill="none"
            stroke="#5c2d91"
            strokeWidth="1.8"
            strokeDasharray="180"
            className="deploy-blueprint-roof-draw"
          />
          {(stage === 1 || planning) && (
            <>
              <g className="deploy-pencil">
                <polygon points="200,95 214,108 208,112 194,99" fill="#c4892d" />
                <rect x="205" y="103" width="18" height="5" transform="rotate(40 205 103)" fill="#5c2d91" />
              </g>
              <text x="160" y="132" textAnchor="middle" fill="#5c2d91" fontSize="11" fontFamily="var(--font-mono)">
                blueprint
              </text>
            </>
          )}
        </g>
      )}

      {/* foundation — rises / pours */}
      {showFoundation && (
        <g className={building && stage === 2 ? 'deploy-pour' : 'deploy-rise-in'}>
          <rect
            x="95"
            y="168"
            width="130"
            height="18"
            fill={teardown ? '#b03a5a88' : '#6b5a4a'}
            stroke="#3d342c"
            strokeWidth="1"
            className={building && stage === 2 ? 'deploy-part-glow' : undefined}
          />
          {building && stage === 2 && (
            <g className="deploy-sparks">
              <circle cx="110" cy="166" r="2" fill="#f0d878" />
              <circle cx="160" cy="164" r="2.5" fill="#fff" />
              <circle cx="200" cy="167" r="2" fill="#f0d878" />
            </g>
          )}
          <text x="160" y="181" textAnchor="middle" fill="#f5efe6" fontSize="9" fontFamily="var(--font-sans)">
            foundation
          </text>
        </g>
      )}

      {/* walls — grow upward */}
      {showWalls && (
        <g className={building && stage === 3 ? 'deploy-walls-build' : 'deploy-rise-in'}>
          <rect
            x="100"
            y="95"
            width="120"
            height="75"
            fill={teardown ? '#b03a5a66' : '#f7f2fc'}
            stroke={teardown ? '#b03a5a' : '#2d5661'}
            strokeWidth="2.5"
            className={building && stage === 3 ? 'deploy-part-glow' : undefined}
          />
          <rect x="145" y="130" width="30" height="40" fill={teardown ? '#8a4055' : '#5c2d91'} className="deploy-door" />
          <g className={done ? 'deploy-window-shine' : undefined}>
            <rect x="115" y="110" width="22" height="22" fill="#7eb8d4" stroke="#2d5661" strokeWidth="1.5" />
            <line x1="126" y1="110" x2="126" y2="132" stroke="#2d5661" strokeWidth="1" />
            <line x1="115" y1="121" x2="137" y2="121" stroke="#2d5661" strokeWidth="1" />
          </g>
          {building && stage === 3 && (
            <g className="deploy-scaffold">
              <line x1="98" y1="100" x2="98" y2="170" stroke="#c4892d" strokeWidth="2" />
              <line x1="222" y1="100" x2="222" y2="170" stroke="#c4892d" strokeWidth="2" />
              <line x1="98" y1="130" x2="222" y2="130" stroke="#c4892d" strokeWidth="1.5" />
            </g>
          )}
          <text x="160" y="118" textAnchor="middle" fill="#5c5278" fontSize="9" fontFamily="var(--font-sans)">
            walls
          </text>
        </g>
      )}

      {/* roof — drops into place */}
      {showRoof && (
        <g className={building && stage === 4 ? 'deploy-roof-drop' : 'deploy-rise-in'}>
          <path
            d="M90 98 L160 42 L230 98 Z"
            fill={`url(#roof-${uid})`}
            stroke="#3d2460"
            strokeWidth="2"
            className={building && stage === 4 ? 'deploy-part-glow' : undefined}
          />
          <text x="160" y="78" textAnchor="middle" fill="#f5efe6" fontSize="10" fontFamily="var(--font-sans)">
            roof
          </text>
        </g>
      )}

      {/* chimney + smoke + flag when done */}
      {showDetails && !teardown && (
        <g className="deploy-finish-in">
          <rect x="190" y="55" width="14" height="28" fill="#5c5278" />
          <g className="deploy-smoke">
            <circle cx="197" cy="48" r="5" fill="#9b8eb8" opacity="0.5" />
            <circle cx="202" cy="38" r="6" fill="#9b8eb8" opacity="0.35" />
            <circle cx="195" cy="28" r="7" fill="#9b8eb8" opacity="0.25" />
          </g>
          <g className="deploy-flag">
            <line x1="120" y1="55" x2="120" y2="95" stroke="#3d2460" strokeWidth="2" />
            <path d="M120 55 L148 64 L120 73 Z" fill="#2f9b7a" />
          </g>
          {done && (
            <text x="160" y="208" textAnchor="middle" fill="#1f7a5c" fontSize="11" fontFamily="var(--font-sans)" fontWeight="700">
              ready to live in
            </text>
          )}
        </g>
      )}

      {/* dust / debris for teardown */}
      {teardown && progress < 1 && (
        <g className="deploy-dust">
          <circle cx="130" cy="150" r="4" fill="#9b8eb8" />
          <circle cx="170" cy="140" r="5" fill="#b0a4c4" />
          <circle cx="200" cy="155" r="3.5" fill="#9b8eb8" />
          <circle cx="150" cy="120" r="4" fill="#c4b8dc" />
        </g>
      )}

      {/* crane with swinging boom + hook load */}
      {(building || (teardown && progress < 1) || (planning && stage >= 1)) && (
        <g className="deploy-crane">
          <line x1="258" y1="30" x2="258" y2="188" stroke="#4a4060" strokeWidth="3.5" />
          <line x1="250" y1="188" x2="266" y2="188" stroke="#4a4060" strokeWidth="4" />
          <g className="deploy-crane-boom">
            <line x1="258" y1="32" x2="175" y2="78" stroke="#c4892d" strokeWidth="3" />
            <line className="deploy-crane-cable" x1="175" y1="78" x2="175" y2="118" stroke="#5c5278" strokeWidth="1.5" />
            <g className="deploy-crane-hook">
              <rect x="167" y="118" width="16" height="10" rx="1" fill="#7b42bc" />
              <path d="M175 128 L175 136" stroke="#3d2460" strokeWidth="2" />
            </g>
          </g>
          {/* spinning hazard light */}
          <circle cx="258" cy="26" r="4" fill="#c4892d" className="deploy-beacon" />
        </g>
      )}

      {/* floating progress ring while live build */}
      {building && (
        <g transform="translate(28 28)">
          <circle cx="0" cy="0" r="16" fill="none" stroke="#9b8eb8" strokeWidth="3" opacity="0.35" />
          <circle
            className="deploy-progress-ring"
            cx="0"
            cy="0"
            r="16"
            fill="none"
            stroke="#2f9b7a"
            strokeWidth="3"
            strokeLinecap="round"
            strokeDasharray={`${Math.max(4, progress * 100)} 100`}
            transform="rotate(-90)"
          />
          <text x="0" y="4" textAnchor="middle" fill="#1f7a5c" fontSize="9" fontFamily="var(--font-mono)" fontWeight="700">
            {Math.round(progress * 100)}
          </text>
        </g>
      )}

      {failed && (
        <g className="deploy-fail-flash">
          <text x="160" y="28" textAnchor="middle" fill="#b03a5a" fontSize="13" fontFamily="var(--font-sans)" fontWeight="700">
            build interrupted
          </text>
        </g>
      )}
    </svg>
  )
}

type Props = {
  graph: ConfigGraph | null
  loading: boolean
  deployStates: Record<string, NodeDeployState>
  run?: Run | null
  onRefresh: () => void
  compact?: boolean
}

export function DeployMap({
  graph,
  loading,
  deployStates,
  run = null,
  onRefresh,
  compact = false,
}: Props) {
  const resourceNodes = useMemo(
    () => (graph?.nodes ?? []).filter((n) => n.kind === 'resource' || n.kind === 'module' || n.kind === 'data'),
    [graph],
  )

  const story = useMemo(
    () => deriveStory(resourceNodes, deployStates, run),
    [resourceNodes, deployStates, run],
  )

  const parts = useMemo(
    () =>
      resourceNodes.map((n) => {
        const st = phaseForNode(n, deployStates)
        const friend = friendlyPart(n)
        return { node: n, st, friend }
      }),
    [resourceNodes, deployStates],
  )

  const live = run?.status === 'queued' || run?.status === 'running'

  return (
    <section
      className={`deploy-map flex h-full min-h-0 flex-col border-2 border-line/70 bg-panel/80 ${
        compact ? 'gap-2 p-3' : 'gap-4 p-4'
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h2 className={`font-display font-bold ${compact ? 'text-base' : 'text-lg'}`}>Live deploy</h2>
          {!compact && (
            <p className="mt-1 text-sm text-ink-muted">
              Resources as a house — blueprint → foundation → walls → roof.
            </p>
          )}
        </div>
        <button
          type="button"
          disabled={loading}
          onClick={onRefresh}
          className="btn-compact text-sm font-medium text-ember-deep hover:underline disabled:opacity-60"
        >
          {loading ? '…' : 'Refresh'}
        </button>
      </div>

      <div
        className={`deploy-status rounded border px-3 py-2 ${
          live
            ? 'deploy-status-live border-moss bg-moss/10'
            : story.mode === 'failed'
              ? 'border-danger bg-danger/10'
              : story.mode === 'done'
                ? 'border-ok/50 bg-ok/10'
                : 'border-line/70 bg-panel'
        }`}
      >
        <div className="flex flex-wrap items-center gap-2">
          {live && <span className="run-live-dot" aria-hidden />}
          <p className={`font-display font-bold text-ink ${compact ? 'text-base' : 'text-xl'}`}>
            {story.headline}
          </p>
          {live && (
            <span className="rounded bg-moss/20 px-1.5 py-0.5 font-mono text-[0.65rem] font-bold uppercase text-moss-deep">
              live · {run?.type}
            </span>
          )}
        </div>
        <p className={`text-ink-muted ${compact ? 'mt-0.5 text-xs line-clamp-2' : 'mt-1 text-sm'}`}>
          {story.detail}
        </p>
        {story.activity && (
          <p className="mt-1 truncate font-mono text-xs text-ink">
            <span className="text-ink-muted">Now: </span>
            {story.activity}
          </p>
        )}
        <div className="mt-2 h-1.5 overflow-hidden rounded bg-line/40">
          <div
            className={`h-full rounded transition-[width] duration-500 ease-out ${
              story.mode === 'failed' ? 'bg-danger' : story.mode === 'teardown' ? 'bg-warn' : 'bg-moss'
            } ${live ? 'deploy-progress-fill-live' : ''}`}
            style={{ width: `${Math.round(story.progress * 100)}%` }}
          />
        </div>
      </div>

      <div
        className={`min-h-0 flex-1 ${
          compact
            ? 'grid gap-2 sm:grid-cols-[minmax(0,9.5rem)_minmax(0,1fr)]'
            : 'grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]'
        }`}
      >
        <div className="flex items-center justify-center border border-line/60 bg-[linear-gradient(165deg,#d5dde8_0%,#d8e8dc_100%)] p-1">
          <HouseScene story={story} />
        </div>

        <div className="min-h-0 space-y-1.5 overflow-auto">
          <p className="text-[0.65rem] font-semibold uppercase tracking-wide text-ink-muted">Parts</p>
          {loading && !graph ? (
            <p className="text-sm text-ink-muted">Reading…</p>
          ) : parts.length === 0 ? (
            <p className="text-sm text-ink-muted">
              No resources yet — write <code className="font-mono text-xs">.tf</code> then{' '}
              <code className="font-mono text-xs">terraform plan</code>.
            </p>
          ) : (
            <ul className="space-y-1">
              {parts.map(({ node, st, friend }) => {
                const active = st.phase === 'creating' || st.phase === 'destroying'
                return (
                  <li
                    key={node.id}
                    className={`flex items-center justify-between gap-2 border px-2 py-1.5 ${
                      active
                        ? 'deploy-part-active border-moss bg-moss/15'
                        : st.phase === 'created'
                          ? 'border-ok/40 bg-ok/10'
                          : st.phase === 'planned'
                            ? 'border-ember/40 bg-ember/10'
                            : st.phase === 'destroyed'
                              ? 'border-danger/40 bg-danger/10 opacity-70'
                              : 'border-line/50 bg-panel/70'
                    }`}
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-ink">{friend.title}</p>
                      <p className="truncate font-mono text-[0.65rem] text-ink-muted">{node.id}</p>
                    </div>
                    <span
                      className={`shrink-0 font-mono text-[0.65rem] font-bold uppercase ${
                        active ? 'deploy-pulse text-moss-deep' : 'text-ink-muted'
                      }`}
                    >
                      {phaseLabel(st)}
                    </span>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </div>
    </section>
  )
}
