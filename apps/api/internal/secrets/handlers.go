package secrets

import (
	"errors"
	"net/http"
	"strings"

	"github.com/google/uuid"
	"github.com/terraforge/terraforge/apps/api/internal/access"
	"github.com/terraforge/terraforge/apps/api/internal/audit"
	"github.com/terraforge/terraforge/apps/api/internal/auth"
	"github.com/terraforge/terraforge/apps/api/internal/httpx"
	"github.com/terraforge/terraforge/apps/api/internal/members"
	"github.com/terraforge/terraforge/apps/api/internal/namespaces"
)

type Handler struct {
	svc   *Service
	ns    *namespaces.Service
	gate  *access.Checker
	audit *audit.Service
}

func NewHandler(svc *Service, ns *namespaces.Service, gate *access.Checker, auditSvc *audit.Service) *Handler {
	return &Handler{svc: svc, ns: ns, gate: gate, audit: auditSvc}
}

type createTokenRequest struct {
	Label string `json:"label"`
}

type upsertSecretRequest struct {
	Key   string `json:"key"`
	Value string `json:"value"`
}

func (h *Handler) ListTokens(w http.ResponseWriter, r *http.Request) {
	nsID, ok := parseID(w, r.PathValue("id"))
	if !ok {
		return
	}
	if !h.gate.Require(w, r, nsID, members.RoleWriter) {
		return
	}
	tokens, err := h.svc.ListBackendTokens(r.Context(), nsID)
	if err != nil {
		httpx.WriteError(w, http.StatusInternalServerError, "failed to list tokens")
		return
	}
	if tokens == nil {
		tokens = []BackendToken{}
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"tokens": tokens})
}

func (h *Handler) CreateToken(w http.ResponseWriter, r *http.Request) {
	nsID, ok := parseID(w, r.PathValue("id"))
	if !ok {
		return
	}
	if !h.gate.Require(w, r, nsID, members.RoleAdmin) {
		return
	}
	if _, err := h.ns.Get(r.Context(), nsID); err != nil {
		if errors.Is(err, namespaces.ErrNotFound) {
			httpx.WriteError(w, http.StatusNotFound, "namespace not found")
			return
		}
		httpx.WriteError(w, http.StatusInternalServerError, "namespace lookup failed")
		return
	}
	var req createTokenRequest
	if r.ContentLength > 0 {
		if err := httpx.DecodeJSON(r, &req); err != nil {
			httpx.WriteError(w, http.StatusBadRequest, "invalid JSON body")
			return
		}
	}
	token, err := h.svc.CreateBackendToken(r.Context(), nsID, req.Label)
	if err != nil {
		httpx.WriteError(w, http.StatusInternalServerError, "failed to create token")
		return
	}
	claims := auth.UserFromContext(r.Context())
	actor := ""
	if claims != nil {
		actor = claims.Email
	}
	h.audit.Write(r.Context(), actor, "backend_token.create", nsID.String(), map[string]any{
		"token_id": token.ID.String(),
	})
	httpx.WriteJSON(w, http.StatusCreated, token)
}

func (h *Handler) RevokeToken(w http.ResponseWriter, r *http.Request) {
	nsID, ok := parseID(w, r.PathValue("id"))
	if !ok {
		return
	}
	tokenID, ok := parseID(w, r.PathValue("tokenId"))
	if !ok {
		return
	}
	if !h.gate.Require(w, r, nsID, members.RoleAdmin) {
		return
	}
	if err := h.svc.RevokeBackendToken(r.Context(), nsID, tokenID); err != nil {
		if errors.Is(err, ErrNotFound) {
			httpx.WriteError(w, http.StatusNotFound, "token not found")
			return
		}
		httpx.WriteError(w, http.StatusInternalServerError, "failed to revoke token")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) ListSecrets(w http.ResponseWriter, r *http.Request) {
	nsID, ok := parseID(w, r.PathValue("id"))
	if !ok {
		return
	}
	if !h.gate.Require(w, r, nsID, members.RoleAdmin) {
		return
	}
	items, err := h.svc.List(r.Context(), nsID)
	if err != nil {
		httpx.WriteError(w, http.StatusInternalServerError, "failed to list secrets")
		return
	}
	if items == nil {
		items = []NamespaceSecret{}
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"secrets": items})
}

func (h *Handler) UpsertSecret(w http.ResponseWriter, r *http.Request) {
	nsID, ok := parseID(w, r.PathValue("id"))
	if !ok {
		return
	}
	if !h.gate.Require(w, r, nsID, members.RoleAdmin) {
		return
	}
	var req upsertSecretRequest
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	sec, err := h.svc.Upsert(r.Context(), nsID, req.Key, req.Value)
	if err != nil {
		if errors.Is(err, ErrBadKey) || strings.Contains(err.Error(), "invalid secret key") {
			httpx.WriteError(w, http.StatusBadRequest, err.Error())
			return
		}
		httpx.WriteError(w, http.StatusInternalServerError, "failed to save secret")
		return
	}
	claims := auth.UserFromContext(r.Context())
	actor := ""
	if claims != nil {
		actor = claims.Email
	}
	h.audit.Write(r.Context(), actor, "secret.upsert", nsID.String(), map[string]any{
		"key": sec.Key,
	})
	httpx.WriteJSON(w, http.StatusOK, sec)
}

func (h *Handler) DeleteSecret(w http.ResponseWriter, r *http.Request) {
	nsID, ok := parseID(w, r.PathValue("id"))
	if !ok {
		return
	}
	secretID, ok := parseID(w, r.PathValue("secretId"))
	if !ok {
		return
	}
	if !h.gate.Require(w, r, nsID, members.RoleAdmin) {
		return
	}
	if err := h.svc.Delete(r.Context(), nsID, secretID); err != nil {
		if errors.Is(err, ErrSecretNotFound) {
			httpx.WriteError(w, http.StatusNotFound, "secret not found")
			return
		}
		httpx.WriteError(w, http.StatusInternalServerError, "failed to delete secret")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func parseID(w http.ResponseWriter, raw string) (uuid.UUID, bool) {
	id, err := uuid.Parse(raw)
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid id")
		return uuid.UUID{}, false
	}
	return id, true
}
