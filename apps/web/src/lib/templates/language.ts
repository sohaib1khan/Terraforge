import type { TfTemplate } from '../templateTypes'

const localRandom = `terraform {
  required_version = ">= 1.5.0"

  required_providers {
    local = {
      source  = "hashicorp/local"
      version = "~> 2.5"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }
}
`

/** Pure Terraform language lessons (still local providers). */
export const LANGUAGE_TEMPLATES: TfTemplate[] = [
  {
    id: 'lang-count',
    title: 'count — make N of something',
    blurb: 'Create several local files with count.index. Core scaling idea before for_each.',
    level: 'beginner',
    cloud: 'local',
    track: 'language',
    step: 1,
    buildsOn: 'module-shape',
    time: '10 min',
    whatYouLearn: ['count meta-argument', 'count.index', 'splat outputs'],
    prerequisites: ['Foundation track finished (or Hello Local at minimum)'],
    nextSteps: ['Change var.how_many and re-apply', 'Continue to for_each'],
    files: [
      {
        path: 'README.md',
        content: `# count (Language 1/5)

Creates N tiny files. Change \`how_many\` to see Terraform add/remove instances.
`,
      },
      { path: 'versions.tf', content: localRandom },
      {
        path: 'variables.tf',
        content: `variable "how_many" {
  type    = number
  default = 3
}
`,
      },
      {
        path: 'main.tf',
        content: `resource "local_file" "notes" {
  count = var.how_many

  filename = "\${path.module}/note-\${count.index}.txt"
  content  = "This is note #\${count.index}\\n"
}
`,
      },
      {
        path: 'outputs.tf',
        content: `output "note_paths" {
  value = local_file.notes[*].filename
}
`,
      },
    ],
  },
  {
    id: 'lang-for-each',
    title: 'for_each — map keys to resources',
    blurb: 'Prefer for_each when each instance has a stable name (not just 0,1,2).',
    level: 'beginner',
    cloud: 'local',
    track: 'language',
    step: 2,
    buildsOn: 'lang-count',
    time: '12 min',
    whatYouLearn: ['for_each with a map', 'each.key / each.value', 'toset()'],
    prerequisites: ['count lesson'],
    nextSteps: ['Add another map entry and apply', 'Continue to locals & functions'],
    files: [
      {
        path: 'README.md',
        content: `# for_each (Language 2/5)

Builds on count. Named instances are easier to reason about than indexes.
`,
      },
      { path: 'versions.tf', content: localRandom },
      {
        path: 'variables.tf',
        content: `variable "pets" {
  type = map(string)
  default = {
    alpha = "friendly"
    beta  = "curious"
    gamma = "brave"
  }
}
`,
      },
      {
        path: 'main.tf',
        content: `resource "local_file" "pet" {
  for_each = var.pets

  filename = "\${path.module}/pet-\${each.key}.txt"
  content  = "\${each.key} is \${each.value}\\n"
}
`,
      },
      {
        path: 'outputs.tf',
        content: `output "pet_files" {
  value = { for k, f in local_file.pet : k => f.filename }
}
`,
      },
    ],
  },
  {
    id: 'lang-locals-functions',
    title: 'locals & functions',
    blurb: 'Build derived values with locals and common functions (join, upper, format).',
    level: 'beginner',
    cloud: 'local',
    track: 'language',
    step: 3,
    buildsOn: 'lang-for-each',
    time: '10 min',
    whatYouLearn: ['locals blocks', 'join / upper / format', 'Keeping main.tf readable'],
    prerequisites: ['for_each lesson'],
    nextSteps: ['Continue to conditionals', 'Try formatdate() in an experiment'],
    files: [
      {
        path: 'README.md',
        content: `# locals & functions (Language 3/5)

Locals are named expressions. Functions transform values without new resources.
`,
      },
      { path: 'versions.tf', content: localRandom },
      {
        path: 'variables.tf',
        content: `variable "project" {
  type    = string
  default = "terraforge"
}

variable "env" {
  type    = string
  default = "learn"
}
`,
      },
      {
        path: 'main.tf',
        content: `locals {
  label       = upper("\${var.project}-\${var.env}")
  banner      = format("Project=%s Env=%s", var.project, var.env)
  tags_line   = join(",", ["managed-by=terraform", "track=language"])
}

resource "local_file" "banner" {
  filename = "\${path.module}/banner.txt"
  content  = "\${local.banner}\\nlabel=\${local.label}\\n\${local.tags_line}\\n"
}
`,
      },
      {
        path: 'outputs.tf',
        content: `output "label" {
  value = local.label
}
`,
      },
    ],
  },
  {
    id: 'lang-conditionals',
    title: 'Conditionals & try()',
    blurb: 'Toggle behavior with ternary expressions and safe lookups with try().',
    level: 'next-step',
    cloud: 'local',
    track: 'language',
    step: 4,
    buildsOn: 'lang-locals-functions',
    time: '10 min',
    whatYouLearn: ['condition ? a : b', 'try()', 'Optional resources via count'],
    prerequisites: ['locals lesson'],
    nextSteps: ['Flip enable_extra and apply', 'Continue to data sources'],
    files: [
      {
        path: 'README.md',
        content: `# Conditionals (Language 4/5)

\`enable_extra\` decides whether a second file exists (count = 0 or 1).
`,
      },
      { path: 'versions.tf', content: localRandom },
      {
        path: 'variables.tf',
        content: `variable "enable_extra" {
  type    = bool
  default = true
}

variable "mode" {
  type    = string
  default = "dev"
}
`,
      },
      {
        path: 'main.tf',
        content: `locals {
  title = var.mode == "prod" ? "PRODUCTION" : "development"
}

resource "local_file" "primary" {
  filename = "\${path.module}/primary.txt"
  content  = "Running in \${local.title}\\n"
}

resource "local_file" "extra" {
  count = var.enable_extra ? 1 : 0

  filename = "\${path.module}/extra.txt"
  content  = "Extra file enabled\\n"
}
`,
      },
      {
        path: 'outputs.tf',
        content: `output "extra_path" {
  # try() avoids errors when count is 0
  value = try(local_file.extra[0].filename, "disabled")
}
`,
      },
    ],
  },
  {
    id: 'lang-data-sources',
    title: 'Data sources (read-only)',
    blurb: 'Read something that already exists — here a local file you create first.',
    level: 'next-step',
    cloud: 'local',
    track: 'language',
    step: 5,
    buildsOn: 'lang-conditionals',
    time: '12 min',
    whatYouLearn: ['data blocks', 'Depends on created resources', 'Read vs manage'],
    prerequisites: ['Conditionals lesson'],
    nextSteps: ['Docker track if you have a daemon', 'Or cloud starters'],
    files: [
      {
        path: 'README.md',
        content: `# Data sources (Language 5/5)

1. Apply once to create \`seed.txt\`
2. The data source reads it back (teaching the pattern used with AMIs, images, etc.)
`,
      },
      { path: 'versions.tf', content: localRandom },
      {
        path: 'main.tf',
        content: `resource "local_file" "seed" {
  filename = "\${path.module}/seed.txt"
  content  = "seed-value-42\\n"
}

data "local_file" "seed_read" {
  filename = local_file.seed.filename
}

resource "local_file" "echo" {
  filename = "\${path.module}/echo.txt"
  content  = "Read from data source: \${trimspace(data.local_file.seed_read.content)}\\n"
}
`,
      },
      {
        path: 'outputs.tf',
        content: `output "echoed" {
  value = trimspace(data.local_file.seed_read.content)
}
`,
      },
    ],
  },
]
