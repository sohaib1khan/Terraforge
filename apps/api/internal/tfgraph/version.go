package tfgraph

import (
	"fmt"
	"strconv"
	"strings"
)

type SemVer struct {
	Major, Minor, Patch int
	Raw                 string
}

func parseSemVer(s string) (SemVer, bool) {
	s = strings.TrimSpace(strings.TrimPrefix(s, "v"))
	if s == "" {
		return SemVer{}, false
	}
	// strip pre-release / build
	if i := strings.IndexAny(s, "-+"); i >= 0 {
		s = s[:i]
	}
	parts := strings.Split(s, ".")
	if len(parts) < 1 || len(parts) > 3 {
		return SemVer{}, false
	}
	nums := make([]int, 3)
	for i, p := range parts {
		n, err := strconv.Atoi(p)
		if err != nil || n < 0 {
			return SemVer{}, false
		}
		nums[i] = n
	}
	return SemVer{Major: nums[0], Minor: nums[1], Patch: nums[2], Raw: s}, true
}

func (a SemVer) Less(b SemVer) bool {
	if a.Major != b.Major {
		return a.Major < b.Major
	}
	if a.Minor != b.Minor {
		return a.Minor < b.Minor
	}
	return a.Patch < b.Patch
}

func (a SemVer) Eq(b SemVer) bool {
	return a.Major == b.Major && a.Minor == b.Minor && a.Patch == b.Patch
}

func (a SemVer) String() string {
	if a.Raw != "" {
		return a.Raw
	}
	return fmt.Sprintf("%d.%d.%d", a.Major, a.Minor, a.Patch)
}

// Constraint is a simplified Terraform version constraint.
type Constraint struct {
	Raw      string
	Kind     string // exact | pessimistic | gte | unknown
	Base     SemVer
	UpperMaj int // for ~> X.Y → < (X+1).0.0 ; for ~> X.Y.Z → < X.(Y+1).0
	UpperMin int
	HasUpper bool
}

func parseConstraint(raw string) Constraint {
	raw = strings.TrimSpace(raw)
	c := Constraint{Raw: raw, Kind: "unknown"}
	if raw == "" {
		return c
	}
	// take first clause if comma-separated
	first := strings.TrimSpace(strings.Split(raw, ",")[0])
	switch {
	case strings.HasPrefix(first, "~>"):
		v, ok := parseSemVer(strings.TrimSpace(strings.TrimPrefix(first, "~>")))
		if !ok {
			return c
		}
		c.Kind = "pessimistic"
		c.Base = v
		c.HasUpper = true
		// ~> 5.0 or ~> 5.0.0 → < 6.0.0 ; ~> 5.1 → < 5.2.0
		parts := strings.Split(strings.TrimPrefix(strings.TrimSpace(strings.TrimPrefix(first, "~>")), "v"), ".")
		if len(parts) >= 3 {
			c.UpperMaj = v.Major
			c.UpperMin = v.Minor + 1
		} else {
			c.UpperMaj = v.Major + 1
			c.UpperMin = 0
		}
		return c
	case strings.HasPrefix(first, ">="):
		v, ok := parseSemVer(strings.TrimSpace(strings.TrimPrefix(first, ">=")))
		if !ok {
			return c
		}
		c.Kind = "gte"
		c.Base = v
		return c
	case strings.HasPrefix(first, "="):
		v, ok := parseSemVer(strings.TrimSpace(strings.TrimPrefix(first, "=")))
		if !ok {
			return c
		}
		c.Kind = "exact"
		c.Base = v
		return c
	default:
		// bare version → treat as exact pin
		if v, ok := parseSemVer(first); ok {
			c.Kind = "exact"
			c.Base = v
			return c
		}
	}
	return c
}

func (c Constraint) Allows(v SemVer) bool {
	switch c.Kind {
	case "exact":
		return c.Base.Eq(v)
	case "gte":
		return !v.Less(c.Base)
	case "pessimistic":
		if v.Less(c.Base) {
			return false
		}
		if !c.HasUpper {
			return true
		}
		upper := SemVer{Major: c.UpperMaj, Minor: c.UpperMin, Patch: 0}
		return v.Less(upper)
	default:
		return true
	}
}

type VersionCheck struct {
	UpdateAvailable     bool
	NewerOutsideConstraint bool
	ConstraintSatisfied bool
	Message             string
}

func compareVersions(constraintRaw, latestRaw string) VersionCheck {
	latest, ok := parseSemVer(latestRaw)
	if !ok {
		return VersionCheck{Message: "Could not parse latest version from registry"}
	}
	c := parseConstraint(constraintRaw)
	if c.Kind == "unknown" || constraintRaw == "" {
		return VersionCheck{
			UpdateAvailable:     true,
			ConstraintSatisfied: true,
			Message:             fmt.Sprintf("Registry latest is %s (no version pinned in config)", latest),
		}
	}
	if c.Kind == "exact" {
		if c.Base.Eq(latest) {
			return VersionCheck{
				ConstraintSatisfied: true,
				Message:             fmt.Sprintf("Pinned at latest (%s)", latest),
			}
		}
		if c.Base.Less(latest) {
			return VersionCheck{
				UpdateAvailable:        true,
				NewerOutsideConstraint: true,
				ConstraintSatisfied:    false,
				Message:                fmt.Sprintf("Pinned %s — latest is %s", c.Base, latest),
			}
		}
		return VersionCheck{
			ConstraintSatisfied: true,
			Message:             fmt.Sprintf("Pinned %s (newer than registry latest %s?)", c.Base, latest),
		}
	}
	allows := c.Allows(latest)
	if allows {
		// still may want to note latest within range
		return VersionCheck{
			UpdateAvailable:     true, // soft: newer exists within or as latest matching
			ConstraintSatisfied: true,
			Message:             fmt.Sprintf("Constraint %s — latest matching release %s", c.Raw, latest),
		}
	}
	return VersionCheck{
		UpdateAvailable:        true,
		NewerOutsideConstraint: true,
		ConstraintSatisfied:    false,
		Message:                fmt.Sprintf("Constraint %s does not include latest %s — consider bumping", c.Raw, latest),
	}
}
