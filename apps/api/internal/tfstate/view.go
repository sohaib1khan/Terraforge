package tfstate

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"time"
)

type View struct {
	Exists           bool           `json:"exists"`
	UpdatedAt        *time.Time     `json:"updated_at,omitempty"`
	TerraformVersion string         `json:"terraform_version,omitempty"`
	Serial           int64          `json:"serial,omitempty"`
	Lineage          string         `json:"lineage,omitempty"`
	ResourceCount    int            `json:"resource_count"`
	Resources        []ViewResource `json:"resources"`
	Outputs          []ViewOutput   `json:"outputs"`
	Providers        []ViewCount    `json:"providers,omitempty"`
	Modules          []ViewCount    `json:"modules,omitempty"`
	Locked           bool           `json:"locked"`
	Lock             *LockInfo      `json:"lock,omitempty"`
}

type ViewCount struct {
	Name  string `json:"name"`
	Count int    `json:"count"`
}

type ViewResource struct {
	Address      string   `json:"address"`
	Mode         string   `json:"mode"`
	Type         string   `json:"type"`
	Name         string   `json:"name"`
	Provider     string   `json:"provider,omitempty"`
	Module       string   `json:"module,omitempty"` // e.g. module.vpc.module.subnets or ""
	IndexKey     any      `json:"index_key,omitempty"`
	ID           string   `json:"id,omitempty"`
	Dependencies []string `json:"dependencies,omitempty"`
	AttrKeys     []string `json:"attr_keys,omitempty"` // non-sensitive attribute names (capped)
}

type ViewOutput struct {
	Name      string `json:"name"`
	Type      string `json:"type,omitempty"`
	Sensitive bool   `json:"sensitive"`
	Value     any    `json:"value,omitempty"`
}

func BuildView(state []byte, updatedAt *time.Time, lock *LockInfo) View {
	v := View{
		Exists:    len(state) > 0,
		UpdatedAt: updatedAt,
		Resources: []ViewResource{},
		Outputs:   []ViewOutput{},
		Providers: []ViewCount{},
		Modules:   []ViewCount{},
		Locked:    lock != nil && lock.ID != "",
		Lock:      lock,
	}
	if !v.Exists {
		return v
	}

	var doc struct {
		Version          int    `json:"version"`
		TerraformVersion string `json:"terraform_version"`
		Serial           int64  `json:"serial"`
		Lineage          string `json:"lineage"`
		Outputs          map[string]struct {
			Value     json.RawMessage `json:"value"`
			Type      json.RawMessage `json:"type"`
			Sensitive bool            `json:"sensitive"`
		} `json:"outputs"`
		Resources []struct {
			Module   string `json:"module"`
			Mode     string `json:"mode"`
			Type     string `json:"type"`
			Name     string `json:"name"`
			Provider string `json:"provider"`
			Instances []struct {
				IndexKey     any               `json:"index_key"`
				Attributes   map[string]any    `json:"attributes"`
				Dependencies []string          `json:"dependencies"`
			} `json:"instances"`
		} `json:"resources"`
	}
	if err := json.Unmarshal(state, &doc); err != nil {
		return v
	}
	v.TerraformVersion = doc.TerraformVersion
	v.Serial = doc.Serial
	v.Lineage = doc.Lineage

	providerCounts := map[string]int{}
	moduleCounts := map[string]int{}

	for _, r := range doc.Resources {
		mode := r.Mode
		if mode == "" {
			mode = "managed"
		}
		mod := strings.TrimSpace(r.Module)
		prov := shortProvider(r.Provider)
		base := r.Type + "." + r.Name
		if mod != "" {
			base = mod + "." + base
		}

		if len(r.Instances) == 0 {
			v.Resources = append(v.Resources, ViewResource{
				Address:  base,
				Mode:     mode,
				Type:     r.Type,
				Name:     r.Name,
				Provider: prov,
				Module:   mod,
			})
			providerCounts[provOrUnknown(prov)]++
			moduleCounts[modOrRoot(mod)]++
			continue
		}
		for _, inst := range r.Instances {
			addr := base
			if inst.IndexKey != nil {
				addr = fmt.Sprintf("%s[%v]", base, formatIndexKey(inst.IndexKey))
			}
			id, keys := identityFromAttrs(inst.Attributes)
			deps := inst.Dependencies
			if len(deps) > 24 {
				deps = deps[:24]
			}
			v.Resources = append(v.Resources, ViewResource{
				Address:      addr,
				Mode:         mode,
				Type:         r.Type,
				Name:         r.Name,
				Provider:     prov,
				Module:       mod,
				IndexKey:     inst.IndexKey,
				ID:           id,
				Dependencies: deps,
				AttrKeys:     keys,
			})
			providerCounts[provOrUnknown(prov)]++
			moduleCounts[modOrRoot(mod)]++
		}
	}
	v.ResourceCount = len(v.Resources)
	v.Providers = countsToSlice(providerCounts)
	v.Modules = countsToSlice(moduleCounts)

	for name, out := range doc.Outputs {
		vo := ViewOutput{
			Name:      name,
			Type:      typeLabel(out.Type),
			Sensitive: out.Sensitive,
		}
		if out.Sensitive {
			vo.Value = "(sensitive)"
		} else if len(out.Value) > 0 {
			var val any
			if err := json.Unmarshal(out.Value, &val); err == nil {
				vo.Value = val
			} else {
				vo.Value = string(out.Value)
			}
		}
		v.Outputs = append(v.Outputs, vo)
	}
	sort.Slice(v.Outputs, func(i, j int) bool { return v.Outputs[i].Name < v.Outputs[j].Name })
	sort.Slice(v.Resources, func(i, j int) bool { return v.Resources[i].Address < v.Resources[j].Address })
	return v
}

