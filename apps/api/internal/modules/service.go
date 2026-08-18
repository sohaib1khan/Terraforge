package modules

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

const registryBase = "https://registry.terraform.io"

type Module struct {
	ID          string `json:"id"`
	Namespace   string `json:"namespace"`
	Name        string `json:"name"`
	Provider    string `json:"provider"`
	FullName    string `json:"full_name"`
	Description string `json:"description"`
	Source      string `json:"source"`
	Downloads   int64  `json:"downloads"`
	Version     string `json:"version,omitempty"`
	Verified    bool   `json:"verified"`
	LogoURL     string `json:"logo_url,omitempty"`
}

type Input struct {
	Name        string `json:"name"`
	Type        string `json:"type"`
	Description string `json:"description"`
	Default     string `json:"default,omitempty"`
	Required    bool   `json:"required"`
}

type Output struct {
	Name        string `json:"name"`
	Description string `json:"description"`
}

type Example struct {
	Name        string   `json:"name"`
	Path        string   `json:"path"`
	Readme      string   `json:"readme,omitempty"`
	SourceLine  string   `json:"source_line"`
	Snippet     string   `json:"snippet"`
	Inputs      []Input  `json:"inputs,omitempty"`
	Outputs     []Output `json:"outputs,omitempty"`
	ResourceN   int      `json:"resource_count"`
}

type Detail struct {
	Module      Module    `json:"module"`
	Snippet     string    `json:"snippet"`
	DocsURL     string    `json:"docs_url"`
	Readme      string    `json:"readme,omitempty"`
	Inputs      []Input   `json:"inputs,omitempty"`
	Outputs     []Output  `json:"outputs,omitempty"`
	Examples    []Example `json:"examples"`
	ExampleCount int      `json:"example_count"`
}

type Service struct {
	client *http.Client
	mu     sync.Mutex
	cache  []Module
	cached time.Time
}

func NewService() *Service {
	return &Service{
		client: &http.Client{Timeout: 25 * time.Second},
	}
}

func (s *Service) Search(ctx context.Context, q string, limit, offset int) ([]Module, int, error) {
	if limit <= 0 || limit > 50 {
		limit = 25
	}
	if offset < 0 {
		offset = 0
	}
	q = strings.TrimSpace(q)

	if q == "" {
		items, err := s.popular(ctx, limit+offset)
		if err != nil {
			return nil, 0, err
		}
		if offset >= len(items) {
			return []Module{}, len(items), nil
		}
		end := offset + limit
		if end > len(items) {
			end = len(items)
		}
		return items[offset:end], len(items), nil
	}

	var ranked []Module
	if direct, ok := s.lookupDirect(ctx, q); ok {
		ranked = append(ranked, direct)
	}

	ns, name, provider := splitQuery(q)
	params := url.Values{}
	params.Set("page[size]", strconv.Itoa(limit))
	params.Set("page[number]", strconv.Itoa(offset/limit+1))
	params.Set("sort", "-downloads")
	params.Set("include", "latest-version")
	if name != "" {
		params.Set("filter[name]", name)
	}
	if ns != "" {
		params.Set("filter[namespace]", ns)
	}
	if provider != "" {
		params.Set("filter[provider]", provider)
	}

	body, err := s.getJSON(ctx, "/v2/modules?"+params.Encode())
	if err != nil {
		if len(ranked) > 0 {
			return ranked, 1, nil
		}
		return nil, 0, err
	}
	items, total, err := parseV2List(body)
	if err != nil {
		if len(ranked) > 0 {
			return ranked, 1, nil
		}
		return nil, 0, err
	}

	if len(items) == 0 || (ns == "" && name != "" && !exactNameMatch(items, name)) {
		catalog, cerr := s.catalog(ctx)
		if cerr == nil {
			filtered := filterCatalog(catalog, q)
			total = len(filtered)
			if offset < len(filtered) {
				end := offset + limit
				if end > len(filtered) {
					end = len(filtered)
				}
				items = mergeModules(items, filtered[offset:end])
			}
		}
	}

	merged := mergeModules(ranked, items)
	if len(merged) > limit {
		merged = merged[:limit]
	}
	if total < len(merged) {
		total = len(merged)
	}
	return merged, total, nil
}

func (s *Service) Get(ctx context.Context, namespace, name, provider string) (Detail, error) {
	namespace = strings.TrimSpace(namespace)
	name = strings.TrimSpace(name)
	provider = strings.TrimSpace(provider)
	if namespace == "" || name == "" || provider == "" {
		return Detail{}, fmt.Errorf("namespace, name, and provider required")
	}

	path := fmt.Sprintf("/v1/modules/%s/%s/%s",
		url.PathEscape(namespace), url.PathEscape(name), url.PathEscape(provider))
	body, err := s.getJSON(ctx, path)
	if err != nil {
		return Detail{}, err
	}
	return parseV1Detail(body)
}

