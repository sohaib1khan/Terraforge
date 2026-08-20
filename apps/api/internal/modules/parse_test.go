package modules

import "testing"

func TestParseSearchProviderVsName(t *testing.T) {
	ns, name, prov := parseSearch("aws")
	if ns != "" || name != "" || prov != "aws" {
		t.Fatalf("aws => got ns=%q name=%q prov=%q", ns, name, prov)
	}
	ns, name, prov = parseSearch("vpc")
	if name != "vpc" || prov != "" {
		t.Fatalf("vpc => got name=%q prov=%q", name, prov)
	}
	ns, name, prov = parseSearch("aws vpc")
	if name != "vpc" || prov != "aws" {
		t.Fatalf("aws vpc => got name=%q prov=%q", name, prov)
	}
	ns, name, prov = parseSearch("azure")
	if prov != "azurerm" {
		t.Fatalf("azure => got prov=%q", prov)
	}
}
