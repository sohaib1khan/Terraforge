package audit

import (
	"context"
	"encoding/json"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Entry struct {
	ID        uuid.UUID      `json:"id"`
	Actor     string         `json:"actor"`
	Action    string         `json:"action"`
	Target    *string        `json:"target"`
	Metadata  map[string]any `json:"metadata,omitempty"`
	CreatedAt time.Time      `json:"created_at"`
}

type Service struct {
	pool *pgxpool.Pool
}

func NewService(pool *pgxpool.Pool) *Service {
	return &Service{pool: pool}
}

func (s *Service) Write(ctx context.Context, actor, action, target string, metadata map[string]any) {
	var meta any
	if metadata != nil {
		b, _ := json.Marshal(metadata)
		meta = b
	}
	var tgt *string
	if target != "" {
		tgt = &target
	}
	_, _ = s.pool.Exec(ctx, `
		INSERT INTO audit_log (actor, action, target, metadata)
		VALUES ($1, $2, $3, $4::jsonb)
	`, actor, action, tgt, meta)
}

func (s *Service) List(ctx context.Context, limit int) ([]Entry, error) {
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	rows, err := s.pool.Query(ctx, `
		SELECT id, actor, action, target, metadata, created_at
		FROM audit_log
		ORDER BY created_at DESC
		LIMIT $1
	`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []Entry
	for rows.Next() {
		var e Entry
		var meta []byte
		if err := rows.Scan(&e.ID, &e.Actor, &e.Action, &e.Target, &meta, &e.CreatedAt); err != nil {
			return nil, err
		}
		if len(meta) > 0 {
			_ = json.Unmarshal(meta, &e.Metadata)
		}
		out = append(out, e)
	}
	return out, rows.Err()
}
