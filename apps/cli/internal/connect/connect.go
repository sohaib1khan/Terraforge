package connect

import (
	"archive/tar"
	"compress/gzip"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// FromURL downloads a one-time connect tarball and extracts it into dir.
// url should be .../api/connect/install/{code}/pack.tar.gz
func FromURL(url, dir string) error {
	url = strings.TrimSpace(url)
	if url == "" {
		return fmt.Errorf("install URL required")
	}
	if !strings.Contains(url, "/api/connect/install/") {
		return fmt.Errorf("URL must be a Terraforge connect install link")
	}
	client := &http.Client{Timeout: 30 * time.Second}
	res, err := client.Get(url)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(res.Body, 2048))
		return fmt.Errorf("install failed: %s: %s", res.Status, string(body))
	}
	gr, err := gzip.NewReader(res.Body)
	if err != nil {
		return fmt.Errorf("gzip: %w", err)
	}
	defer gr.Close()
	tr := tar.NewReader(gr)
	for {
		hdr, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return err
		}
		name := filepath.Clean(hdr.Name)
		if strings.HasPrefix(name, "..") || filepath.IsAbs(name) {
			return fmt.Errorf("refusing unsafe path %q", hdr.Name)
		}
		target := filepath.Join(dir, name)
		switch hdr.Typeflag {
		case tar.TypeDir:
			if err := os.MkdirAll(target, 0o755); err != nil {
				return err
			}
		case tar.TypeReg, tar.TypeRegA:
			if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
				return err
			}
			f, err := os.OpenFile(target, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o600)
			if err != nil {
				return err
			}
			if _, err := io.Copy(f, tr); err != nil {
				f.Close()
				return err
			}
			if err := f.Close(); err != nil {
				return err
			}
		default:
			// skip
		}
	}
	fmt.Println("wrote terraforge_connect/ + terraforge_connect.tf")
	fmt.Println("next: terraform init -reconfigure -backend-config=terraforge_connect/backend.hcl")
	fmt.Println("disconnect: rm -rf terraforge_connect terraforge_connect.tf")
	return nil
}
