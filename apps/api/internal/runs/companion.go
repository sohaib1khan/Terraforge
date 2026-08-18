package runs

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"

	"github.com/google/uuid"
	"github.com/terraforge/terraforge/apps/api/internal/namespaces"
)

// CreateCompanionCLI registers a local companion-CLI run (no worker enqueue).
func (s *Service) CreateCompanionCLI(ctx context.Context, namespaceID uuid.UUID, runType Type, triggeredBy *uuid.UUID) (Run, error) {
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
	if ns.RequireApproval && (runType == TypeApply || runType == TypeDestroy) {
		return Run{}, ErrApprovalRequired
	}

	sha, _ := s.ns.HeadSHA(namespaceID)
	runID := uuid.New()
	logRel := filepath.ToSlash(filepath.Join("logs", namespaceID.String(), runID.String()+".log"))
	logAbs := filepath.Join(s.dataDir, logRel)
	if err := os.MkdirAll(filepath.Dir(logAbs), 0o755); err != nil {
		return Run{}, err
	}
	if f, err := os.OpenFile(logAbs, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o644); err == nil {
		_ = f.Close()
	}

	row := s.pool.QueryRow(ctx, `
		INSERT INTO runs (id, namespace_id, type, status, source, commit_sha, triggered_by, log_path, started_at)
		VALUES ($1, $2, $3, 'running', 'cli', $4, $5, $6, now())
		RETURNING `+runCols+`
	`, runID, namespaceID, string(runType), nullIfEmpty(sha), triggeredBy, logRel)
	run, err := scanRun(row)
	if err != nil {
		return Run{}, fmt.Errorf("insert companion run: %w", err)
	}
	return withDuration(run), nil
}

func (s *Service) AbsoluteLogPath(run Run) string {
	if run.LogPath == nil || *run.LogPath == "" {
		return ""
	}
	if filepath.IsAbs(*run.LogPath) {
		return *run.LogPath
	}
	return filepath.Join(s.dataDir, *run.LogPath)
}

func (s *Service) AppendLogLines(ctx context.Context, namespaceID, runID uuid.UUID, lines []string) (Run, error) {
	run, err := s.Get(ctx, namespaceID, runID)
	if err != nil {
		return Run{}, err
	}
	path := s.AbsoluteLogPath(run)
	if path == "" {
		return run, fmt.Errorf("run has no log path")
	}
	f, err := os.OpenFile(path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		return Run{}, err
	}
	defer f.Close()
	for _, line := range lines {
		if _, err := f.WriteString(line + "\n"); err != nil {
			return Run{}, err
		}
	}
	return run, nil
}

func (s *Service) Complete(ctx context.Context, namespaceID, runID uuid.UUID, status Status) (Run, error) {
	switch status {
	case StatusSuccess, StatusFailed, StatusCanceled:
	default:
		return Run{}, fmt.Errorf("%w: status must be success, failed, or canceled", ErrValidation)
	}
	tag, err := s.pool.Exec(ctx, `
		UPDATE runs
		SET status = $3::run_status, finished_at = now()
		WHERE id = $1 AND namespace_id = $2 AND status IN ('queued', 'running')
	`, runID, namespaceID, string(status))
	if err != nil {
		return Run{}, err
	}
	if tag.RowsAffected() == 0 {
		return s.Get(ctx, namespaceID, runID)
	}
	return s.Get(ctx, namespaceID, runID)
}

func nullIfEmpty(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

func mustJSON(v any) []byte {
	b, _ := json.Marshal(v)
	return b
}
