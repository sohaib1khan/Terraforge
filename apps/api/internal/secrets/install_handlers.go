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

    terraforge status          # checklist + digests
    terraforge sync            # push local → Terraforge
    terraforge pull            # pull Terraforge → local
    terraforge watch           # auto bi-directional (leave running)

When you edit in the web UI, watch pulls changes to this folder automatically.
`, apiBase, nsID.String(), cli.ExpiresAt.UTC().Format(time.RFC3339))

	return connectFiles{
		APIBase:       apiBase,
		Namespace:     nsID.String(),
		BackendStubTF: backendStub,
		BackendHCL:    backendHCL,
		ConfigYAML:    configYAML,
		ConnectMD:     connectMD,
		BackendID:     backend.ID.String(),
		CLIID:         cli.ID.String(),
		Expires:       cli.ExpiresAt,
	}, nil
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
	b.WriteString("printf '*\\n' > terraforge_connect/.gitignore\n")
	b.WriteString("chmod 600 terraforge_connect/backend.hcl terraforge_connect/config.yaml\n")
	b.WriteString("echo '==> Done. Next:'\n")
	b.WriteString("echo '    terraform init -reconfigure -backend-config=terraforge_connect/backend.hcl'\n")
	b.WriteString("echo '    terraform plan'\n")
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
