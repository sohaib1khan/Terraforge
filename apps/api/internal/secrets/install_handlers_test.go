package secrets

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

// shellParses runs `sh -n` so quoting/heredoc mistakes fail here rather than on
// a developer's machine mid-connect.
func shellParses(t *testing.T, name, body string) {
	t.Helper()
	if _, err := exec.LookPath("sh"); err != nil {
		t.Skip("sh not available")
	}
	path := filepath.Join(t.TempDir(), name)
	if err := os.WriteFile(path, []byte(body), 0o700); err != nil {
		t.Fatalf("write %s: %v", name, err)
	}
	out, err := exec.Command("sh", "-n", path).CombinedOutput()
	if err != nil {
		t.Fatalf("%s is not valid sh: %v\n%s\n---\n%s", name, err, out, body)
	}
}

func TestConnectScriptsAreValidShell(t *testing.T) {
	const (
		token  = "tfc_test_token_value"
		api    = "http://192.168.1.76:3000/"
		nsID   = "b34f1915-ceb4-42bc-97cf-bc1ed069191d"
		single = "it's quoted"
	)

	sync := syncScript(token, api, nsID)
	pull := pullScript(token, api, nsID)
	shellParses(t, "sync.sh", sync)
	shellParses(t, "pull.sh", pull)

	// Trailing slash must not produce a double slash in the URL.
	if strings.Contains(sync, "3000//api") || strings.Contains(pull, "3000//api") {
		t.Error("api base trailing slash leaked into the URL")
	}
	if !strings.Contains(sync, "/api/namespaces/"+nsID+"/import") {
		t.Error("sync script missing import endpoint")
	}
	if !strings.Contains(pull, "/api/namespaces/"+nsID+"/config-export") {
		t.Error("pull script missing export endpoint")
	}
	// State must never be uploaded, even if it sits in the project root.
	for _, want := range []string{"*.tfstate", "./.terraform", "./terraforge_connect"} {
		if !strings.Contains(sync, want) {
			t.Errorf("sync script does not exclude %s", want)
		}
	}

	installer := buildInstallShell(connectFiles{
		APIBase:       api,
		Namespace:     nsID,
		BackendStubTF: "terraform {\n  backend \"http\" {}\n}\n",
		BackendHCL:    "password = \"" + token + "\"\n",
		ConfigYAML:    "token: " + token + "\n",
		ConnectMD:     "# readme\n" + single + "\n",
		SyncSH:        sync,
		PullSH:        pull,
	})
	shellParses(t, "install.sh", installer)

	for _, want := range []string{
		"terraforge_connect/sync.sh",
		"terraforge_connect/pull.sh",
		"chmod 700",
	} {
		if !strings.Contains(installer, want) {
			t.Errorf("installer missing %q", want)
		}
	}
}
