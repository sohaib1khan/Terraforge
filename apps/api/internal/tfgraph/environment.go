package tfgraph

import (
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
)

// EnvProvider is one Terraform provider detected for a namespace.
type EnvProvider struct {
	Name          string `json:"name"`
	Label         string `json:"label"`
	Source        string `json:"source,omitempty"`
	Version       string `json:"version,omitempty"`
	Category      string `json:"category"` // cloud | local | kubernetes | utility | vcs | other
	Declared      bool   `json:"declared"`
	InConfig      bool   `json:"in_config"`
	InState       bool   `json:"in_state"`
	ResourceCount int    `json:"resource_count"`
	DataCount     int    `json:"data_count"`
}

// Environment summarizes which platforms a namespace's Terraform config targets.
type Environment struct {
	Summary   string        `json:"summary"`
	Primary   string        `json:"primary,omitempty"`
	Providers []EnvProvider `json:"providers"`
	Clouds    []string      `json:"clouds"`
	HasLocal  bool          `json:"has_local"`
	Empty     bool          `json:"empty"`
	Note      string        `json:"note,omitempty"`
}

type envAccum struct {
	name     string
	source   string
	version  string
	declared bool
	inConfig bool
	inState  bool
	res      int
	data     int
}

var (
	reTerraformBlock = regexp.MustCompile(`(?m)^terraform\s*\{`)
	reProviderBlock  = regexp.MustCompile(`(?m)^provider\s+"([^"]+)"\s*\{`)
	reReqProviders   = regexp.MustCompile(`required_providers\s*\{`)
	reProvAssign     = regexp.MustCompile(`(?m)^\s*([a-zA-Z0-9_-]+)\s*=\s*\{`)
	reSourceAttr     = regexp.MustCompile(`source\s*=\s*"([^"]+)"`)
	reVersionAttr    = regexp.MustCompile(`version\s*=\s*"([^"]+)"`)
)

// DetectEnvironment scans .tf files for required_providers, provider blocks, and resource types.
func DetectEnvironment(root string) Environment {
	acc := map[string]*envAccum{}

	if root != "" {
		info, err := os.Stat(root)
		if err == nil && info.IsDir() {
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
				base := d.Name()
				if !strings.HasSuffix(base, ".tf") && !strings.HasSuffix(base, ".tf.json") {
					return nil
				}
				raw, err := os.ReadFile(path)
				if err != nil || len(raw) > 1<<20 {
					return nil
				}
				scanProvidersFromFile(string(raw), acc)
				return nil
			})
		}
	}

	return buildEnvironment(acc)
}

// EnrichEnvironmentFromGraph marks providers used by resources/data in the config graph.
func EnrichEnvironmentFromGraph(env *Environment, g Graph) {
	acc := map[string]*envAccum{}
	for _, p := range env.Providers {
		acc[p.Name] = &envAccum{
			name:     p.Name,
			source:   p.Source,
			version:  p.Version,
			declared: p.Declared,
			inConfig: p.InConfig,
			inState:  p.InState,
			res:      p.ResourceCount,
			data:     p.DataCount,
		}
	}
	for _, n := range g.Nodes {
		if n.Provider == "" {
			continue
		}
		name := normalizeProviderName(n.Provider)
		e := ensureAccum(acc, name)
		e.inConfig = true
		switch n.Kind {
		case KindResource:
			e.res++
		case KindData:
			e.data++
		}
	}
	*env = buildEnvironment(acc)
}

// EnrichEnvironmentFromState merges providers observed in remote state.
func EnrichEnvironmentFromState(env *Environment, stateProviders []string) {
	acc := map[string]*envAccum{}
	for _, p := range env.Providers {
		acc[p.Name] = &envAccum{
			name:     p.Name,
			source:   p.Source,
			version:  p.Version,
			declared: p.Declared,
			inConfig: p.InConfig,
			inState:  p.InState,
			res:      p.ResourceCount,
			data:     p.DataCount,
		}
	}
	for _, raw := range stateProviders {
		name := normalizeProviderName(raw)
		if name == "" {
			continue
		}
		e := ensureAccum(acc, name)
		e.inState = true
	}
	*env = buildEnvironment(acc)
}

