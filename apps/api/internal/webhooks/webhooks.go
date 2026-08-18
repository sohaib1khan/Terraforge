package webhooks

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/terraforge/terraforge/apps/api/internal/access"
	"github.com/terraforge/terraforge/apps/api/internal/audit"
	"github.com/terraforge/terraforge/apps/api/internal/auth"
	"github.com/terraforge/terraforge/apps/api/internal/githubx"
	"github.com/terraforge/terraforge/apps/api/internal/httpx"
	"github.com/terraforge/terraforge/apps/api/internal/members"
	"github.com/terraforge/terraforge/apps/api/internal/runs"
)

type Config struct {
	ID           uuid.UUID  `json:"id"`
	NamespaceID  uuid.UUID  `json:"namespace_id"`
	Enabled      bool       `json:"enabled"`
	LastDelivery *time.Time `json:"last_delivery"`
	CreatedAt    time.Time  `json:"created_at"`
	// Secret only returned on create/rotate.
	Secret string `json:"secret,omitempty"`
}

type Service struct {
	pool *pgxpool.Pool
}

func NewService(pool *pgxpool.Pool) *Service {
	return &Service{pool: pool}
}

func (s *Service) Get(ctx context.Context, namespaceID uuid.UUID) (Config, error) {
	var c Config
	err := s.pool.QueryRow(ctx, `
		SELECT id, namespace_id, enabled, last_delivery, created_at
		FROM webhook_configs WHERE namespace_id = $1
	`, namespaceID).Scan(&c.ID, &c.NamespaceID, &c.Enabled, &c.LastDelivery, &c.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return Config{}, err
	}
	return c, err
}

func (s *Service) Ensure(ctx context.Context, namespaceID uuid.UUID) (Config, error) {
	if c, err := s.Get(ctx, namespaceID); err == nil {
		return c, nil
	}
	raw, hash, err := newSecret()
	if err != nil {
		return Config{}, err
	}
	var c Config
	err = s.pool.QueryRow(ctx, `
		INSERT INTO webhook_configs (namespace_id, secret_hash)
		VALUES ($1, $2)
		RETURNING id, namespace_id, enabled, last_delivery, created_at
	`, namespaceID, hash).Scan(&c.ID, &c.NamespaceID, &c.Enabled, &c.LastDelivery, &c.CreatedAt)
	if err != nil {
		return Config{}, err
	}
	c.Secret = raw
	return c, nil
}

func (s *Service) Rotate(ctx context.Context, namespaceID uuid.UUID) (Config, error) {
	raw, hash, err := newSecret()
	if err != nil {
		return Config{}, err
	}
	tag, err := s.pool.Exec(ctx, `
		UPDATE webhook_configs SET secret_hash = $2 WHERE namespace_id = $1
	`, namespaceID, hash)
	if err != nil {
		return Config{}, err
	}
	if tag.RowsAffected() == 0 {
		return s.Ensure(ctx, namespaceID)
	}
	c, err := s.Get(ctx, namespaceID)
	if err != nil {
		return Config{}, err
	}
	c.Secret = raw
	return c, nil
}

func (s *Service) Validate(ctx context.Context, namespaceID uuid.UUID, secret string) bool {
	var hash string
	var enabled bool
	err := s.pool.QueryRow(ctx, `
		SELECT secret_hash, enabled FROM webhook_configs WHERE namespace_id = $1
	`, namespaceID).Scan(&hash, &enabled)
	if err != nil || !enabled {
		return false
	}
	return hmac.Equal([]byte(hash), []byte(hashSecret(secret)))
}

func (s *Service) Touch(ctx context.Context, namespaceID uuid.UUID) {
	_, _ = s.pool.Exec(ctx, `
		UPDATE webhook_configs SET last_delivery = now() WHERE namespace_id = $1
	`, namespaceID)
}

func newSecret() (raw, hash string, err error) {
	b := make([]byte, 24)
	if _, err = rand.Read(b); err != nil {
		return "", "", err
	}
	raw = "whsec_" + hex.EncodeToString(b)
	return raw, hashSecret(raw), nil
}