func (s *Service) lookupDirect(ctx context.Context, q string) (Module, bool) {
	ns, name, provider := splitQuery(q)
	if name == "" {
		return Module{}, false
	}
	if ns == "" {
		ns = "hashicorp"
	}
	if provider == "" {
		// try common providers
		for _, p := range []string{"aws", "azurerm", "google", "null"} {
			m, err := s.fetchV1Summary(ctx, ns, name, p)
			if err == nil {
				return m, true
			}
		}
		return Module{}, false
	}
	m, err := s.fetchV1Summary(ctx, ns, name, provider)
	if err != nil {
		return Module{}, false
	}
	return m, true
}

func (s *Service) fetchV1Summary(ctx context.Context, namespace, name, provider string) (Module, error) {
	d, err := s.Get(ctx, namespace, name, provider)
	if err != nil {
		return Module{}, err
	}
	return d.Module, nil
}

func (s *Service) popular(ctx context.Context, n int) ([]Module, error) {
	if n < 50 {
		n = 50
	}
	params := url.Values{}
	params.Set("page[size]", strconv.Itoa(min(n, 100)))
	params.Set("page[number]", "1")
	params.Set("sort", "-downloads")
	params.Set("include", "latest-version")
	body, err := s.getJSON(ctx, "/v2/modules?"+params.Encode())
	if err != nil {
		return nil, err
	}
	items, _, err := parseV2List(body)
	return items, err
}

func (s *Service) catalog(ctx context.Context) ([]Module, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if time.Since(s.cached) < time.Hour && len(s.cache) > 0 {
		return s.cache, nil
	}
	var all []Module
	for page := 1; page <= 5; page++ {
		params := url.Values{}
		params.Set("page[size]", "100")
		params.Set("page[number]", strconv.Itoa(page))
		params.Set("sort", "-downloads")
		params.Set("include", "latest-version")
		body, err := s.getJSON(ctx, "/v2/modules?"+params.Encode())
		if err != nil {
			return nil, err
		}
		items, _, err := parseV2List(body)
		if err != nil {
			return nil, err
		}
		if len(items) == 0 {
			break
		}
		all = append(all, items...)
	}
	sort.SliceStable(all, func(i, j int) bool { return all[i].Downloads > all[j].Downloads })
	s.cache = all
	s.cached = time.Now()
	return all, nil
}

func (s *Service) getJSON(ctx context.Context, path string) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, registryBase+path, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", "terraforge/modules-browser")
	res, err := s.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	body, err := io.ReadAll(io.LimitReader(res.Body, 8<<20))
	if err != nil {
		return nil, err
	}
	if res.StatusCode == http.StatusNotFound {
		return nil, fmt.Errorf("module not found")
	}
	if res.StatusCode >= 400 {
		return nil, fmt.Errorf("registry error: %s", res.Status)
	}
	return body, nil
}

func parseV1Detail(body []byte) (Detail, error) {
	var raw struct {
		ID          string `json:"id"`
		Namespace   string `json:"namespace"`
		Name        string `json:"name"`
		Provider    string `json:"provider"`
		Description string `json:"description"`
		Source      string `json:"source"`
		Downloads   int64  `json:"downloads"`
		Version     string `json:"version"`
		Verified    bool   `json:"verified"`
		LogoURL     string `json:"provider_logo_url"`
		Root        *struct {
			Readme  string          `json:"readme"`
			Inputs  []rawIOField    `json:"inputs"`
			Outputs []rawOutputField `json:"outputs"`
		} `json:"root"`
		Examples []struct {
			Name      string           `json:"name"`
			Path      string           `json:"path"`
			Readme    string           `json:"readme"`
			Inputs    []rawIOField     `json:"inputs"`
			Outputs   []rawOutputField `json:"outputs"`
			Resources []any            `json:"resources"`
		} `json:"examples"`
	}
	if err := json.Unmarshal(body, &raw); err != nil {
		return Detail{}, err
	}
	if raw.Name == "" {
		return Detail{}, fmt.Errorf("module not found")
	}
	logo := absLogo(raw.LogoURL)
	full := raw.Namespace + "/" + raw.Name + "/" + raw.Provider
	m := Module{
		ID:          raw.ID,
		Namespace:   raw.Namespace,
		Name:        raw.Name,
		Provider:    raw.Provider,
		FullName:    full,
		Description: cleanDesc(raw.Description),
		Source:      raw.Source,
		Downloads:   raw.Downloads,
		Version:     raw.Version,
		Verified:    raw.Verified,
		LogoURL:     logo,
	}

	var inputs []Input
	var outputs []Output
	readme := ""
	if raw.Root != nil {
		readme = truncateReadme(raw.Root.Readme)
		inputs = mapInputs(raw.Root.Inputs)
		outputs = mapOutputs(raw.Root.Outputs)
	}

	examples := make([]Example, 0, len(raw.Examples))
	for _, ex := range raw.Examples {
		path := strings.TrimSpace(ex.Path)
		if path == "" {
			continue
		}
		sourceLine := fmt.Sprintf("%s//%s", full, strings.TrimPrefix(path, "/"))
		snippet := buildExampleSnippet(m.Name, sourceLine, raw.Version, mapInputs(ex.Inputs))
		examples = append(examples, Example{
			Name:       firstNonEmpty(ex.Name, path),
			Path:       path,
			Readme:     truncateReadme(ex.Readme),
			SourceLine: sourceLine,
			Snippet:    snippet,
			Inputs:     mapInputs(ex.Inputs),
			Outputs:    mapOutputs(ex.Outputs),
			ResourceN:  len(ex.Resources),
		})
	}
	sort.SliceStable(examples, func(i, j int) bool {
		return strings.ToLower(examples[i].Name) < strings.ToLower(examples[j].Name)
	})

	return Detail{
		Module:       m,
		Snippet:      buildModuleSnippet(m),
		DocsURL:      fmt.Sprintf("https://registry.terraform.io/modules/%s/%s/%s/latest", m.Namespace, m.Name, m.Provider),
		Readme:       readme,
		Inputs:       inputs,
		Outputs:      outputs,
		Examples:     examples,
		ExampleCount: len(examples),
	}, nil
}

