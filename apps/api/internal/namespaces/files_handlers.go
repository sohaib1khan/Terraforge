package namespaces

import (
	"net/http"
	"strings"

	"github.com/google/uuid"
	"github.com/terraforge/terraforge/apps/api/internal/httpx"
	"github.com/terraforge/terraforge/apps/api/internal/members"
)

type writeFileRequest struct {
	Content string `json:"content"`
	Message string `json:"message"`
}

type deleteFileRequest struct {
	Message string `json:"message"`
}

func (h *Handler) registerFileRoutes(mux *http.ServeMux, requireAuth func(http.Handler) http.Handler) {
	mux.Handle("GET /api/namespaces/{id}/files", requireAuth(http.HandlerFunc(h.ListFiles)))
	mux.Handle("GET /api/namespaces/{id}/files/{path...}", requireAuth(http.HandlerFunc(h.ReadFile)))
	mux.Handle("PUT /api/namespaces/{id}/files/{path...}", requireAuth(http.HandlerFunc(h.WriteFile)))
	mux.Handle("DELETE /api/namespaces/{id}/files/{path...}", requireAuth(http.HandlerFunc(h.DeleteFile)))
}

func (h *Handler) ListFiles(w http.ResponseWriter, r *http.Request) {
	id, ok := parseNamespaceID(w, r)
	if !ok {
		return
	}
	if !h.gate.Require(w, r, id, members.RoleViewer) {
		return
	}
	tree, err := h.svc.ListFiles(id.String())
	if err != nil {
		writeServiceError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, tree)
}

func (h *Handler) ReadFile(w http.ResponseWriter, r *http.Request) {
	id, ok := parseNamespaceID(w, r)
	if !ok {
		return
	}
	if !h.gate.Require(w, r, id, members.RoleViewer) {
		return
	}
	path := r.PathValue("path")
	file, err := h.svc.ReadFile(id.String(), path)
	if err != nil {
		writeServiceError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, file)
}

func (h *Handler) WriteFile(w http.ResponseWriter, r *http.Request) {
	id, ok := parseNamespaceID(w, r)
	if !ok {
		return
	}
	if !h.gate.Require(w, r, id, members.RoleWriter) {
		return
	}
	var req writeFileRequest
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	path := r.PathValue("path")
	file, err := h.svc.WriteFile(id.String(), path, req.Content, req.Message)
	if err != nil {
		writeServiceError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, file)
}

func (h *Handler) DeleteFile(w http.ResponseWriter, r *http.Request) {
	id, ok := parseNamespaceID(w, r)
	if !ok {
		return
	}
	if !h.gate.Require(w, r, id, members.RoleWriter) {
		return
	}
	var req deleteFileRequest
	if r.ContentLength > 0 {
		if err := httpx.DecodeJSON(r, &req); err != nil {
			httpx.WriteError(w, http.StatusBadRequest, "invalid JSON body")
			return
		}
	}

	path := r.PathValue("path")
	sha, err := h.svc.DeleteFile(id.String(), path, req.Message)
	if err != nil {
		writeServiceError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]string{
		"path":       strings.TrimPrefix(path, "/"),
		"commit_sha": sha,
	})
}

func parseNamespaceID(w http.ResponseWriter, r *http.Request) (uuid.UUID, bool) {
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid namespace id")
		return uuid.UUID{}, false
	}
	return id, true
}
