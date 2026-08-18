package runs

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/terraforge/terraforge/apps/api/internal/namespaces"
	"github.com/terraforge/terraforge/apps/api/internal/queue"
)

var (
	ErrNotFound         = errors.New("run not found")
	ErrValidation       = errors.New("validation failed")
	ErrNotAwaiting      = errors.New("run is not awaiting approval")
	ErrApprovalRequired = errors.New("apply/destroy requires approval via the web UI when require_approval is enabled")
)

type Type string

const (
	TypeInit    Type = "init"
	TypePlan    Type = "plan"
	TypeApply   Type = "apply"
	TypeDestroy Type = "destroy"
)

type Status string

const (
	StatusQueued   Status = "queued"
	StatusRunning  Status = "running"
	StatusSuccess  Status = "success"
	StatusFailed   Status = "failed"
	StatusCanceled Status = "canceled"
)

type Source string

const (
	SourceWeb     Source = "web"
	SourceCLI     Source = "cli"
	SourceWebhook Source = "webhook"
)

type Run struct {
	ID               uuid.UUID      `json:"id"`
	NamespaceID      uuid.UUID      `json:"namespace_id"`
	Type             Type           `json:"type"`
	Status           Status         `json:"status"`
	Source           Source         `json:"source"`
	CommitSHA        *string        `json:"commit_sha"`
	TriggeredBy      *uuid.UUID     `json:"triggered_by"`
	StartedAt        *time.Time     `json:"started_at"`
	FinishedAt       *time.Time     `json:"finished_at"`
	LogPath          *string        `json:"log_path"`
	CreatedAt        time.Time      `json:"created_at"`
	DurationMS       *int64         `json:"duration_ms,omitempty"`
	Summary          map[string]any `json:"summary,omitempty"`
	AwaitingApproval bool           `json:"awaiting_approval"`
	ApprovedBy       *uuid.UUID     `json:"approved_by,omitempty"`
	ApprovedAt       *time.Time     `json:"approved_at,omitempty"`
}

type Service struct {
	pool    *pgxpool.Pool
	queue   *queue.Client
	ns      *namespaces.Service
	dataDir string
}

func NewService(pool *pgxpool.Pool, q *queue.Client, ns *namespaces.Service, dataDir string) *Service {
	return &Service{pool: pool, queue: q, ns: ns, dataDir: dataDir}
}

const runCols = `
	id, namespace_id, type::text, status::text, source::text, commit_sha, triggered_by,
	started_at, finished_at, log_path, created_at, summary,
	awaiting_approval, approved_by, approved_at
`

func (s *Service) Create(ctx context.Context, namespaceID uuid.UUID, runType Type, triggeredBy uuid.UUID) (Run, error) {
	return s.createAndMaybeEnqueue(ctx, namespaceID, runType, SourceWeb, &triggeredBy, false, nil)
}

func (s *Service) CreateWebhookPlan(ctx context.Context, namespaceID uuid.UUID) (Run, error) {
	return s.createAndMaybeEnqueue(ctx, namespaceID, TypePlan, SourceWebhook, nil, false, nil)
}

func (s *Service) CreateWebhookPlanWithMeta(ctx context.Context, namespaceID uuid.UUID, meta map[string]any) (Run, error) {
	return s.createAndMaybeEnqueue(ctx, namespaceID, TypePlan, SourceWebhook, nil, false, meta)
}

func (s *Service) CreateDriftPlan(ctx context.Context, namespaceID uuid.UUID) (Run, error) {
	meta := map[string]any{"drift": true}
	return s.createAndMaybeEnqueue(ctx, namespaceID, TypePlan, SourceWebhook, nil, false, meta)
}

