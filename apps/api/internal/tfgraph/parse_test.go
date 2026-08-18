package tfgraph

import (
	"os"
	"path/filepath"
	"testing"
)

func TestBuildSimple(t *testing.T) {
	dir := t.TempDir()
	src := `
variable "name" {
  type = string
}

locals {
  prefix = var.name
}

data "local_file" "cfg" {
  filename = "${path.module}/cfg.txt"
}

resource "local_file" "hello" {
  content  = "hi ${local.prefix}"
  filename = "${path.module}/${data.local_file.cfg.filename}"
}

module "child" {
  source = "./child"
  name   = var.name
}

output "path" {
  value = local_file.hello.filename
}
`
	if err := os.WriteFile(filepath.Join(dir, "main.tf"), []byte(src), 0o644); err != nil {
		t.Fatal(err)
	}
	g, err := Build(dir, map[string]bool{"local_file.hello": true})
	if err != nil {
		t.Fatal(err)
	}
	if g.Files != 1 {
		t.Fatalf("files=%d", g.Files)
	}
	ids := map[string]bool{}
	for _, n := range g.Nodes {
		ids[n.ID] = true
		if n.ID == "local_file.hello" && !n.InState {
			t.Fatal("expected in_state")
		}
	}
	for _, want := range []string{"var.name", "local.prefix", "data.local_file.cfg", "local_file.hello", "module.child", "output.path"} {
		if !ids[want] {
			t.Fatalf("missing node %s", want)
		}
	}
	if len(g.Edges) == 0 {
		t.Fatal("expected edges")
	}
}
