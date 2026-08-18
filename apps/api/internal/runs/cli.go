package runs

import (
	"context"
	"encoding/json"
	"strings"

	"github.com/google/uuid"
)

func (s *Service) StartCLIRun(ctx context.Context, namespaceID uuid.UUID, operation, who string) (Run, error) {
	runType := TypeApply
	op := strings.ToLower(operation)
	switch {
	case strings.Contains(op, "plan"):
		runType = TypePlan
	case strings.Contains(op, "destroy"):
		runType = TypeDestroy
	case strings.Contains(op, "init"):
		runType = TypeInit
	}

	// Reuse an already-running CLI run for this namespace if present.
	var existingID uuid.UUID
	err := s.pool.QueryRow(ctx, `
		SELECT id FROM runs
		WHERE namespace_id = $1 AND source = 'cli' AND status = 'running'
		ORDER BY created_at DESC
		LIMIT 1
	`, namespaceID).Scan(&existingID)
	if err == nil {
		return s.Get(ctx, namespaceID, existingID)
	}

	meta, _ := json.Marshal(map[string]string{
		"operation": operation,
		"who":       who,
		"note":      "no logs available — run via CLI wrapper for full output",
	})

	row := s.pool.QueryRow(ctx, `
		INSERT INTO runs (namespace_id, type, status, source, started_at, summary)
		VALUES ($1, $2, 'running', 'cli', now(), $3::jsonb)
		RETURNING `+runCols+`
	`, namespaceID, string(runType), meta)
	run, err := scanRun(row)
	if err != nil {
		return Run{}, err
	}
	return withDuration(run), nil
}

func (s *Service) AttachCLISummary(ctx context.Context, namespaceID uuid.UUID, summary map[string]any) error {
	body, err := json.Marshal(summary)
	if err != nil {
		return err
	}
	_, err = s.pool.Exec(ctx, `
		UPDATE runs
		SET summary = COALESCE(summary, '{}'::jsonb) || $2::jsonb
		WHERE id = (
			SELECT id FROM runs
			WHERE namespace_id = $1 AND source = 'cli' AND status = 'running'
			ORDER BY created_at DESC
			LIMIT 1
		)
	`, namespaceID, body)
	return err
}

func (s *Service) FinishCLIRun(ctx context.Context, namespaceID uuid.UUID, success bool) error {
	status := StatusSuccess
	if !success {
		status = StatusFailed
	}
	_, err := s.pool.Exec(ctx, `
		UPDATE runs
		SET status = $2::run_status, finished_at = now()
		WHERE id = (
			SELECT id FROM runs
			WHERE namespace_id = $1 AND source = 'cli' AND status = 'running'
			ORDER BY created_at DESC
			LIMIT 1
		)
	`, namespaceID, string(status))
	return err
}

func decodeSummary(raw []byte) map[string]any {
	if len(raw) == 0 {
		return nil
	}
	var m map[string]any
	if err := json.Unmarshal(raw, &m); err != nil {
		return nil
	}
	return m
}
