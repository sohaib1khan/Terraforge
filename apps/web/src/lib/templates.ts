import { CLOUD_TEMPLATES } from './templates/cloud'
import { DOCKER_TEMPLATES } from './templates/docker'
import { FOUNDATION_TEMPLATES } from './templates/foundation'
import { LANGUAGE_TEMPLATES } from './templates/language'
import { PLAYGROUND_DEMO_TEMPLATES } from './templates/playground'
import { QEMU_TEMPLATES } from './templates/qemu'
import { VIRTUALBOX_TEMPLATES } from './templates/virtualbox'
import {
  sortTemplates,
  templateFilesMap,
  TRACK_META,
  type TemplateTrack,
  type TfTemplate,
} from './templateTypes'

export type { TemplateFile, TemplateTrack, TfTemplate } from './templateTypes'
export { TRACK_META, templateFilesMap, sortTemplates }

/** Safe local starters for Playground (foundation + language count/for_each + demos). */
export const PLAYGROUND_STARTER_IDS = [
  'hello-local',
  'variables-basics',
  'random-pet-local',
  'pg-vm-specs',
  'lang-count',
  'lang-for-each',
] as const

export function playgroundStarters(): TfTemplate[] {
  return PLAYGROUND_STARTER_IDS.map((id) => TF_TEMPLATES.find((t) => t.id === id)).filter(
    (t): t is TfTemplate => Boolean(t),
  )
}

/** Soft-warn if .tf files reference providers beyond local/random. */
export function detectNonLocalProviders(files: Record<string, string>): string[] {
  const found = new Set<string>()
  const re = /source\s*=\s*"([^"]+)"/g
  for (const [path, content] of Object.entries(files)) {
    if (!path.endsWith('.tf') && !path.endsWith('.tf.json')) continue
    let m: RegExpExecArray | null
    while ((m = re.exec(content))) {
      const src = m[1]
      if (src === 'hashicorp/local' || src === 'hashicorp/random') continue
      found.add(src)
    }
  }
  return [...found]
}

/** All learning templates — ordered by track then step. */
export const TF_TEMPLATES: TfTemplate[] = sortTemplates([
  ...FOUNDATION_TEMPLATES,
  ...PLAYGROUND_DEMO_TEMPLATES,
  ...LANGUAGE_TEMPLATES,
  ...DOCKER_TEMPLATES,
  ...VIRTUALBOX_TEMPLATES,
  ...QEMU_TEMPLATES,
  ...CLOUD_TEMPLATES,
])

export function templatesForTrack(track: TemplateTrack | 'all'): TfTemplate[] {
  if (track === 'all') return TF_TEMPLATES
  return TF_TEMPLATES.filter((t) => t.track === track)
}

export function previousTemplate(t: TfTemplate): TfTemplate | undefined {
  if (!t.buildsOn) return undefined
  return TF_TEMPLATES.find((x) => x.id === t.buildsOn)
}

export function nextTemplate(t: TfTemplate): TfTemplate | undefined {
  return TF_TEMPLATES.find((x) => x.buildsOn === t.id)
}
