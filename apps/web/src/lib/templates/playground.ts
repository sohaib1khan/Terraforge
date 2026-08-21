import type { TfTemplate } from '../templateTypes'

const versions = `terraform {
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
`

/**
 * Playground-focused mini demos that mirror real deployment shapes
 * while staying on safe local/random providers.
 */
export const PLAYGROUND_DEMO_TEMPLATES: TfTemplate[] = [
  {
    id: 'pg-vm-specs',
    title: 'Choose VM specs',
    blurb:
      'Pick a size (nano→large); a local catalog maps it to vCPU / RAM / disk — same pattern as real cloud instance types.',
    level: 'beginner',
    cloud: 'local',
    track: 'foundation',
    step: 90,
    buildsOn: 'random-pet-local',
    time: '8 min',
    whatYouLearn: [
      'Size catalogs with locals maps',
      'variable validation for allowed sizes',
      'Writing a deployment-style manifest',
    ],
    prerequisites: ['Hello Local or Variables'],
    nextSteps: [
      'Edit terraform.tfvars (try medium or large) and re-apply',
      'Compare with real cloud instance types on Templates → Cloud',
    ],
    files: [
      {
        path: 'README.md',
        content: `# Choose VM specs (Playground demo)

This is a **mock VM deploy** — no hypervisor or cloud account.

You pick \`instance_size\`; Terraform looks up vCPU / memory / disk from a catalog
(the same pattern teams use for \`t3.micro\` / \`Standard_B2s\` style maps), then writes
a small JSON “deployment” file with a generated instance id.

## Try it
1. Init → Plan → Apply
2. Open \`deployed-vm.json\`
3. Change \`instance_size\` in \`terraform.tfvars\` to \`medium\` and Apply again
4. Destroy when finished

Safe providers only: \`hashicorp/local\` + \`hashicorp/random\`.
`,
      },
      { path: 'versions.tf', content: versions },
      {
        path: 'variables.tf',
        content: `variable "project_name" {
  description = "Logical name for this mock workload"
  type        = string
  default     = "playground-app"
}

variable "environment" {
  description = "Environment label (dev / staging / prod)"
  type        = string
  default     = "dev"
}

variable "instance_size" {
  description = "VM size key — maps to vCPU / memory / disk in locals"
  type        = string
  default     = "small"

  validation {
    condition     = contains(["nano", "small", "medium", "large"], var.instance_size)
    error_message = "instance_size must be one of: nano, small, medium, large."
  }
}

variable "region" {
  description = "Fake region label (shows how specs + placement show up together)"
  type        = string
  default     = "local-1"
}
`,
      },
      {
        path: 'terraform.tfvars',
        content: `project_name  = "playground-app"
environment   = "dev"
instance_size = "small"
region        = "local-1"
`,
      },
      {
        path: 'main.tf',
        content: `# Catalog looks like a real instance-type table (AWS / Azure / GCE style).
locals {
  size_catalog = {
    nano = {
      vcpus     = 1
      memory_mb = 512
      disk_gb   = 8
      class     = "burstable"
    }
    small = {
      vcpus     = 2
      memory_mb = 2048
      disk_gb   = 20
      class     = "general"
    }
    medium = {
      vcpus     = 4
      memory_mb = 8192
      disk_gb   = 40
      class     = "general"
    }
    large = {
      vcpus     = 8
      memory_mb = 16384
      disk_gb   = 80
      class     = "compute"
    }
  }

  selected = local.size_catalog[var.instance_size]
}

resource "random_id" "instance" {
  byte_length = 4
}

# Stand-in for a real compute resource: records what "would" be provisioned.
resource "local_file" "vm_manifest" {
  filename = "\${path.module}/deployed-vm.json"
  content = jsonencode({
    id           = "i-\${random_id.instance.hex}"
    name         = "\${var.project_name}-\${var.environment}"
    region       = var.region
    size         = var.instance_size
    class        = local.selected.class
    vcpus        = local.selected.vcpus
    memory_mb    = local.selected.memory_mb
    disk_gb      = local.selected.disk_gb
    status       = "running"
    provider_hint = "local-mock (swap for aws_instance / azurerm_linux_virtual_machine later)"
  })
}

resource "local_file" "vm_summary" {
  filename = "\${path.module}/vm-summary.txt"
  content  = <<-EOT
    Mock VM deployment
    ------------------
    Name:     \${var.project_name}-\${var.environment}
    ID:       i-\${random_id.instance.hex}
    Region:   \${var.region}
    Size:     \${var.instance_size} (\${local.selected.class})
    Specs:    \${local.selected.vcpus} vCPU · \${local.selected.memory_mb} MB RAM · \${local.selected.disk_gb} GB disk

    Change instance_size in terraform.tfvars and re-apply to resize.
  EOT
}
`,
      },
      {
        path: 'outputs.tf',
        content: `output "instance_id" {
  description = "Mock instance id"
  value       = "i-\${random_id.instance.hex}"
}

output "selected_specs" {
  description = "Resolved vCPU / memory / disk for the chosen size"
  value = {
    size      = var.instance_size
    vcpus     = local.selected.vcpus
    memory_mb = local.selected.memory_mb
    disk_gb   = local.selected.disk_gb
    class     = local.selected.class
  }
}

output "manifest_path" {
  value = local_file.vm_manifest.filename
}

output "summary_path" {
  value = local_file.vm_summary.filename
}
`,
      },
    ],
  },
]
