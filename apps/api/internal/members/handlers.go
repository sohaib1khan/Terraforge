package members

import (
	"errors"
	"net/http"

	"github.com/google/uuid"
	"github.com/terraforge/terraforge/apps/api/internal/audit"
	"github.com/terraforge/terraforge/apps/api/internal/auth"
	"github.com/terraforge/terraforge/apps/api/internal/httpx"
)

type Handler struct {
	svc   *Service
	auth  *auth.Service
	audit *audit.Service
}

func NewHandler(svc *Service, authSvc *auth.Service, auditSvc *audit.Service) *Handler {
	return &Handler{svc: svc, auth: authSvc, audit: auditSvc}
}

func (h *Handler) Register(mux *http.ServeMux, requireAuth func(http.Handler) http.Handler) {
	mux.Handle("GET /api/namespaces/{id}/members", requireAuth(http.HandlerFunc(h.List)))
	mux.Handle("POST /api/namespaces/{id}/members", requireAuth(http.HandlerFunc(h.Add)))
	mux.Handle("PUT /api/namespaces/{id}/members/{userId}", requireAuth(http.HandlerFunc(h.Update)))
	mux.Handle("DELETE /api/namespaces/{id}/members/{userId}", requireAuth(http.HandlerFunc(h.Remove)))
}

type addRequest struct {
	Email string `json:"email"`
	Role  string `json:"role"`
}

type updateRequest struct {
	Role string `json:"role"`
}

func (h *Handler) require(w http.ResponseWriter, r *http.Request, nsID uuid.UUID, min Role) bool {
	claims := auth.UserFromContext(r.Context())
	if claims == nil {
		httpx.WriteError(w, http.StatusUnauthorized, "unauthorized")
		return false
	}
	err := h.svc.Require(r.Context(), nsID, claims.UserID, claims.IsAdmin, min)
	if errors.Is(err, ErrForbidden) || errors.Is(err, ErrNotFound) {
		httpx.WriteError(w, http.StatusForbidden, "insufficient permissions")
		return false
	}
	if err != nil {
		httpx.WriteError(w, http.StatusInternalServerError, "permission check failed")
		return false
	}
	return true
}

func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	nsID, ok := parseUUID(w, r.PathValue("id"))
	if !ok {
		return
	}
	if !h.require(w, r, nsID, RoleViewer) {
		return
	}
	items, err := h.svc.List(r.Context(), nsID)
	if err != nil {
		httpx.WriteError(w, http.StatusInternalServerError, "failed to list members")
		return
	}
	if items == nil {
		items = []Member{}
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"members": items})
}

func (h *Handler) Add(w http.ResponseWriter, r *http.Request) {
	nsID, ok := parseUUID(w, r.PathValue("id"))
	if !ok {
		return
	}
	if !h.require(w, r, nsID, RoleAdmin) {
		return
	}
	var req addRequest
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	user, err := h.auth.FindByEmail(r.Context(), req.Email)
	if err != nil {
		httpx.WriteError(w, http.StatusNotFound, "user not found — create the user in Settings first")
		return
	}
	m, err := h.svc.Upsert(r.Context(), nsID, user.ID, Role(req.Role))
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, err.Error())
		return
	}
	claims := auth.UserFromContext(r.Context())
	actor := ""
	if claims != nil {
		actor = claims.Email
	}
	h.audit.Write(r.Context(), actor, "member.add", nsID.String(), map[string]any{
		"user_id": user.ID.String(), "role": req.Role,
	})
	httpx.WriteJSON(w, http.StatusCreated, m)
}

func (h *Handler) Update(w http.ResponseWriter, r *http.Request) {
	nsID, ok := parseUUID(w, r.PathValue("id"))
	if !ok {
		return
	}
	userID, ok := parseUUID(w, r.PathValue("userId"))
	if !ok {
		return
	}
	if !h.require(w, r, nsID, RoleAdmin) {
		return
	}
	var req updateRequest
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	m, err := h.svc.Upsert(r.Context(), nsID, userID, Role(req.Role))
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, err.Error())
		return
	}
	httpx.WriteJSON(w, http.StatusOK, m)
}

func (h *Handler) Remove(w http.ResponseWriter, r *http.Request) {
	nsID, ok := parseUUID(w, r.PathValue("id"))
	if !ok {
		return
	}
	userID, ok := parseUUID(w, r.PathValue("userId"))
	if !ok {
		return
	}
	if !h.require(w, r, nsID, RoleAdmin) {
		return
	}
	if err := h.svc.Remove(r.Context(), nsID, userID); err != nil {
		if errors.Is(err, ErrNotFound) {
			httpx.WriteError(w, http.StatusNotFound, "member not found")
			return
		}
		httpx.WriteError(w, http.StatusInternalServerError, "failed to remove member")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func parseUUID(w http.ResponseWriter, raw string) (uuid.UUID, bool) {
	id, err := uuid.Parse(raw)
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid id")
		return uuid.UUID{}, false
	}
	return id, true
}
