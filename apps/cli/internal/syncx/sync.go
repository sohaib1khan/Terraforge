package syncx

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/terraforge/terraforge/apps/cli/internal/config"
)

var skipDirs = map[string]bool{
	".git":               true,
	".terraform":         true,
	".terraforge":        true,
	"terraforge_connect": true,
	"node_modules":       true,
	".idea":              true,
	".vscode":            true,
}

type Manifest struct {
	Digest    string `json:"digest"`
	CommitSHA string `json:"commit_sha,omitempty"`
	Count     int    `json:"count"`
	Files     []struct {
		Path   string `json:"path"`
		SHA256 string `json:"sha256"`
		Bytes  int    `json:"bytes"`
	} `json:"files"`
}

type State struct {
	LastSyncedDigest string    `json:"last_synced_digest"`
	LastSyncedAt     time.Time `json:"last_synced_at"`
	LastDirection    string    `json:"last_direction,omitempty"` // push|pull
}

type Report struct {
	Status       string // synced|local_ahead|remote_ahead|diverged|empty_remote|empty_local
	LocalDigest  string
	RemoteDigest string
	LastSynced   string
	LocalCount   int
	RemoteCount  int
	Checklist    []Check
}

type Check struct {
	ID     string
	OK     bool
	Label  string
	Detail string
}

func allowFile(rel string) bool {
	base := filepath.Base(rel)
	if base == ".gitignore" || base == ".terraform.lock.hcl" {
		return true
	}
	ext := strings.ToLower(filepath.Ext(base))
	switch ext {
	case ".tf", ".tfvars", ".hcl", ".md", ".json", ".yml", ".yaml", ".tpl", ".tmpl", ".sh", ".txt":
		return true
	default:
		return false
	}
}

func statePath(dir string) string {
	return filepath.Join(dir, "terraforge_connect", "sync_state.json")
}

func loadState(dir string) State {
	data, err := os.ReadFile(statePath(dir))
	if err != nil {
		return State{}
	}
	var st State
	_ = json.Unmarshal(data, &st)
	return st
}

func saveState(dir string, st State) error {
	path := statePath(dir)
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	data, err := json.MarshalIndent(st, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, data, 0o600)
}

func localDigest(dir string) (digest string, count int, err error) {
	type meta struct{ path, sum string }
	var metas []meta
	err = filepath.WalkDir(dir, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			if skipDirs[d.Name()] {
				return filepath.SkipDir
			}
			return nil
		}
		rel, err := filepath.Rel(dir, path)
		if err != nil {
			return err
		}
		rel = filepath.ToSlash(rel)
		if !allowFile(rel) || strings.HasSuffix(rel, ".tfstate") || strings.Contains(rel, ".tfstate.") {
			return nil
		}
		data, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		sum := sha256.Sum256(data)
		metas = append(metas, meta{path: rel, sum: hex.EncodeToString(sum[:])})
		return nil
	})
	if err != nil {
		return "", 0, err
	}
	sort.Slice(metas, func(i, j int) bool { return metas[i].path < metas[j].path })
	h := sha256.New()
	for _, m := range metas {
		fmt.Fprintf(h, "%s\n%s\n", m.path, m.sum)
	}
	return hex.EncodeToString(h.Sum(nil)), len(metas), nil
}

func fetchManifest(cfg config.Config) (Manifest, error) {
	url := strings.TrimRight(cfg.APIURL, "/") + "/api/namespaces/" + cfg.NamespaceID + "/config-manifest"
	req, err := http.NewRequest(http.MethodGet, url, nil)
	if err != nil {
		return Manifest{}, err
	}
	req.Header.Set("Authorization", "Bearer "+cfg.Token)
	res, err := (&http.Client{Timeout: 30 * time.Second}).Do(req)
	if err != nil {
		return Manifest{}, err
	}
	defer res.Body.Close()
	data, _ := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	if res.StatusCode >= 300 {
		return Manifest{}, fmt.Errorf("manifest: %s (%s)", res.Status, string(data))
	}
	var m Manifest
	if err := json.Unmarshal(data, &m); err != nil {
		return Manifest{}, err
	}
	return m, nil
}

