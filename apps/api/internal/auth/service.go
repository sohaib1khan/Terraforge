package auth

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	ErrSetupComplete = errors.New("setup already complete")
	ErrInvalidCreds  = errors.New("invalid email or password")
	ErrValidation    = errors.New("validation failed")
	ErrUserNotFound  = errors.New("user not found")
	ErrConflict      = errors.New("user already exists")
	ErrForbidden     = errors.New("forbidden")
	ErrDisabled      = errors.New("account disabled")
)

type User struct {
	ID           uuid.UUID  `json:"id"`
	Email        string     `json:"email"`
	IsAdmin      bool       `json:"is_admin"`
	CreatedAt    time.Time  `json:"created_at"`
	DisabledAt   *time.Time `json:"disabled_at,omitempty"`
	PasswordHash string     `json:"-"`
}

type Service struct {
	pool      *pgxpool.Pool
	jwtSecret []byte
	tokenTTL  time.Duration
}

func NewService(pool *pgxpool.Pool, jwtSecret string, tokenTTL time.Duration) *Service {
	if tokenTTL <= 0 {
		tokenTTL = 24 * time.Hour
	}
	return &Service{
		pool:      pool,
		jwtSecret: []byte(jwtSecret),
		tokenTTL:  tokenTTL,
	}
}

func (s *Service) NeedsSetup(ctx context.Context) (bool, error) {
	var count int
	if err := s.pool.QueryRow(ctx, `SELECT COUNT(*) FROM users`).Scan(&count); err != nil {
		return false, err
	}
	return count == 0, nil
}

func (s *Service) CreateFirstAdmin(ctx context.Context, email, password string) (User, error) {
	email = normalizeEmail(email)
	if err := validateCredentials(email, password); err != nil {
		return User{}, err
	}

	needs, err := s.NeedsSetup(ctx)
	if err != nil {
		return User{}, err
	}
	if !needs {
		return User{}, ErrSetupComplete
	}

	hash, err := HashPassword(password)
	if err != nil {
		return User{}, err
	}

	var user User
	err = s.pool.QueryRow(ctx, `
		INSERT INTO users (email, password_hash, is_admin)
		VALUES ($1, $2, true)
		RETURNING id, email, is_admin, created_at, disabled_at
	`, email, hash).Scan(&user.ID, &user.Email, &user.IsAdmin, &user.CreatedAt, &user.DisabledAt)
	if err != nil {
		return User{}, fmt.Errorf("insert admin: %w", err)
	}
	return user, nil
}

func (s *Service) Authenticate(ctx context.Context, email, password string) (User, error) {
	email = normalizeEmail(email)
	if email == "" || password == "" {
		return User{}, ErrInvalidCreds
	}

	var user User
	err := s.pool.QueryRow(ctx, `
		SELECT id, email, password_hash, is_admin, created_at, disabled_at
		FROM users WHERE email = $1
	`, email).Scan(&user.ID, &user.Email, &user.PasswordHash, &user.IsAdmin, &user.CreatedAt, &user.DisabledAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return User{}, ErrInvalidCreds
	}
	if err != nil {
		return User{}, err
	}
	if user.DisabledAt != nil {
		return User{}, ErrDisabled
	}
	if !CheckPassword(user.PasswordHash, password) {
		return User{}, ErrInvalidCreds
	}
	user.PasswordHash = ""
	return user, nil
}

func (s *Service) GetUser(ctx context.Context, id uuid.UUID) (User, error) {
	var user User
	err := s.pool.QueryRow(ctx, `
		SELECT id, email, is_admin, created_at, disabled_at
		FROM users WHERE id = $1
	`, id).Scan(&user.ID, &user.Email, &user.IsAdmin, &user.CreatedAt, &user.DisabledAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return User{}, ErrUserNotFound
	}
	if err != nil {
		return User{}, err
	}
	return user, nil
}

func (s *Service) FindByEmail(ctx context.Context, email string) (User, error) {
	email = normalizeEmail(email)
	var user User
	err := s.pool.QueryRow(ctx, `
		SELECT id, email, is_admin, created_at, disabled_at
		FROM users WHERE email = $1
	`, email).Scan(&user.ID, &user.Email, &user.IsAdmin, &user.CreatedAt, &user.DisabledAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return User{}, ErrUserNotFound
	}
	if err != nil {
		return User{}, err
	}
	return user, nil
}

func (s *Service) ListUsers(ctx context.Context) ([]User, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id, email, is_admin, created_at, disabled_at
		FROM users
		ORDER BY created_at ASC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []User
	for rows.Next() {
		var user User
		if err := rows.Scan(&user.ID, &user.Email, &user.IsAdmin, &user.CreatedAt, &user.DisabledAt); err != nil {
			return nil, err
		}
		out = append(out, user)
	}
	return out, rows.Err()
}

type CreateUserInput struct {
	Email    string
	Password string
	IsAdmin  bool
}

func (s *Service) CreateUser(ctx context.Context, in CreateUserInput) (User, error) {
	email := normalizeEmail(in.Email)
	if err := validateCredentials(email, in.Password); err != nil {
		return User{}, err
	}

	hash, err := HashPassword(in.Password)
	if err != nil {
		return User{}, err
	}

	var user User
	err = s.pool.QueryRow(ctx, `
		INSERT INTO users (email, password_hash, is_admin)
		VALUES ($1, $2, $3)
		RETURNING id, email, is_admin, created_at, disabled_at
	`, email, hash, in.IsAdmin).Scan(&user.ID, &user.Email, &user.IsAdmin, &user.CreatedAt, &user.DisabledAt)
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			return User{}, fmt.Errorf("%w: email already registered", ErrConflict)
		}
		return User{}, fmt.Errorf("insert user: %w", err)
	}
	return user, nil
}

func (s *Service) ResetPassword(ctx context.Context, userID uuid.UUID, password string) error {
	if len(password) < 8 {
		return fmt.Errorf("%w: password must be at least 8 characters", ErrValidation)
	}
	hash, err := HashPassword(password)
	if err != nil {
		return err
	}
	tag, err := s.pool.Exec(ctx, `
		UPDATE users SET password_hash = $2 WHERE id = $1
	`, userID, hash)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrUserNotFound
	}
	return nil
}

func (s *Service) SetDisabled(ctx context.Context, userID uuid.UUID, disabled bool) (User, error) {
	var err error
	if disabled {
		_, err = s.pool.Exec(ctx, `
			UPDATE users SET disabled_at = now() WHERE id = $1 AND disabled_at IS NULL
		`, userID)
	} else {
		_, err = s.pool.Exec(ctx, `
			UPDATE users SET disabled_at = NULL WHERE id = $1
		`, userID)
	}
	if err != nil {
		return User{}, err
	}
	return s.GetUser(ctx, userID)
}

func normalizeEmail(email string) string {
	return strings.ToLower(strings.TrimSpace(email))
}

func validateCredentials(email, password string) error {
	if email == "" || !strings.Contains(email, "@") {
		return fmt.Errorf("%w: email must be valid", ErrValidation)
	}
	if len(password) < 8 {
		return fmt.Errorf("%w: password must be at least 8 characters", ErrValidation)
	}
	return nil
}
