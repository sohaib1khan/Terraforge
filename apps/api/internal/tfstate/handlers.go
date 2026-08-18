package tfstate

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"

	"github.com/google/uuid"
	"github.com/terraforge/terraforge/apps/api/internal/access"
	"github.com/terraforge/terraforge/apps/api/internal/httpx"
	"github.com/terraforge/terraforge/apps/api/internal/runs"
	"github.com/terraforge/terraforge/apps/api/internal/secrets"
)

type Handler struct {
	state   *Service
	secrets *secrets.Service
	runs    *runs.Service
	gate    *access.Checker
}

func NewHandler(state *Service, secretsSvc *secrets.Service, runsSvc *runs.Service) *Handler {
	return &Handler{state: state, secrets: secretsSvc, runs: runsSvc}
}

func (h *Handler) Register(mux *http.ServeMux) {
	mux.HandleFunc("/api/state/{id}", h.Handle)
}

func (h *Handler) Handle(w http.ResponseWriter, r *http.Request) {
	nsID, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid namespace id")
		return
	}

	rawToken := extractBackendToken(r)
	_, tokenNS, err := h.secrets.ResolveBackendToken(r.Context(), rawToken)
	if err != nil {
		httpx.WriteError(w, http.StatusUnauthorized, "invalid backend token")
		return
	}
	if tokenNS != nsID {
		httpx.WriteError(w, http.StatusForbidden, "token not valid for this namespace")
		return
	}

	switch r.Method {
	case http.MethodGet:
		h.get(w, r, nsID)
	case http.MethodPost:
		h.post(w, r, nsID)
	case "LOCK":
		h.lock(w, r, nsID)
	case "UNLOCK":
		h.unlock(w, r, nsID)
	default:
		httpx.WriteError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func (h *Handler) get(w http.ResponseWriter, r *http.Request, nsID uuid.UUID) {
	state, err := h.state.GetState(r.Context(), nsID)
	if errors.Is(err, ErrNotFound) || len(state) == 0 {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if err != nil {
		httpx.WriteError(w, http.StatusInternalServerError, "failed to read state")
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(state)
}

func (h *Handler) post(w http.ResponseWriter, r *http.Request, nsID uuid.UUID) {
	body, err := io.ReadAll(io.LimitReader(r.Body, 32<<20))
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "failed to read body")
		return
	}
	if !json.Valid(body) {
		httpx.WriteError(w, http.StatusBadRequest, "state must be JSON")
		return
	}

	before, _ := h.state.GetState(r.Context(), nsID)
	if err := h.state.PutState(r.Context(), nsID, body); err != nil {
		httpx.WriteError(w, http.StatusInternalServerError, "failed to store state")
		return
	}
	// Keep latest diff on the active CLI run (finalized on unlock).
	summary := DiffStates(before, body)
	_ = h.runs.AttachCLISummary(r.Context(), nsID, summaryMap(summary))
	w.WriteHeader(http.StatusOK)
}

func (h *Handler) lock(w http.ResponseWriter, r *http.Request, nsID uuid.UUID) {
	var info LockInfo
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&info); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid lock payload")
		return
	}
	if err := h.state.Lock(r.Context(), nsID, info); err != nil {
		if errors.Is(err, ErrLocked) {
			current, _ := h.state.GetLock(r.Context(), nsID)
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusConflict)
			if current != nil {
				_ = json.NewEncoder(w).Encode(current)
			} else {
				_, _ = w.Write([]byte(`{}`))
			}
			return
		}
		httpx.WriteError(w, http.StatusInternalServerError, "failed to lock state")
		return
	}
	_, _ = h.runs.StartCLIRun(r.Context(), nsID, info.Operation, info.Who)
	w.WriteHeader(http.StatusOK)
}

func (h *Handler) unlock(w http.ResponseWriter, r *http.Request, nsID uuid.UUID) {
	var info LockInfo
	_ = json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&info)

	if err := h.state.Unlock(r.Context(), nsID, info); err != nil {
		if errors.Is(err, ErrLockMismatch) {
			httpx.WriteError(w, http.StatusConflict, "lock id mismatch")
			return
		}
		httpx.WriteError(w, http.StatusInternalServerError, "failed to unlock state")
		return
	}
	_ = h.runs.FinishCLIRun(r.Context(), nsID, true)
	w.WriteHeader(http.StatusOK)
}

func extractBackendToken(r *http.Request) string {
	if u, pass, ok := r.BasicAuth(); ok {
		if pass != "" {
			return pass
		}
		return u
	}
	auth := r.Header.Get("Authorization")
	if len(auth) > 7 && (auth[:7] == "Bearer " || auth[:7] == "bearer ") {
		return auth[7:]
	}
	return r.Header.Get("X-Terraforge-Token")
}

func summaryMap(s DiffSummary) map[string]any {
	return map[string]any{
		"added":     s.Added,
		"changed":   s.Changed,
		"destroyed": s.Destroyed,
		"resources": s.Resources,
	}
}