func Status(dir string) (Report, error) {
	cfg, err := config.Load()
	if err != nil {
		return Report{}, err
	}
	local, localCount, err := localDigest(dir)
	if err != nil {
		return Report{}, err
	}
	remote, err := fetchManifest(cfg)
	if err != nil {
		return Report{}, err
	}
	st := loadState(dir)
	rep := Report{
		LocalDigest:  local,
		RemoteDigest: remote.Digest,
		LocalCount:   localCount,
		RemoteCount:  remote.Count,
	}
	if !st.LastSyncedAt.IsZero() {
		rep.LastSynced = st.LastSyncedAt.Local().Format(time.RFC3339)
	}

	switch {
	case remote.Count == 0 && localCount <= 1:
		rep.Status = "empty"
	case local == remote.Digest:
		rep.Status = "synced"
	case st.LastSyncedDigest != "" && local == st.LastSyncedDigest && remote.Digest != st.LastSyncedDigest:
		rep.Status = "remote_ahead"
	case st.LastSyncedDigest != "" && remote.Digest == st.LastSyncedDigest && local != st.LastSyncedDigest:
		rep.Status = "local_ahead"
	case st.LastSyncedDigest == "" && local != remote.Digest:
		rep.Status = "diverged"
	default:
		rep.Status = "diverged"
	}

	rep.Checklist = []Check{
		{
			ID:    "connect",
			OK:    cfg.APIURL != "" && cfg.Token != "" && cfg.NamespaceID != "",
			Label: "Connected (terraforge_connect/config.yaml)",
			Detail: func() string {
				if cfg.NamespaceID == "" {
					return "run curl install or terraforge connect"
				}
				return "namespace " + cfg.NamespaceID[:8] + "…"
			}(),
		},
		{
			ID:     "local_to_remote",
			OK:     rep.Status == "synced" || rep.Status == "remote_ahead",
			Label:  "Local → Terraforge",
			Detail: statusDetail(rep.Status, "push"),
		},
		{
			ID:     "remote_to_local",
			OK:     rep.Status == "synced" || rep.Status == "local_ahead",
			Label:  "Terraforge → Local",
			Detail: statusDetail(rep.Status, "pull"),
		},
		{
			ID:     "in_sync",
			OK:     rep.Status == "synced",
			Label:  "Both sides match",
			Detail: fmt.Sprintf("local %d files · remote %d files", localCount, remote.Count),
		},
	}
	return rep, nil
}

func statusDetail(status, dir string) string {
	switch status {
	case "synced":
		return "ok"
	case "local_ahead":
		if dir == "push" {
			return "run: terraforge sync (push local changes)"
		}
		return "local has newer edits"
	case "remote_ahead":
		if dir == "pull" {
			return "run: terraforge pull (or terraforge watch)"
		}
		return "Terraforge has newer edits"
	case "diverged":
		return "both changed — pull then re-apply local, or sync carefully"
	default:
		return "import or sync to establish baseline"
	}
}

func PrintStatus(dir string) error {
	rep, err := Status(dir)
	if err != nil {
		return err
	}
	fmt.Printf("sync status:  %s\n", rep.Status)
	fmt.Printf("local digest:  %s (%d files)\n", short(rep.LocalDigest), rep.LocalCount)
	fmt.Printf("remote digest: %s (%d files)\n", short(rep.RemoteDigest), rep.RemoteCount)
	if rep.LastSynced != "" {
		fmt.Printf("last synced:   %s\n", rep.LastSynced)
	}
	fmt.Println("checklist:")
	for _, c := range rep.Checklist {
		mark := "[ ]"
		if c.OK {
			mark = "[x]"
		}
		fmt.Printf("  %s %s — %s\n", mark, c.Label, c.Detail)
	}
	if rep.Status == "synced" {
		fmt.Println("hey — Terraforge and the local project folder are synced.")
	}
	return nil
}

func short(s string) string {
	if len(s) > 12 {
		return s[:12] + "…"
	}
	return s
}

// PushDir uploads local files to Terraforge (local → remote).
func PushDir(dir string) error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	body, paths, err := pack(dir)
	if err != nil {
		return err
	}
	if len(paths) == 0 {
		return fmt.Errorf("no Terraform files found to sync (.tf, .tfvars, …)")
	}

	url := strings.TrimRight(cfg.APIURL, "/") + "/api/namespaces/" + cfg.NamespaceID + "/import"
	req, err := http.NewRequest(http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+cfg.Token)
	req.Header.Set("Content-Type", "application/gzip")
	res, err := (&http.Client{Timeout: 120 * time.Second}).Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	data, _ := io.ReadAll(io.LimitReader(res.Body, 4096))
	if res.StatusCode >= 300 {
		return fmt.Errorf("import failed: %s (%s)", res.Status, string(data))
	}
	fmt.Printf("pushed %d file(s) → Terraforge\n", len(paths))
	m, err := fetchManifest(cfg)
	if err != nil {
		return err
	}
	_ = saveState(dir, State{
		LastSyncedDigest: m.Digest,
		LastSyncedAt:     time.Now().UTC(),
		LastDirection:    "push",
	})
	fmt.Println("status: synced")
	return nil
}

