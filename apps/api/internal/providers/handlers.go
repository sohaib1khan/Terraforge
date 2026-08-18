package providers

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
	mux.Handle("GET /api/providers", requireAuth(http.HandlerFunc(h.Search)))
	mux.Handle("GET /api/providers/{namespace}/{name}", requireAuth(http.HandlerFunc(h.Get)))
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
		items = []Provider{}
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{
		"providers": items,
		"total":     total,
		"limit":     limit,
		"offset":    offset,
	})
}

func (h *Handler) Get(w http.ResponseWriter, r *http.Request) {
	ns := r.PathValue("namespace")
	name := r.PathValue("name")
	detail, err := h.svc.Get(r.Context(), ns, name)
	if err != nil {
		if errors.Is(err, errNotFound) || strings.Contains(err.Error(), "not found") {
			httpx.WriteError(w, http.StatusNotFound, "provider not found")
			return
		}
		httpx.WriteError(w, http.StatusBadGateway, "failed to load provider")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, detail)
}

var errNotFound = errors.New("provider not found")