type rawIOField struct {
	Name        string `json:"name"`
	Type        string `json:"type"`
	Description string `json:"description"`
	Default     any    `json:"default"`
	Required    bool   `json:"required"`
}

type rawOutputField struct {
	Name        string `json:"name"`
	Description string `json:"description"`
}

func mapInputs(in []rawIOField) []Input {
	out := make([]Input, 0, len(in))
	for _, f := range in {
		def := ""
		if f.Default != nil {
			b, err := json.Marshal(f.Default)
			if err == nil {
				def = string(b)
			}
		}
		out = append(out, Input{
			Name:        f.Name,
			Type:        f.Type,
			Description: strings.TrimSpace(f.Description),
			Default:     def,
			Required:    f.Required,
		})
	}
	return out
}

func mapOutputs(in []rawOutputField) []Output {
	out := make([]Output, 0, len(in))
	for _, f := range in {
		out = append(out, Output{
			Name:        f.Name,
			Description: strings.TrimSpace(f.Description),
		})
	}
	return out
}

func buildModuleSnippet(m Module) string {
	ver := strings.TrimPrefix(strings.TrimSpace(m.Version), "v")
	verLine := ""
	if ver != "" {
		verLine = fmt.Sprintf("\n  version = %q", ver)
	}
	alias := sanitizeAlias(m.Name)
	return fmt.Sprintf(`module %q {
  source  = %q%s

  # See registry docs for required inputs
}`, alias, m.FullName, verLine)
}

func buildExampleSnippet(moduleName, sourceLine, version string, inputs []Input) string {
	ver := strings.TrimPrefix(strings.TrimSpace(version), "v")
	verLine := ""
	if ver != "" {
		verLine = fmt.Sprintf("\n  version = %q", ver)
	}
	var b strings.Builder
	fmt.Fprintf(&b, "module %q {\n  source  = %q%s\n", sanitizeAlias(moduleName+"_"+pathBase(sourceLine)), sourceLine, verLine)
	shown := 0
	for _, in := range inputs {
		if !in.Required {
			continue
		}
		fmt.Fprintf(&b, "\n  %s = %s", in.Name, placeholderFor(in))
		shown++
		if shown >= 8 {
			b.WriteString("\n  # …")
			break
		}
	}
	if shown == 0 {
		b.WriteString("\n  # Configuration options — see example readme")
	}
	b.WriteString("\n}")
	return b.String()
}

func placeholderFor(in Input) string {
	t := strings.ToLower(in.Type)
	switch {
	case strings.Contains(t, "bool"):
		return "true"
	case strings.Contains(t, "number"), strings.Contains(t, "int"):
		return "1"
	case strings.Contains(t, "list"), strings.Contains(t, "set"):
		return "[]"
	case strings.Contains(t, "map"), strings.Contains(t, "object"):
		return "{}"
	default:
		return fmt.Sprintf("%q", "CHANGE_ME")
	}
}

func sanitizeAlias(name string) string {
	name = strings.ToLower(strings.TrimSpace(name))
	name = strings.ReplaceAll(name, "-", "_")
	name = strings.ReplaceAll(name, "/", "_")
	name = strings.ReplaceAll(name, " ", "_")
	if name == "" {
		return "example"
	}
	return name
}

