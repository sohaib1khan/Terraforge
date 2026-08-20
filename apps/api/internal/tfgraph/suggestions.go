package tfgraph

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"
)

const registryBase = "https://registry.terraform.io"

type Suggestion struct {
	Kind                   string `json:"kind"` // provider | module
	Name                   string `json:"name"`
	Label                  string `json:"label"`
	Source                 string `json:"source"`
	Current                string `json:"current,omitempty"`
	Latest                 string `json:"latest,omitempty"`
	UpdateAvailable        bool   `json:"update_available"`
	NewerOutsideConstraint bool   `json:"newer_outside_constraint"`
	ConstraintSatisfied    bool   `json:"constraint_satisfied"`
	Message                string `json:"message"`
	DocsURL                string `json:"docs_url,omitempty"`
	File                   string `json:"file,omitempty"`
}

type Suggestions struct {
	Providers   []Suggestion `json:"providers"`
	Modules     []Suggestion `json:"modules"`
	UpdateCount int          `json:"update_count"`
	BumpCount   int          `json:"bump_count"` // outside current constraint
	CheckedAt   time.Time    `json:"checked_at"`
	Note        string       `json:"note,omitempty"`
}

type declaredProvider struct {
	Alias   string
	Source  string
	Version string
	File    string
}

type declaredModule struct {
	Name    string
	Source  string
	Version string
	File    string
}

type registryClient struct {
	http *http.Client
	mu   sync.Mutex
	prov map[string]cacheEnt
	mod  map[string]cacheEnt
}

type cacheEnt struct {
	version string
	at      time.Time
}

func newRegistryClient() *registryClient {
	return &registryClient{
		http: &http.Client{Timeout: 12 * time.Second},
		prov: map[string]cacheEnt{},
		mod:  map[string]cacheEnt{},
	}
}

var sharedRegistry = newRegistryClient()

var (
	reModuleBlock = regexp.MustCompile(`(?m)^module\s+"([^"]+)"\s*\{`)
	reModSource   = regexp.MustCompile(`(?m)^\s*source\s*=\s*"([^"]+)"`)
	reModVersion  = regexp.MustCompile(`(?m)^\s*version\s*=\s*"([^"]+)"`)
)

