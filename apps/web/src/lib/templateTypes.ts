export type TemplateFile = {
  path: string
  content: string
}

/** Learning path — each track is a ladder of small lessons. */
export type TemplateTrack =
  | 'foundation'
  | 'language'
  | 'docker'
  | 'virtualbox'
  | 'qemu'
  | 'cloud'

export type TfTemplate = {
  id: string
  title: string
  blurb: string
  level: 'start-here' | 'beginner' | 'next-step'
  /** UI chip / icon family */
  cloud: 'local' | 'aws' | 'azure' | 'google' | 'docker' | 'virtualbox' | 'qemu' | 'multi'
  track: TemplateTrack
  /** 1-based order within the track */
  step: number
  /** Previous lesson id in the same track (optional) */
  buildsOn?: string
  time: string
  whatYouLearn: string[]
  prerequisites: string[]
  nextSteps: string[]
  files: TemplateFile[]
}

export const TRACK_META: Record<
  TemplateTrack,
  { label: string; blurb: string }
> = {
  foundation: {
    label: '1 · Foundation',
    blurb: 'Local files only — learn plan/apply with zero cloud or hypervisor.',
  },
  language: {
    label: '2 · Language',
    blurb: 'Terraform building blocks: count, for_each, locals, conditionals, data.',
  },
  docker: {
    label: '3 · Docker',
    blurb: 'Public kreuzwerker/docker provider — containers on your laptop daemon.',
  },
  virtualbox: {
    label: '4 · VirtualBox',
    blurb: 'Public terra-farm/virtualbox provider — tiny VMs for learning.',
  },
  qemu: {
    label: '5 · QEMU / libvirt',
    blurb: 'Public dmacvicar/libvirt provider — KVM/QEMU domains (Linux hosts).',
  },
  cloud: {
    label: '6 · Cloud starters',
    blurb: 'Tiny AWS / Azure / GCP samples after you know the basics.',
  },
}

export function templateFilesMap(t: TfTemplate): Record<string, string> {
  const out: Record<string, string> = {}
  for (const f of t.files) out[f.path] = f.content
  return out
}

export function sortTemplates(list: TfTemplate[]): TfTemplate[] {
  const trackOrder: TemplateTrack[] = [
    'foundation',
    'language',
    'docker',
    'virtualbox',
    'qemu',
    'cloud',
  ]
  return [...list].sort((a, b) => {
    const ta = trackOrder.indexOf(a.track)
    const tb = trackOrder.indexOf(b.track)
    if (ta !== tb) return ta - tb
    return a.step - b.step
  })
}
