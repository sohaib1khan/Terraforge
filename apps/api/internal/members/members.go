package members

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Role string

const (
	RoleAdmin  Role = "admin"
	RoleWriter Role = "writer"
	RoleViewer Role = "viewer"
)

var (
	ErrForbidden = errors.New("forbidden")
	ErrNotFound  = errors.New("member not found")
	ErrConflict  = errors.New("member already exists")
)

type Member struct {
	NamespaceID uuid.UUID `json:"namespace_id"`
	UserID      uuid.UUID `json:"user_id"`
	Email       string    `json:"email"`
	Role        Role      `json:"role"`
	CreatedAt   time.Time `json:"created_at"`
}

type Service struct {
	pool *pgxpool.Pool
}

func NewService(pool *pgxpool.Pool) *Service {
	return &Service{pool: pool}
}

func (s *Service) Add(ctx context.Context, namespaceID, userID uuid.UUID, role Role) (Member, error) {
	if !validRole(role) {
		return Member{}, fmt.Errorf("invalid role")
	}
	_, err := s.pool.Exec(ctx, `
		INSERT INTO namespace_members (namespace_id, user_id, role)
		VALUES ($1, $2, $3)
	`, namespaceID, userID, string(role))
	if err != nil {
		return Member{}, err
	}
	return s.Get(ctx, namespaceID, userID)
}

func (s *Service) Upsert(ctx context.Context, namespaceID, userID uuid.UUID, role Role) (Member, error) {
	if !validRole(role) {
		return Member{}, fmt.Errorf("invalid role")
	}
	_, err := s.pool.Exec(ctx, `
		INSERT INTO namespace_members (namespace_id, user_id, role)
		VALUES ($1, $2, $3)
		ON CONFLICT (namespace_id, user_id) DO UPDATE SET role = EXCLUDED.role
	`, namespaceID, userID, string(role))
	if err != nil {
		return Member{}, err
	}
	return s.Get(ctx, namespaceID, userID)
}

func (s *Service) Remove(ctx context.Context, namespaceID, userID uuid.UUID) error {
	tag, err := s.pool.Exec(ctx, `
		DELETE FROM namespace_members WHERE namespace_id = $1 AND user_id = $2
	`, namespaceID, userID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *Service) List(ctx context.Context, namespaceID uuid.UUID) ([]Member, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT m.namespace_id, m.user_id, u.email, m.role::text, m.created_at
		FROM namespace_members m
		JOIN users u ON u.id = m.user_id
		WHERE m.namespace_id = $1
		ORDER BY m.created_at ASC
	`, namespaceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Member
	for rows.Next() {
		var m Member
		var role string
		if err := rows.Scan(&m.NamespaceID, &m.UserID, &m.Email, &role, &m.CreatedAt); err != nil {
			return nil, err
		}
		m.Role = Role(role)
		out = append(out, m)
	}
	return out, rows.Err()
}

func (s *Service) Get(ctx context.Context, namespaceID, userID uuid.UUID) (Member, error) {
	var m Member
	var role string
	err := s.pool.QueryRow(ctx, `
		SELECT m.namespace_id, m.user_id, u.email, m.role::text, m.created_at
		FROM namespace_members m
		JOIN users u ON u.id = m.user_id
		WHERE m.namespace_id = $1 AND m.user_id = $2
	`, namespaceID, userID).Scan(&m.NamespaceID, &m.UserID, &m.Email, &role, &m.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return Member{}, ErrNotFound
	}
	if err != nil {
		return Member{}, err
	}
	m.Role = Role(role)
	return m, nil
}

func (s *Service) RoleOf(ctx context.Context, namespaceID, userID uuid.UUID, isPlatformAdmin bool) (Role, error) {
	if isPlatformAdmin {
		return RoleAdmin, nil
	}
	m, err := s.Get(ctx, namespaceID, userID)
	if err != nil {
		return "", err
	}
	return m.Role, nil
}

func (s *Service) Require(ctx context.Context, namespaceID, userID uuid.UUID, isPlatformAdmin bool, min Role) error {
	role, err := s.RoleOf(ctx, namespaceID, userID, isPlatformAdmin)
	if errors.Is(err, ErrNotFound) {
		return ErrForbidden
	}
	if err != nil {
		return err
	}
	if !roleAtLeast(role, min) {
		return ErrForbidden
	}
	return nil
}

func (s *Service) AccessibleNamespaceIDs(ctx context.Context, userID uuid.UUID, isPlatformAdmin bool) ([]uuid.UUID, error) {
	if isPlatformAdmin {
		rows, err := s.pool.Query(ctx, `SELECT id FROM namespaces`)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		var ids []uuid.UUID
		for rows.Next() {
			var id uuid.UUID
			if err := rows.Scan(&id); err != nil {
				return nil, err
			}
			ids = append(ids, id)
		}
		return ids, rows.Err()
	}
	rows, err := s.pool.Query(ctx, `
		SELECT namespace_id FROM namespace_members WHERE user_id = $1
	`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var ids []uuid.UUID
	for rows.Next() {
		var id uuid.UUID
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

func validRole(r Role) bool {
	return r == RoleAdmin || r == RoleWriter || r == RoleViewer
}

func roleAtLeast(have, need Role) bool {
	rank := map[Role]int{RoleViewer: 1, RoleWriter: 2, RoleAdmin: 3}
	return rank[have] >= rank[need]
}
