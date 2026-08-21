import type { TfTemplate } from '../templateTypes'

/** Progressive Docker lessons using the public kreuzwerker/docker provider. */
export const DOCKER_TEMPLATES: TfTemplate[] = [
  {
    id: 'docker-01-image',
    title: 'Docker 1 — Pull an image',
    blurb: 'Talk to your local Docker daemon and pull nginx. No container yet.',
    level: 'beginner',
    cloud: 'docker',
    track: 'docker',
    step: 1,
    time: '10 min',
    whatYouLearn: ['kreuzwerker/docker provider', 'docker_image', 'keep_locally'],
    prerequisites: [
      'Docker Desktop or dockerd running on the machine that runs Terraform',
      'Foundation track recommended',
    ],
    nextSteps: ['Confirm image with docker images', 'Continue to Docker 2 (container)'],
    files: [
      {
        path: 'README.md',
        content: `# Docker 1 — Pull an image

Provider: [\`kreuzwerker/docker\`](https://registry.terraform.io/providers/kreuzwerker/docker/latest) (public Registry).

## Needs
- Docker daemon reachable (usually unix:///var/run/docker.sock)

## Note
If Terraforge’s runner has no Docker socket, copy these files and run \`terraform\` on your laptop next to Docker Desktop.
`,
      },
      {
        path: 'versions.tf',
        content: `terraform {
  required_version = ">= 1.5.0"

  required_providers {
    docker = {
      source  = "kreuzwerker/docker"
      version = "~> 3.0"
    }
  }
}
`,
      },
      {
        path: 'providers.tf',
        content: `provider "docker" {
  # Default: local Docker socket. Override host if needed:
  # host = "unix:///var/run/docker.sock"
}
`,
      },
      {
        path: 'main.tf',
        content: `resource "docker_image" "nginx" {
  name         = "nginx:alpine"
  keep_locally = true
}
`,
      },
      {
        path: 'outputs.tf',
        content: `output "image_id" {
  value = docker_image.nginx.image_id
}

output "image_name" {
  value = docker_image.nginx.name
}
`,
      },
    ],
  },
  {
    id: 'docker-02-container',
    title: 'Docker 2 — Run a container',
    blurb: 'Builds on the image lesson: start an nginx container from that image.',
    level: 'beginner',
    cloud: 'docker',
    track: 'docker',
    step: 2,
    buildsOn: 'docker-01-image',
    time: '10 min',
    whatYouLearn: ['docker_container', 'Linking image_id', 'must_run / restart'],
    prerequisites: ['Docker 1 — Pull an image', 'Docker daemon'],
    nextSteps: ['docker ps', 'Continue to published ports'],
    files: [
      {
        path: 'README.md',
        content: `# Docker 2 — Run a container

Builds on Docker 1. Same provider; adds \`docker_container\`.
`,
      },
      {
        path: 'versions.tf',
        content: `terraform {
  required_version = ">= 1.5.0"

  required_providers {
    docker = {
      source  = "kreuzwerker/docker"
      version = "~> 3.0"
    }
  }
}
`,
      },
      {
        path: 'providers.tf',
        content: `provider "docker" {}
`,
      },
      {
        path: 'main.tf',
        content: `resource "docker_image" "nginx" {
  name         = "nginx:alpine"
  keep_locally = true
}

resource "docker_container" "web" {
  name  = "tf-learn-nginx"
  image = docker_image.nginx.image_id

  must_run = true
  restart  = "unless-stopped"
}
`,
      },
      {
        path: 'outputs.tf',
        content: `output "container_id" {
  value = docker_container.web.id
}

output "container_name" {
  value = docker_container.web.name
}
`,
      },
    ],
  },
  {
    id: 'docker-03-ports',
    title: 'Docker 3 — Publish a port',
    blurb: 'Map host 8080 → container 80 so you can open nginx in a browser.',
    level: 'beginner',
    cloud: 'docker',
    track: 'docker',
    step: 3,
    buildsOn: 'docker-02-container',
    time: '10 min',
    whatYouLearn: ['ports block', 'Host vs container networking'],
    prerequisites: ['Docker 2', 'Port 8080 free on the host'],
    nextSteps: ['Open http://localhost:8080', 'Continue to volumes'],
    files: [
      {
        path: 'README.md',
        content: `# Docker 3 — Publish a port

Visit http://127.0.0.1:8080 after apply.
`,
      },
      {
        path: 'versions.tf',
        content: `terraform {
  required_version = ">= 1.5.0"

  required_providers {
    docker = {
      source  = "kreuzwerker/docker"
      version = "~> 3.0"
    }
  }
}
`,
      },
      {
        path: 'providers.tf',
        content: `provider "docker" {}
`,
      },
      {
        path: 'variables.tf',
        content: `variable "host_port" {
  type    = number
  default = 8080
}
`,
      },
      {
        path: 'main.tf',
        content: `resource "docker_image" "nginx" {
  name         = "nginx:alpine"
  keep_locally = true
}

resource "docker_container" "web" {
  name  = "tf-learn-nginx-port"
  image = docker_image.nginx.image_id

  ports {
    internal = 80
    external = var.host_port
  }
}
`,
      },
      {
        path: 'outputs.tf',
        content: `output "url" {
  value = "http://127.0.0.1:\${var.host_port}"
}
`,
      },
    ],
  },
  {
    id: 'docker-04-volume',
    title: 'Docker 4 — Named volume',
    blurb: 'Persist a file with docker_volume and mount it into nginx.',
    level: 'next-step',
    cloud: 'docker',
    track: 'docker',
    step: 4,
    buildsOn: 'docker-03-ports',
    time: '12 min',
    whatYouLearn: ['docker_volume', 'volumes mount', 'Persistence across recreate'],
    prerequisites: ['Docker 3'],
    nextSteps: ['Destroy/re-apply and see volume survive (until volume destroy)', 'Continue to network'],
    files: [
      {
        path: 'README.md',
        content: `# Docker 4 — Named volume

Creates a volume and mounts it at \`/usr/share/nginx/html\` (empty until you add files).
`,
      },
      {
        path: 'versions.tf',
        content: `terraform {
  required_version = ">= 1.5.0"

  required_providers {
    docker = {
      source  = "kreuzwerker/docker"
      version = "~> 3.0"
    }
  }
}
`,
      },
      {
        path: 'providers.tf',
        content: `provider "docker" {}
`,
      },
      {
        path: 'main.tf',
        content: `resource "docker_volume" "web_content" {
  name = "tf-learn-nginx-content"
}

resource "docker_image" "nginx" {
  name         = "nginx:alpine"
  keep_locally = true
}

resource "docker_container" "web" {
  name  = "tf-learn-nginx-vol"
  image = docker_image.nginx.image_id

  ports {
    internal = 80
    external = 8081
  }

  volumes {
    volume_name    = docker_volume.web_content.name
    container_path = "/usr/share/nginx/html"
  }
}
`,
      },
      {
        path: 'outputs.tf',
        content: `output "volume_name" {
  value = docker_volume.web_content.name
}

output "url" {
  value = "http://127.0.0.1:8081"
}
`,
      },
    ],
  },
  {
    id: 'docker-05-network',
    title: 'Docker 5 — User-defined network',
    blurb: 'Two containers on a custom bridge network (nginx + a tiny alias buddy).',
    level: 'next-step',
    cloud: 'docker',
    track: 'docker',
    step: 5,
    buildsOn: 'docker-04-volume',
    time: '15 min',
    whatYouLearn: ['docker_network', 'Multi-container wiring', 'Network aliases'],
    prerequisites: ['Docker 4'],
    nextSteps: ['docker network inspect tf-learn-net', 'Try VirtualBox or QEMU tracks next'],
    files: [
      {
        path: 'README.md',
        content: `# Docker 5 — Network

Creates a bridge network and attaches nginx. A second busybox container shares the network.
`,
      },
      {
        path: 'versions.tf',
        content: `terraform {
  required_version = ">= 1.5.0"

  required_providers {
    docker = {
      source  = "kreuzwerker/docker"
      version = "~> 3.0"
    }
  }
}
`,
      },
      {
        path: 'providers.tf',
        content: `provider "docker" {}
`,
      },
      {
        path: 'main.tf',
        content: `resource "docker_network" "learn" {
  name   = "tf-learn-net"
  driver = "bridge"
}

resource "docker_image" "nginx" {
  name         = "nginx:alpine"
  keep_locally = true
}

resource "docker_image" "busybox" {
  name         = "busybox:latest"
  keep_locally = true
}

resource "docker_container" "web" {
  name  = "tf-learn-web"
  image = docker_image.nginx.image_id

  networks_advanced {
    name = docker_network.learn.name
  }

  ports {
    internal = 80
    external = 8082
  }
}

resource "docker_container" "buddy" {
  name    = "tf-learn-buddy"
  image   = docker_image.busybox.image_id
  command = ["sleep", "3600"]

  networks_advanced {
    name    = docker_network.learn.name
    aliases = ["buddy"]
  }
}
`,
      },
      {
        path: 'outputs.tf',
        content: `output "network" {
  value = docker_network.learn.name
}

output "hint" {
  value = "From buddy: wget -qO- http://tf-learn-web (same Docker network)"
}
`,
      },
    ],
  },
]
