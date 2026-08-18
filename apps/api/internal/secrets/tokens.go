package secrets

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	ErrNotFound = errors.New("token not found")
	ErrInvalid  = errors.New("invalid token")
)

type BackendToken struct {
	ID          uuid.UUID  `json:"id"`
	NamespaceID uuid.UUID  `json:"namespace_id"`
	Label       string     `json:"label"`
	CreatedAt   time.Time  `json:"created_at"`
	RevokedAt   *time.Time `json:"revoked_at"`
	// Token is only set on create (shown once).
	Token string `json:"token,omitempty"`
}

type Service struct {
	pool *pgxpool.Pool
	key  []byte
}

func NewService(pool *pgxpool.Pool, key []byte) *Service {
	return &Service{pool: pool, key: key}
}

func (s *Service) ListBackendTokens(ctx context.Context, namespaceID uuid.UUID) ([]BackendToken, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id, namespace_id, label, created_at, revoked_at
		FROM backend_tokens
		WHERE namespace_id = $1
		ORDER BY created_at DESC
	`, namespaceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []BackendToken
	for rows.Next() {
		var t BackendToken
		if err := rows.Scan(&t.ID, &t.NamespaceID, &t.Label, &t.CreatedAt, &t.RevokedAt); err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

func (s *Service) CreateBackendToken(ctx context.Context, namespaceID uuid.UUID, label string) (BackendToken, error) {
	label = strings.TrimSpace(label)
	if label == "" {
		label = "default"
	}
	raw, err := generateToken()
	if err != nil {
		return BackendToken{}, err
	}
	hash := hashToken(raw)

	var t BackendToken
	err = s.pool.QueryRow(ctx, `
		INSERT INTO backend_tokens (namespace_id, token_hash, label)
		VALUES ($1, $2, $3)
		RETURNING id, namespace_id, label, created_at, revoked_at
	`, namespaceID, hash, label).Scan(&t.ID, &t.NamespaceID, &t.Label, &t.CreatedAt, &t.RevokedAt)
	if err != nil {
		return BackendToken{}, err
	}
	t.Token = raw
	return t, nil
}

func (s *Service) RevokeBackendToken(ctx context.Context, namespaceID, tokenID uuid.UUID) error {
	tag, err := s.pool.Exec(ctx, `
		UPDATE backend_tokens
		SET revoked_at = now()
		WHERE id = $1 AND namespace_id = $2 AND revoked_at IS NULL
	`, tokenID, namespaceID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// ResolveBackendToken returns the namespace ID for a valid (non-revoked) raw token.
func (s *Service) ResolveBackendToken(ctx context.Context, raw string) (uuid.UUID, uuid.UUID, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return uuid.UUID{}, uuid.UUID{}, ErrInvalid
	}
	hash := hashToken(raw)
	var tokenID, nsID uuid.UUID
	err := s.pool.QueryRow(ctx, `
		SELECT id, namespace_id
		FROM backend_tokens
		WHERE token_hash = $1 AND revoked_at IS NULL
	`, hash).Scan(&tokenID, &nsID)
	if errors.Is(err, pgx.ErrNoRows) {
		return uuid.UUID{}, uuid.UUID{}, ErrInvalid
	}
	if err != nil {
		return uuid.UUID{}, uuid.UUID{}, err
	}
	return tokenID, nsID, nil
}

func generateToken() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", fmt.Errorf("generate token: %w", err)
	}
	return "tfb_" + base64.RawURLEncoding.EncodeToString(b), nil
}

func hashToken(raw string) string {
	sum := sha256.Sum256([]byte(raw))
	return hex.EncodeToString(sum[:])
}
