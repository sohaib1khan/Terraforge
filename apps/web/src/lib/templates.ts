export type TemplateFile = {
  path: string
  content: string
}

export type TfTemplate = {
  id: string
  title: string
  blurb: string
  level: 'start-here' | 'beginner' | 'next-step'
  cloud: 'local' | 'aws' | 'azure' | 'google' | 'multi'
  time: string
  whatYouLearn: string[]
  prerequisites: string[]
  nextSteps: string[]
  files: TemplateFile[]
}

export const TF_TEMPLATES: TfTemplate[] = [
  {
    id: 'hello-local',
    title: 'Hello Local',
    blurb: 'Your first Terraform apply — no cloud account needed. Writes a text file on disk.',
    level: 'start-here',
    cloud: 'local',
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
      'Try Destroy when you are done',
    ],
    files: [
      {
        path: 'README.md',
        content: `# Hello Local

This is the safest first template: it only uses the \`local\` provider.

## What it does
Creates a file named \`hello.txt\` with a short greeting.

## Try it
1. Init
2. Plan
3. Apply
4. Change the \`content\` string and Apply again
5. Destroy to remove the file
`,
      },
      {
        path: 'versions.tf',
        content: `terraform {
  required_version = ">= 1.5.0"

  required_providers {
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
        content: `# Creates a plain text file on the runner / workspace disk.
resource "local_file" "hello" {
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
    time: '8 min',
    whatYouLearn: [
      'variable blocks and defaults',
      'tfvars files',
      'outputs for useful values',
    ],
    prerequisites: ['Complete Hello Local first if you are brand new'],
    nextSteps: [
      'Edit terraform.tfvars and re-apply',
      'Try terraform plan -var="greeting=Hi from me"',
    ],
    files: [
      {
        path: 'README.md',
        content: `# Variables & Outputs

Learn how to pass values into Terraform and print useful results.

Edit \`terraform.tfvars\` (safe for beginners) instead of hard-coding strings in resources.
`,
      },
      {
        path: 'versions.tf',
        content: `terraform {
  required_version = ">= 1.5.0"

  required_providers {
    local = {
      source  = "hashicorp/local"
      version = "~> 2.5"
    }
  }
}
`,
      },
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
  description = "Full path of the file Terraform managed"
  value       = local_file.greeting.filename
}

output "message" {
  description = "Echo of the greeting variable"
  value       = var.greeting
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
    time: '10 min',
    whatYouLearn: [
      'Using more than one provider',
      'Referencing one resource from another',
      'How Terraform dependency graph works',
    ],
    prerequisites: ['No cloud credentials'],
    nextSteps: [
      'Change length / prefix and apply',
      'Run Destroy — both resources should go away',
    ],
    files: [
      {
        path: 'README.md',
        content: `# Random pet + local file

Demonstrates resource references: the file content comes from \`random_pet\`.
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
    id: 'aws-s3-starter',
    title: 'AWS — Private S3 bucket',
    blurb: 'Minimal AWS starter: one private bucket with tagging. Easy to read, easy to destroy.',
    level: 'beginner',
    cloud: 'aws',
    time: '15 min',
    whatYouLearn: [
      'AWS provider configuration',
      'A real cloud resource (S3)',
      'Tags and public-access blocks',
    ],
    prerequisites: [
      'AWS account',
      'Credentials via env (AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY) or instance role',
      'Permission to create S3 buckets',
    ],
    nextSteps: [
      'Set region in providers.tf',
      'Apply, then verify in AWS console',
      'Destroy when finished — avoid leaving buckets behind',
    ],
    files: [
      {
        path: 'README.md',
        content: `# AWS S3 starter

Creates a **private** S3 bucket. Bucket names must be globally unique — we append a random suffix.

## Credentials
Export keys before running, or store them as namespace secrets that your runner can use:

\`\`\`bash
export AWS_ACCESS_KEY_ID=...
export AWS_SECRET_ACCESS_KEY=...
export AWS_DEFAULT_REGION=us-west-2
\`\`\`

## Clean up
Always Destroy this template when you are done practicing.
`,
      },
      {
        path: 'versions.tf',
        content: `terraform {
  required_version = ">= 1.5.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }
}
`,
      },
      {
        path: 'providers.tf',
        content: `provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project     = "terraforge-starter"
      Environment = "learning"
      ManagedBy   = "terraform"
    }
  }
}
`,
      },
      {
        path: 'variables.tf',
        content: `variable "aws_region" {
  description = "AWS region for the bucket"
  type        = string
  default     = "us-west-2"
}

variable "bucket_prefix" {
  description = "Prefix for the bucket name (lowercase letters/numbers/hyphens)"
  type        = string
  default     = "tf-learn"
}
`,
      },
      {
        path: 'main.tf',
        content: `resource "random_id" "suffix" {
  byte_length = 4
}

resource "aws_s3_bucket" "learn" {
  bucket = "\${var.bucket_prefix}-\${random_id.suffix.hex}"
}

resource "aws_s3_bucket_public_access_block" "learn" {
  bucket = aws_s3_bucket.learn.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "learn" {
  bucket = aws_s3_bucket.learn.id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}
`,
      },
      {
        path: 'outputs.tf',
        content: `output "bucket_name" {
  description = "Name of the learning bucket"
  value       = aws_s3_bucket.learn.bucket
}

output "bucket_arn" {
  description = "ARN of the learning bucket"
  value       = aws_s3_bucket.learn.arn
}

output "region" {
  value = var.aws_region
}
`,
      },
    ],
  },
  {
    id: 'azure-rg-starter',
    title: 'Azure — Resource group',
    blurb: 'Smallest useful Azure starter: one resource group you can build on later.',
    level: 'beginner',
    cloud: 'azure',
    time: '15 min',
    whatYouLearn: [
      'azurerm provider + features block',
      'Resource groups as the Azure foundation',
      'Naming with variables',
    ],
    prerequisites: [
      'Azure subscription',
      'Logged-in az cli or service principal env vars',
      'Permission to create resource groups',
    ],
    nextSteps: [
      'Apply, then open the Azure portal and find the group',
      'Add a storage account resource in a later exercise',
      'Destroy to delete the group',
    ],
    files: [
      {
        path: 'README.md',
        content: `# Azure resource group starter

Creates one resource group. This is the usual first object for Azure labs.

## Auth options
- \`az login\` on the machine running Terraform, or
- Service principal: \`ARM_CLIENT_ID\`, \`ARM_CLIENT_SECRET\`, \`ARM_SUBSCRIPTION_ID\`, \`ARM_TENANT_ID\`
`,
      },
      {
        path: 'versions.tf',
        content: `terraform {
  required_version = ">= 1.5.0"

  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 4.0"
    }
  }
}
`,
      },
      {
        path: 'providers.tf',
        content: `provider "azurerm" {
  features {}
}
`,
      },
      {
        path: 'variables.tf',
        content: `variable "location" {
  description = "Azure region"
  type        = string
  default     = "eastus"
}

variable "name" {
  description = "Resource group name"
  type        = string
  default     = "rg-terraforge-learn"
}
`,
      },
      {
        path: 'main.tf',
        content: `resource "azurerm_resource_group" "learn" {
  name     = var.name
  location = var.location

  tags = {
    Project     = "terraforge-starter"
    Environment = "learning"
    ManagedBy   = "terraform"
  }
}
`,
      },
      {
        path: 'outputs.tf',
        content: `output "resource_group_name" {
  value = azurerm_resource_group.learn.name
}

output "location" {
  value = azurerm_resource_group.learn.location
}

output "id" {
  value = azurerm_resource_group.learn.id
}
`,
      },
    ],
  },
  {
    id: 'gcp-storage-starter',
    title: 'Google Cloud — Storage bucket',
    blurb: 'Beginner GCP template: one regional bucket with uniform access.',
    level: 'beginner',
    cloud: 'google',
    time: '15 min',
    whatYouLearn: [
      'google provider and project id',
      'Cloud Storage bucket basics',
      'Preventing accidental destroy (optional toggle)',
    ],
    prerequisites: [
      'GCP project with billing',
      'Application Default Credentials or GOOGLE_CREDENTIALS',
      'Permission to create storage buckets',
    ],
    nextSteps: [
      'Set project_id in terraform.tfvars',
      'Apply and confirm in Cloud Console',
      'Destroy when finished',
    ],
    files: [
      {
        path: 'README.md',
        content: `# GCP storage starter

Creates one regional Cloud Storage bucket.

Set your project in \`terraform.tfvars\` before applying.
`,
      },
      {
        path: 'versions.tf',
        content: `terraform {
  required_version = ">= 1.5.0"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }
}
`,
      },
      {
        path: 'providers.tf',
        content: `provider "google" {
  project = var.project_id
  region  = var.region
}
`,
      },
      {
        path: 'variables.tf',
        content: `variable "project_id" {
  description = "GCP project ID (not the display name)"
  type        = string
}

variable "region" {
  description = "Default region"
  type        = string
  default     = "us-central1"
}

variable "bucket_prefix" {
  description = "Prefix for the bucket name"
  type        = string
  default     = "tf-learn"
}
`,
      },
      {
        path: 'terraform.tfvars.example',
        content: `project_id    = "your-gcp-project-id"
region        = "us-central1"
bucket_prefix = "tf-learn"
`,
      },
      {
        path: 'main.tf',
        content: `resource "random_id" "suffix" {
  byte_length = 4
}

resource "google_storage_bucket" "learn" {
  name                        = "\${var.bucket_prefix}-\${random_id.suffix.hex}"
  location                    = var.region
  force_destroy               = true
  uniform_bucket_level_access = true

  labels = {
    project     = "terraforge-starter"
    environment = "learning"
    managed_by  = "terraform"
  }
}
`,
      },
      {
        path: 'outputs.tf',
        content: `output "bucket_name" {
  value = google_storage_bucket.learn.name
}

output "bucket_url" {
  value = google_storage_bucket.learn.url
}
`,
      },
    ],
  },
  {
    id: 'module-shape',
    title: 'Module shape (local only)',
    blurb: 'See how a root module calls a child module — still 100% local, no cloud.',
    level: 'next-step',
    cloud: 'local',
    time: '12 min',
    whatYouLearn: [
      'module blocks and source paths',
      'Passing variables into modules',
      'Module outputs',
    ],
    prerequisites: ['Comfortable with Hello Local'],
    nextSteps: [
      'Change the child module greeting and re-apply',
      'Add a second module call with a different name',
    ],
    files: [
      {
        path: 'README.md',
        content: `# Module shape

Root module calls \`modules/greeting\`. This is how larger Terraform projects stay organized.
`,
      },
      {
        path: 'versions.tf',
        content: `terraform {
  required_version = ">= 1.5.0"

  required_providers {
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
  filename = "\${path.module}/../../\${var.filename}"
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

export function templateFilesMap(t: TfTemplate): Record<string, string> {
  const out: Record<string, string> = {}
  for (const f of t.files) out[f.path] = f.content
  return out
}
