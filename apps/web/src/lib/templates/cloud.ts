import type { TfTemplate } from '../templateTypes'

/** Tiny public-cloud starters (after local tracks). */
export const CLOUD_TEMPLATES: TfTemplate[] = [
  {
    id: 'aws-s3-starter',
    title: 'AWS — Private S3 bucket',
    blurb: 'Minimal AWS starter: one private bucket with tagging.',
    level: 'beginner',
    cloud: 'aws',
    track: 'cloud',
    step: 1,
    time: '15 min',
    whatYouLearn: ['AWS provider', 'S3 bucket', 'Public access block'],
    prerequisites: ['AWS credentials', 'Foundation track recommended'],
    nextSteps: ['Apply then Destroy', 'Try Azure / GCP starters'],
    files: [
      {
        path: 'README.md',
        content: `# AWS S3 starter (Cloud)

Creates a private bucket. Names must be globally unique — we append a random suffix.
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
  type    = string
  default = "us-west-2"
}

variable "bucket_prefix" {
  type    = string
  default = "tf-learn"
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
  bucket                  = aws_s3_bucket.learn.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}
`,
      },
      {
        path: 'outputs.tf',
        content: `output "bucket_name" {
  value = aws_s3_bucket.learn.bucket
}
`,
      },
    ],
  },
  {
    id: 'azure-rg-starter',
    title: 'Azure — Resource group',
    blurb: 'Smallest useful Azure starter: one resource group.',
    level: 'beginner',
    cloud: 'azure',
    track: 'cloud',
    step: 2,
    time: '15 min',
    whatYouLearn: ['azurerm provider', 'Resource groups'],
    prerequisites: ['Azure auth (az login or service principal)'],
    nextSteps: ['Destroy when finished'],
    files: [
      {
        path: 'README.md',
        content: `# Azure resource group starter (Cloud)
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
  type    = string
  default = "eastus"
}

variable "name" {
  type    = string
  default = "rg-terraforge-learn"
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
`,
      },
    ],
  },
  {
    id: 'gcp-storage-starter',
    title: 'Google Cloud — Storage bucket',
    blurb: 'Beginner GCP template: one regional bucket.',
    level: 'beginner',
    cloud: 'google',
    track: 'cloud',
    step: 3,
    time: '15 min',
    whatYouLearn: ['google provider', 'Cloud Storage bucket'],
    prerequisites: ['GCP project id', 'Application Default Credentials'],
    nextSteps: ['Copy terraform.tfvars.example → terraform.tfvars'],
    files: [
      {
        path: 'README.md',
        content: `# GCP storage starter (Cloud)
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
  type = string
}

variable "region" {
  type    = string
  default = "us-central1"
}

variable "bucket_prefix" {
  type    = string
  default = "tf-learn"
}
`,
      },
      {
        path: 'terraform.tfvars.example',
        content: `project_id = "your-gcp-project-id"
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
}
`,
      },
      {
        path: 'outputs.tf',
        content: `output "bucket_name" {
  value = google_storage_bucket.learn.name
}
`,
      },
    ],
  },
]
