package runs

import (
	"bufio"
	"errors"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"

	"github.com/google/uuid"
	"github.com/terraforge/terraforge/apps/api/internal/access"
	"github.com/terraforge/terraforge/apps/api/internal/audit"
	"github.com/terraforge/terraforge/apps/api/internal/auth"
	"github.com/terraforge/terraforge/apps/api/internal/httpx"
	"github.com/terraforge/terraforge/apps/api/internal/members"
	tfws "github.com/terraforge/terraforge/apps/api/internal/websocket"
)

type Handler struct {
	svc     *Service
	hub     *tfws.Hub
	dataDir string
	gate    *access.Checker
	audit   *audit.Service
}

func NewHandler(svc *Service, hub *tfws.Hub, dataDir string, gate *access.Checker, auditSvc *audit.Service) *Handler {
	return &Handler{svc: svc, hub: hub, dataDir: dataDir, gate: gate, audit: auditSvc}
}

func (h *Handler) Register(mux *http.ServeMux, requireAuth func(http.Handler) http.Handler, requireRunAuth func(http.Handler) http.Handler) {
	mux.Handle("GET /api/namespaces/{id}/runs", requireAuth(http.HandlerFunc(h.List)))
	mux.Handle("POST /api/namespaces/{id}/runs", requireRunAuth(http.HandlerFunc(h.Create)))
	mux.Handle("GET /api/namespaces/{id}/runs/{runId}", requireAuth(http.HandlerFunc(h.Get)))
	mux.Handle("POST /api/namespaces/{id}/runs/{runId}/approve", requireAuth(http.HandlerFunc(h.Approve)))
	mux.Handle("POST /api/namespaces/{id}/runs/{runId}/cancel", requireAuth(http.HandlerFunc(h.Cancel)))
	mux.Handle("POST /api/namespaces/{id}/runs/{runId}/logs", requireRunAuth(http.HandlerFunc(h.AppendLogs)))
	mux.Handle("POST /api/namespaces/{id}/runs/{runId}/complete", requireRunAuth(http.HandlerFunc(h.Complete)))
	mux.Handle("GET /api/namespaces/{id}/runs/{runId}/logs/ws", requireAuth(http.HandlerFunc(h.LogsWS)))
}

type createRequest struct {
	Type   string `json:"type"`
	Source string `json:"source"`
}

type logsRequest struct {
	Lines []string `json:"lines"`
}

type completeRequest struct {
	Status string `json:"status"`
}