// BuildSuggestions scans config and compares declared versions to the public Terraform Registry.
func BuildSuggestions(ctx context.Context, root string) Suggestions {
	out := Suggestions{
		Providers: []Suggestion{},
		Modules:   []Suggestion{},
		CheckedAt: time.Now().UTC(),
		Note:      "Compared against registry.terraform.io. Constraints are interpreted best-effort (~>, >=, exact pins).",
	}
	if root == "" {
		return out
	}
	info, err := os.Stat(root)
	if err != nil || !info.IsDir() {
		return out
	}

	providers := scanDeclaredProviders(root)
	modules := scanDeclaredModules(root)

	for _, p := range providers {
		ns, name := splitProviderSource(p.Source, p.Alias)
		latest, err := sharedRegistry.latestProvider(ctx, ns, name)
		label := providerMeta(name).label
		src := ns + "/" + name
		sug := Suggestion{
			Kind:    "provider",
			Name:    name,
			Label:   label,
			Source:  src,
			Current: p.Version,
			File:    p.File,
			DocsURL: fmt.Sprintf("https://registry.terraform.io/providers/%s/%s/latest", ns, name),
		}
		if err != nil || latest == "" {
			sug.Message = "Could not reach registry for latest version"
			sug.ConstraintSatisfied = true
			out.Providers = append(out.Providers, sug)
			continue
		}
		sug.Latest = latest
		check := compareVersions(p.Version, latest)
		sug.UpdateAvailable = check.UpdateAvailable
		sug.NewerOutsideConstraint = check.NewerOutsideConstraint
		sug.ConstraintSatisfied = check.ConstraintSatisfied
		sug.Message = check.Message
		// For soft "within constraint" tips, only flag update_available when outside or exact pin behind
		if check.UpdateAvailable && !check.NewerOutsideConstraint && parseConstraint(p.Version).Kind == "pessimistic" {
			// Still useful: show latest but mark as advisory within range
			sug.UpdateAvailable = true
			sug.Message = fmt.Sprintf("Within %s — newest release is %s", p.Version, latest)
		}
		if sug.UpdateAvailable {
			out.UpdateCount++
		}
		if sug.NewerOutsideConstraint {
			out.BumpCount++
		}
		out.Providers = append(out.Providers, sug)
	}

	for _, m := range modules {
		ns, name, prov, ok := parseRegistryModuleSource(m.Source)
		if !ok {
			out.Modules = append(out.Modules, Suggestion{
				Kind:                "module",
				Name:                m.Name,
				Label:               m.Name,
				Source:              m.Source,
				Current:             m.Version,
				File:                m.File,
				ConstraintSatisfied: true,
				Message:             "Not a Terraform Registry module (git/path source) — skipped",
			})
			continue
		}
		latest, err := sharedRegistry.latestModule(ctx, ns, name, prov)
		full := ns + "/" + name + "/" + prov
		sug := Suggestion{
			Kind:    "module",
			Name:    m.Name,
			Label:   m.Name,
			Source:  full,
			Current: m.Version,
			File:    m.File,
			DocsURL: fmt.Sprintf("https://registry.terraform.io/modules/%s/%s/%s/latest", ns, name, prov),
		}
		if err != nil || latest == "" {
			sug.Message = "Could not reach registry for latest version"
			sug.ConstraintSatisfied = true
			out.Modules = append(out.Modules, sug)
			continue
		}
		sug.Latest = latest
		check := compareVersions(m.Version, latest)
		sug.UpdateAvailable = check.UpdateAvailable
		sug.NewerOutsideConstraint = check.NewerOutsideConstraint
		sug.ConstraintSatisfied = check.ConstraintSatisfied
		sug.Message = check.Message
		if check.UpdateAvailable && !check.NewerOutsideConstraint && parseConstraint(m.Version).Kind == "pessimistic" {
			sug.Message = fmt.Sprintf("Within %s — newest release is %s", m.Version, latest)
		}
		if sug.UpdateAvailable {
			out.UpdateCount++
		}
		if sug.NewerOutsideConstraint {
			out.BumpCount++
		}
		out.Modules = append(out.Modules, sug)
	}

	sort.SliceStable(out.Providers, func(i, j int) bool {
		if out.Providers[i].NewerOutsideConstraint != out.Providers[j].NewerOutsideConstraint {
			return out.Providers[i].NewerOutsideConstraint
		}
		if out.Providers[i].UpdateAvailable != out.Providers[j].UpdateAvailable {
			return out.Providers[i].UpdateAvailable
		}
		return out.Providers[i].Name < out.Providers[j].Name
	})
	sort.SliceStable(out.Modules, func(i, j int) bool {
		if out.Modules[i].NewerOutsideConstraint != out.Modules[j].NewerOutsideConstraint {
			return out.Modules[i].NewerOutsideConstraint
		}
		if out.Modules[i].UpdateAvailable != out.Modules[j].UpdateAvailable {
			return out.Modules[i].UpdateAvailable
		}
		return out.Modules[i].Name < out.Modules[j].Name
	})
	return out
}

func scanDeclaredProviders(root string) []declaredProvider {
	var out []declaredProvider
	_ = filepath.WalkDir(root, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if d.IsDir() {
			name := d.Name()
			if name == ".git" || name == ".terraform" || name == ".terraforge" || name == "terraforge_connect" || name == "node_modules" {
				return filepath.SkipDir
			}
			return nil
		}
		if !strings.HasSuffix(d.Name(), ".tf") {
			return nil
		}
		raw, err := os.ReadFile(path)
		if err != nil || len(raw) > 1<<20 {
			return nil
		}
		rel, _ := filepath.Rel(root, path)
		rel = filepath.ToSlash(rel)
		src := string(raw)
		for _, m := range reTerraformBlock.FindAllStringIndex(src, -1) {
			body := blockBody(src, m[1]-1)
			for _, rp := range reReqProviders.FindAllStringIndex(body, -1) {
				rpBody := blockBody(body, rp[1]-1)
				matches := reProvAssign.FindAllStringSubmatchIndex(rpBody, -1)
				for _, mm := range matches {
					alias := rpBody[mm[2]:mm[3]]
					open := mm[1] - 1
					if open < 0 || open >= len(rpBody) || rpBody[open] != '{' {
						continue
					}
					inner := blockBody(rpBody, open)
					source, version := "", ""
					if sm := reSourceAttr.FindStringSubmatch(inner); len(sm) > 1 {
						source = sm[1]
					}
					if vm := reVersionAttr.FindStringSubmatch(inner); len(vm) > 1 {
						version = vm[1]
					}
					out = append(out, declaredProvider{
						Alias:   alias,
						Source:  source,
						Version: version,
						File:    rel,
					})
				}
			}
		}
		return nil
	})
	return out
}

