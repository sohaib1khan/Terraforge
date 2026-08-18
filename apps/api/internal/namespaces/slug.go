package namespaces

import (
	"fmt"
	"regexp"
	"strings"
	"unicode"
)

var (
	slugCleanup = regexp.MustCompile(`[^a-z0-9]+`)
	slugTrim    = regexp.MustCompile(`^-+|-+$`)
)

func slugify(name string) string {
	s := strings.ToLower(strings.TrimSpace(name))
	s = slugCleanup.ReplaceAllString(s, "-")
	s = slugTrim.ReplaceAllString(s, "")
	if s == "" {
		return "namespace"
	}
	if len(s) > 64 {
		s = s[:64]
		s = slugTrim.ReplaceAllString(s, "")
	}
	return s
}

func validateName(name string) error {
	name = strings.TrimSpace(name)
	if name == "" {
		return fmt.Errorf("%w: name is required", ErrValidation)
	}
	if len(name) > 100 {
		return fmt.Errorf("%w: name must be at most 100 characters", ErrValidation)
	}
	for _, r := range name {
		if unicode.IsControl(r) {
			return fmt.Errorf("%w: name contains invalid characters", ErrValidation)
		}
	}
	return nil
}

func validateSlug(slug string) error {
	if slug == "" {
		return fmt.Errorf("%w: slug is required", ErrValidation)
	}
	if len(slug) > 64 {
		return fmt.Errorf("%w: slug must be at most 64 characters", ErrValidation)
	}
	matched, _ := regexp.MatchString(`^[a-z0-9]+(?:-[a-z0-9]+)*$`, slug)
	if !matched {
		return fmt.Errorf("%w: slug must be lowercase alphanumeric with hyphens", ErrValidation)
	}
	return nil
}

func validateTerraformVersion(v string) error {
	if v == "" {
		return nil
	}
	matched, _ := regexp.MatchString(`^[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9.]+)?$`, v)
	if !matched {
		return fmt.Errorf("%w: terraform_version must look like X.Y.Z", ErrValidation)
	}
	return nil
}
