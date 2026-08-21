import type { TfTemplate } from '../templateTypes'

/** QEMU/KVM via the public dmacvicar/libvirt provider. */
export const QEMU_TEMPLATES: TfTemplate[] = [
  {
    id: 'qemu-01-provider',
    title: 'QEMU 1 — libvirt provider',
    blurb: 'Connect Terraform to libvirt (QEMU/KVM). Init-only lesson with connection notes.',
    level: 'beginner',
    cloud: 'qemu',
    track: 'qemu',
    step: 1,
    time: '10 min',
    whatYouLearn: [
      'dmacvicar/libvirt on the public Registry',
      'qemu:///system vs session URIs',
      'Why this track needs a Linux host with libvirt',
    ],
    prerequisites: [
      'Linux host with libvirt + qemu installed',
      'User permission for the libvirt socket (or root)',
    ],
    nextSteps: ['terraform init', 'virsh uri', 'Continue to pool + volume'],
    files: [
      {
        path: 'README.md',
        content: `# QEMU 1 — libvirt provider

Provider: [\`dmacvicar/libvirt\`](https://registry.terraform.io/providers/dmacvicar/libvirt/latest) (public).

## Host setup (examples)
\`\`\`bash
# Debian/Ubuntu-ish
sudo apt install qemu-kvm libvirt-daemon-system
virsh list --all
\`\`\`

Default URI \`qemu:///system\` talks to the system daemon.
`,
      },
      {
        path: 'versions.tf',
        content: `terraform {
  required_version = ">= 1.5.0"

  required_providers {
    libvirt = {
      source  = "dmacvicar/libvirt"
      version = "~> 0.8"
    }
  }
}
`,
      },
      {
        path: 'providers.tf',
        content: `provider "libvirt" {
  uri = var.libvirt_uri
}
`,
      },
      {
        path: 'variables.tf',
        content: `variable "libvirt_uri" {
  description = "libvirt connection URI"
  type        = string
  default     = "qemu:///system"
}
`,
      },
      {
        path: 'main.tf',
        content: `# Step 1: provider only. Next lesson creates a storage pool + volume.
`,
      },
      {
        path: 'outputs.tf',
        content: `output "uri" {
  value = var.libvirt_uri
}
`,
      },
    ],
  },
  {
    id: 'qemu-02-pool-volume',
    title: 'QEMU 2 — Pool + volume',
    blurb: 'Create a directory storage pool and an empty volume — building blocks for a domain.',
    level: 'beginner',
    cloud: 'qemu',
    track: 'qemu',
    step: 2,
    buildsOn: 'qemu-01-provider',
    time: '15 min',
    whatYouLearn: ['libvirt_pool', 'libvirt_volume', 'dir-backed storage'],
    prerequisites: ['QEMU 1', 'Writable path for the pool (default under /var/lib/libvirt)'],
    nextSteps: ['virsh pool-list', 'Continue to a minimal domain'],
    files: [
      {
        path: 'README.md',
        content: `# QEMU 2 — Pool + volume

Creates a small learning pool and a 1G volume. Adjust paths if your distro differs.
`,
      },
      {
        path: 'versions.tf',
        content: `terraform {
  required_version = ">= 1.5.0"

  required_providers {
    libvirt = {
      source  = "dmacvicar/libvirt"
      version = "~> 0.8"
    }
  }
}
`,
      },
      {
        path: 'providers.tf',
        content: `provider "libvirt" {
  uri = var.libvirt_uri
}
`,
      },
      {
        path: 'variables.tf',
        content: `variable "libvirt_uri" {
  type    = string
  default = "qemu:///system"
}

variable "pool_path" {
  description = "Directory for the learning pool"
  type        = string
  default     = "/var/lib/libvirt/images/tf-learn"
}
`,
      },
      {
        path: 'main.tf',
        content: `resource "libvirt_pool" "learn" {
  name = "tf-learn"
  type = "dir"
  path = var.pool_path
}

resource "libvirt_volume" "disk" {
  name   = "tf-learn-disk.qcow2"
  pool   = libvirt_pool.learn.name
  format = "qcow2"
  size   = 1000000000 # ~1 GiB — learning only
}
`,
      },
      {
        path: 'outputs.tf',
        content: `output "pool" {
  value = libvirt_pool.learn.name
}

output "volume" {
  value = libvirt_volume.disk.name
}
`,
      },
    ],
  },
  {
    id: 'qemu-03-domain',
    title: 'QEMU 3 — Minimal domain',
    blurb: 'Attach the volume to a tiny libvirt domain (VM). Expect to supply a bootable base image.',
    level: 'next-step',
    cloud: 'qemu',
    track: 'qemu',
    step: 3,
    buildsOn: 'qemu-02-pool-volume',
    time: '25 min',
    whatYouLearn: ['libvirt_domain', 'Disk + network XML-ish HCL', 'Why cloud images need base volumes'],
    prerequisites: [
      'QEMU 2',
      'A small cloud image you trust (set base_image_path)',
      'Comfort editing variables',
    ],
    nextSteps: [
      'Point base_image_path at a local qcow2',
      'virsh list --all after apply',
      'Destroy carefully when done',
    ],
    files: [
      {
        path: 'README.md',
        content: `# QEMU 3 — Minimal domain

This lesson expects a **local** base qcow2 (download Ubuntu cloud image yourself, then set \`base_image_path\`).

We keep the example small on purpose — libvirt domains have many knobs; this shows the Terraform shape only.
`,
      },
      {
        path: 'versions.tf',
        content: `terraform {
  required_version = ">= 1.5.0"

  required_providers {
    libvirt = {
      source  = "dmacvicar/libvirt"
      version = "~> 0.8"
    }
  }
}
`,
      },
      {
        path: 'providers.tf',
        content: `provider "libvirt" {
  uri = var.libvirt_uri
}
`,
      },
      {
        path: 'variables.tf',
        content: `variable "libvirt_uri" {
  type    = string
  default = "qemu:///system"
}

variable "pool_path" {
  type    = string
  default = "/var/lib/libvirt/images/tf-learn"
}

variable "base_image_path" {
  description = "Path to a local base qcow2 on the libvirt host"
  type        = string
}

variable "memory_mb" {
  type    = number
  default = 512
}

variable "vcpu" {
  type    = number
  default = 1
}
`,
      },
      {
        path: 'terraform.tfvars.example',
        content: `base_image_path = "/var/lib/libvirt/images/focal-server-cloudimg-amd64.img"
`,
      },
      {
        path: 'main.tf',
        content: `resource "libvirt_pool" "learn" {
  name = "tf-learn"
  type = "dir"
  path = var.pool_path
}

# Copy-on-write volume backed by your base image
resource "libvirt_volume" "root" {
  name           = "tf-learn-root.qcow2"
  pool           = libvirt_pool.learn.name
  base_volume_id = libvirt_volume.base.id
}

resource "libvirt_volume" "base" {
  name   = "tf-learn-base.qcow2"
  pool   = libvirt_pool.learn.name
  source = var.base_image_path
  format = "qcow2"
}

resource "libvirt_domain" "vm" {
  name   = "tf-learn-vm"
  memory = var.memory_mb
  vcpu   = var.vcpu

  disk {
    volume_id = libvirt_volume.root.id
  }

  network_interface {
    network_name = "default"
  }

  console {
    type        = "pty"
    target_type = "serial"
    target_port = "0"
  }
}
`,
      },
      {
        path: 'outputs.tf',
        content: `output "domain" {
  value = libvirt_domain.vm.name
}

output "hint" {
  value = "virsh dominfo tf-learn-vm"
}
`,
      },
    ],
  },
]