// PullDir downloads Terraforge config into the local project (remote → local).
func PullDir(dir string) error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	url := strings.TrimRight(cfg.APIURL, "/") + "/api/namespaces/" + cfg.NamespaceID + "/config-export"
	req, err := http.NewRequest(http.MethodGet, url, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+cfg.Token)
	res, err := (&http.Client{Timeout: 120 * time.Second}).Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode >= 300 {
		data, _ := io.ReadAll(io.LimitReader(res.Body, 2048))
		return fmt.Errorf("export failed: %s (%s)", res.Status, string(data))
	}
	digest := res.Header.Get("X-Terraforge-Digest")
	n, err := extractTarGz(res.Body, dir)
	if err != nil {
		return err
	}
	if digest == "" {
		m, err := fetchManifest(cfg)
		if err == nil {
			digest = m.Digest
		}
	}
	_ = saveState(dir, State{
		LastSyncedDigest: digest,
		LastSyncedAt:     time.Now().UTC(),
		LastDirection:    "pull",
	})
	fmt.Printf("pulled %d file(s) ← Terraforge\n", n)
	fmt.Println("status: synced (local matches Terraforge)")
	return nil
}

func extractTarGz(r io.Reader, dir string) (int, error) {
	gr, err := gzip.NewReader(r)
	if err != nil {
		return 0, err
	}
	defer gr.Close()
	tr := tar.NewReader(gr)
	count := 0
	for {
		hdr, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return count, err
		}
		if hdr.Typeflag != tar.TypeReg && hdr.Typeflag != tar.TypeRegA {
			continue
		}
		name := filepath.Clean(hdr.Name)
		if strings.HasPrefix(name, "..") || filepath.IsAbs(name) {
			continue
		}
		if !allowFile(name) {
			continue
		}
		target := filepath.Join(dir, name)
		if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
			return count, err
		}
		f, err := os.OpenFile(target, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o644)
		if err != nil {
			return count, err
		}
		if _, err := io.Copy(f, io.LimitReader(tr, 1<<20)); err != nil {
			f.Close()
			return count, err
		}
		_ = f.Close()
		count++
	}
	return count, nil
}

// Watch polls Terraforge and auto-pulls when remote is ahead; auto-pushes when local is ahead.
// On diverge, prefers remote (web/Terraforge wins) then you can re-push local if needed.
func Watch(dir string, every time.Duration) error {
	if every <= 0 {
		every = 5 * time.Second
	}
	fmt.Printf("watching %s (every %s) — Terraforge edits pull automatically\n", dir, every)
	fmt.Println("Ctrl+C to stop")
	for {
		rep, err := Status(dir)
		if err != nil {
			fmt.Fprintf(os.Stderr, "status error: %v\n", err)
		} else {
			switch rep.Status {
			case "synced":
				// quiet
			case "remote_ahead":
				fmt.Println("→ Terraforge changed — pulling to local…")
				if err := PullDir(dir); err != nil {
					fmt.Fprintf(os.Stderr, "pull error: %v\n", err)
				}
			case "local_ahead":
				fmt.Println("→ local changed — pushing to Terraforge…")
				if err := PushDir(dir); err != nil {
					fmt.Fprintf(os.Stderr, "push error: %v\n", err)
				}
			case "diverged":
				fmt.Println("⚠ diverged — preferring Terraforge (pull), then you can sync local edits")
				if err := PullDir(dir); err != nil {
					fmt.Fprintf(os.Stderr, "pull error: %v\n", err)
				}
			}
		}
		time.Sleep(every)
	}
}

func pack(root string) ([]byte, []string, error) {
	var buf bytes.Buffer
	gw := gzip.NewWriter(&buf)
	tw := tar.NewWriter(gw)
	var paths []string

	err := filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		name := d.Name()
		if d.IsDir() {
			if skipDirs[name] {
				return filepath.SkipDir
			}
			return nil
		}
		rel, err := filepath.Rel(root, path)
		if err != nil {
			return err
		}
		rel = filepath.ToSlash(rel)
		if strings.HasPrefix(rel, "..") {
			return nil
		}
		if !allowFile(rel) {
			return nil
		}
		if strings.HasSuffix(rel, ".tfstate") || strings.Contains(rel, ".tfstate.") {
			return nil
		}
		info, err := d.Info()
		if err != nil {
			return err
		}
		if info.Size() > 1<<20 {
			return fmt.Errorf("%s exceeds 1 MiB", rel)
		}
		data, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		hdr := &tar.Header{
			Name:    rel,
			Mode:    0o644,
			Size:    int64(len(data)),
			ModTime: info.ModTime(),
		}
		if err := tw.WriteHeader(hdr); err != nil {
			return err
		}
		if _, err := tw.Write(data); err != nil {
			return err
		}
		paths = append(paths, rel)
		return nil
	})
	if err != nil {
		return nil, nil, err
	}
	if err := tw.Close(); err != nil {
		return nil, nil, err
	}
	if err := gw.Close(); err != nil {
		return nil, nil, err
	}
	return buf.Bytes(), paths, nil
}