func (s *Service) createAndMaybeEnqueue(
	ctx context.Context,
	namespaceID uuid.UUID,
	runType Type,
	source Source,
	triggeredBy *uuid.UUID,
	forceAwait bool,
	summary map[string]any,
) (Run, error) {
	if err := validateType(runType); err != nil {
		return Run{}, err
	}

	ns, err := s.ns.Get(ctx, namespaceID)
	if err != nil {
		if errors.Is(err, namespaces.ErrNotFound) {
			return Run{}, ErrNotFound
		}
		return Run{}, err
	}

	awaiting := forceAwait
	if !awaiting && ns.RequireApproval && (runType == TypeApply || runType == TypeDestroy) && source == SourceWeb {
		awaiting = true
	}

	sha, err := s.ns.HeadSHA(namespaceID)
	if err != nil {
		return Run{}, fmt.Errorf("resolve commit: %w", err)
	}

	runID := uuid.New()
	logRel := filepath.ToSlash(filepath.Join("logs", namespaceID.String(), runID.String()+".log"))
	logAbs := filepath.Join(s.dataDir, logRel)
	if err := os.MkdirAll(filepath.Dir(logAbs), 0o755); err != nil {
		return Run{}, err
	}

	var summaryRaw any
	if summary != nil {
		summaryRaw = mustJSON(summary)
	}

	var run Run
	row := s.pool.QueryRow(ctx, `
		INSERT INTO runs (id, namespace_id, type, status, source, commit_sha, triggered_by, log_path, awaiting_approval, summary)
		VALUES ($1, $2, $3, 'queued', $4, $5, $6, $7, $8, $9)
		RETURNING `+runCols+`
	`, runID, namespaceID, string(runType), string(source), sha, triggeredBy, logRel, awaiting, summaryRaw)
	run, err = scanRun(row)
	if err != nil {
		return Run{}, err
	}

	if awaiting {
		return withDuration(run), nil
	}

	if err := s.enqueue(ctx, run, ns.TerraformVersion, logAbs); err != nil {
		_, _ = s.pool.Exec(ctx, `
			UPDATE runs SET status = 'failed', finished_at = now()
			WHERE id = $1
		`, run.ID)
		return Run{}, fmt.Errorf("enqueue run: %w", err)
	}
	return withDuration(run), nil
}

func (s *Service) Approve(ctx context.Context, namespaceID, runID, approverID uuid.UUID) (Run, error) {
	run, err := s.Get(ctx, namespaceID, runID)
	if err != nil {
		return Run{}, err
	}
	if !run.AwaitingApproval {
		return Run{}, ErrNotAwaiting
	}

	tag, err := s.pool.Exec(ctx, `
		UPDATE runs
		SET awaiting_approval = false, approved_by = $3, approved_at = now()
		WHERE id = $1 AND namespace_id = $2 AND awaiting_approval = true
	`, runID, namespaceID, approverID)
	if err != nil {
		return Run{}, err
	}
	if tag.RowsAffected() == 0 {
		return Run{}, ErrNotAwaiting
	}

	run, err = s.Get(ctx, namespaceID, runID)
	if err != nil {
		return Run{}, err
	}

	ns, err := s.ns.Get(ctx, namespaceID)
	if err != nil {
		return Run{}, err
	}
	logAbs := s.AbsoluteLogPath(run)
	if err := s.enqueue(ctx, run, ns.TerraformVersion, logAbs); err != nil {
		_, _ = s.pool.Exec(ctx, `
			UPDATE runs SET status = 'failed', finished_at = now(), awaiting_approval = false
			WHERE id = $1
		`, run.ID)
		return Run{}, fmt.Errorf("enqueue run: %w", err)
	}
	return run, nil
}

func (s *Service) enqueue(ctx context.Context, run Run, tfVersion, logAbs string) error {
	job := queue.RunJob{
		RunID:            run.ID.String(),
		NamespaceID:      run.NamespaceID.String(),
		Type:             string(run.Type),
		RepoPath:         s.ns.RepoPath(run.NamespaceID),
		TerraformVersion: tfVersion,
		LogPath:          logAbs,
	}
	return s.queue.EnqueueRun(ctx, job)
}

