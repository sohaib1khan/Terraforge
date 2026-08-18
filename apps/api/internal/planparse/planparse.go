package planparse

import (
	"encoding/json"
)

type Summary struct {
	Added     int      `json:"added"`
	Changed   int      `json:"changed"`
	Destroyed int      `json:"destroyed"`
	Resources []string `json:"resources,omitempty"`
	HasChanges bool    `json:"has_changes"`
}

// FromShowJSON parses `terraform show -json` plan output.
func FromShowJSON(raw []byte) (Summary, error) {
	var doc struct {
		ResourceChanges []struct {
			Address string `json:"address"`
			Change  struct {
				Actions []string `json:"actions"`
			} `json:"change"`
		} `json:"resource_changes"`
	}
	if err := json.Unmarshal(raw, &doc); err != nil {
		return Summary{}, err
	}
	var s Summary
	for _, rc := range doc.ResourceChanges {
		actions := rc.Change.Actions
		if len(actions) == 0 || (len(actions) == 1 && actions[0] == "no-op") {
			continue
		}
		joined := joinActions(actions)
		switch {
		case contains(actions, "create") && contains(actions, "delete"):
			s.Changed++
			s.Resources = append(s.Resources, "~/+ "+rc.Address)
		case contains(actions, "create"):
			s.Added++
			s.Resources = append(s.Resources, "+ "+rc.Address)
		case contains(actions, "delete"):
			s.Destroyed++
			s.Resources = append(s.Resources, "- "+rc.Address)
		case contains(actions, "update"):
			s.Changed++
			s.Resources = append(s.Resources, "~ "+rc.Address)
		default:
			s.Changed++
			s.Resources = append(s.Resources, joined+" "+rc.Address)
		}
	}
	s.HasChanges = s.Added+s.Changed+s.Destroyed > 0
	if len(s.Resources) > 40 {
		s.Resources = append(s.Resources[:40], "…")
	}
	return s, nil
}

func contains(xs []string, want string) bool {
	for _, x := range xs {
		if x == want {
			return true
		}
	}
	return false
}

func joinActions(xs []string) string {
	out := ""
	for i, x := range xs {
		if i > 0 {
			out += ","
		}
		out += x
	}
	return out
}

func (s Summary) Map() map[string]any {
	return map[string]any{
		"added":       s.Added,
		"changed":     s.Changed,
		"destroyed":   s.Destroyed,
		"has_changes": s.HasChanges,
		"resources":   s.Resources,
	}
}
