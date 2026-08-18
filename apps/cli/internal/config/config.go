package config

import (
	"fmt"
	"os"
	"path/filepath"

	"gopkg.in/yaml.v3"
)

type Config struct {
	APIURL      string `yaml:"api_url"`
	Token       string `yaml:"token"`
	NamespaceID string `yaml:"namespace_id"`
}

// preferred paths (first match wins for Load; Save writes the first).
func candidatePaths(wd string) []string {
	return []string{
		filepath.Join(wd, "terraforge_connect", "config.yaml"),
		filepath.Join(wd, ".terraforge", "config.yaml"),
	}
}

func Path() (string, error) {
	wd, err := os.Getwd()
	if err != nil {
		return "", err
	}
	for _, p := range candidatePaths(wd) {
		if _, err := os.Stat(p); err == nil {
			return p, nil
		}
	}
	return candidatePaths(wd)[0], nil
}

func Load() (Config, error) {
	wd, err := os.Getwd()
	if err != nil {
		return Config{}, err
	}
	var lastErr error
	for _, path := range candidatePaths(wd) {
		data, err := os.ReadFile(path)
		if err != nil {
			lastErr = err
			continue
		}
		var cfg Config
		if err := yaml.Unmarshal(data, &cfg); err != nil {
			return Config{}, err
		}
		if cfg.APIURL == "" || cfg.Token == "" || cfg.NamespaceID == "" {
			return Config{}, fmt.Errorf("config incomplete in %s — need api_url, token, namespace_id", path)
		}
		return cfg, nil
	}
	return Config{}, fmt.Errorf("read terraforge_connect/config.yaml: %w (run curl install or: terraforge config set)", lastErr)
}

func Save(cfg Config) error {
	path, err := Path()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	data, err := yaml.Marshal(cfg)
	if err != nil {
		return err
	}
	return os.WriteFile(path, data, 0o600)
}
