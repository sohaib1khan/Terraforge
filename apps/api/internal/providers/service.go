package providers

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

type Provider struct {
	ID          string `json:"id"`
	Namespace   string `json:"namespace"`
	Name        string `json:"name"`
	FullName    string `json:"full_name"`
	Description string `json:"description"`
	Source      string `json:"source"`
	Tier        string `json:"tier"`
	Downloads   int64  `json:"downloads"`
	Version     string `json:"version,omitempty"`
	LogoURL     string `json:"logo_url,omitempty"`
}

type Snippets struct {
	RequiredProviders string `json:"required_providers"`
	ProviderBlock     string `json:"provider_block"`
	Combined          string `json:"combined"`
}

type Detail struct {
	Provider Provider `json:"provider"`
	Snippets Snippets `json:"snippets"`
	DocsURL  string   `json:"docs_url"`
}

type Service struct {
	client *http.Client
	mu     sync.Mutex
	cache  []Provider
	cached time.Time
}

func NewService() *Service {
	return &Service{
		client: &http.Client{Timeout: 20 * time.Second},
	}
}

func (s *Service) Search(ctx context.Context, q string, limit, offset int) ([]Provider, int, error) {
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
			return []Provider{}, len(items), nil
		}
		end := offset + limit
		if end > len(items) {
			end = len(items)
		}
		return items[offset:end], len(items), nil
	}

	var ranked []Provider
	if direct, ok := s.lookupDirect(ctx, q); ok {
		ranked = append(ranked, direct)
	}

	ns, name := splitQuery(q)
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

	body, err := s.getJSON(ctx, "/v2/providers?"+params.Encode())
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
				items = mergeProviders(items, filtered[offset:end])
			}
		}
	}

	merged := mergeProviders(ranked, items)
	if len(merged) > limit {
		merged = merged[:limit]
	}
	if total < len(merged) {
		total = len(merged)
	}
	return merged, total, nil
}

func (s *Service) Get(ctx context.Context, namespace, name string) (Detail, error) {
	namespace = strings.TrimSpace(namespace)
	name = strings.TrimSpace(name)
	if namespace == "" || name == "" {
		return Detail{}, fmt.Errorf("namespace and name required")
	}

	p, err := s.fetchV1(ctx, namespace, name)
	if err != nil {
		return Detail{}, err
	}
	return Detail{
		Provider: p,
		Snippets: BuildSnippets(p),
		DocsURL:  fmt.Sprintf("https://registry.terraform.io/providers/%s/%s/latest/docs", p.Namespace, p.Name),
	}, nil
}

func BuildSnippets(p Provider) Snippets {
	alias := p.Name
	if i := strings.LastIndex(alias, "-"); i >= 0 && len(alias) > i+1 {
		// keep full name as provider block label (aws, azurerm, google-beta, …)
	}
	verConstraint := "~> " + majorMinor(p.Version)
	source := p.Namespace + "/" + p.Name

	required := fmt.Sprintf(`terraform {
  required_providers {
    %s = {
      source  = %q
      version = %q
    }
  }
}`, alias, source, verConstraint)

	block := fmt.Sprintf(`provider %q {
  # Configuration options
}`, alias)

	combined := required + "\n\n" + block
	return Snippets{
		RequiredProviders: required,
		ProviderBlock:     block,
		Combined:          combined,
	}
}

func majorMinor(version string) string {
	version = strings.TrimPrefix(strings.TrimSpace(version), "v")
	if version == "" {
		return "1.0"
	}
	parts := strings.Split(version, ".")
	if len(parts) >= 2 {
		return parts[0] + "." + parts[1]
	}
	return version
}

func (s *Service) lookupDirect(ctx context.Context, q string) (Provider, bool) {
	ns, name := splitQuery(q)
	if name == "" {
		return Provider{}, false
	}
	if ns == "" {
		ns = "hashicorp"
	}
	p, err := s.fetchV1(ctx, ns, name)
	if err != nil {
		return Provider{}, false
	}
	return p, true
}

func (s *Service) fetchV1(ctx context.Context, namespace, name string) (Provider, error) {
	path := fmt.Sprintf("/v1/providers/%s/%s", url.PathEscape(namespace), url.PathEscape(name))
	body, err := s.getJSON(ctx, path)
	if err != nil {
		return Provider{}, err
	}
	var raw struct {
		ID          string `json:"id"`
		Namespace   string `json:"namespace"`
		Name        string `json:"name"`
		Description string `json:"description"`
		Source      string `json:"source"`
		Tier        string `json:"tier"`
		Downloads   int64  `json:"downloads"`
		Version     string `json:"version"`
		LogoURL     string `json:"logo_url"`
	}
	if err := json.Unmarshal(body, &raw); err != nil {
		return Provider{}, err
	}
	if raw.Name == "" {
		return Provider{}, fmt.Errorf("provider not found")
	}
	logo := raw.LogoURL
	if logo != "" && strings.HasPrefix(logo, "/") {
		logo = registryBase + logo
	}
	return Provider{
		ID:          raw.ID,
		Namespace:   raw.Namespace,
		Name:        raw.Name,
		FullName:    raw.Namespace + "/" + raw.Name,
		Description: cleanDesc(raw.Description),
		Source:      raw.Source,
		Tier:        raw.Tier,
		Downloads:   raw.Downloads,
		Version:     raw.Version,
		LogoURL:     logo,
	}, nil
}