func hashSecret(raw string) string {
	sum := sha256.Sum256([]byte(raw))
	return hex.EncodeToString(sum[:])
}

type Handler struct {
	svc   *Service
	runs  *runs.Service
	audit *audit.Service
	gate  *access.Checker
}

func NewHandler(svc *Service, runsSvc *runs.Service, auditSvc *audit.Service, gate *access.Checker) *Handler {
	return &Handler{svc: svc, runs: runsSvc, audit: auditSvc, gate: gate}
}

func (h *Handler) Register(mux *http.ServeMux, requireAuth func(http.Handler) http.Handler) {
	mux.Handle("GET /api/namespaces/{id}/webhook", requireAuth(http.HandlerFunc(h.Get)))
	mux.Handle("POST /api/namespaces/{id}/webhook", requireAuth(http.HandlerFunc(h.CreateOrRotate)))
	mux.HandleFunc("POST /api/webhooks/{id}", h.Receive)
}

func (h *Handler) Get(w http.ResponseWriter, r *http.Request) {
	nsID, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid id")
		return
	}
	if !h.gate.Require(w, r, nsID, members.RoleAdmin) {
		return
	}
	c, err := h.svc.Get(r.Context(), nsID)
	if errors.Is(err, pgx.ErrNoRows) {
		httpx.WriteJSON(w, http.StatusOK, map[string]any{"configured": false})
		return
	}
	if err != nil {
		httpx.WriteError(w, http.StatusInternalServerError, "failed to load webhook")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{
		"configured": true,
		"webhook":    c,
		"url":        fmt.Sprintf("/api/webhooks/%s", nsID),
	})
}

func (h *Handler) CreateOrRotate(w http.ResponseWriter, r *http.Request) {
	nsID, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid id")
		return
	}
	if !h.gate.Require(w, r, nsID, members.RoleAdmin) {
		return
	}
	c, err := h.svc.Rotate(r.Context(), nsID)
	if err != nil {
		httpx.WriteError(w, http.StatusInternalServerError, "failed to create webhook")
		return
	}
	claims := auth.UserFromContext(r.Context())
	actor := ""
	if claims != nil {
		actor = claims.Email
	}
	h.audit.Write(r.Context(), actor, "webhook.rotate", nsID.String(), nil)
	httpx.WriteJSON(w, http.StatusCreated, map[string]any{
		"webhook": c,
		"url":     fmt.Sprintf("/api/webhooks/%s", nsID),
		"note":    "secret shown once",
	})
}

func (h *Handler) Receive(w http.ResponseWriter, r *http.Request) {
	nsID, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid id")
		return
	}
	secret := r.Header.Get("X-Terraforge-Secret")
	if secret == "" {
		secret = r.URL.Query().Get("secret")
	}
	// Also accept GitHub-style HMAC for future; for MVP shared secret header is enough.
	if !h.svc.Validate(r.Context(), nsID, secret) {
		// GitHub: X-Hub-Signature-256 — soft accept if body event looks like push and secret matches query
		httpx.WriteError(w, http.StatusUnauthorized, "invalid webhook secret")
		return
	}
	body, _ := io.ReadAll(io.LimitReader(r.Body, 2<<20))
	event := r.Header.Get("X-GitHub-Event")
	if event == "" {
		event = r.Header.Get("X-Gitlab-Event")
	}
	if !githubx.ShouldPlan(event, body) {
		w.WriteHeader(http.StatusNoContent)
		return
	}

	var meta map[string]any
	if _, prMeta, ok := githubx.ParsePRFromPayload(event, body); ok {
		meta = prMeta
	}

	run, err := h.runs.CreateWebhookPlanWithMeta(r.Context(), nsID, meta)
	if err != nil {
		httpx.WriteError(w, http.StatusInternalServerError, "failed to enqueue plan")
		return
	}
	h.svc.Touch(r.Context(), nsID)
	h.audit.Write(r.Context(), "webhook", "run.plan", nsID.String(), map[string]any{
		"run_id": run.ID.String(), "event": event, "meta": meta,
	})
	httpx.WriteJSON(w, http.StatusAccepted, map[string]any{"run_id": run.ID, "status": run.Status})
}
