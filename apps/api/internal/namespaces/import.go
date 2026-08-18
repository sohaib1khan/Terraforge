package namespaces

import (
	"archive/tar"
	"compress/gzip"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
)

const maxImportBytes = 12 << 20 // 12 MiB uncompressed budget

var importSkipDir = map[string]bool{
	".git":              true,
	".terraform":        true,
	".terraforge":       true,
	"terraforge_connect": true,
	"node_modules":      true,
	".idea":             true,
	".vscode":           true,
}

var importAllowExt = map[string]bool{
	".tf":      true,
	".tfvars":  true,
	".hcl":     true,
	".md":      true,
	".json":    true,
	".yml":     true,
	".yaml":    true,
	".tpl":     true,
	".tmpl":    true,
	".sh":      true,
	".txt":     true,
	".gitignore": true, // special — handled by name
}

type ImportResult struct {
	Files   int      `json:"files"`
	Paths   []string `json:"paths"`
	Message string   `json:"message"`
}

// ImportTarGz extracts a project tarball into the namespace repo and commits.
func (s *Service) ImportTarGz(nsID string, r io.Reader, message string) (ImportResult, error) {
	root := s.repoPath(nsID)
	if _, err := os.Stat(root); err != nil {
		if os.IsNotExist(err) {
			return ImportResult{}, ErrNotFound
		}
		return ImportResult{}, err
	}

	gr, err := gzip.NewReader(r)
	if err != nil {
		return ImportResult{}, fmt.Errorf("%w: not a gzip tarball", ErrValidation)
	}
	defer gr.Close()

	tr := tar.NewReader(gr)
	var written []string
	var total int64

	for {
		hdr, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return ImportResult{}, fmt.Errorf("%w: invalid tar: %v", ErrValidation, err)
		}
		if hdr.Typeflag != tar.TypeReg && hdr.Typeflag != tar.TypeRegA {
			continue
		}
		rel, ok := sanitizeImportPath(hdr.Name)
		if !ok {
			continue
		}
		if !allowedImportFile(rel) {
			continue
		}
		if hdr.Size < 0 || hdr.Size > maxFileBytes {
			return ImportResult{}, fmt.Errorf("%w: file %s too large", ErrValidation, rel)
		}
		total += hdr.Size
		if total > maxImportBytes {
			return ImportResult{}, fmt.Errorf("%w: import exceeds size limit", ErrValidation)
		}

		full, err := s.safePath(nsID, rel)
		if err != nil {
			return ImportResult{}, err
		}
		if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
			return ImportResult{}, err
		}
		f, err := os.OpenFile(full, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o644)
		if err != nil {
			return ImportResult{}, err
		}
		n, err := io.Copy(f, io.LimitReader(tr, hdr.Size+1))
		_ = f.Close()
		if err != nil {
			return ImportResult{}, err
		}
		if n > hdr.Size {
			_ = os.Remove(full)
			return ImportResult{}, fmt.Errorf("%w: truncated or oversized entry %s", ErrValidation, rel)
		}
		written = append(written, rel)
	}

	if len(written) == 0 {
		return ImportResult{}, fmt.Errorf("%w: no importable Terraform files found (.tf, .tfvars, …)", ErrValidation)
	}

	if err := runGit(root, "add", "-A"); err != nil {
		return ImportResult{}, err
	}
	if message == "" {
		message = fmt.Sprintf("Import %d configuration file(s)", len(written))
	}
	diff := exec.Command("git", "diff", "--cached", "--quiet")
	diff.Dir = root
	if err := diff.Run(); err == nil {
		return ImportResult{Files: len(written), Paths: written, Message: "no changes to commit"}, nil
	} else if ee, ok := err.(*exec.ExitError); !ok || ee.ExitCode() != 1 {
		return ImportResult{}, fmt.Errorf("git diff --cached: %w", err)
	}
	if err := runGit(root, "commit", "-m", message); err != nil {
		return ImportResult{}, err
	}
	return ImportResult{Files: len(written), Paths: written, Message: message}, nil
}

// ImportFiles writes a list of text files into the namespace repo and commits.
func (s *Service) ImportFiles(nsID string, files map[string]string, message string) (ImportResult, error) {
	root := s.repoPath(nsID)
	if _, err := os.Stat(root); err != nil {
		if os.IsNotExist(err) {
			return ImportResult{}, ErrNotFound
		}
		return ImportResult{}, err
	}
	var written []string
	var total int
	for rawPath, content := range files {
		rel, ok := sanitizeImportPath(rawPath)
		if !ok || !allowedImportFile(rel) {
			continue
		}
		if len(content) > maxFileBytes {
			return ImportResult{}, fmt.Errorf("%w: file %s too large", ErrValidation, rel)
		}
		total += len(content)
		if total > maxImportBytes {
			return ImportResult{}, fmt.Errorf("%w: import exceeds size limit", ErrValidation)
		}
		full, err := s.safePath(nsID, rel)
		if err != nil {
			return ImportResult{}, err
		}
		if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
			return ImportResult{}, err
		}
		if err := os.WriteFile(full, []byte(content), 0o644); err != nil {
			return ImportResult{}, err
		}
		written = append(written, rel)
	}
	if len(written) == 0 {
		return ImportResult{}, fmt.Errorf("%w: no importable Terraform files found (.tf, .tfvars, …)", ErrValidation)
	}
	sort.Strings(written)
	if err := runGit(root, "add", "-A"); err != nil {
		return ImportResult{}, err
	}
	if message == "" {
		message = fmt.Sprintf("Import %d configuration file(s)", len(written))
	}
	diff := exec.Command("git", "diff", "--cached", "--quiet")
	diff.Dir = root
	if err := diff.Run(); err == nil {
		return ImportResult{Files: len(written), Paths: written, Message: "no changes to commit"}, nil
	} else if ee, ok := err.(*exec.ExitError); !ok || ee.ExitCode() != 1 {
		return ImportResult{}, fmt.Errorf("git diff --cached: %w", err)
	}
	if err := runGit(root, "commit", "-m", message); err != nil {
		return ImportResult{}, err
	}
	return ImportResult{Files: len(written), Paths: written, Message: message}, nil
}

func sanitizeImportPath(name string) (string, bool) {
	name = strings.TrimSpace(name)
	name = strings.ReplaceAll(name, "\\", "/")
	name = strings.TrimPrefix(name, "./")
	for strings.HasPrefix(name, "/") {
		name = strings.TrimPrefix(name, "/")
	}
	if name == "" || name == "." {
		return "", false
	}
	clean := filepath.ToSlash(filepath.Clean(name))
	if clean == "." || clean == ".." || strings.HasPrefix(clean, "../") {
		return "", false
	}
	parts := strings.Split(clean, "/")
	for _, p := range parts {
		if p == "" || p == "." || p == ".." {
			return "", false
		}
		if importSkipDir[p] {
			return "", false
		}
		if strings.HasPrefix(p, ".git") {
			return "", false
		}
	}
	base := parts[len(parts)-1]
	if strings.HasSuffix(base, ".tfstate") || strings.Contains(base, ".tfstate.") {
		return "", false
	}
	if base == "terraform.tfstate" || base == "terraform.tfstate.backup" {
		return "", false
	}
	return clean, true
}

func allowedImportFile(rel string) bool {
	base := filepath.Base(rel)
	if base == ".gitignore" || base == ".terraform.lock.hcl" {
		return true
	}
	ext := strings.ToLower(filepath.Ext(base))
	if ext == ".hcl" && strings.HasSuffix(strings.ToLower(base), ".lock.hcl") {
		return true
	}
	return importAllowExt[ext]
}
