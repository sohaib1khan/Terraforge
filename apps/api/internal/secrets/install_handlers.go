package secrets

import (
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/terraforge/terraforge/apps/api/internal/auth"
	"github.com/terraforge/terraforge/apps/api/internal/httpx"
	"github.com/terraforge/terraforge/apps/api/internal/members"
)

// RegisterConnectPublic mounts unauthenticated install redemption (code is the secret).
func (h *Handler) RegisterConnectPublic(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/connect/install/{code}", h.InstallScript)
	mux.HandleFunc("GET /api/connect/install/{code}/pack.tar.gz", h.InstallTarball)
}

func (h *Handler) CreateInstallCommand(w http.ResponseWriter, r *http.Request) {
	nsID, ok := parseID(w, r.PathValue("id"))
	if !ok {
		return
	}
	if !h.gate.Require(w, r, nsID, members.RoleWriter) {
		return
	}
	if _, err := h.ns.Get(r.Context(), nsID); err != nil {
		httpx.WriteError(w, http.StatusNotFound, "namespace not found")
		return
	}
	claims := auth.UserFromContext(r.Context())
	var createdBy *uuid.UUID
	actor := "unknown"
	if claims != nil {
		actor = claims.Email
		if claims.UserID != uuid.Nil {
			id := claims.UserID
			createdBy = &id
		}
	}
	code, err := h.svc.CreateInstallCode(r.Context(), nsID, createdBy)
	if err != nil {
		httpx.WriteError(w, http.StatusInternalServerError, "failed to create install code")
		return
	}
	base := publicOrigin(r)
	curl := fmt.Sprintf(`curl -fsSL %q | sh`, base+"/api/connect/install/"+code.Code)
	wget := fmt.Sprintf(`wget -qO- %q | sh`, base+"/api/connect/install/"+code.Code)
	code.Curl = curl

	h.audit.Write(r.Context(), actor, "connect_install.create", nsID.String(), map[string]any{
		"expires_at": code.ExpiresAt.UTC().Format(time.RFC3339),
	})

	httpx.WriteJSON(w, http.StatusCreated, map[string]any{
		"code":       code.Code,
		"expires_at": code.ExpiresAt,
		"curl":       curl,
		"wget":       wget,
		"note":       "One-time code. Run from your Terraform project root within 15 minutes. Do not share.",
	})
}