func scanDeclaredModules(root string) []declaredModule {
	var out []declaredModule
	_ = filepath.WalkDir(root, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if d.IsDir() {
			name := d.Name()
			if name == ".git" || name == ".terraform" || name == ".terraforge" || name == "terraforge_connect" || name == "node_modules" {
				return filepath.SkipDir
			}
			return nil
		}
		if !strings.HasSuffix(d.Name(), ".tf") {
			return nil
		}
		raw, err := os.ReadFile(path)
		if err != nil || len(raw) > 1<<20 {
			return nil
		}
		rel, _ := filepath.Rel(root, path)
		rel = filepath.ToSlash(rel)
		src := string(raw)
		matches := reModuleBlock.FindAllStringSubmatchIndex(src, -1)
		for _, m := range matches {
			name := src[m[2]:m[3]]
			open := m[1] - 1
			if open < 0 || src[open] != '{' {
				continue
			}
			body := blockBody(src, open)
			source, version := "", ""
			if sm := reModSource.FindStringSubmatch(body); len(sm) > 1 {
				source = sm[1]
			}
			if vm := reModVersion.FindStringSubmatch(body); len(vm) > 1 {
				version = vm[1]
			}
			if source == "" {
				continue
			}
			out = append(out, declaredModule{
				Name:    name,
				Source:  source,
				Version: version,
				File:    rel,
			})
		}
		return nil
	})
	return out
}

func splitProviderSource(source, alias string) (ns, name string) {
	source = strings.TrimSpace(source)
	if source != "" {
		parts := strings.Split(source, "/")
		if len(parts) >= 2 {
			return parts[len(parts)-2], parts[len(parts)-1]
		}
		return "hashicorp", parts[0]
	}
	alias = normalizeProviderName(alias)
	return "hashicorp", alias
}

func parseRegistryModuleSource(source string) (ns, name, provider string, ok bool) {
	source = strings.TrimSpace(source)
	if source == "" || strings.Contains(source, "://") || strings.HasPrefix(source, ".") || strings.HasPrefix(source, "/") {
		return "", "", "", false
	}
	// strip submodule path: ns/name/prov//modules/x
	base := source
	if i := strings.Index(source, "//"); i >= 0 {
		base = source[:i]
	}
	parts := strings.Split(base, "/")
	if len(parts) != 3 {
		return "", "", "", false
	}
	return parts[0], parts[1], parts[2], true
}

func (c *registryClient) latestProvider(ctx context.Context, ns, name string) (string, error) {
	key := ns + "/" + name
	c.mu.Lock()
	if e, ok := c.prov[key]; ok && time.Since(e.at) < 10*time.Minute {
		c.mu.Unlock()
		return e.version, nil
	}
	c.mu.Unlock()

	path := fmt.Sprintf("/v1/providers/%s/%s", url.PathEscape(ns), url.PathEscape(name))
	body, err := c.get(ctx, path)
	if err != nil {
		return "", err
	}
	var raw struct {
		Version string `json:"version"`
	}
	if err := json.Unmarshal(body, &raw); err != nil {
		return "", err
	}
	c.mu.Lock()
	c.prov[key] = cacheEnt{version: raw.Version, at: time.Now()}
	c.mu.Unlock()
	return raw.Version, nil
}

func (c *registryClient) latestModule(ctx context.Context, ns, name, provider string) (string, error) {
	key := ns + "/" + name + "/" + provider
	c.mu.Lock()
	if e, ok := c.mod[key]; ok && time.Since(e.at) < 10*time.Minute {
		c.mu.Unlock()
		return e.version, nil
	}
	c.mu.Unlock()

	path := fmt.Sprintf("/v1/modules/%s/%s/%s", url.PathEscape(ns), url.PathEscape(name), url.PathEscape(provider))
	body, err := c.get(ctx, path)
	if err != nil {
		return "", err
	}
	var raw struct {
		Version string `json:"version"`
	}
	if err := json.Unmarshal(body, &raw); err != nil {
		return "", err
	}
	c.mu.Lock()
	c.mod[key] = cacheEnt{version: raw.Version, at: time.Now()}
	c.mu.Unlock()
	return raw.Version, nil
}

func (c *registryClient) get(ctx context.Context, path string) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, registryBase+path, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", "terraforge/suggestions")
	res, err := c.http.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	body, err := io.ReadAll(io.LimitReader(res.Body, 2<<20))
	if err != nil {
		return nil, err
	}
	if res.StatusCode >= 400 {
		return nil, fmt.Errorf("registry %s", res.Status)
	}
	return body, nil
}