func pathBase(sourceLine string) string {
	if i := strings.LastIndex(sourceLine, "/"); i >= 0 {
		return sourceLine[i+1:]
	}
	return sourceLine
}

func parseV2List(body []byte) ([]Module, int, error) {
	var raw struct {
		Data []struct {
			ID         string `json:"id"`
			Attributes struct {
				Name            string `json:"name"`
				Namespace       string `json:"namespace"`
				FullName        string `json:"full-name"`
				Description     string `json:"description"`
				Source          string `json:"source"`
				Downloads       int64  `json:"downloads"`
				Verified        bool   `json:"verified"`
				ProviderName    string `json:"provider-name"`
				ProviderLogoURL string `json:"provider-logo-url"`
			} `json:"attributes"`
			Relationships struct {
				LatestVersion struct {
					Data *struct {
						ID string `json:"id"`
					} `json:"data"`
				} `json:"latest-version"`
			} `json:"relationships"`
		} `json:"data"`
		Included []struct {
			ID         string `json:"id"`
			Type       string `json:"type"`
			Attributes struct {
				Version string `json:"version"`
			} `json:"attributes"`
		} `json:"included"`
		Meta struct {
			Pagination struct {
				TotalCount int `json:"total-count"`
			} `json:"pagination"`
		} `json:"meta"`
	}
	if err := json.Unmarshal(body, &raw); err != nil {
		return nil, 0, err
	}
	versions := map[string]string{}
	for _, inc := range raw.Included {
		if inc.Type == "module-versions" || strings.Contains(inc.Type, "version") {
			versions[inc.ID] = inc.Attributes.Version
		}
	}
	out := make([]Module, 0, len(raw.Data))
	for _, d := range raw.Data {
		a := d.Attributes
		ver := ""
		if d.Relationships.LatestVersion.Data != nil {
			ver = versions[d.Relationships.LatestVersion.Data.ID]
		}
		full := a.FullName
		if full == "" {
			full = a.Namespace + "/" + a.Name + "/" + a.ProviderName
		}
		out = append(out, Module{
			ID:          d.ID,
			Namespace:   a.Namespace,
			Name:        a.Name,
			Provider:    a.ProviderName,
			FullName:    full,
			Description: cleanDesc(a.Description),
			Source:      a.Source,
			Downloads:   a.Downloads,
			Version:     ver,
			Verified:    a.Verified,
			LogoURL:     absLogo(a.ProviderLogoURL),
		})
	}
	return out, raw.Meta.Pagination.TotalCount, nil
}

func splitQuery(q string) (ns, name, provider string) {
	q = strings.TrimSpace(strings.ToLower(q))
	if q == "" {
		return "", "", ""
	}
	parts := strings.Split(q, "/")
	switch len(parts) {
	case 1:
		return "", parts[0], ""
	case 2:
		return parts[0], parts[1], ""
	default:
		return parts[0], parts[1], parts[2]
	}
}

func filterCatalog(catalog []Module, q string) []Module {
	q = strings.ToLower(strings.TrimSpace(q))
	var out []Module
	for _, m := range catalog {
		hay := strings.ToLower(m.FullName + " " + m.Description + " " + m.Name + " " + m.Namespace + " " + m.Provider)
		if strings.Contains(hay, q) {
			out = append(out, m)
		}
	}
	return out
}

func exactNameMatch(items []Module, name string) bool {
	name = strings.ToLower(name)
	for _, m := range items {
		if strings.EqualFold(m.Name, name) {
			return true
		}
	}
	return false
}

func mergeModules(a, b []Module) []Module {
	seen := map[string]bool{}
	var out []Module
	for _, m := range a {
		key := m.FullName
		if seen[key] {
			continue
		}
		seen[key] = true
		out = append(out, m)
	}
	for _, m := range b {
		key := m.FullName
		if seen[key] {
			continue
		}
		seen[key] = true
		out = append(out, m)
	}
	return out
}

func absLogo(logo string) string {
	if logo != "" && strings.HasPrefix(logo, "/") {
		return registryBase + logo
	}
	return logo
}

func cleanDesc(s string) string {
	s = strings.TrimSpace(s)
	if len(s) > 280 {
		return s[:277] + "…"
	}
	return s
}

func truncateReadme(s string) string {
	s = strings.TrimSpace(s)
	const max = 12000
	if len(s) > max {
		return s[:max] + "\n\n… (truncated — open Registry docs for full readme)"
	}
	return s
}

func firstNonEmpty(a, b string) string {
	if strings.TrimSpace(a) != "" {
		return a
	}
	return b
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
