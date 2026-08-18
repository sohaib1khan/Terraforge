package secrets

import (
	"archive/zip"
	"bytes"
	"fmt"
	"net/http"
	"os"
	"strings"

	"github.com/google/uuid"
	"github.com/terraforge/terraforge/apps/api/internal/auth"
	"github.com/terraforge/terraforge/apps/api/internal/httpx"
	"github.com/terraforge/terraforge/apps/api/internal/members"
)

func (h *Handler) Register(mux *http.ServeMux, requireAuth func(http.Handler) http.Handler) {
	mux.Handle("GET /api/namespaces/{id}/backend-tokens", requireAuth(http.HandlerFunc(h.ListTokens)))
	mux.Handle("POST /api/namespaces/{id}/backend-tokens", requireAuth(http.HandlerFunc(h.CreateToken)))
	mux.Handle("DELETE /api/namespaces/{id}/backend-tokens/{tokenId}", requireAuth(http.HandlerFunc(h.RevokeToken)))

	mux.Handle("GET /api/namespaces/{id}/cli-tokens", requireAuth(http.HandlerFunc(h.ListCLITokens)))
	mux.Handle("DELETE /api/namespaces/{id}/cli-tokens/{tokenId}", requireAuth(http.HandlerFunc(h.RevokeCLIToken)))
	mux.Handle("POST /api/namespaces/{id}/connect-pack", requireAuth(http.HandlerFunc(h.ConnectPack)))
	mux.Handle("POST /api/namespaces/{id}/connect-install", requireAuth(http.HandlerFunc(h.CreateInstallCommand)))

	mux.Handle("GET /api/namespaces/{id}/secrets", requireAuth(http.HandlerFunc(h.ListSecrets)))
	mux.Handle("PUT /api/namespaces/{id}/secrets", requireAuth(http.HandlerFunc(h.UpsertSecret)))
	mux.Handle("DELETE /api/namespaces/{id}/secrets/{secretId}", requireAuth(http.HandlerFunc(h.DeleteSecret)))
}

func (h *Handler) ListCLITokens(w http.ResponseWriter, r *http.Request) {
	nsID, ok := parseID(w, r.PathValue("id"))
	if !ok {
		return
	}
	if !h.gate.Require(w, r, nsID, members.RoleWriter) {
		return
	}
	tokens, err := h.svc.ListCLITokens(r.Context(), nsID)
	if err != nil {
		httpx.WriteError(w, http.StatusInternalServerError, "failed to list CLI tokens")
		return
	}
	if tokens == nil {
		tokens = []CLIToken{}
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"tokens": tokens})
}

func (h *Handler) RevokeCLIToken(w http.ResponseWriter, r *http.Request) {
	nsID, ok := parseID(w, r.PathValue("id"))
	if !ok {
		return
	}
	tokenID, ok := parseID(w, r.PathValue("tokenId"))
	if !ok {
		return
	}
	if !h.gate.Require(w, r, nsID, members.RoleWriter) {
		return
	}
	if err := h.svc.RevokeCLIToken(r.Context(), nsID, tokenID); err != nil {
		if err == ErrNotFound {
			httpx.WriteError(w, http.StatusNotFound, "token not found")
			return
		}
		httpx.WriteError(w, http.StatusInternalServerError, "failed to revoke token")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) CLICheck(w http.ResponseWriter, r *http.Request) {
	nsID, ok := parseID(w, r.PathValue("id"))
	if !ok {
		return
	}
	if !h.gate.Require(w, r, nsID, members.RoleWriter) {
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{
		"ok":           true,
		"namespace_id": nsID.String(),
		"cli_token":    auth.CLIFromContext(r.Context()) != nil,
	})
}

func (h *Handler) ConnectPack(w http.ResponseWriter, r *http.Request) {
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

	pack, err := h.buildConnectFiles(r, nsID, createdBy)
	if err != nil {
		httpx.WriteError(w, http.StatusInternalServerError, "failed to create connect pack")
		return
	}

	buf := new(bytes.Buffer)
	zw := zip.NewWriter(buf)
	files := connectPackFileMap(pack)
	for name, body := range files {
		wtr, err := zw.Create(name)
		if err != nil {
			httpx.WriteError(w, http.StatusInternalServerError, "failed to build pack")
			return
		}
		if _, err := wtr.Write([]byte(body)); err != nil {
			httpx.WriteError(w, http.StatusInternalServerError, "failed to build pack")
			return
		}
	}
	if err := zw.Close(); err != nil {
		httpx.WriteError(w, http.StatusInternalServerError, "failed to build pack")
		return
	}

	h.audit.Write(r.Context(), actor, "connect_pack.create", nsID.String(), map[string]any{
		"backend_token_id": pack.BackendID,
		"cli_token_id":     pack.CLIID,
		"api_base":         pack.APIBase,
	})

	filename := fmt.Sprintf("terraforge-connect-%s.zip", nsID.String()[:8])
	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, filename))
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(buf.Bytes())
}

func publicOrigin(r *http.Request) string {
	proto := strings.TrimSpace(r.Header.Get("X-Forwarded-Proto"))
	if proto == "" {
		if r.TLS != nil {
			proto = "https"
		} else {
			proto = "http"
		}
	}
	host := strings.TrimSpace(r.Header.Get("X-Forwarded-Host"))
	if host == "" {
		host = strings.TrimSpace(r.Host)
	}
	if host == "" {
		host = "localhost"
		if p := strings.TrimSpace(os.Getenv("APP_PORT")); p != "" && p != "80" && p != "443" {
			host = "localhost:" + p
		} else {
			host = "localhost:3000"
		}
	}
	return proto + "://" + host
}