func (s *Service) MergeSummary(ctx context.Context, runID uuid.UUID, summary map[string]any) error {
	body, err := json.Marshal(summary)
	if err != nil {
		return err
	}
	_, err = s.pool.Exec(ctx, `
		UPDATE runs
		SET summary = COALESCE(summary, '{}'::jsonb) || $2::jsonb
		WHERE id = $1
	`, runID, body)
	return err
}

func (s *Service) Cancel(ctx context.Context, namespaceID, runID uuid.UUID) (Run, error) {
	run, err := s.Get(ctx, namespaceID, runID)
	if err != nil {
		return Run{}, err
	}
	switch run.Status {
	case StatusQueued, StatusRunning:
	default:
		return Run{}, fmt.Errorf("%w: only queued or running runs can be canceled", ErrValidation)
	}
	tag, err := s.pool.Exec(ctx, `
		UPDATE runs
		SET status = 'canceled', finished_at = now(), awaiting_approval = false
		WHERE id = $1 AND namespace_id = $2 AND status IN ('queued', 'running')
	`, runID, namespaceID)
	if err != nil {
		return Run{}, err
	}
	if tag.RowsAffected() == 0 {
		return s.Get(ctx, namespaceID, runID)
	}
	return s.Get(ctx, namespaceID, runID)
}

func (s *Service) IsCanceled(ctx context.Context, runID uuid.UUID) bool {
	var status string
	err := s.pool.QueryRow(ctx, `SELECT status::text FROM runs WHERE id = $1`, runID).Scan(&status)
	return err == nil && status == string(StatusCanceled)
}

func (s *Service) List(ctx context.Context, namespaceID uuid.UUID) ([]Run, error) {
	if _, err := s.ns.Get(ctx, namespaceID); err != nil {
		if errors.Is(err, namespaces.ErrNotFound) {
			return nil, ErrNotFound
		}
		return nil, err
	}

	rows, err := s.pool.Query(ctx, `
		SELECT `+runCols+`
		FROM runs
		WHERE namespace_id = $1
		ORDER BY created_at DESC
		LIMIT 100
	`, namespaceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []Run
	for rows.Next() {
		run, err := scanRun(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, withDuration(run))
	}
	return out, rows.Err()
}

func (s *Service) Get(ctx context.Context, namespaceID, runID uuid.UUID) (Run, error) {
	row := s.pool.QueryRow(ctx, `
		SELECT `+runCols+`
		FROM runs
		WHERE id = $1 AND namespace_id = $2
	`, runID, namespaceID)
	run, err := scanRun(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return Run{}, ErrNotFound
	}
	if err != nil {
		return Run{}, err
	}
	return withDuration(run), nil
}

func validateType(t Type) error {
	switch t {
	case TypeInit, TypePlan, TypeApply, TypeDestroy:
		return nil
	default:
		return fmt.Errorf("%w: type must be init, plan, apply, or destroy", ErrValidation)
	}
}

type scannable interface {
	Scan(dest ...any) error
}

func scanRun(row scannable) (Run, error) {
	var run Run
	var typ, status, source string
	var summaryRaw []byte
	if err := row.Scan(
		&run.ID, &run.NamespaceID, &typ, &status, &source, &run.CommitSHA, &run.TriggeredBy,
		&run.StartedAt, &run.FinishedAt, &run.LogPath, &run.CreatedAt, &summaryRaw,
		&run.AwaitingApproval, &run.ApprovedBy, &run.ApprovedAt,
	); err != nil {
		return Run{}, err
	}
	run.Type = Type(typ)
	run.Status = Status(status)
	run.Source = Source(source)
	run.Summary = decodeSummary(summaryRaw)
	return run, nil
}

func withDuration(run Run) Run {
	if run.StartedAt != nil && run.FinishedAt != nil {
		ms := run.FinishedAt.Sub(*run.StartedAt).Milliseconds()
		run.DurationMS = &ms
	}
	return run
}
