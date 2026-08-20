package tfgraph

import (
	"errors"
	"net/http"

	"github.com/google/uuid"
	"github.com/terraforge/terraforge/apps/api/internal/access"
	"github.com/terraforge/terraforge/apps/api/internal/httpx"
	"github.com/terraforge/terraforge/apps/api/internal/members"
	"github.com/terraforge/terraforge/apps/api/internal/namespaces"
	"github.com/terraforge/terraforge/apps/api/internal/tfstate"
)

type Handler struct {
	ns    *namespaces.Service
	state *tfstate.Service
	gate  *access.Checker
}

func NewHandler(ns *namespaces.Service, state *tfstate.Service, gate *access.Checker) *Handler {
	return &Handler{ns: ns, state: state, gate: gate}
}

func (h *Handler) Register(mux *http.ServeMux, requireAuth func(http.Handler) http.Handler) {
	mux.Handle("GET /api/namespaces/{id}/graph", requireAuth(http.HandlerFunc(h.Get)))
	mux.Handle("GET /api/namespaces/{id}/suggestions", requireAuth(http.HandlerFunc(h.Suggestions)))
}

func (h *Handler) Get(w http.ResponseWriter, r *http.Request) {
	nsID, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid id")
		return
	}
	if !h.gate.Require(w, r, nsID, members.RoleViewer) {
		return
	}

	root := h.ns.RepoPath(nsID)
	addrs := map[string]bool{}
	if raw, err := h.state.GetState(r.Context(), nsID); err == nil {
		addrs = StateAddrs(raw)
	} else if !errors.Is(err, tfstate.ErrNotFound) {
		httpx.WriteError(w, http.StatusInternalServerError, "failed to read state")
		return
	}

	g, err := Build(root, addrs)
	if err != nil {
		httpx.WriteError(w, http.StatusInternalServerError, "failed to build graph")
		return
	}
	if raw, err := h.state.GetState(r.Context(), nsID); err == nil {
		view := tfstate.BuildView(raw, nil, nil)
		names := make([]string, 0, len(view.Providers))
		for _, p := range view.Providers {
			names = append(names, p.Name)
		}
		EnrichEnvironmentFromState(&g.Environment, names)
	}
	httpx.WriteJSON(w, http.StatusOK, g)
}

func (h *Handler) Suggestions(w http.ResponseWriter, r *http.Request) {
	nsID, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid id")
		return
	}
	if !h.gate.Require(w, r, nsID, members.RoleViewer) {
		return
	}
	root := h.ns.RepoPath(nsID)
	sug := BuildSuggestions(r.Context(), root)
	httpx.WriteJSON(w, http.StatusOK, sug)
}
