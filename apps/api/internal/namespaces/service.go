package namespaces

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
	ErrNotFound   = errors.New("namespace not found")
	ErrConflict   = errors.New("namespace already exists")
	ErrValidation = errors.New("validation failed")
)

type Status string

const (
	StatusNeverRun Status = "never_run"
	StatusRunning  Status = "running"
	StatusHealthy  Status = "healthy"
	StatusFailed   Status = "failed"
)

type Namespace struct {
	ID                   uuid.UUID  `json:"id"`
	Name                 string     `json:"name"`
	Slug                 string     `json:"slug"`
	TerraformVersion     string     `json:"terraform_version"`
	HasRemote            bool       `json:"has_remote"`
	RemoteURL            *string    `json:"remote_url"`
	DefaultBranch        string     `json:"default_branch"`
	RequireApproval      bool       `json:"require_approval"`
	DriftIntervalMinutes *int       `json:"drift_interval_minutes"`
	HasDrift             bool       `json:"has_drift"`
	DriftDetectedAt      *time.Time `json:"drift_detected_at,omitempty"`
	CreatedAt            time.Time  `json:"created_at"`
	Status               Status     `json:"status"`
}

type CreateInput struct {
	Name             string
	Slug             string
	TerraformVersion string
}

type Service struct {
	pool    *pgxpool.Pool
	dataDir string
}

func NewService(pool *pgxpool.Pool, dataDir string) *Service {
	return &Service{pool: pool, dataDir: dataDir}
}

const nsSelect = `
	SELECT
		n.id, n.name, n.slug, n.terraform_version, n.has_remote,
		n.remote_url, n.default_branch, n.require_approval, n.drift_interval_minutes,
		n.has_drift, n.drift_detected_at, n.created_at,
		(
			SELECT r.status::text
			FROM runs r
			WHERE r.namespace_id = n.id
			ORDER BY r.created_at DESC
			LIMIT 1
		) AS last_run_status
	FROM namespaces n
`