func scanProvidersFromFile(src string, acc map[string]*envAccum) {
	for _, m := range reTerraformBlock.FindAllStringIndex(src, -1) {
		body := blockBody(src, m[1]-1)
		if body == "" {
			continue
		}
		for _, rp := range reReqProviders.FindAllStringIndex(body, -1) {
			rpBody := blockBody(body, rp[1]-1)
			scanRequiredProvidersBody(rpBody, acc)
		}
	}
	for _, m := range reProviderBlock.FindAllStringSubmatch(src, -1) {
		name := normalizeProviderName(m[1])
		if name == "" {
			continue
		}
		e := ensureAccum(acc, name)
		e.declared = true
	}
}

func scanRequiredProvidersBody(body string, acc map[string]*envAccum) {
	matches := reProvAssign.FindAllStringSubmatchIndex(body, -1)
	for _, m := range matches {
		alias := body[m[2]:m[3]]
		open := m[1] - 1 // index of '{'
		if open < 0 || open >= len(body) || body[open] != '{' {
			continue
		}
		inner := blockBody(body, open)
		name := normalizeProviderName(alias)
		source := ""
		version := ""
		if sm := reSourceAttr.FindStringSubmatch(inner); len(sm) > 1 {
			source = sm[1]
			if i := strings.LastIndex(source, "/"); i >= 0 {
				name = normalizeProviderName(source[i+1:])
			}
		}
		if vm := reVersionAttr.FindStringSubmatch(inner); len(vm) > 1 {
			version = vm[1]
		}
		if name == "" {
			continue
		}
		e := ensureAccum(acc, name)
		e.declared = true
		if source != "" {
			e.source = source
		}
		if version != "" {
			e.version = version
		}
	}
}

func ensureAccum(acc map[string]*envAccum, name string) *envAccum {
	if e, ok := acc[name]; ok {
		return e
	}
	e := &envAccum{name: name}
	acc[name] = e
	return e
}

func buildEnvironment(acc map[string]*envAccum) Environment {
	if len(acc) == 0 {
		return Environment{
			Summary:   "No providers detected",
			Providers: []EnvProvider{},
			Clouds:    []string{},
			Empty:     true,
			Note:      "Add required_providers or resources in .tf files, then refresh.",
		}
	}

	providers := make([]EnvProvider, 0, len(acc))
	clouds := []string{}
	cloudSeen := map[string]bool{}
	hasLocal := false

	for _, e := range acc {
		meta := providerMeta(e.name)
		if meta.category == "local" {
			hasLocal = true
		}
		if meta.category == "cloud" && !cloudSeen[e.name] {
			cloudSeen[e.name] = true
			clouds = append(clouds, e.name)
		}
		providers = append(providers, EnvProvider{
			Name:          e.name,
			Label:         meta.label,
			Source:        e.source,
			Version:       e.version,
			Category:      meta.category,
			Declared:      e.declared,
			InConfig:      e.inConfig || e.res > 0 || e.data > 0,
			InState:       e.inState,
			ResourceCount: e.res,
			DataCount:     e.data,
		})
	}

	sort.SliceStable(providers, func(i, j int) bool {
		pi, pj := providers[i], providers[j]
		ri, rj := categoryRank(pi.Category), categoryRank(pj.Category)
		if ri != rj {
			return ri < rj
		}
		ti, tj := pi.ResourceCount+pi.DataCount, pj.ResourceCount+pj.DataCount
		if ti != tj {
			return ti > tj
		}
		return pi.Name < pj.Name
	})
	sort.Strings(clouds)

	primary := ""
	for _, p := range providers {
		if p.Category == "cloud" {
			primary = p.Name
			break
		}
	}
	if primary == "" && len(providers) > 0 {
		primary = providers[0].Name
	}

	return Environment{
		Summary:   summarizeEnv(providers, clouds, hasLocal),
		Primary:   primary,
		Providers: providers,
		Clouds:    clouds,
		HasLocal:  hasLocal,
		Empty:     false,
	}
}