func (h *Handler) Create(w http.ResponseWriter, r *http.Request) {
	nsID, ok := parseID(w, r.PathValue("id"), "namespace id")
	if !ok {
		return
	}
	if !h.gate.Require(w, r, nsID, members.RoleWriter) {
		return
	}
	claims := auth.UserFromContext(r.Context())
	cli := auth.CLIFromContext(r.Context())
	if claims == nil && cli == nil {
		httpx.WriteError(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	var req createRequest
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}

	// CLI tokens may only create companion CLI runs.
	if cli != nil {
		req.Source = "cli"
	}

	var (
		run Run
		err error
	)
	actor := ""
	if claims != nil {
		actor = claims.Email
	}
	if req.Source == "cli" {
		var triggeredBy *uuid.UUID
		if cli != nil && cli.CreatedBy != nil {
			triggeredBy = cli.CreatedBy
		} else if claims != nil && claims.UserID != uuid.Nil {
			id := claims.UserID
			triggeredBy = &id
		}
		run, err = h.svc.CreateCompanionCLI(r.Context(), nsID, Type(req.Type), triggeredBy)
	} else {
		if claims == nil || claims.UserID == uuid.Nil {
			httpx.WriteError(w, http.StatusUnauthorized, "unauthorized")
			return
		}
		run, err = h.svc.Create(r.Context(), nsID, Type(req.Type), claims.UserID)
	}
	if err != nil {
		writeError(w, err)
		return
	}
	h.audit.Write(r.Context(), actor, "run.create", nsID.String(), map[string]any{
		"run_id": run.ID.String(), "type": req.Type, "awaiting_approval": run.AwaitingApproval,
		"cli_token": cli != nil,
	})
	status := http.StatusAccepted
	if req.Source == "cli" || run.AwaitingApproval {
		status = http.StatusCreated
	}
	httpx.WriteJSON(w, status, run)
}

func (h *Handler) Approve(w http.ResponseWriter, r *http.Request) {
	nsID, ok := parseID(w, r.PathValue("id"), "namespace id")
	if !ok {
		return
	}
	runID, ok := parseID(w, r.PathValue("runId"), "run id")
	if !ok {
		return
	}
	if !h.gate.Require(w, r, nsID, members.RoleWriter) {
		return
	}
	claims := auth.UserFromContext(r.Context())
	if claims == nil {
		httpx.WriteError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	run, err := h.svc.Approve(r.Context(), nsID, runID, claims.UserID)
	if err != nil {
		writeError(w, err)
		return
	}
	h.audit.Write(r.Context(), claims.Email, "run.approve", nsID.String(), map[string]any{
		"run_id": run.ID.String(),
	})
	httpx.WriteJSON(w, http.StatusAccepted, run)
}

func (h *Handler) Cancel(w http.ResponseWriter, r *http.Request) {
	nsID, ok := parseID(w, r.PathValue("id"), "namespace id")
	if !ok {
		return
	}
	runID, ok := parseID(w, r.PathValue("runId"), "run id")
	if !ok {
		return
	}
	if !h.gate.Require(w, r, nsID, members.RoleWriter) {
		return
	}
	claims := auth.UserFromContext(r.Context())
	if claims == nil {
		httpx.WriteError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	run, err := h.svc.Cancel(r.Context(), nsID, runID)
	if err != nil {
		writeError(w, err)
		return
	}
	// Best-effort: stop an in-flight docker runner if present.
	_ = exec.Command("docker", "rm", "-f", "terraforge-"+runID.String()).Run()
	h.audit.Write(r.Context(), claims.Email, "run.cancel", nsID.String(), map[string]any{
		"run_id": run.ID.String(),
	})
	httpx.WriteJSON(w, http.StatusOK, run)
}

func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	nsID, ok := parseID(w, r.PathValue("id"), "namespace id")
	if !ok {
		return
	}
	if !h.gate.Require(w, r, nsID, members.RoleViewer) {
		return
	}
	items, err := h.svc.List(r.Context(), nsID)
	if err != nil {
		writeError(w, err)
		return
	}
	if items == nil {
		items = []Run{}
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"runs": items})
}

func (h *Handler) Get(w http.ResponseWriter, r *http.Request) {
	nsID, ok := parseID(w, r.PathValue("id"), "namespace id")
	if !ok {
		return
	}
	runID, ok := parseID(w, r.PathValue("runId"), "run id")
	if !ok {
		return
	}
	if !h.gate.Require(w, r, nsID, members.RoleViewer) {
		return
	}
	run, err := h.svc.Get(r.Context(), nsID, runID)
	if err != nil {
		writeError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, run)
}

func (h *Handler) AppendLogs(w http.ResponseWriter, r *http.Request) {
	nsID, ok := parseID(w, r.PathValue("id"), "namespace id")
	if !ok {
		return
	}
	runID, ok := parseID(w, r.PathValue("runId"), "run id")
	if !ok {
		return
	}
	if !h.gate.Require(w, r, nsID, members.RoleWriter) {
		return
	}
	var req logsRequest
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	if len(req.Lines) == 0 {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if _, err := h.svc.AppendLogLines(r.Context(), nsID, runID, req.Lines); err != nil {
		writeError(w, err)
		return
	}
	for _, line := range req.Lines {
		h.hub.PublishLine(runID.String(), line)
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) Complete(w http.ResponseWriter, r *http.Request) {
	nsID, ok := parseID(w, r.PathValue("id"), "namespace id")
	if !ok {
		return
	}
	runID, ok := parseID(w, r.PathValue("runId"), "run id")
	if !ok {
		return
	}
	if !h.gate.Require(w, r, nsID, members.RoleWriter) {
		return
	}
	var req completeRequest
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	run, err := h.svc.Complete(r.Context(), nsID, runID, Status(req.Status))
	if err != nil {
		writeError(w, err)
		return
	}
	h.hub.PublishStatus(runID.String(), string(run.Status))
	httpx.WriteJSON(w, http.StatusOK, run)
}

func (h *Handler) LogsWS(w http.ResponseWriter, r *http.Request) {
	nsID, ok := parseID(w, r.PathValue("id"), "namespace id")
	if !ok {
		return
	}
	runID, ok := parseID(w, r.PathValue("runId"), "run id")
	if !ok {
		return
	}
	if !h.gate.Require(w, r, nsID, members.RoleViewer) {
		return
	}
	run, err := h.svc.Get(r.Context(), nsID, runID)
	if err != nil {
		writeError(w, err)
		return
	}

	h.hub.ServeWS(w, r, runID.String(), func(publish func(line string)) {
		if run.LogPath == nil {
			return
		}
		path := *run.LogPath
		if !filepath.IsAbs(path) {
			path = filepath.Join(h.dataDir, path)
		}
		f, err := os.Open(path)
		if err != nil {
			return
		}
		defer f.Close()
		scanner := bufio.NewScanner(f)
		buf := make([]byte, 0, 64*1024)
		scanner.Buffer(buf, 1024*1024)
		for scanner.Scan() {
			publish(scanner.Text())
		}
	})
}

func parseID(w http.ResponseWriter, raw, label string) (uuid.UUID, bool) {
	id, err := uuid.Parse(raw)
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid "+label)
		return uuid.UUID{}, false
	}
	return id, true
}

func writeError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, ErrNotFound):
		httpx.WriteError(w, http.StatusNotFound, err.Error())
	case errors.Is(err, ErrValidation), errors.Is(err, ErrApprovalRequired), errors.Is(err, ErrNotAwaiting):
		httpx.WriteError(w, http.StatusBadRequest, err.Error())
	default:
		httpx.WriteError(w, http.StatusInternalServerError, "run operation failed")
	}
}
