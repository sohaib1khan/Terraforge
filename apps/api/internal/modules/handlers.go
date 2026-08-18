package modules

import (
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/terraforge/terraforge/apps/api/internal/httpx"
)

type Handler struct {
	svc *Service
}

func NewHandler(svc *Service) *Handler {
	return &Handler{svc: svc}
}

func (h *Handler) Register(mux *http.ServeMux, requireAuth func(http.Handler) http.Handler) {
	mux.Handle("GET /api/modules", requireAuth(http.HandlerFunc(h.Search)))
	mux.Handle("GET /api/modules/{namespace}/{name}/{provider}", requireAuth(http.HandlerFunc(h.Get)))
}

func (h *Handler) Search(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query().Get("q")
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	offset, _ := strconv.Atoi(r.URL.Query().Get("offset"))
	items, total, err := h.svc.Search(r.Context(), q, limit, offset)
	if err != nil {
		httpx.WriteError(w, http.StatusBadGateway, "failed to query Terraform Registry")
		return
	}
	if items == nil {
		items = []Module{}
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{
		"modules": items,
		"total":   total,
		"limit":   limit,
		"offset":  offset,
	})
}

func (h *Handler) Get(w http.ResponseWriter, r *http.Request) {
	ns := r.PathValue("namespace")
	name := r.PathValue("name")
	provider := r.PathValue("provider")
	detail, err := h.svc.Get(r.Context(), ns, name, provider)
	if err != nil {
		if errors.Is(err, errNotFound) || strings.Contains(err.Error(), "not found") {
			httpx.WriteError(w, http.StatusNotFound, "module not found")
			return
		}
		httpx.WriteError(w, http.StatusBadGateway, "failed to load module")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, detail)
}

var errNotFound = errors.New("module not found")
