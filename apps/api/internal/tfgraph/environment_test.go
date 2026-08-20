package tfgraph

import (
	"os"
	"path/filepath"
	"testing"
)

func TestDetectEnvironmentAWSAndLocal(t *testing.T) {
	dir := t.TempDir()
	content := `
terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    local = {
      source = "hashicorp/local"
    }
  }
}

provider "aws" {
  region = "us-west-2"
}

resource "aws_s3_bucket" "b" {
  bucket = "demo"
}

resource "local_file" "f" {
  content  = "hi"
  filename = "x.txt"
}
`
	if err := os.WriteFile(filepath.Join(dir, "main.tf"), []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}

	g, err := Build(dir, nil)
	if err != nil {
		t.Fatal(err)
	}
	env := g.Environment
	if env.Empty {
		t.Fatal("expected non-empty environment")
	}
	if env.Primary != "aws" {
		t.Fatalf("primary=%q", env.Primary)
	}
	if !env.HasLocal {
		t.Fatal("expected has_local")
	}
	if env.Summary == "" || env.Summary == "No providers detected" {
		t.Fatalf("summary=%q", env.Summary)
	}

	byName := map[string]EnvProvider{}
	for _, p := range env.Providers {
		byName[p.Name] = p
	}
	aws := byName["aws"]
	if !aws.Declared || aws.Source != "hashicorp/aws" || aws.Version != "~> 5.0" {
		t.Fatalf("aws=%+v", aws)
	}
	if aws.ResourceCount < 1 {
		t.Fatalf("aws resource_count=%d", aws.ResourceCount)
	}
	if byName["local"].ResourceCount < 1 {
		t.Fatalf("local=%+v", byName["local"])
	}
}

func TestDetectEnvironmentAzure(t *testing.T) {
	dir := t.TempDir()
	content := `
terraform {
  required_providers {
    azurerm = {
      source = "hashicorp/azurerm"
    }
  }
}
resource "azurerm_resource_group" "rg" {
  name     = "rg"
  location = "eastus"
}
`
	if err := os.WriteFile(filepath.Join(dir, "main.tf"), []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
	g, err := Build(dir, nil)
	if err != nil {
		t.Fatal(err)
	}
	if g.Environment.Primary != "azurerm" {
		t.Fatalf("primary=%q summary=%q", g.Environment.Primary, g.Environment.Summary)
	}
}