func (s *Service) List(ctx context.Context) ([]Namespace, error) {
	rows, err := s.pool.Query(ctx, nsSelect+` ORDER BY n.created_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return collectNamespaces(rows)
}

func (s *Service) ListByIDs(ctx context.Context, ids []uuid.UUID) ([]Namespace, error) {
	if len(ids) == 0 {
		return []Namespace{}, nil
	}
	rows, err := s.pool.Query(ctx, nsSelect+` WHERE n.id = ANY($1) ORDER BY n.created_at DESC`, ids)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return collectNamespaces(rows)
}

func (s *Service) Get(ctx context.Context, id uuid.UUID) (Namespace, error) {
	row := s.pool.QueryRow(ctx, nsSelect+` WHERE n.id = $1`, id)
	ns, err := scanNamespace(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return Namespace{}, ErrNotFound
	}
	return ns, err
}

func (s *Service) Create(ctx context.Context, in CreateInput) (Namespace, error) {
	name := strings.TrimSpace(in.Name)
	if err := validateName(name); err != nil {
		return Namespace{}, err
	}

	slug := strings.TrimSpace(in.Slug)
	if slug == "" {
		slug = slugify(name)
	} else {
		slug = slugify(slug)
	}
	if err := validateSlug(slug); err != nil {
		return Namespace{}, err
	}

	tfVersion := strings.TrimSpace(in.TerraformVersion)
	if tfVersion == "" {
		tfVersion = "1.9.0"
	}
	if err := validateTerraformVersion(tfVersion); err != nil {
		return Namespace{}, err
	}

	const defaultBranch = "main"

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return Namespace{}, err
	}
	defer tx.Rollback(ctx)

	var ns Namespace
	err = tx.QueryRow(ctx, `
		INSERT INTO namespaces (name, slug, terraform_version, default_branch)
		VALUES ($1, $2, $3, $4)
		RETURNING id, name, slug, terraform_version, has_remote, remote_url, default_branch,
		          require_approval, drift_interval_minutes, has_drift, drift_detected_at, created_at
	`, name, slug, tfVersion, defaultBranch).Scan(
		&ns.ID, &ns.Name, &ns.Slug, &ns.TerraformVersion, &ns.HasRemote,
		&ns.RemoteURL, &ns.DefaultBranch, &ns.RequireApproval, &ns.DriftIntervalMinutes,
		&ns.HasDrift, &ns.DriftDetectedAt, &ns.CreatedAt,
	)
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			return Namespace{}, fmt.Errorf("%w: slug %q is taken", ErrConflict, slug)
		}
		return Namespace{}, err
	}
	ns.Status = StatusNeverRun

	if err := s.initLocalRepo(ns.ID.String(), defaultBranch); err != nil {
		_ = s.removeLocalRepo(ns.ID.String())
		return Namespace{}, err
	}

	if err := tx.Commit(ctx); err != nil {
		_ = s.removeLocalRepo(ns.ID.String())
		return Namespace{}, err
	}
	return ns, nil
}

type UpdateSettingsInput struct {
	RequireApproval      *bool
	DriftIntervalMinutes *int
}

func (s *Service) UpdateSettings(ctx context.Context, id uuid.UUID, in UpdateSettingsInput) (Namespace, error) {
	ns, err := s.Get(ctx, id)
	if err != nil {
		return Namespace{}, err
	}
	req := ns.RequireApproval
	if in.RequireApproval != nil {
		req = *in.RequireApproval
	}
	drift := ns.DriftIntervalMinutes
	if in.DriftIntervalMinutes != nil {
		v := *in.DriftIntervalMinutes
		if v <= 0 {
			drift = nil
		} else {
			drift = &v
		}
	}
	_, err = s.pool.Exec(ctx, `
		UPDATE namespaces
		SET require_approval = $2, drift_interval_minutes = $3
		WHERE id = $1
	`, id, req, drift)
	if err != nil {
		return Namespace{}, err
	}
	return s.Get(ctx, id)
}

func (s *Service) SetDrift(ctx context.Context, id uuid.UUID, hasDrift bool) error {
	if hasDrift {
		_, err := s.pool.Exec(ctx, `
			UPDATE namespaces SET has_drift = true, drift_detected_at = now() WHERE id = $1
		`, id)
		return err
	}
	_, err := s.pool.Exec(ctx, `
		UPDATE namespaces SET has_drift = false, drift_detected_at = NULL WHERE id = $1
	`, id)
	return err
}

func (s *Service) Delete(ctx context.Context, id uuid.UUID) error {
	tag, err := s.pool.Exec(ctx, `DELETE FROM namespaces WHERE id = $1`, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	if err := s.removeLocalRepo(id.String()); err != nil {
		return err
	}
	return nil
}

func (s *Service) ListDueForDrift(ctx context.Context) ([]Namespace, error) {
	rows, err := s.pool.Query(ctx, nsSelect+`
		WHERE n.drift_interval_minutes IS NOT NULL
		  AND n.drift_interval_minutes > 0
		  AND (
			NOT EXISTS (
				SELECT 1 FROM runs r
				WHERE r.namespace_id = n.id
				  AND COALESCE(r.summary->>'drift', 'false') = 'true'
			)
			OR (
				SELECT MAX(r.created_at) FROM runs r
				WHERE r.namespace_id = n.id
				  AND COALESCE(r.summary->>'drift', 'false') = 'true'
			) < now() - make_interval(mins => n.drift_interval_minutes)
		  )
		  AND NOT EXISTS (
			SELECT 1 FROM runs r
			WHERE r.namespace_id = n.id
			  AND r.status IN ('queued', 'running')
			  AND COALESCE(r.summary->>'drift', 'false') = 'true'
		  )
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return collectNamespaces(rows)
}

type scannable interface {
	Scan(dest ...any) error
}

type rowIter interface {
	Next() bool
	Scan(dest ...any) error
	Err() error
}

func collectNamespaces(rows rowIter) ([]Namespace, error) {
	var out []Namespace
	for rows.Next() {
		ns, err := scanNamespace(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, ns)
	}
	return out, rows.Err()
}

func scanNamespace(row scannable) (Namespace, error) {
	var ns Namespace
	var lastRun *string
	if err := row.Scan(
		&ns.ID, &ns.Name, &ns.Slug, &ns.TerraformVersion, &ns.HasRemote,
		&ns.RemoteURL, &ns.DefaultBranch, &ns.RequireApproval, &ns.DriftIntervalMinutes,
		&ns.HasDrift, &ns.DriftDetectedAt, &ns.CreatedAt, &lastRun,
	); err != nil {
		return Namespace{}, err
	}
	ns.Status = statusFromLastRun(lastRun)
	return ns, nil
}

func statusFromLastRun(last *string) Status {
	if last == nil {
		return StatusNeverRun
	}
	switch *last {
	case "queued", "running":
		return StatusRunning
	case "success":
		return StatusHealthy
	case "failed", "canceled":
		return StatusFailed
	default:
		return StatusNeverRun
	}
}
