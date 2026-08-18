package tfstate

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	ErrLocked     = errors.New("state is locked")
	ErrLockMismatch = errors.New("lock id mismatch")
	ErrNotFound   = errors.New("state not found")
)

type LockInfo struct {
	ID        string `json:"ID"`
	Operation string `json:"Operation"`
	Info      string `json:"Info"`
	Who       string `json:"Who"`
	Version   string `json:"Version"`
	Created   string `json:"Created"`
	Path      string `json:"Path"`
}

type StateRecord struct {
	NamespaceID uuid.UUID
	StateJSON   []byte
	LockID      *string
	LockInfo    []byte
	UpdatedAt   time.Time
}

type DiffSummary struct {
	Added     int      `json:"added"`
	Changed   int      `json:"changed"`
	Destroyed int      `json:"destroyed"`
	Resources []string `json:"resources,omitempty"`
}

type Service struct {
	pool *pgxpool.Pool
}

func NewService(pool *pgxpool.Pool) *Service {
	return &Service{pool: pool}
}

func (s *Service) GetState(ctx context.Context, namespaceID uuid.UUID) ([]byte, error) {
	var state []byte
	err := s.pool.QueryRow(ctx, `
		SELECT state_json FROM terraform_states WHERE namespace_id = $1
	`, namespaceID).Scan(&state)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return state, err
}

func (s *Service) UpdatedAt(ctx context.Context, namespaceID uuid.UUID) (*time.Time, error) {
	var ts time.Time
	err := s.pool.QueryRow(ctx, `
		SELECT updated_at FROM terraform_states WHERE namespace_id = $1
	`, namespaceID).Scan(&ts)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &ts, nil
}

func (s *Service) PutState(ctx context.Context, namespaceID uuid.UUID, state []byte) error {
	_, err := s.pool.Exec(ctx, `
		INSERT INTO terraform_states (namespace_id, state_json, updated_at)
		VALUES ($1, $2::jsonb, now())
		ON CONFLICT (namespace_id) DO UPDATE
		SET state_json = EXCLUDED.state_json, updated_at = now()
	`, namespaceID, state)
	return err
}

func (s *Service) GetLock(ctx context.Context, namespaceID uuid.UUID) (*LockInfo, error) {
	var lockID *string
	var lockInfo []byte
	err := s.pool.QueryRow(ctx, `
		SELECT lock_id, lock_info FROM terraform_states WHERE namespace_id = $1
	`, namespaceID).Scan(&lockID, &lockInfo)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if lockID == nil || *lockID == "" {
		return nil, nil
	}
	var info LockInfo
	if len(lockInfo) > 0 {
		_ = json.Unmarshal(lockInfo, &info)
	}
	if info.ID == "" {
		info.ID = *lockID
	}
	return &info, nil
}

func (s *Service) Lock(ctx context.Context, namespaceID uuid.UUID, info LockInfo) error {
	if info.ID == "" {
		return fmt.Errorf("lock id required")
	}
	infoJSON, err := json.Marshal(info)
	if err != nil {
		return err
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	var lockID *string
	var existingInfo []byte
	err = tx.QueryRow(ctx, `
		SELECT lock_id, lock_info FROM terraform_states WHERE namespace_id = $1 FOR UPDATE
	`, namespaceID).Scan(&lockID, &existingInfo)
	if errors.Is(err, pgx.ErrNoRows) {
		_, err = tx.Exec(ctx, `
			INSERT INTO terraform_states (namespace_id, lock_id, lock_info, updated_at)
			VALUES ($1, $2, $3::jsonb, now())
		`, namespaceID, info.ID, infoJSON)
		if err != nil {
			return err
		}
		return tx.Commit(ctx)
	}
	if err != nil {
		return err
	}
	if lockID != nil && *lockID != "" {
		var current LockInfo
		_ = json.Unmarshal(existingInfo, &current)
		if current.ID == "" {
			current.ID = *lockID
		}
		return fmt.Errorf("%w: %s", ErrLocked, current.ID)
	}
	_, err = tx.Exec(ctx, `
		UPDATE terraform_states
		SET lock_id = $2, lock_info = $3::jsonb, updated_at = now()
		WHERE namespace_id = $1
	`, namespaceID, info.ID, infoJSON)
	if err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (s *Service) Unlock(ctx context.Context, namespaceID uuid.UUID, info LockInfo) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	var lockID *string
	err = tx.QueryRow(ctx, `
		SELECT lock_id FROM terraform_states WHERE namespace_id = $1 FOR UPDATE
	`, namespaceID).Scan(&lockID)
	if errors.Is(err, pgx.ErrNoRows) {
		return tx.Commit(ctx)
	}
	if err != nil {
		return err
	}
	if lockID != nil && *lockID != "" && info.ID != "" && *lockID != info.ID {
		return ErrLockMismatch
	}
	_, err = tx.Exec(ctx, `
		UPDATE terraform_states
		SET lock_id = NULL, lock_info = NULL, updated_at = now()
		WHERE namespace_id = $1
	`, namespaceID)
	if err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// DiffStates compares Terraform state JSON and returns a coarse resource summary.
func DiffStates(before, after []byte) DiffSummary {
	beforeAddrs := resourceAddrs(before)
	afterAddrs := resourceAddrs(after)

	var summary DiffSummary
	for addr := range afterAddrs {
		if _, ok := beforeAddrs[addr]; !ok {
			summary.Added++
			summary.Resources = append(summary.Resources, "+ "+addr)
		} else {
			// Treat present-in-both as potentially changed if serialized instance differs.
			if beforeAddrs[addr] != afterAddrs[addr] {
				summary.Changed++
				summary.Resources = append(summary.Resources, "~ "+addr)
			}
		}
	}
	for addr := range beforeAddrs {
		if _, ok := afterAddrs[addr]; !ok {
			summary.Destroyed++
			summary.Resources = append(summary.Resources, "- "+addr)
		}
	}
	return summary
}

func resourceAddrs(state []byte) map[string]string {
	out := map[string]string{}
	if len(state) == 0 {
		return out
	}
	var doc struct {
		Resources []struct {
			Mode      string `json:"mode"`
			Type      string `json:"type"`
			Name      string `json:"name"`
			Provider  string `json:"provider"`
			Instances []struct {
				AttributesJSON json.RawMessage `json:"attributes_flat"`
				Attributes     json.RawMessage `json:"attributes"`
				IndexKey       any             `json:"index_key"`
			} `json:"instances"`
		} `json:"resources"`
	}
	if err := json.Unmarshal(state, &doc); err != nil {
		return out
	}
	for _, r := range doc.Resources {
		if r.Mode != "managed" && r.Mode != "" {
			// still include data sources lightly; prefer managed
		}
		base := r.Type + "." + r.Name
		if len(r.Instances) == 0 {
			out[base] = ""
			continue
		}
		for _, inst := range r.Instances {
			addr := base
			if inst.IndexKey != nil {
				addr = fmt.Sprintf("%s[%v]", base, inst.IndexKey)
			}
			payload := inst.Attributes
			if len(payload) == 0 {
				payload = inst.AttributesJSON
			}
			out[addr] = string(payload)
		}
	}
	return out
}
