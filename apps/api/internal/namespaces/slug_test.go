package namespaces

import "testing"

func TestSlugify(t *testing.T) {
	cases := map[string]string{
		"My App":           "my-app",
		"  Hello___World ": "hello-world",
		"!!!":              "namespace",
	}
	for in, want := range cases {
		if got := slugify(in); got != want {
			t.Fatalf("slugify(%q)=%q want %q", in, got, want)
		}
	}
}

func TestValidateTerraformVersion(t *testing.T) {
	if err := validateTerraformVersion("1.9.0"); err != nil {
		t.Fatal(err)
	}
	if err := validateTerraformVersion("latest"); err == nil {
		t.Fatal("expected invalid version")
	}
}
