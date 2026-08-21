package namespaces

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

type ConfigFileMeta struct {
	Path   string `json:"path"`
	SHA256 string `json:"sha256"`
	Bytes  int    `json:"bytes"`
}

type ConfigManifest struct {
	Digest    string           `json:"digest"`
	CommitSHA string           `json:"commit_sha,omitempty"`
	UpdatedAt *time.Time       `json:"updated_at,omitempty"`
	Files     []ConfigFileMeta `json:"files"`
	Count     int              `json:"count"`
}

// ConfigManifest returns a stable fingerprint of tracked Terraform files in the namespace repo.
func (s *Service) ConfigManifest(nsID string) (ConfigManifest, error) {
	root := s.repoPath(nsID)
	if _, err := os.Stat(root); err != nil {
		if os.IsNotExist(err) {
			return ConfigManifest{}, ErrNotFound
		}
		return ConfigManifest{}, err
	}

	var metas []ConfigFileMeta
	err := filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		name := d.Name()
		if d.IsDir() {
			if importSkipDir[name] || name == ".git" {
				return filepath.SkipDir
			}
			return nil
		}
		rel, err := filepath.Rel(root, path)
		if err != nil {
			return err
		}
		rel = filepath.ToSlash(rel)
		if !allowedImportFile(rel) {
			return nil
		}
		if strings.HasSuffix(rel, ".tfstate") || strings.Contains(rel, ".tfstate.") {
			return nil
		}
		data, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		sum := sha256.Sum256(data)
		metas = append(metas, ConfigFileMeta{
			Path:   rel,
			SHA256: hex.EncodeToString(sum[:]),
			Bytes:  len(data),
		})
		return nil
	})
	if err != nil {
		return ConfigManifest{}, err
	}
	sort.Slice(metas, func(i, j int) bool { return metas[i].Path < metas[j].Path })

	h := sha256.New()
	for _, m := range metas {
		fmt.Fprintf(h, "%s\n%s\n", m.Path, m.SHA256)
	}
	digest := hex.EncodeToString(h.Sum(nil))
	sha, _ := s.headSHA(nsID)

	var updated *time.Time
	if info, err := os.Stat(filepath.Join(root, ".git")); err == nil {
		t := info.ModTime().UTC()
		updated = &t
	}

	return ConfigManifest{
		Digest:    digest,
		CommitSHA: sha,
		UpdatedAt: updated,
		Files:     metas,
		Count:     len(metas),
	}, nil
}

// ExportTarGz packs tracked config files for terraforge pull.
func (s *Service) ExportTarGz(nsID string) ([]byte, ConfigManifest, error) {
	manifest, err := s.ConfigManifest(nsID)
	if err != nil {
		return nil, ConfigManifest{}, err
	}
	root := s.repoPath(nsID)
	var buf bytes.Buffer
	gw := gzip.NewWriter(&buf)
	tw := tar.NewWriter(gw)
	now := time.Now()
	for _, m := range manifest.Files {
		full := filepath.Join(root, filepath.FromSlash(m.Path))
		data, err := os.ReadFile(full)
		if err != nil {
			return nil, ConfigManifest{}, err
		}
		hdr := &tar.Header{
			Name:    m.Path,
			Mode:    0o644,
			Size:    int64(len(data)),
			ModTime: now,
		}
		if err := tw.WriteHeader(hdr); err != nil {
			return nil, ConfigManifest{}, err
		}
		if _, err := tw.Write(data); err != nil {
			return nil, ConfigManifest{}, err
		}
	}
	if err := tw.Close(); err != nil {
		return nil, ConfigManifest{}, err
	}
	if err := gw.Close(); err != nil {
		return nil, ConfigManifest{}, err
	}
	return buf.Bytes(), manifest, nil
}

// ExportFilesMap returns tracked config files as path → content for playground templates.
func (s *Service) ExportFilesMap(nsID string) (map[string]string, error) {
	manifest, err := s.ConfigManifest(nsID)
	if err != nil {
		return nil, err
	}
	root := s.repoPath(nsID)
	out := make(map[string]string, len(manifest.Files))
	for _, m := range manifest.Files {
		full := filepath.Join(root, filepath.FromSlash(m.Path))
		data, err := os.ReadFile(full)
		if err != nil {
			return nil, err
		}
		out[m.Path] = string(data)
	}
	return out, nil
}