func formatIndexKey(v any) string {
	switch t := v.(type) {
	case string:
		return fmt.Sprintf("%q", t)
	default:
		return fmt.Sprintf("%v", v)
	}
}

func provOrUnknown(p string) string {
	if p == "" {
		return "(unknown provider)"
	}
	return p
}

func modOrRoot(m string) string {
	if m == "" {
		return "(root)"
	}
	return m
}

func countsToSlice(m map[string]int) []ViewCount {
	out := make([]ViewCount, 0, len(m))
	for k, c := range m {
		out = append(out, ViewCount{Name: k, Count: c})
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Count != out[j].Count {
			return out[i].Count > out[j].Count
		}
		return out[i].Name < out[j].Name
	})
	return out
}

var identityAttrKeys = []string{"id", "arn", "name", "unique_id", "hex", "url"}

func identityFromAttrs(attrs map[string]any) (id string, keys []string) {
	if attrs == nil {
		return "", nil
	}
	for _, k := range identityAttrKeys {
		if v, ok := attrs[k]; ok && v != nil {
			switch t := v.(type) {
			case string:
				if t != "" {
					id = t
				}
			case float64:
				id = fmt.Sprintf("%v", t)
			case bool:
				id = fmt.Sprintf("%v", t)
			}
			if id != "" {
				break
			}
		}
	}
	keys = make([]string, 0, 16)
	for k := range attrs {
		lk := strings.ToLower(k)
		if strings.Contains(lk, "password") || strings.Contains(lk, "secret") ||
			strings.Contains(lk, "token") || strings.Contains(lk, "private_key") ||
			strings.Contains(lk, "access_key") {
			continue
		}
		keys = append(keys, k)
	}
	sort.Strings(keys)
	if len(keys) > 20 {
		keys = keys[:20]
	}
	return id, keys
}

func shortProvider(p string) string {
	// provider["registry.terraform.io/hashicorp/local"]
	if len(p) > 12 && p[:9] == "provider[" {
		inner := p[10:]
		if i := len(inner) - 1; i >= 0 && inner[i] == ']' {
			inner = inner[:i]
		}
		if len(inner) > 0 && inner[0] == '"' {
			inner = inner[1:]
		}
		if len(inner) > 0 && inner[len(inner)-1] == '"' {
			inner = inner[:len(inner)-1]
		}
		// Prefer short name: hashicorp/local or local
		if i := strings.LastIndex(inner, "/"); i >= 0 && i+1 < len(inner) {
			return inner[i+1:]
		}
		return inner
	}
	return p
}

func typeLabel(raw json.RawMessage) string {
	if len(raw) == 0 {
		return ""
	}
	var s string
	if err := json.Unmarshal(raw, &s); err == nil {
		return s
	}
	var arr []any
	if err := json.Unmarshal(raw, &arr); err == nil && len(arr) > 0 {
		if t, ok := arr[0].(string); ok {
			return t
		}
	}
	return string(raw)
}
