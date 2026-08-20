import type { ConfigEnvironment } from '../../api/client'

export type EnvStyle = {
  bg: string
  border: string
  text: string
  accent: string
  glyph: string
}

const DEFAULT_STYLE: EnvStyle = {
  bg: 'color-mix(in srgb, #5c6d7c 18%, transparent)',
  border: '#5c6d7c',
  text: '#2a3846',
  accent: '#5c6d7c',
  glyph: '?',
}

const STYLES: Record<string, EnvStyle> = {
  aws: {
    bg: 'color-mix(in srgb, #FF9900 28%, transparent)',
    border: '#C77100',
    text: '#5C3A00',
    accent: '#FF9900',
    glyph: 'aws',
  },
  azurerm: {
    bg: 'color-mix(in srgb, #0078D4 22%, transparent)',
    border: '#005A9E',
    text: '#003A66',
    accent: '#0078D4',
    glyph: 'az',
  },
  azuread: {
    bg: 'color-mix(in srgb, #0078D4 22%, transparent)',
    border: '#005A9E',
    text: '#003A66',
    accent: '#0078D4',
    glyph: 'ad',
  },
  azapi: {
    bg: 'color-mix(in srgb, #0078D4 22%, transparent)',
    border: '#005A9E',
    text: '#003A66',
    accent: '#0078D4',
    glyph: 'az',
  },
  google: {
    bg: 'color-mix(in srgb, #4285F4 22%, transparent)',
    border: '#1A73E8',
    text: '#174EA6',
    accent: '#4285F4',
    glyph: 'gcp',
  },
  'google-beta': {
    bg: 'color-mix(in srgb, #4285F4 22%, transparent)',
    border: '#1A73E8',
    text: '#174EA6',
    accent: '#4285F4',
    glyph: 'gcp',
  },
  local: {
    bg: 'color-mix(in srgb, #4a7264 24%, transparent)',
    border: '#35584c',
    text: '#243c34',
    accent: '#4a7264',
    glyph: 'loc',
  },
  null: {
    bg: 'color-mix(in srgb, #8a9aab 28%, transparent)',
    border: '#5c6d7c',
    text: '#2a3846',
    accent: '#5c6d7c',
    glyph: '∅',
  },
  kubernetes: {
    bg: 'color-mix(in srgb, #326CE5 22%, transparent)',
    border: '#2458C5',
    text: '#163A8A',
    accent: '#326CE5',
    glyph: 'k8s',
  },
  helm: {
    bg: 'color-mix(in srgb, #0F1689 18%, transparent)',
    border: '#0F1689',
    text: '#0A105C',
    accent: '#0F1689',
    glyph: 'helm',
  },
  digitalocean: {
    bg: 'color-mix(in srgb, #0080FF 22%, transparent)',
    border: '#0066CC',
    text: '#004999',
    accent: '#0080FF',
    glyph: 'do',
  },
  cloudflare: {
    bg: 'color-mix(in srgb, #F6821F 26%, transparent)',
    border: '#C45E0A',
    text: '#7A3A06',
    accent: '#F6821F',
    glyph: 'cf',
  },
  github: {
    bg: 'color-mix(in srgb, #24292F 16%, transparent)',
    border: '#24292F',
    text: '#24292F',
    accent: '#24292F',
    glyph: 'gh',
  },
  gitlab: {
    bg: 'color-mix(in srgb, #FC6D26 24%, transparent)',
    border: '#E24329',
    text: '#8B1E0B',
    accent: '#FC6D26',
    glyph: 'gl',
  },
  docker: {
    bg: 'color-mix(in srgb, #2496ED 22%, transparent)',
    border: '#0DB7ED',
    text: '#066A8A',
    accent: '#2496ED',
    glyph: 'dk',
  },
  oci: {
    bg: 'color-mix(in srgb, #C74634 22%, transparent)',
    border: '#A03828',
    text: '#6B241A',
    accent: '#C74634',
    glyph: 'oci',
  },
  random: {
    bg: 'color-mix(in srgb, #8a6a28 22%, transparent)',
    border: '#8a6a28',
    text: '#5C4518',
    accent: '#8a6a28',
    glyph: 'rnd',
  },
  tls: {
    bg: 'color-mix(in srgb, #3d6e55 22%, transparent)',
    border: '#3d6e55',
    text: '#244836',
    accent: '#3d6e55',
    glyph: 'tls',
  },
  vault: {
    bg: 'color-mix(in srgb, #FFEC6A 35%, transparent)',
    border: '#B8A300',
    text: '#5C5200',
    accent: '#FFEC6A',
    glyph: 'vlt',
  },
}

export function envStyle(name: string): EnvStyle {
  return STYLES[name.toLowerCase()] ?? {
    ...DEFAULT_STYLE,
    glyph: name.slice(0, 3).toLowerCase() || '?',
  }
}

/** Cloud-style mark: colored tile + short glyph. */
export function EnvIcon({
  name,
  size = 28,
}: {
  name: string
  size?: number
}) {
  const s = envStyle(name)
  const fontSize = size <= 24 ? 9 : size <= 32 ? 10 : 11
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-md font-mono font-bold uppercase tracking-tight"
      style={{
        width: size,
        height: size,
        background: s.accent,
        color: name === 'vault' || name === 'aws' ? '#1a1a1a' : '#fff',
        fontSize,
        boxShadow: `inset 0 0 0 2px ${s.border}`,
      }}
      aria-hidden
    >
      {s.glyph}
    </span>
  )
}

export function EnvBadge({
  name,
  label,
  size = 'md',
}: {
  name: string
  label: string
  size?: 'sm' | 'md' | 'lg'
}) {
  const s = envStyle(name)
  const pad = size === 'sm' ? 'px-2 py-0.5 text-xs' : size === 'lg' ? 'px-3 py-1.5 text-base' : 'px-2.5 py-1 text-sm'
  const icon = size === 'sm' ? 18 : size === 'lg' ? 32 : 24
  return (
    <span
      className={`inline-flex items-center gap-2 border-2 font-bold ${pad}`}
      style={{
        background: s.bg,
        borderColor: s.border,
        color: s.text,
      }}
      title={label}
    >
      <EnvIcon name={name} size={icon} />
      {label}
    </span>
  )
}

export function EnvBadgeRow({
  environment,
  size = 'md',
}: {
  environment: ConfigEnvironment
  size?: 'sm' | 'md' | 'lg'
}) {
  if (environment.empty) return null
  const chips: { name: string; label: string }[] = []
  const seen = new Set<string>()
  for (const c of environment.clouds) {
    const p = environment.providers.find((x) => x.name === c)
    chips.push({ name: c, label: p?.label ?? c })
    seen.add(c)
  }
  if (environment.has_local && !seen.has('local')) {
    chips.push({ name: 'local', label: 'Local' })
    seen.add('local')
  }
  for (const p of environment.providers) {
    if (seen.has(p.name)) continue
    if (p.category === 'kubernetes' || p.category === 'vcs' || p.category === 'other') {
      chips.push({ name: p.name, label: p.label })
      seen.add(p.name)
    }
  }
  // Always show utilities if nothing else
  if (chips.length === 0) {
    for (const p of environment.providers.slice(0, 4)) {
      chips.push({ name: p.name, label: p.label })
    }
  }
  return (
    <div className="flex flex-wrap gap-2">
      {chips.map((c) => (
        <EnvBadge key={c.name} name={c.name} label={c.label} size={size} />
      ))}
    </div>
  )
}
