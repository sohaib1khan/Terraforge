package namespaces

import (
	"os"
	"path/filepath"
	"testing"
)

func TestSafePathRejectsTraversal(t *testing.T) {
	dir := t.TempDir()
	svc := NewService(nil, dir)
	nsID := "11111111-1111-1111-1111-111111111111"
	repo := filepath.Join(dir, "namespaces", nsID)
	if err := os.MkdirAll(repo, 0o755); err != nil {
		t.Fatal(err)
	}

	bad := []string{"../etc/passwd", "..", ".git/config", ".git", "foo/../../etc/passwd"}
	for _, p := range bad {
		if _, err := svc.safePath(nsID, p); err == nil {
			t.Fatalf("expected rejection for %q", p)
		}
	}

	// Leading slash is stripped for API convenience (/main.tf → main.tf).
	got, err := svc.safePath(nsID, "/main.tf")
	if err != nil {
		t.Fatal(err)
	}
	want := filepath.Join(repo, "main.tf")
	wantAbs, _ := filepath.Abs(want)
	if got != wantAbs {
		t.Fatalf("got %q want %q", got, wantAbs)
	}
}
