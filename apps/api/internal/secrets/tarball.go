package secrets

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"time"
)

func connectPackFileMap(p connectFiles) map[string]string {
	return map[string]string{
		"terraforge_connect.tf":             p.BackendStubTF,
		"terraforge_connect/backend.hcl":    p.BackendHCL,
		"terraforge_connect/config.yaml":    p.ConfigYAML,
		"terraforge_connect/README.md":      p.ConnectMD,
		"terraforge_connect/.gitignore":     "*\n",
	}
}

func packTarGz(p connectFiles) ([]byte, error) {
	var buf bytes.Buffer
	gw := gzip.NewWriter(&buf)
	tw := tar.NewWriter(gw)

	files := connectPackFileMap(p)
	now := time.Now()
	for name, body := range files {
		bodyBytes := []byte(body)
		mode := int64(0o600)
		if name == "terraforge_connect.tf" || name == "terraforge_connect/README.md" {
			mode = 0o644
		}
		hdr := &tar.Header{
			Name:    name,
			Mode:    mode,
			Size:    int64(len(bodyBytes)),
			ModTime: now,
		}
		if err := tw.WriteHeader(hdr); err != nil {
			return nil, err
		}
		if _, err := tw.Write(bodyBytes); err != nil {
			return nil, err
		}
	}
	if err := tw.Close(); err != nil {
		return nil, err
	}
	if err := gw.Close(); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}
