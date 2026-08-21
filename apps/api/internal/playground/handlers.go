package playground

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
	svc     *Service
	ns      *namespaces.Service
	members *members.Service
	audit   *audit.Service
	gate    *access.Checker
}

func NewHandler(
	svc *Service,
	ns *namespaces.Service,
	membersSvc *members.Service,
	auditSvc *audit.Service,
	gate *access.Checker,
) *Handler {
	return &Handler{svc: svc, ns: ns, members: membersSvc, audit: auditSvc, gate: gate}
}

func (h *Handler) Register(mux *http.ServeMux, requireAuth func(http.Handler) http.Handler) {
	mux.Handle("GET /api/playground/templates", requireAuth(http.HandlerFunc(h.List)))
	mux.Handle("POST /api/playground/templates", requireAuth(http.HandlerFunc(h.Create)))
	mux.Handle("GET /api/playground/templates/{id}", requireAuth(http.HandlerFunc(h.Get)))
	mux.Handle("PATCH /api/playground/templates/{id}", requireAuth(http.HandlerFunc(h.Update)))
	mux.Handle("DELETE /api/playground/templates/{id}", requireAuth(http.HandlerFunc(h.Delete)))
	mux.Handle("POST /api/playground/templates/{id}/launch", requireAuth(http.HandlerFunc(h.Launch)))
	// Separate path prefix so it does not conflict with {id}/launch in ServeMux.
	mux.Handle("POST /api/playground/namespaces/{namespaceId}/save-template", requireAuth(http.HandlerFunc(h.SnapshotFromNamespace)))
}

func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	claims := auth.UserFromContext(r.Context())
	if claims == nil {
		httpx.WriteError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	items, err := h.svc.List(r.Context(), claims.UserID)
	if err != nil {
		httpx.WriteError(w, http.StatusInternalServerError, "failed to list playground templates")
		return
	}
	if items == nil {
		items = []Template{}
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"templates": items})
}

func (h *Handler) Get(w http.ResponseWriter, r *http.Request) {
	claims := auth.UserFromContext(r.Context())
	if claims == nil {
		httpx.WriteError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid template id")
		return
	}
	t, err := h.svc.Get(r.Context(), id, claims.UserID)
	if err != nil {
		writeErr(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, t)
}

func (h *Handler) Create(w http.ResponseWriter, r *http.Request) {
	claims := auth.UserFromContext(r.Context())
	if claims == nil {
		httpx.WriteError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	var req struct {
		Name              string            `json:"name"`
		Description       string            `json:"description"`
		Files             map[string]string `json:"files"`
		SourceNamespaceID *uuid.UUID        `json:"source_namespace_id"`
	}
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	if req.SourceNamespaceID != nil {
		if !h.gate.Require(w, r, *req.SourceNamespaceID, members.RoleViewer) {
			return
		}
	}
	t, err := h.svc.Create(r.Context(), claims.UserID, CreateInput{
		Name:              req.Name,
		Description:       req.Description,
		Files:             req.Files,
		SourceNamespaceID: req.SourceNamespaceID,
	})
	if err != nil {
		writeErr(w, err)
		return
	}
	h.audit.Write(r.Context(), claims.Email, "playground.template.create", t.ID.String(), map[string]any{
		"name": t.Name,
	})
	httpx.WriteJSON(w, http.StatusCreated, t)
}

func (h *Handler) Update(w http.ResponseWriter, r *http.Request) {
	claims := auth.UserFromContext(r.Context())
	if claims == nil {
		httpx.WriteError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid template id")
		return
	}
	var req struct {
		Name        *string           `json:"name"`
		Description *string           `json:"description"`
		Files       map[string]string `json:"files"`
	}
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	t, err := h.svc.Update(r.Context(), id, claims.UserID, UpdateInput{
		Name:        req.Name,
		Description: req.Description,
		Files:       req.Files,
	})
	if err != nil {
		writeErr(w, err)
		return
	}
	h.audit.Write(r.Context(), claims.Email, "playground.template.update", t.ID.String(), nil)
	httpx.WriteJSON(w, http.StatusOK, t)
}

func (h *Handler) Delete(w http.ResponseWriter, r *http.Request) {
	claims := auth.UserFromContext(r.Context())
	if claims == nil {
		httpx.WriteError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid template id")
		return
	}
	if err := h.svc.Delete(r.Context(), id, claims.UserID); err != nil {
		writeErr(w, err)
		return
	}
	h.audit.Write(r.Context(), claims.Email, "playground.template.delete", id.String(), nil)
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) Launch(w http.ResponseWriter, r *http.Request) {
	claims := auth.UserFromContext(r.Context())
	if claims == nil {
		httpx.WriteError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid template id")
		return
	}
	var req struct {
		Name string `json:"name"`
		Slug string `json:"slug"`
	}
	_ = httpx.DecodeJSON(r, &req)

	ns, t, err := h.svc.Launch(r.Context(), claims.UserID, id, req.Name, req.Slug)
	if err != nil {
		writeErr(w, err)
		return
	}
	if _, err := h.members.Upsert(r.Context(), ns.ID, claims.UserID, members.RoleAdmin); err != nil {
		_ = h.ns.Delete(r.Context(), ns.ID)
		httpx.WriteError(w, http.StatusInternalServerError, "failed to assign namespace admin")
		return
	}
	h.audit.Write(r.Context(), claims.Email, "playground.template.launch", t.ID.String(), map[string]any{
		"namespace_id": ns.ID.String(),
		"name":         ns.Name,
	})
	httpx.WriteJSON(w, http.StatusCreated, map[string]any{
		"namespace": ns,
		"template":  t,
	})
}

func (h *Handler) SnapshotFromNamespace(w http.ResponseWriter, r *http.Request) {
	claims := auth.UserFromContext(r.Context())
	if claims == nil {
		httpx.WriteError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	nsID, err := uuid.Parse(r.PathValue("namespaceId"))
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid namespace id")
		return
	}
	if !h.gate.Require(w, r, nsID, members.RoleWriter) {
		return
	}
	var req struct {
		Name        string `json:"name"`
		Description string `json:"description"`
	}
	_ = httpx.DecodeJSON(r, &req)
	t, err := h.svc.SnapshotFromNamespace(r.Context(), claims.UserID, nsID, req.Name, req.Description)
	if err != nil {
		writeErr(w, err)
		return
	}
	h.audit.Write(r.Context(), claims.Email, "playground.template.snapshot", t.ID.String(), map[string]any{
		"namespace_id": nsID.String(),
	})
	httpx.WriteJSON(w, http.StatusCreated, t)
}

func writeErr(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, ErrNotFound), errors.Is(err, namespaces.ErrNotFound):
		httpx.WriteError(w, http.StatusNotFound, "not found")
	case errors.Is(err, ErrForbidden):
		httpx.WriteError(w, http.StatusForbidden, "forbidden")
	case errors.Is(err, ErrValidation), errors.Is(err, namespaces.ErrValidation):
		msg := err.Error()
		if i := strings.Index(msg, ": "); i >= 0 {
			msg = strings.TrimSpace(msg[i+2:])
		}
		httpx.WriteError(w, http.StatusBadRequest, msg)
	case errors.Is(err, namespaces.ErrConflict):
		httpx.WriteError(w, http.StatusConflict, err.Error())
	default:
		httpx.WriteError(w, http.StatusInternalServerError, "request failed")
	}
}
