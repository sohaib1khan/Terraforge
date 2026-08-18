package audit

import (
	"net/http"
	"strconv"

	"github.com/terraforge/terraforge/apps/api/internal/auth"
	"github.com/terraforge/terraforge/apps/api/internal/httpx"
)

type Handler struct {
	svc *Service
}

func NewHandler(svc *Service) *Handler {
	return &Handler{svc: svc}
}

func (h *Handler) Register(mux *http.ServeMux, requireAuth func(http.Handler) http.Handler) {
	mux.Handle("GET /api/audit", requireAuth(http.HandlerFunc(h.List)))
}

func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	claims := auth.UserFromContext(r.Context())
	if claims == nil || !claims.IsAdmin {
		httpx.WriteError(w, http.StatusForbidden, "admin only")
		return
	}
	limit := 100
	if raw := r.URL.Query().Get("limit"); raw != "" {
		if n, err := strconv.Atoi(raw); err == nil {
			limit = n
		}
	}
	items, err := h.svc.List(r.Context(), limit)
	if err != nil {
		httpx.WriteError(w, http.StatusInternalServerError, "failed to list audit log")
		return
	}
	if items == nil {
		items = []Entry{}
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"entries": items})
}
