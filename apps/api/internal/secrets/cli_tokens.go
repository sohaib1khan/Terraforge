package secrets

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

const CLITokenTTL = 90 * 24 * time.Hour

type CLIToken struct {
	ID          uuid.UUID  `json:"id"`
	NamespaceID uuid.UUID  `json:"namespace_id"`
	Label       string     `json:"label"`
	CreatedBy   *uuid.UUID `json:"created_by,omitempty"`
	CreatedAt   time.Time  `json:"created_at"`
	ExpiresAt   time.Time  `json:"expires_at"`
	RevokedAt   *time.Time `json:"revoked_at"`
	// Token is only set on create (shown once).
	Token string `json:"token,omitempty"`
}

func (s *Service) ListCLITokens(ctx context.Context, namespaceID uuid.UUID) ([]CLIToken, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id, namespace_id, label, created_by, created_at, expires_at, revoked_at
		FROM cli_tokens
		WHERE namespace_id = $1
		ORDER BY created_at DESC
	`, namespaceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []CLIToken
	for rows.Next() {
		var t CLIToken
		if err := rows.Scan(&t.ID, &t.NamespaceID, &t.Label, &t.CreatedBy, &t.CreatedAt, &t.ExpiresAt, &t.RevokedAt); err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

func (s *Service) CreateCLIToken(ctx context.Context, namespaceID uuid.UUID, label string, createdBy *uuid.UUID) (CLIToken, error) {
	label = strings.TrimSpace(label)
	if label == "" {
		label = "connect-pack"
	}
	raw, err := generateCLIToken()
	if err != nil {
		return CLIToken{}, err
	}
	hash := hashToken(raw)
	expires := time.Now().UTC().Add(CLITokenTTL)

	var t CLIToken
	err = s.pool.QueryRow(ctx, `
		INSERT INTO cli_tokens (namespace_id, token_hash, label, created_by, expires_at)
		VALUES ($1, $2, $3, $4, $5)
		RETURNING id, namespace_id, label, created_by, created_at, expires_at, revoked_at
	`, namespaceID, hash, label, createdBy, expires).Scan(
		&t.ID, &t.NamespaceID, &t.Label, &t.CreatedBy, &t.CreatedAt, &t.ExpiresAt, &t.RevokedAt,
	)
	if err != nil {
		return CLIToken{}, err
	}
	t.Token = raw
	return t, nil
}

func (s *Service) RevokeCLIToken(ctx context.Context, namespaceID, tokenID uuid.UUID) error {
	tag, err := s.pool.Exec(ctx, `
		UPDATE cli_tokens
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

func (s *Service) RevokeCLITokensByLabel(ctx context.Context, namespaceID uuid.UUID, label string) error {
	_, err := s.pool.Exec(ctx, `
		UPDATE cli_tokens
		SET revoked_at = now()
		WHERE namespace_id = $1 AND label = $2 AND revoked_at IS NULL
	`, namespaceID, label)
	return err
}

func (s *Service) RevokeBackendTokensByLabel(ctx context.Context, namespaceID uuid.UUID, label string) error {
	_, err := s.pool.Exec(ctx, `
		UPDATE backend_tokens
		SET revoked_at = now()
		WHERE namespace_id = $1 AND label = $2 AND revoked_at IS NULL
	`, namespaceID, label)
	return err
}

// ResolveCLIToken returns token id, namespace id, and optional creator for a valid CLI token.
func (s *Service) ResolveCLIToken(ctx context.Context, raw string) (tokenID, nsID uuid.UUID, createdBy *uuid.UUID, err error) {
	raw = strings.TrimSpace(raw)
	if raw == "" || !strings.HasPrefix(raw, "tfc_") {
		return uuid.UUID{}, uuid.UUID{}, nil, ErrInvalid
	}
	hash := hashToken(raw)
	var expires time.Time
	err = s.pool.QueryRow(ctx, `
		SELECT id, namespace_id, created_by, expires_at
		FROM cli_tokens
		WHERE token_hash = $1 AND revoked_at IS NULL
	`, hash).Scan(&tokenID, &nsID, &createdBy, &expires)
	if errors.Is(err, pgx.ErrNoRows) {
		return uuid.UUID{}, uuid.UUID{}, nil, ErrInvalid
	}
	if err != nil {
		return uuid.UUID{}, uuid.UUID{}, nil, err
	}
	if time.Now().UTC().After(expires) {
		return uuid.UUID{}, uuid.UUID{}, nil, ErrInvalid
	}
	return tokenID, nsID, createdBy, nil
}

func generateCLIToken() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", fmt.Errorf("generate cli token: %w", err)
	}
	return "tfc_" + base64.RawURLEncoding.EncodeToString(b), nil
}
