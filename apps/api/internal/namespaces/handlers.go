package namespaces

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
)

type Handler struct {
	svc     *Service
	members *members.Service
	audit   *audit.Service
	gate    *access.Checker
}

func NewHandler(svc *Service, membersSvc *members.Service, auditSvc *audit.Service, gate *access.Checker) *Handler {
	return &Handler{svc: svc, members: membersSvc, audit: auditSvc, gate: gate}
}

func (h *Handler) Register(mux *http.ServeMux, requireAuth func(http.Handler) http.Handler) {
	mux.Handle("GET /api/namespaces", requireAuth(http.HandlerFunc(h.List)))
	mux.Handle("POST /api/namespaces", requireAuth(http.HandlerFunc(h.Create)))
	mux.Handle("GET /api/namespaces/{id}", requireAuth(http.HandlerFunc(h.Get)))
	mux.Handle("PATCH /api/namespaces/{id}", requireAuth(http.HandlerFunc(h.UpdateSettings)))
	mux.Handle("DELETE /api/namespaces/{id}", requireAuth(http.HandlerFunc(h.Delete)))
	h.registerFileRoutes(mux, requireAuth)
	h.registerRemoteRoutes(mux, requireAuth)
}

// RegisterImport mounts config import/export/sync (JWT or CLI token).
func (h *Handler) RegisterImport(mux *http.ServeMux, requireAuth func(http.Handler) http.Handler) {
	mux.Handle("POST /api/namespaces/{id}/import", requireAuth(http.HandlerFunc(h.ImportConfig)))
	mux.Handle("POST /api/namespaces/{id}/import-files", requireAuth(http.HandlerFunc(h.ImportFilesJSON)))
	mux.Handle("GET /api/namespaces/{id}/config-manifest", requireAuth(http.HandlerFunc(h.ConfigManifest)))
	mux.Handle("GET /api/namespaces/{id}/config-export", requireAuth(http.HandlerFunc(h.ConfigExport)))
}

func (h *Handler) ConfigManifest(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid namespace id")
		return
	}
	if !h.gate.Require(w, r, id, members.RoleViewer) {
		return
	}
	m, err := h.svc.ConfigManifest(id.String())
	if err != nil {
		writeServiceError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, m)
}

func (h *Handler) ConfigExport(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid namespace id")
		return
	}
	if !h.gate.Require(w, r, id, members.RoleViewer) {
		return
	}
	body, m, err := h.svc.ExportTarGz(id.String())
	if err != nil {
		writeServiceError(w, err)
		return
	}
	w.Header().Set("Content-Type", "application/gzip")
	w.Header().Set("Content-Disposition", `attachment; filename="terraforge-config.tar.gz"`)
	w.Header().Set("X-Terraforge-Digest", m.Digest)
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(body)
}

func (h *Handler) ImportFilesJSON(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid namespace id")
		return
	}
	if !h.gate.Require(w, r, id, members.RoleWriter) {
		return
	}
	var req struct {
		Message string            `json:"message"`
		Files   map[string]string `json:"files"`
	}
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	if len(req.Files) == 0 {
		httpx.WriteError(w, http.StatusBadRequest, "files required")
		return
	}
	result, err := h.svc.ImportFiles(id.String(), req.Files, req.Message)
	if err != nil {
		writeServiceError(w, err)
		return
	}
	claims := auth.UserFromContext(r.Context())
	actor := "cli-token"
	if claims != nil && claims.Email != "" {
		actor = claims.Email
	}
	h.audit.Write(r.Context(), actor, "namespace.import", id.String(), map[string]any{
		"files": result.Files,
		"via":   "json",
	})
	httpx.WriteJSON(w, http.StatusOK, result)
}

func (h *Handler) ImportConfig(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid namespace id")
		return
	}
	if !h.gate.Require(w, r, id, members.RoleWriter) {
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxImportBytes+512<<10)
	ct := r.Header.Get("Content-Type")
	var body = r.Body
	if strings.HasPrefix(ct, "multipart/") {
		if err := r.ParseMultipartForm(maxImportBytes + 512<<10); err != nil {
			httpx.WriteError(w, http.StatusBadRequest, "invalid multipart form")
			return
		}
		f, _, err := r.FormFile("archive")
		if err != nil {
			httpx.WriteError(w, http.StatusBadRequest, "missing archive file field")
			return
		}
		defer f.Close()
		body = f
	}
	msg := strings.TrimSpace(r.URL.Query().Get("message"))
	result, err := h.svc.ImportTarGz(id.String(), body, msg)
	if err != nil {
		writeServiceError(w, err)
		return
	}
	claims := auth.UserFromContext(r.Context())
	actor := "cli-token"
	if claims != nil && claims.Email != "" {
		actor = claims.Email
	}
	h.audit.Write(r.Context(), actor, "namespace.import", id.String(), map[string]any{
		"files": result.Files,
	})
	httpx.WriteJSON(w, http.StatusOK, result)
}


type createRequest struct {
	Name             string `json:"name"`
	Slug             string `json:"slug"`
	TerraformVersion string `json:"terraform_version"`
	RemoteURL        string `json:"remote_url"`
	PAT              string `json:"pat"`
	IsPlayground     bool   `json:"is_playground"`
}

