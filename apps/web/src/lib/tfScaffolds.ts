/**
 * Starter file contents for blank playgrounds.
 * Everything here stays on the local / random providers so it runs
 * in the sandbox with no credentials.
 */

export type Scaffold = {
  id: string
  path: string
  label: string
  blurb: string
  content: string
}

const VERSIONS = `terraform {
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

const MAIN_DEMO = `# A resource block is: resource "<type>" "<name>" { ... }
# Type + name form the resource address, e.g. random_pet.app

resource "random_pet" "app" {
  length    = 2
  separator = "-"
}

# Referencing random_pet.app here creates a dependency edge, so Terraform
# always generates the name before it writes this file.
resource "local_file" "hello" {
  filename = "\${path.module}/hello.txt"
  content  = "Hello from \${random_pet.app.id}\\n"
}
`

const MAIN_MINIMAL = `resource "local_file" "example" {
  filename = "\${path.module}/example.txt"
  content  = "change me, then run terraform plan\\n"
}
`

const VARIABLES = `variable "environment" {
  description = "Which environment this configuration represents."
  type        = string
  default     = "dev"

  validation {
    condition     = contains(["dev", "stage", "prod"], var.environment)
    error_message = "environment must be one of: dev, stage, prod."
  }
}
`

const TFVARS = `# Values here override variable defaults automatically.
environment = "dev"
`

const OUTPUTS = `output "workspace" {
  description = "Values printed after apply — handy for IDs and paths."
  value       = terraform.workspace
}
`

const README = `# Playground session

Scratch workspace. Files here run in the same Docker Terraform runner as
real namespaces, but only the local and random providers are available.

    terraform init    # install providers
    terraform plan    # preview changes
    terraform apply   # make them real
    terraform destroy # clean up
`

export const TF_SCAFFOLDS: Scaffold[] = [
  {
    id: 'versions',
    path: 'versions.tf',
    label: 'versions.tf',
    blurb: 'Pins Terraform and provider versions. Needed before init.',
    content: VERSIONS,
  },
  {
    id: 'main-demo',
    path: 'main.tf',
    label: 'main.tf — worked example',
    blurb: 'Two linked resources that show a dependency edge.',
    content: MAIN_DEMO,
  },
  {
    id: 'main-minimal',
    path: 'main.tf',
    label: 'main.tf — bare skeleton',
    blurb: 'One local_file resource to edit from scratch.',
    content: MAIN_MINIMAL,
  },
  {
    id: 'variables',
    path: 'variables.tf',
    label: 'variables.tf',
    blurb: 'A typed input variable with a validation rule.',
    content: VARIABLES,
  },
  {
    id: 'tfvars',
    path: 'terraform.tfvars',
    label: 'terraform.tfvars',
    blurb: 'Concrete values for your variables.',
    content: TFVARS,
  },
  {
    id: 'outputs',
    path: 'outputs.tf',
    label: 'outputs.tf',
    blurb: 'Values surfaced after apply.',
    content: OUTPUTS,
  },
  {
    id: 'readme',
    path: 'README.md',
    label: 'README.md',
    blurb: 'Notes for whoever opens this playground next.',
    content: README,
  },
]

/** The smallest set that runs init → plan → apply successfully. */
export const RUNNABLE_SET = ['versions', 'main-demo', 'outputs']

export function scaffoldById(id: string): Scaffold | undefined {
  return TF_SCAFFOLDS.find((s) => s.id === id)
}

export function scaffoldFiles(ids: string[]): Record<string, string> {
  const files: Record<string, string> = {}
  for (const id of ids) {
    const s = scaffoldById(id)
    if (s) files[s.path] = s.content
  }
  return files
}
