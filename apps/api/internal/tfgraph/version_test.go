package tfgraph

import "testing"

func TestParseConstraintPessimistic(t *testing.T) {
	c := parseConstraint("~> 5.0")
	if c.Kind != "pessimistic" {
		t.Fatalf("kind=%s", c.Kind)
	}
	v50, _ := parseSemVer("5.0.0")
	v59, _ := parseSemVer("5.9.1")
	v60, _ := parseSemVer("6.0.0")
	if !c.Allows(v50) || !c.Allows(v59) {
		t.Fatal("expected 5.x allowed")
	}
	if c.Allows(v60) {
		t.Fatal("6.0 should not be allowed by ~> 5.0")
	}
}

func TestCompareExactBehind(t *testing.T) {
	check := compareVersions("5.1.0", "5.8.0")
	if !check.UpdateAvailable || !check.NewerOutsideConstraint {
		t.Fatalf("%+v", check)
	}
}

func TestComparePessimisticLatestInRange(t *testing.T) {
	check := compareVersions("~> 5.0", "5.84.0")
	if !check.ConstraintSatisfied {
		t.Fatalf("%+v", check)
	}
}