func (h *Handler) InstallScript(w http.ResponseWriter, r *http.Request) {
	code := strings.TrimSpace(r.PathValue("code"))
	nsID, createdBy, err := h.svc.ConsumeInstallCode(r.Context(), code)
	if err != nil {
		httpx.WriteError(w, http.StatusUnauthorized, "invalid, expired, or already-used install code")
		return
	}
	pack, err := h.buildConnectFiles(r, nsID, createdBy)
	if err != nil {
		httpx.WriteError(w, http.StatusInternalServerError, "failed to build connect files")
		return
	}

	h.audit.Write(r.Context(), "install-code", "connect_install.redeem", nsID.String(), map[string]any{
		"via": "shell",
	})

	script := buildInstallShell(pack)
	w.Header().Set("Content-Type", "text/x-shellscript; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(script))
}

func (h *Handler) InstallTarball(w http.ResponseWriter, r *http.Request) {
	code := strings.TrimSpace(r.PathValue("code"))
	nsID, createdBy, err := h.svc.ConsumeInstallCode(r.Context(), code)
	if err != nil {
		httpx.WriteError(w, http.StatusUnauthorized, "invalid, expired, or already-used install code")
		return
	}
	pack, err := h.buildConnectFiles(r, nsID, createdBy)
	if err != nil {
		httpx.WriteError(w, http.StatusInternalServerError, "failed to build connect files")
		return
	}
	h.audit.Write(r.Context(), "install-code", "connect_install.redeem", nsID.String(), map[string]any{
		"via": "tarball",
	})
	body, err := packTarGz(pack)
	if err != nil {
		httpx.WriteError(w, http.StatusInternalServerError, "failed to build archive")
		return
	}
	w.Header().Set("Content-Type", "application/gzip")
	w.Header().Set("Content-Disposition", `attachment; filename="terraforge-connect.tar.gz"`)
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(body)
}

type connectFiles struct {
	APIBase       string
	Namespace     string
	BackendStubTF string
	BackendHCL    string
	ConfigYAML    string
	ConnectMD     string
	SyncSH        string
	PullSH        string
	BackendID     string
	CLIID         string
	Expires       time.Time
}

func (h *Handler) buildConnectFiles(r *http.Request, nsID uuid.UUID, createdBy *uuid.UUID) (connectFiles, error) {
	const packLabel = "connect-pack"
	_ = h.svc.RevokeBackendTokensByLabel(r.Context(), nsID, packLabel)
	_ = h.svc.RevokeCLITokensByLabel(r.Context(), nsID, packLabel)

	backend, err := h.svc.CreateBackendToken(r.Context(), nsID, packLabel)
	if err != nil {
		return connectFiles{}, err
	}
	cli, err := h.svc.CreateCLIToken(r.Context(), nsID, packLabel, createdBy)
	if err != nil {
		return connectFiles{}, err
	}

	apiBase := publicOrigin(r)
	stateURL := strings.TrimRight(apiBase, "/") + "/api/state/" + nsID.String()

	// Root stub only declares backend type — credentials live in terraforge_connect/.
	backendStub := `# Terraforge remote state (generated).
# Disconnect:  rm -rf terraforge_connect terraforge_connect.tf
terraform {
  backend "http" {}
}
`

	backendHCL := fmt.Sprintf(`address        = %q
lock_address   = %q
unlock_address = %q
username       = "terraforge"
password       = %q
`, stateURL, stateURL, stateURL, backend.Token)

	configYAML := fmt.Sprintf(`# Terraforge companion CLI config (do not commit)
api_url: %s
token: %s
namespace_id: %s
`, apiBase, cli.Token, nsID.String())

	syncSH := syncScript(cli.Token, apiBase, nsID.String())
	pullSH := pullScript(cli.Token, apiBase, nsID.String())

	connectMD := fmt.Sprintf(`# Terraforge connect

API: %s
Namespace: %s

## Next

    terraform init -reconfigure -backend-config=terraforge_connect/backend.hcl
    terraform plan

## Disconnect (delete everything)

    rm -rf terraforge_connect terraforge_connect.tf

## Companion CLI (optional)

Build from the Terraforge repo (bin/terraforge), then:

    terraforge doctor
    terraforge plan

CLI token expires: %s

## Keep local ↔ dashboard in sync

The HTTP backend only syncs *state*. Your .tf files stay on this machine unless
you push them, and the dashboard's config map, in-app runs and drift checks all
read the pushed copy. No extra tooling needed:

    sh terraforge_connect/sync.sh    # push local .tf → Terraforge
    sh terraforge_connect/pull.sh    # pull Terraforge → local (overwrites)

Run sync.sh again after editing locally. State files are never uploaded.

## Companion CLI extras (optional)

    terraforge status          # checklist + digests
    terraforge watch           # auto bi-directional (leave running)
`, apiBase, nsID.String(), cli.ExpiresAt.UTC().Format(time.RFC3339))

	return connectFiles{
		APIBase:       apiBase,
		Namespace:     nsID.String(),
		BackendStubTF: backendStub,
		BackendHCL:    backendHCL,
		ConfigYAML:    configYAML,
		ConnectMD:     connectMD,
		SyncSH:        syncSH,
		PullSH:        pullSH,
		BackendID:     backend.ID.String(),
		CLIID:         cli.ID.String(),
		Expires:       cli.ExpiresAt,
	}, nil
}

// syncScript pushes local config up. The HTTP backend only carries state, so
// without this the dashboard's config map, in-app runs and drift checks stay
// empty even though state is flowing. Kept as plain sh + curl so it works with
// no Go toolchain installed.
func syncScript(token, apiBase, nsID string) string {
	return fmt.Sprintf(`#!/bin/sh
# Push this project's Terraform config to Terraforge.
# The dashboard then shows the same files you edit locally.
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$root"
tar czf - \
  --exclude=./.git \
  --exclude=./.terraform \
  --exclude=./terraforge_connect \
  --exclude='*.tfstate' \
  --exclude='*.tfstate.backup' \
  . | curl -fsS -X POST \
    -H "Authorization: Bearer %s" \
    -H 'Content-Type: application/gzip' \
    --data-binary @- \
    "%s/api/namespaces/%s/import?message=sync+from+local"
echo
echo "==> pushed local config to Terraforge"
`, token, strings.TrimRight(apiBase, "/"), nsID)
}

// pullScript brings dashboard edits back down into the working directory.
func pullScript(token, apiBase, nsID string) string {
	return fmt.Sprintf(`#!/bin/sh
# Pull Terraform config from Terraforge into this folder.
# Overwrites local files with the dashboard's copy — commit or stash first.
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$root"
tmp=$(mktemp)
curl -fsS -H "Authorization: Bearer %s" \
  "%s/api/namespaces/%s/config-export" -o "$tmp"
tar xzf "$tmp"
rm -f "$tmp"
echo "==> pulled Terraforge config into $root"
`, token, strings.TrimRight(apiBase, "/"), nsID)
}

func buildInstallShell(p connectFiles) string {
	// Quoted heredocs so tokens/special chars are not expanded by the shell.
	var b strings.Builder
	b.WriteString("#!/bin/sh\n")
	b.WriteString("set -eu\n")
	b.WriteString("echo '==> Terraforge: writing terraforge_connect/ (easy to delete)'\n")
	b.WriteString("mkdir -p terraforge_connect\n")
	writeHeredoc(&b, "terraforge_connect.tf", "TERRAFORGE_STUB_EOF", p.BackendStubTF)
	writeHeredoc(&b, "terraforge_connect/backend.hcl", "TERRAFORGE_BACKEND_EOF", p.BackendHCL)
	writeHeredoc(&b, "terraforge_connect/config.yaml", "TERRAFORGE_CONFIG_EOF", p.ConfigYAML)
	writeHeredoc(&b, "terraforge_connect/README.md", "TERRAFORGE_MD_EOF", p.ConnectMD)
	writeHeredoc(&b, "terraforge_connect/sync.sh", "TERRAFORGE_SYNC_EOF", p.SyncSH)
	writeHeredoc(&b, "terraforge_connect/pull.sh", "TERRAFORGE_PULL_EOF", p.PullSH)
	b.WriteString("printf '*\\n' > terraforge_connect/.gitignore\n")
	b.WriteString("chmod 600 terraforge_connect/backend.hcl terraforge_connect/config.yaml\n")
	b.WriteString("chmod 700 terraforge_connect/sync.sh terraforge_connect/pull.sh\n")
	// State travels over the backend; config only arrives if we push it, so do
	// that once now to leave the dashboard mirroring the project immediately.
	b.WriteString("echo '==> Pushing this project'\\''s .tf files so the dashboard mirrors it'\n")
	b.WriteString("sh terraforge_connect/sync.sh || echo '==> Config push skipped (no .tf files yet, or API unreachable)'\n")
	b.WriteString("echo '==> Done. Next:'\n")
	b.WriteString("echo '    terraform init -reconfigure -backend-config=terraforge_connect/backend.hcl'\n")
	b.WriteString("echo '    terraform plan'\n")
	b.WriteString("echo '==> After editing .tf files locally, re-sync the dashboard:'\n")
	b.WriteString("echo '    sh terraforge_connect/sync.sh'\n")
	b.WriteString("echo '==> Disconnect later:'\n")
	b.WriteString("echo '    rm -rf terraforge_connect terraforge_connect.tf'\n")
	b.WriteString("echo \"==> API: " + shellSingleQuote(p.APIBase) + "\"\n")
	return b.String()
}

func writeHeredoc(b *strings.Builder, path, marker, body string) {
	b.WriteString("cat > " + path + " <<'" + marker + "'\n")
	b.WriteString(body)
	if !strings.HasSuffix(body, "\n") {
		b.WriteByte('\n')
	}
	b.WriteString(marker + "\n")
}

func shellSingleQuote(s string) string {
	return strings.ReplaceAll(s, "'", `'"'"'`)
}
