package secrets

import (
	"context"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/terraforge/terraforge/apps/api/internal/crypto"
)

var (
	ErrSecretNotFound = errors.New("secret not found")
	ErrBadKey         = errors.New("invalid secret key")
)

var keyPattern = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*$`)

var blockedKeys = map[string]bool{
	"PATH": true, "HOME": true, "USER": true, "SHELL": true,
	"LD_PRELOAD": true, "LD_LIBRARY_PATH": true,
	"DOCKER_HOST": true, "DOCKER_API_VERSION": true,
	"AWS_CONTAINER_CREDENTIALS_RELATIVE_URI": true,
}

type NamespaceSecret struct {
	ID          uuid.UUID `json:"id"`
	NamespaceID uuid.UUID `json:"namespace_id"`
	Key         string    `json:"key"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

func (s *Service) List(ctx context.Context, namespaceID uuid.UUID) ([]NamespaceSecret, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id, namespace_id, key, created_at, updated_at
		FROM namespace_secrets
		WHERE namespace_id = $1
		ORDER BY key ASC
	`, namespaceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []NamespaceSecret
	for rows.Next() {
		var sec NamespaceSecret
		if err := rows.Scan(&sec.ID, &sec.NamespaceID, &sec.Key, &sec.CreatedAt, &sec.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, sec)
	}
	return out, rows.Err()
}

func (s *Service) Upsert(ctx context.Context, namespaceID uuid.UUID, key, value string) (NamespaceSecret, error) {
	key = strings.TrimSpace(key)
	if err := validateKey(key); err != nil {
		return NamespaceSecret{}, err
	}
	if value == "" {
		return NamespaceSecret{}, fmt.Errorf("%w: value required", ErrBadKey)
	}
	ct, nonce, err := crypto.Seal(s.key, []byte(value))
	if err != nil {
		return NamespaceSecret{}, err
	}
	var sec NamespaceSecret
	err = s.pool.QueryRow(ctx, `
		INSERT INTO namespace_secrets (namespace_id, key, ciphertext, nonce)
		VALUES ($1, $2, $3, $4)
		ON CONFLICT (namespace_id, key) DO UPDATE
		SET ciphertext = EXCLUDED.ciphertext,
		    nonce = EXCLUDED.nonce,
		    updated_at = now()
		RETURNING id, namespace_id, key, created_at, updated_at
	`, namespaceID, key, ct, nonce).Scan(&sec.ID, &sec.NamespaceID, &sec.Key, &sec.CreatedAt, &sec.UpdatedAt)
	return sec, err
}

func (s *Service) Delete(ctx context.Context, namespaceID, secretID uuid.UUID) error {
	tag, err := s.pool.Exec(ctx, `
		DELETE FROM namespace_secrets WHERE id = $1 AND namespace_id = $2
	`, secretID, namespaceID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrSecretNotFound
	}
	return nil
}

// EnvMap returns decrypted secrets as docker -e KEY=value pairs (map).
func (s *Service) EnvMap(ctx context.Context, namespaceID uuid.UUID) (map[string]string, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT key, ciphertext, nonce FROM namespace_secrets WHERE namespace_id = $1
	`, namespaceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]string{}
	for rows.Next() {
		var key string
		var ct, nonce []byte
		if err := rows.Scan(&key, &ct, &nonce); err != nil {
			return nil, err
		}
		plain, err := crypto.Open(s.key, ct, nonce)
		if err != nil {
			return nil, fmt.Errorf("decrypt %s: %w", key, err)
		}
		out[key] = string(plain)
	}
	return out, rows.Err()
}

func validateKey(key string) error {
	if !keyPattern.MatchString(key) {
		return fmt.Errorf("%w: use letters, numbers, underscore (e.g. TF_VAR_region or AWS_ACCESS_KEY_ID)", ErrBadKey)
	}
	if blockedKeys[strings.ToUpper(key)] {
		return fmt.Errorf("%w: key %q is not allowed", ErrBadKey, key)
	}
	if len(key) > 128 {
		return fmt.Errorf("%w: key too long", ErrBadKey)
	}
	return nil
}

func GetByID(ctx context.Context, pool *pgxpool.Pool, namespaceID, secretID uuid.UUID) (NamespaceSecret, error) {
	var sec NamespaceSecret
	err := pool.QueryRow(ctx, `
		SELECT id, namespace_id, key, created_at, updated_at
		FROM namespace_secrets WHERE id = $1 AND namespace_id = $2
	`, secretID, namespaceID).Scan(&sec.ID, &sec.NamespaceID, &sec.Key, &sec.CreatedAt, &sec.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return NamespaceSecret{}, ErrSecretNotFound
	}
	return sec, err
}
