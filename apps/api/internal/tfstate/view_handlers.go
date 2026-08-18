package tfstate

import (
	"errors"
	"net/http"

	"github.com/google/uuid"
	"github.com/terraforge/terraforge/apps/api/internal/access"
	"github.com/terraforge/terraforge/apps/api/internal/httpx"
	"github.com/terraforge/terraforge/apps/api/internal/members"
)

func (h *Handler) RegisterUI(mux *http.ServeMux, requireAuth func(http.Handler) http.Handler, gate *access.Checker) {
	h.gate = gate
	mux.Handle("GET /api/namespaces/{id}/state", requireAuth(http.HandlerFunc(h.View)))
}

func (h *Handler) View(w http.ResponseWriter, r *http.Request) {
	nsID, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid id")
		return
	}
	if h.gate != nil && !h.gate.Require(w, r, nsID, members.RoleViewer) {
		return
	}

	updatedAt, _ := h.state.UpdatedAt(r.Context(), nsID)
	raw, err := h.state.GetState(r.Context(), nsID)
	if errors.Is(err, ErrNotFound) {
		httpx.WriteJSON(w, http.StatusOK, BuildView(nil, nil, nil))
		return
	}
	if err != nil {
		httpx.WriteError(w, http.StatusInternalServerError, "failed to load state")
		return
	}
	lock, _ := h.state.GetLock(r.Context(), nsID)
	httpx.WriteJSON(w, http.StatusOK, BuildView(raw, updatedAt, lock))
}
