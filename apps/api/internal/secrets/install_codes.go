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

const InstallCodeTTL = 15 * time.Minute

type InstallCode struct {
	ID          uuid.UUID `json:"id"`
	NamespaceID uuid.UUID `json:"namespace_id"`
	Code        string    `json:"code,omitempty"` // raw, shown once
	ExpiresAt   time.Time `json:"expires_at"`
	Curl        string    `json:"curl,omitempty"`
}

func (s *Service) CreateInstallCode(ctx context.Context, namespaceID uuid.UUID, createdBy *uuid.UUID) (InstallCode, error) {
	raw, err := generateInstallCode()
	if err != nil {
		return InstallCode{}, err
	}
	hash := hashToken(raw)
	expires := time.Now().UTC().Add(InstallCodeTTL)

	var id uuid.UUID
	err = s.pool.QueryRow(ctx, `
		INSERT INTO connect_install_codes (namespace_id, code_hash, created_by, expires_at)
		VALUES ($1, $2, $3, $4)
		RETURNING id
	`, namespaceID, hash, createdBy, expires).Scan(&id)
	if err != nil {
		return InstallCode{}, err
	}
	return InstallCode{
		ID:          id,
		NamespaceID: namespaceID,
		Code:        raw,
		ExpiresAt:   expires,
	}, nil
}

// ConsumeInstallCode validates a one-time code and marks it used.
// Returns namespace ID on success.
func (s *Service) ConsumeInstallCode(ctx context.Context, raw string) (uuid.UUID, *uuid.UUID, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return uuid.UUID{}, nil, ErrInvalid
	}
	hash := hashToken(raw)

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return uuid.UUID{}, nil, err
	}
	defer tx.Rollback(ctx)

	var (
		id        uuid.UUID
		nsID      uuid.UUID
		createdBy *uuid.UUID
		expires   time.Time
		usedAt    *time.Time
	)
	err = tx.QueryRow(ctx, `
		SELECT id, namespace_id, created_by, expires_at, used_at
		FROM connect_install_codes
		WHERE code_hash = $1
		FOR UPDATE
	`, hash).Scan(&id, &nsID, &createdBy, &expires, &usedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return uuid.UUID{}, nil, ErrInvalid
	}
	if err != nil {
		return uuid.UUID{}, nil, err
	}
	if usedAt != nil {
		return uuid.UUID{}, nil, fmt.Errorf("%w: install code already used", ErrInvalid)
	}
	if time.Now().UTC().After(expires) {
		return uuid.UUID{}, nil, fmt.Errorf("%w: install code expired", ErrInvalid)
	}
	tag, err := tx.Exec(ctx, `
		UPDATE connect_install_codes SET used_at = now() WHERE id = $1 AND used_at IS NULL
	`, id)
	if err != nil {
		return uuid.UUID{}, nil, err
	}
	if tag.RowsAffected() == 0 {
		return uuid.UUID{}, nil, fmt.Errorf("%w: install code already used", ErrInvalid)
	}
	if err := tx.Commit(ctx); err != nil {
		return uuid.UUID{}, nil, err
	}
	return nsID, createdBy, nil
}

func generateInstallCode() (string, error) {
	b := make([]byte, 24)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	// URL-safe, no padding — works in path segments.
	return "tfi_" + base64.RawURLEncoding.EncodeToString(b), nil
}
