package namespaces

import (
	"net/http"

	"github.com/google/uuid"
	"github.com/terraforge/terraforge/apps/api/internal/httpx"
	"github.com/terraforge/terraforge/apps/api/internal/members"
)

func (h *Handler) registerRemoteRoutes(mux *http.ServeMux, requireAuth func(http.Handler) http.Handler) {
	mux.Handle("POST /api/namespaces/{id}/remote", requireAuth(http.HandlerFunc(h.ConnectRemote)))
	mux.Handle("POST /api/namespaces/{id}/remote/push", requireAuth(http.HandlerFunc(h.PushRemote)))
	mux.Handle("POST /api/namespaces/{id}/remote/pull", requireAuth(http.HandlerFunc(h.PullRemote)))
	mux.Handle("POST /api/namespaces/{id}/remote/fetch", requireAuth(http.HandlerFunc(h.FetchRemote)))
}

type remoteRequest struct {
	RemoteURL string `json:"remote_url"`
	PAT       string `json:"pat"`
	Push      bool   `json:"push"`
}

type remoteAuthRequest struct {
	PAT string `json:"pat"`
}

func (h *Handler) ConnectRemote(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid namespace id")
		return
	}
	if !h.gate.Require(w, r, id, members.RoleAdmin) {
		return
	}
	var req remoteRequest
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	ns, err := h.svc.ConnectRemote(r.Context(), id, ConnectRemoteInput{
		RemoteURL: req.RemoteURL,
		PAT:       req.PAT,
		Push:      req.Push,
	})
	if err != nil {
		writeServiceError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, ns)
}

func (h *Handler) PushRemote(w http.ResponseWriter, r *http.Request) {
	h.remoteAction(w, r, members.RoleWriter, func(id uuid.UUID, pat string) error {
		return h.svc.Push(r.Context(), id, pat)
	})
}

func (h *Handler) PullRemote(w http.ResponseWriter, r *http.Request) {
	h.remoteAction(w, r, members.RoleWriter, func(id uuid.UUID, pat string) error {
		return h.svc.Pull(r.Context(), id, pat)
	})
}

func (h *Handler) FetchRemote(w http.ResponseWriter, r *http.Request) {
	h.remoteAction(w, r, members.RoleViewer, func(id uuid.UUID, pat string) error {
		return h.svc.Fetch(r.Context(), id, pat)
	})
}

func (h *Handler) remoteAction(w http.ResponseWriter, r *http.Request, min members.Role, fn func(uuid.UUID, string) error) {
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid namespace id")
		return
	}
	if !h.gate.Require(w, r, id, min) {
		return
	}
	var req remoteAuthRequest
	if r.ContentLength > 0 {
		if err := httpx.DecodeJSON(r, &req); err != nil {
			httpx.WriteError(w, http.StatusBadRequest, "invalid JSON body")
			return
		}
	}
	if err := fn(id, req.PAT); err != nil {
		writeServiceError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
