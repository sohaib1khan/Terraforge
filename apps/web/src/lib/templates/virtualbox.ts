import type { TfTemplate } from '../templateTypes'

/** VirtualBox lessons using the public terra-farm/virtualbox provider. */
export const VIRTUALBOX_TEMPLATES: TfTemplate[] = [
  {
    id: 'vbox-01-provider',
    title: 'VirtualBox 1 — Provider smoke test',
    blurb: 'Wire up terra-farm/virtualbox and document how VMs are declared (no heavy download yet).',
    level: 'beginner',
    cloud: 'virtualbox',
    track: 'virtualbox',
    step: 1,
    time: '8 min',
    whatYouLearn: [
      'terra-farm/virtualbox on the public Registry',
      'Where VirtualBox must be installed',
      'How image URLs feed VM disks',
    ],
    prerequisites: [
      'Oracle VirtualBox installed on the Terraform host',
      'Enough disk for a small appliance later',
    ],
    nextSteps: ['Install VirtualBox if needed', 'Continue to VirtualBox 2 (tiny VM)'],
    files: [
      {
        path: 'README.md',
        content: `# VirtualBox 1 — Provider smoke test

Provider: [\`terra-farm/virtualbox\`](https://registry.terraform.io/providers/terra-farm/virtualbox/latest) (public).

This step only pins the provider and shows the shape of a VM resource in comments.
Run \`terraform init\` to download the provider binary — no VM is created yet.
`,
      },
      {
        path: 'versions.tf',
        content: `terraform {
  required_version = ">= 1.5.0"

  required_providers {
    virtualbox = {
      source  = "terra-farm/virtualbox"
      version = "~> 0.2"
    }
  }
}
`,
      },
      {
        path: 'providers.tf',
        content: `provider "virtualbox" {
  # Talks to the VirtualBox installation on this machine.
}
`,
      },
      {
        path: 'main.tf',
        content: `# Intentionally empty for step 1.
# Next lesson creates virtualbox_vm with a public image URL.
#
# Example shape (do not uncomment until VirtualBox 2):
#
# resource "virtualbox_vm" "node" {
#   name   = "tf-learn-node"
#   memory = "512 mib"
#   cpus   = 1
#   ...
# }
`,
      },
      {
        path: 'outputs.tf',
        content: `output "next" {
  value = "Run terraform init, then open the VirtualBox 2 template"
}
`,
      },
    ],
  },
  {
    id: 'vbox-02-vm',
    title: 'VirtualBox 2 — Tiny VM',
    blurb: 'Create one small VM from a public cloud image URL. Learning-only, not production.',
    level: 'beginner',
    cloud: 'virtualbox',
    track: 'virtualbox',
    step: 2,
    buildsOn: 'vbox-01-provider',
    time: '20 min',
    whatYouLearn: ['virtualbox_vm', 'network_adapter NAT', 'image download on first apply'],
    prerequisites: [
      'VirtualBox 1',
      'VirtualBox GUI/CLI working',
      '~1 GB free for the demo image',
    ],
    nextSteps: [
      'First apply downloads the image — be patient',
      'Open VirtualBox Manager to see the VM',
      'Destroy when finished to reclaim disk',
    ],
    files: [
      {
        path: 'README.md',
        content: `# VirtualBox 2 — Tiny VM

Uses a public Ubuntu cloud image URL (example). If the URL 404s in the future, swap \`var.image\` for another \`.vdi\`/\`.ova\` link from a trusted mirror.

## Warning
Not hardened. Destroy after class.
`,
      },
      {
        path: 'versions.tf',
        content: `terraform {
  required_version = ">= 1.5.0"

  required_providers {
    virtualbox = {
      source  = "terra-farm/virtualbox"
      version = "~> 0.2"
    }
  }
}
`,
      },
      {
        path: 'providers.tf',
        content: `provider "virtualbox" {}
`,
      },
      {
        path: 'variables.tf',
        content: `variable "vm_name" {
  type    = string
  default = "tf-learn-vbox"
}

variable "image" {
  description = "Public image URL (.vdi / .ova). Replace if the link goes stale."
  type        = string
  # Example Ubuntu cloud image used in many community tutorials — verify before apply.
  default     = "https://app.vagrantup.com/ubuntu/boxes/bionic64/versions/20180903.0.0/providers/virtualbox.box"
}
`,
      },
      {
        path: 'main.tf',
        content: `resource "virtualbox_vm" "node" {
  name   = var.vm_name
  memory = "512 mib"
  cpus   = 1

  network_adapter {
    type           = "nat"
    host_interface = "vboxnet0"
  }

  status = "running"

  # On first apply the provider fetches var.image.
  image = var.image
}
`,
      },
      {
        path: 'outputs.tf',
        content: `output "vm_name" {
  value = virtualbox_vm.node.name
}

output "vm_id" {
  value = virtualbox_vm.node.id
}
`,
      },
    ],
  },
  {
    id: 'vbox-03-count',
    title: 'VirtualBox 3 — Two VMs with count',
    blurb: 'Combine VirtualBox with the language count idea — two tiny lab VMs.',
    level: 'next-step',
    cloud: 'virtualbox',
    track: 'virtualbox',
    step: 3,
    buildsOn: 'vbox-02-vm',
    time: '20 min',
    whatYouLearn: ['count with virtualbox_vm', 'Named instances via count.index'],
    prerequisites: ['VirtualBox 2 worked once', 'Extra RAM/disk for 2 VMs'],
    nextSteps: ['Set how_many = 1 when low on resources', 'Try QEMU/libvirt track on Linux'],
    files: [
      {
        path: 'README.md',
        content: `# VirtualBox 3 — count

Same public provider. Creates \`how_many\` VMs. Keep \`how_many\` small.
`,
      },
      {
        path: 'versions.tf',
        content: `terraform {
  required_version = ">= 1.5.0"

  required_providers {
    virtualbox = {
      source  = "terra-farm/virtualbox"
      version = "~> 0.2"
    }
  }
}
`,
      },
      {
        path: 'providers.tf',
        content: `provider "virtualbox" {}
`,
      },
      {
        path: 'variables.tf',
        content: `variable "how_many" {
  type    = number
  default = 2
}

variable "image" {
  type    = string
  default = "https://app.vagrantup.com/ubuntu/boxes/bionic64/versions/20180903.0.0/providers/virtualbox.box"
}
`,
      },
      {
        path: 'main.tf',
        content: `resource "virtualbox_vm" "node" {
  count  = var.how_many
  name   = "tf-learn-vbox-\${count.index}"
  memory = "512 mib"
  cpus   = 1
  image  = var.image
  status = "running"

  network_adapter {
    type = "nat"
  }
}
`,
      },
      {
        path: 'outputs.tf',
        content: `output "vm_names" {
  value = virtualbox_vm.node[*].name
}
`,
      },
    ],
  },
]
