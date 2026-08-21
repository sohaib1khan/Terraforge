import type { TfTemplate } from '../templateTypes'

const localVersions = `terraform {
  required_version = ">= 1.5.0"

  required_providers {
    local = {
      source  = "hashicorp/local"
      version = "~> 2.5"
    }
  }
}
`

export const FOUNDATION_TEMPLATES: TfTemplate[] = [
  {
    id: 'hello-local',
    title: 'Hello Local',
    blurb: 'Your first Terraform apply — no cloud account needed. Writes a text file on disk.',
    level: 'start-here',
    cloud: 'local',
    track: 'foundation',
    step: 1,
    time: '5 min',
    whatYouLearn: [
      'terraform block and required_providers',
      'A simple resource',
      'plan → apply → destroy cycle',
    ],
    prerequisites: ['Terraform CLI or Terraforge runs', 'Nothing else — fully local'],
    nextSteps: [
      'Open the namespace and run Init, then Plan, then Apply',
      'Change content and apply again to see an update',
      'Continue to Variables & Outputs',
    ],
    files: [
      {
        path: 'README.md',
        content: `# Hello Local (Foundation 1/4)

Safest first template: \`hashicorp/local\` only.

## Try it
1. Init → Plan → Apply
2. Change \`content\` and Apply again
3. Destroy when finished
`,
      },
      { path: 'versions.tf', content: localVersions },
      {
        path: 'main.tf',
        content: `resource "local_file" "hello" {
  filename = "\${path.module}/hello.txt"
  content  = "Hello from Terraforge — your first apply worked.\\n"
}
`,
      },
      {
        path: 'outputs.tf',
        content: `output "hello_path" {
  description = "Where the greeting file was written"
  value       = local_file.hello.filename
}
`,
      },
    ],
  },
  {
    id: 'variables-basics',
    title: 'Variables & Outputs',
    blurb: 'Same local file pattern, but driven by variables so you learn inputs and outputs.',
    level: 'start-here',
    cloud: 'local',
    track: 'foundation',
    step: 2,
    buildsOn: 'hello-local',
    time: '8 min',
    whatYouLearn: ['variable blocks and defaults', 'tfvars files', 'outputs'],
    prerequisites: ['Hello Local (Foundation 1)'],
    nextSteps: ['Edit terraform.tfvars and re-apply', 'Continue to Random + Local'],
    files: [
      {
        path: 'README.md',
        content: `# Variables & Outputs (Foundation 2/4)

Builds on Hello Local. Edit \`terraform.tfvars\` instead of hard-coding strings.
`,
      },
      { path: 'versions.tf', content: localVersions },
      {
        path: 'variables.tf',
        content: `variable "greeting" {
  description = "Text written into the greeting file"
  type        = string
  default     = "Hello from variables"
}

variable "file_name" {
  description = "File name created under this module"
  type        = string
  default     = "greeting.txt"
}
`,
      },
      {
        path: 'terraform.tfvars',
        content: `greeting  = "Hello from terraform.tfvars"
file_name = "greeting.txt"
`,
      },
      {
        path: 'main.tf',
        content: `resource "local_file" "greeting" {
  filename = "\${path.module}/\${var.file_name}"
  content  = "\${var.greeting}\\n"
}
`,
      },
      {
        path: 'outputs.tf',
        content: `output "written_file" {
  value = local_file.greeting.filename
}

output "message" {
  value = var.greeting
}
`,
      },
    ],
  },
  {
    id: 'random-pet-local',
    title: 'Random name + Local file',
    blurb: 'Combine two providers: generate a random pet name and write it to a file.',
    level: 'beginner',
    cloud: 'local',
    track: 'foundation',
    step: 3,
    buildsOn: 'variables-basics',
    time: '10 min',
    whatYouLearn: [
      'Using more than one provider',
      'Referencing one resource from another',
      'Dependency graph basics',
    ],
    prerequisites: ['Variables & Outputs'],
    nextSteps: ['Continue to Module shape', 'Or jump to Language track'],
    files: [
      {
        path: 'README.md',
        content: `# Random pet + local file (Foundation 3/4)

File content comes from \`random_pet\` — a simple resource reference.
`,
      },
      {
        path: 'versions.tf',
        content: `terraform {
  required_version = ">= 1.5.0"

  required_providers {
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
    local = {
      source  = "hashicorp/local"
      version = "~> 2.5"
    }
  }
}
`,
      },
      {
        path: 'main.tf',
        content: `resource "random_pet" "server" {
  length    = 2
  separator = "-"
}

resource "local_file" "nameplate" {
  filename = "\${path.module}/nameplate.txt"
  content  = "Generated name: \${random_pet.server.id}\\n"
}
`,
      },
      {
        path: 'outputs.tf',
        content: `output "pet_name" {
  value = random_pet.server.id
}

output "nameplate_path" {
  value = local_file.nameplate.filename
}
`,
      },
    ],
  },
  {
    id: 'module-shape',
    title: 'Module shape (local only)',
    blurb: 'See how a root module calls a child module — still 100% local.',
    level: 'next-step',
    cloud: 'local',
    track: 'foundation',
    step: 4,
    buildsOn: 'random-pet-local',
    time: '12 min',
    whatYouLearn: ['module blocks and source paths', 'Passing variables into modules', 'Module outputs'],
    prerequisites: ['Random + Local'],
    nextSteps: ['Language track (count / for_each)', 'Or Docker track if daemon is ready'],
    files: [
      {
        path: 'README.md',
        content: `# Module shape (Foundation 4/4)

Root calls \`./modules/greeting\`. This is how larger projects stay organized.
`,
      },
      { path: 'versions.tf', content: localVersions },
      {
        path: 'main.tf',
        content: `module "welcome" {
  source = "./modules/greeting"

  name     = "Terraform learner"
  filename = "welcome.txt"
}
`,
      },
      {
        path: 'outputs.tf',
        content: `output "welcome_file" {
  value = module.welcome.file_path
}
`,
      },
      {
        path: 'modules/greeting/variables.tf',
        content: `variable "name" {
  type = string
}

variable "filename" {
  type = string
}
`,
      },
      {
        path: 'modules/greeting/main.tf',
        content: `resource "local_file" "this" {
  filename = "\${path.root}/\${var.filename}"
  content  = "Welcome, \${var.name}!\\n"
}
`,
      },
      {
        path: 'modules/greeting/outputs.tf',
        content: `output "file_path" {
  value = local_file.this.filename
}
`,
      },
      {
        path: 'modules/greeting/versions.tf',
        content: `terraform {
  required_providers {
    local = {
      source = "hashicorp/local"
    }
  }
}
`,
      },
    ],
  },
]