type settingsRequest struct {
	RequireApproval      *bool `json:"require_approval"`
	DriftIntervalMinutes *int  `json:"drift_interval_minutes"`
}

func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	claims := auth.UserFromContext(r.Context())
	if claims == nil {
		httpx.WriteError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	ids, err := h.members.AccessibleNamespaceIDs(r.Context(), claims.UserID, claims.IsAdmin)
	if err != nil {
		httpx.WriteError(w, http.StatusInternalServerError, "failed to list namespaces")
		return
	}
	items, err := h.svc.ListByIDs(r.Context(), ids)
	if err != nil {
		httpx.WriteError(w, http.StatusInternalServerError, "failed to list namespaces")
		return
	}
	if items == nil {
		items = []Namespace{}
	}
	if playgroundOnly := strings.EqualFold(r.URL.Query().Get("playground"), "true"); playgroundOnly {
		filtered := make([]Namespace, 0, len(items))
		for _, ns := range items {
			if ns.IsPlayground {
				filtered = append(filtered, ns)
			}
		}
		items = filtered
	} else if excludePlayground := strings.EqualFold(r.URL.Query().Get("playground"), "false"); excludePlayground {
		filtered := make([]Namespace, 0, len(items))
		for _, ns := range items {
			if !ns.IsPlayground {
				filtered = append(filtered, ns)
			}
		}
		items = filtered
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"namespaces": items})
}

func (h *Handler) Create(w http.ResponseWriter, r *http.Request) {
	claims := auth.UserFromContext(r.Context())
	if claims == nil {
		httpx.WriteError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	var req createRequest
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}

	var (
		ns  Namespace
		err error
	)
	if req.IsPlayground && strings.TrimSpace(req.RemoteURL) != "" {
		httpx.WriteError(w, http.StatusBadRequest, "playground namespaces cannot use a remote git URL")
		return
	}
	if strings.TrimSpace(req.RemoteURL) != "" {
		ns, err = h.svc.CreateFromRemote(r.Context(), CreateFromRemoteInput{
			Name:             req.Name,
			Slug:             req.Slug,
			RemoteURL:        req.RemoteURL,
			PAT:              req.PAT,
			TerraformVersion: req.TerraformVersion,
		})
	} else {
		ns, err = h.svc.Create(r.Context(), CreateInput{
			Name:             req.Name,
			Slug:             req.Slug,
			TerraformVersion: req.TerraformVersion,
			IsPlayground:     req.IsPlayground,
		})
	}
	if err != nil {
		writeServiceError(w, err)
		return
	}
	if _, err := h.members.Upsert(r.Context(), ns.ID, claims.UserID, members.RoleAdmin); err != nil {
		_ = h.svc.Delete(r.Context(), ns.ID)
		httpx.WriteError(w, http.StatusInternalServerError, "failed to assign namespace admin")
		return
	}
	h.audit.Write(r.Context(), claims.Email, "namespace.create", ns.ID.String(), map[string]any{
		"name": ns.Name, "slug": ns.Slug,
	})
	httpx.WriteJSON(w, http.StatusCreated, ns)
}

func (h *Handler) Get(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid namespace id")
		return
	}
	if !h.gate.Require(w, r, id, members.RoleViewer) {
		return
	}
	ns, err := h.svc.Get(r.Context(), id)
	if err != nil {
		writeServiceError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, ns)
}

func (h *Handler) UpdateSettings(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid namespace id")
		return
	}
	if !h.gate.Require(w, r, id, members.RoleAdmin) {
		return
	}
	var req settingsRequest
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	ns, err := h.svc.UpdateSettings(r.Context(), id, UpdateSettingsInput{
		RequireApproval:      req.RequireApproval,
		DriftIntervalMinutes: req.DriftIntervalMinutes,
	})
	if err != nil {
		writeServiceError(w, err)
		return
	}
	claims := auth.UserFromContext(r.Context())
	actor := ""
	if claims != nil {
		actor = claims.Email
	}
	h.audit.Write(r.Context(), actor, "namespace.settings", id.String(), map[string]any{
		"require_approval": ns.RequireApproval,
		"drift_interval":   ns.DriftIntervalMinutes,
	})
	httpx.WriteJSON(w, http.StatusOK, ns)
}

func (h *Handler) Delete(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid namespace id")
		return
	}
	if !h.gate.Require(w, r, id, members.RoleAdmin) {
		return
	}
	if err := h.svc.Delete(r.Context(), id); err != nil {
		writeServiceError(w, err)
		return
	}
	claims := auth.UserFromContext(r.Context())
	actor := ""
	if claims != nil {
		actor = claims.Email
	}
	h.audit.Write(r.Context(), actor, "namespace.delete", id.String(), nil)
	w.WriteHeader(http.StatusNoContent)
}

func writeServiceError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, ErrNotFound):
		httpx.WriteError(w, http.StatusNotFound, "namespace not found")
	case errors.Is(err, ErrConflict):
		httpx.WriteError(w, http.StatusConflict, err.Error())
	case errors.Is(err, ErrValidation):
		httpx.WriteError(w, http.StatusBadRequest, err.Error())
	default:
		httpx.WriteError(w, http.StatusInternalServerError, "namespace operation failed")
	}
}