func (s *Service) popular(ctx context.Context, n int) ([]Provider, error) {
	if n < 50 {
		n = 50
	}
	params := url.Values{}
	params.Set("page[size]", strconv.Itoa(min(n, 100)))
	params.Set("page[number]", "1")
	params.Set("sort", "-downloads")
	params.Set("include", "latest-version")
	body, err := s.getJSON(ctx, "/v2/providers?"+params.Encode())
	if err != nil {
		return nil, err
	}
	items, _, err := parseV2List(body)
	return items, err
}

func (s *Service) catalog(ctx context.Context) ([]Provider, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if time.Since(s.cached) < time.Hour && len(s.cache) > 0 {
		return s.cache, nil
	}
	var all []Provider
	for page := 1; page <= 5; page++ {
		params := url.Values{}
		params.Set("page[size]", "100")
		params.Set("page[number]", strconv.Itoa(page))
		params.Set("sort", "-downloads")
		params.Set("include", "latest-version")
		body, err := s.getJSON(ctx, "/v2/providers?"+params.Encode())
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
	req.Header.Set("User-Agent", "terraforge/providers-browser")
	res, err := s.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	body, err := io.ReadAll(io.LimitReader(res.Body, 4<<20))
	if err != nil {
		return nil, err
	}
	if res.StatusCode == http.StatusNotFound {
		return nil, fmt.Errorf("provider not found")
	}
	if res.StatusCode >= 400 {
		return nil, fmt.Errorf("registry error: %s", res.Status)
	}
	return body, nil
}

func parseV2List(body []byte) ([]Provider, int, error) {
	var raw struct {
		Data []struct {
			ID         string `json:"id"`
			Attributes struct {
				Name        string `json:"name"`
				Namespace   string `json:"namespace"`
				FullName    string `json:"full-name"`
				Description string `json:"description"`
				Source      string `json:"source"`
				Tier        string `json:"tier"`
				Downloads   int64  `json:"downloads"`
				LogoURL     string `json:"logo-url"`
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
		if inc.Type == "provider-versions" {
			versions[inc.ID] = inc.Attributes.Version
		}
	}
	out := make([]Provider, 0, len(raw.Data))
	for _, d := range raw.Data {
		a := d.Attributes
		logo := a.LogoURL
		if logo != "" && strings.HasPrefix(logo, "/") {
			logo = registryBase + logo
		}
		ver := ""
		if d.Relationships.LatestVersion.Data != nil {
			ver = versions[d.Relationships.LatestVersion.Data.ID]
		}
		full := a.FullName
		if full == "" {
			full = a.Namespace + "/" + a.Name
		}
		out = append(out, Provider{
			ID:          d.ID,
			Namespace:   a.Namespace,
			Name:        a.Name,
			FullName:    full,
			Description: cleanDesc(a.Description),
			Source:      a.Source,
			Tier:        a.Tier,
			Downloads:   a.Downloads,
			Version:     ver,
			LogoURL:     logo,
		})
	}
	return out, raw.Meta.Pagination.TotalCount, nil
}

func splitQuery(q string) (ns, name string) {
	q = strings.TrimSpace(strings.ToLower(q))
	if q == "" {
		return "", ""
	}
	if strings.Contains(q, "/") {
		parts := strings.SplitN(q, "/", 2)
		return strings.TrimSpace(parts[0]), strings.TrimSpace(parts[1])
	}
	return "", q
}

func filterCatalog(catalog []Provider, q string) []Provider {
	q = strings.ToLower(strings.TrimSpace(q))
	var out []Provider
	for _, p := range catalog {
		hay := strings.ToLower(p.FullName + " " + p.Description + " " + p.Name + " " + p.Namespace)
		if strings.Contains(hay, q) {
			out = append(out, p)
		}
	}
	return out
}

func exactNameMatch(items []Provider, name string) bool {
	name = strings.ToLower(name)
	for _, p := range items {
		if strings.EqualFold(p.Name, name) {
			return true
		}
	}
	return false
}

func mergeProviders(a, b []Provider) []Provider {
	seen := map[string]bool{}
	var out []Provider
	for _, p := range a {
		key := p.FullName
		if seen[key] {
			continue
		}
		seen[key] = true
		out = append(out, p)
	}
	for _, p := range b {
		key := p.FullName
		if seen[key] {
			continue
		}
		seen[key] = true
		out = append(out, p)
	}
	return out
}

func cleanDesc(s string) string {
	s = strings.TrimSpace(s)
	if strings.HasPrefix(strings.ToLower(s), "terraform-provider-") {
		return ""
	}
	if len(s) > 280 {
		return s[:277] + "…"
	}
	return s
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