func summarizeEnv(providers []EnvProvider, clouds []string, hasLocal bool) string {
	var parts []string
	for _, c := range clouds {
		parts = append(parts, providerMeta(c).label)
	}
	if hasLocal {
		parts = append(parts, "Local")
	}
	for _, p := range providers {
		if p.Category == "cloud" || p.Category == "local" {
			continue
		}
		if p.Category == "kubernetes" || p.Category == "vcs" {
			parts = append(parts, p.Label)
		}
	}
	if len(parts) == 0 {
		for _, p := range providers {
			parts = append(parts, p.Label)
			if len(parts) >= 3 {
				break
			}
		}
	}
	if len(parts) == 0 {
		return "No providers detected"
	}
	if len(parts) == 1 {
		return parts[0]
	}
	if len(parts) == 2 {
		return parts[0] + " + " + parts[1]
	}
	return strings.Join(parts[:len(parts)-1], ", ") + " + " + parts[len(parts)-1]
}

type pmeta struct {
	label    string
	category string
}

func providerMeta(name string) pmeta {
	switch strings.ToLower(name) {
	case "aws":
		return pmeta{"AWS", "cloud"}
	case "azurerm":
		return pmeta{"Azure", "cloud"}
	case "azuread":
		return pmeta{"Azure AD", "cloud"}
	case "azapi":
		return pmeta{"Azure (AzAPI)", "cloud"}
	case "google":
		return pmeta{"Google Cloud", "cloud"}
	case "google-beta":
		return pmeta{"Google Cloud (beta)", "cloud"}
	case "oci":
		return pmeta{"Oracle Cloud", "cloud"}
	case "alicloud":
		return pmeta{"Alibaba Cloud", "cloud"}
	case "digitalocean":
		return pmeta{"DigitalOcean", "cloud"}
	case "linode":
		return pmeta{"Linode", "cloud"}
	case "cloudflare":
		return pmeta{"Cloudflare", "cloud"}
	case "ibm", "ibmcloud":
		return pmeta{"IBM Cloud", "cloud"}
	case "openstack":
		return pmeta{"OpenStack", "cloud"}
	case "vsphere":
		return pmeta{"vSphere", "cloud"}
	case "local":
		return pmeta{"Local", "local"}
	case "null":
		return pmeta{"Null", "utility"}
	case "random", "time", "tls", "archive", "external", "http", "template", "cloudinit":
		label := name
		if len(name) > 0 {
			label = strings.ToUpper(name[:1]) + name[1:]
		}
		return pmeta{label, "utility"}
	case "kubernetes":
		return pmeta{"Kubernetes", "kubernetes"}
	case "helm":
		return pmeta{"Helm", "kubernetes"}
	case "docker":
		return pmeta{"Docker", "other"}
	case "github":
		return pmeta{"GitHub", "vcs"}
	case "gitlab":
		return pmeta{"GitLab", "vcs"}
	case "vault":
		return pmeta{"Vault", "other"}
	case "consul":
		return pmeta{"Consul", "other"}
	case "nomad":
		return pmeta{"Nomad", "other"}
	case "datadog":
		return pmeta{"Datadog", "other"}
	default:
		if name == "" {
			return pmeta{"Unknown", "other"}
		}
		return pmeta{name, "other"}
	}
}

func categoryRank(c string) int {
	switch c {
	case "cloud":
		return 0
	case "kubernetes":
		return 1
	case "local":
		return 2
	case "vcs":
		return 3
	case "utility":
		return 4
	default:
		return 5
	}
}

func normalizeProviderName(s string) string {
	s = strings.TrimSpace(strings.ToLower(s))
	s = strings.TrimPrefix(s, "registry.terraform.io/")
	if i := strings.LastIndex(s, "/"); i >= 0 {
		s = s[i+1:]
	}
	// provider["hashicorp/aws"] style
	s = strings.Trim(s, `"'[]`)
	if i := strings.LastIndex(s, "/"); i >= 0 {
		s = s[i+1:]
	}
	switch s {
	case "amazon":
		return "aws"
	case "azure", "azurerm":
		return "azurerm"
	case "gcp":
		return "google"
	}
	return s
}
