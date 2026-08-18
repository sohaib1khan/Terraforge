package executor

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
	"github.com/terraforge/terraforge/apps/api/internal/githubx"
	"github.com/terraforge/terraforge/apps/api/internal/notify"
	"github.com/terraforge/terraforge/apps/api/internal/planparse"
	"github.com/terraforge/terraforge/apps/api/internal/queue"
	"github.com/terraforge/terraforge/apps/api/internal/runner"
	"github.com/terraforge/terraforge/apps/api/internal/secrets"
)

type Config struct {
	RunnerImage string
	Timeout     time.Duration
}

type Executor struct {
	pool    *pgxpool.Pool
	rdb     *redis.Client
	cfg     Config
	secrets *secrets.Service
}

func New(pool *pgxpool.Pool, rdb *redis.Client, cfg Config, secretsSvc *secrets.Service) *Executor {
	return &Executor{pool: pool, rdb: rdb, cfg: cfg, secrets: secretsSvc}
}

func (e *Executor) Run(ctx context.Context) error {
	log.Println("worker listening on", queue.RunsQueueKey)
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		res, err := e.rdb.BLPop(ctx, 5*time.Second, queue.RunsQueueKey).Result()
		if err == redis.Nil {
			continue
		}
		if err != nil {
			if ctx.Err() != nil {
				return ctx.Err()
			}
			log.Printf("blpop: %v", err)
			time.Sleep(time.Second)
			continue
		}
		if len(res) < 2 {
			continue
		}

		var job queue.RunJob
		if err := json.Unmarshal([]byte(res[1]), &job); err != nil {
			log.Printf("bad job payload: %v", err)
			continue
		}
		if err := e.handle(ctx, job); err != nil {
			log.Printf("job %s: %v", job.RunID, err)
		}
	}
}

func (e *Executor) handle(ctx context.Context, job queue.RunJob) error {
	if e.isCanceled(ctx, job.RunID) {
		return nil
	}

	lockKey := "terraforge:nslock:" + job.NamespaceID
	ok, err := e.rdb.SetNX(ctx, lockKey, job.RunID, e.cfg.Timeout+time.Minute).Result()
	if err != nil {
		return err
	}
	if !ok {
		if e.isCanceled(ctx, job.RunID) {
			return nil
		}
		_ = e.rdb.RPush(ctx, queue.RunsQueueKey, mustJSON(job)).Err()
		time.Sleep(3 * time.Second)
		return nil
	}
	defer e.rdb.Del(context.Background(), lockKey)

	if e.isCanceled(ctx, job.RunID) {
		return nil
	}

	if err := e.markRunning(ctx, job.RunID); err != nil {
		return err
	}
	e.publishStatus(ctx, job.RunID, "running")

	if err := os.MkdirAll(filepath.Dir(job.LogPath), 0o755); err != nil {
		_ = e.markFinished(ctx, job.RunID, "failed")
		return err
	}
	logFile, err := os.OpenFile(job.LogPath, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o644)
	if err != nil {
		_ = e.markFinished(ctx, job.RunID, "failed")
		return err
	}
	defer logFile.Close()

	onLog := func(line string) {
		_, _ = logFile.WriteString(line + "\n")
		_ = e.rdb.Publish(ctx, logChannel(job.RunID), line).Err()
	}

	env := map[string]string{}
	if e.secrets != nil {
		nsID, err := uuid.Parse(job.NamespaceID)
		if err == nil {
			loaded, err := e.secrets.EnvMap(ctx, nsID)
			if err != nil {
				onLog(fmt.Sprintf("WARN: failed to load namespace secrets: %v", err))
			} else {
				env = loaded
				if len(env) > 0 {
					onLog(fmt.Sprintf("Injected %d namespace secret(s) into runner", len(env)))
				}
			}
		}
	}

	container := "terraforge-" + job.RunID
	runErr := runner.Run(ctx, runner.Options{
		Image:     e.cfg.RunnerImage,
		RepoPath:  job.RepoPath,
		RunType:   job.Type,
		Timeout:   e.cfg.Timeout,
		Container: container,
		Env:       env,
	}, onLog)

	if e.isCanceled(ctx, job.RunID) {
		_ = exec.Command("docker", "rm", "-f", container).Run()
		e.publishStatus(ctx, job.RunID, "canceled")
		return nil
	}

	status := "success"
	if runErr != nil {
		status = "failed"
		onLog(fmt.Sprintf("ERROR: %v", runErr))
		fail := map[string]any{
			"error":  runErr.Error(),
			"failed": true,
		}
		var ee *exec.ExitError
		if errors.As(runErr, &ee) {
			fail["exit_code"] = ee.ExitCode()
		}
		_ = e.mergeSummary(ctx, job.RunID, fail)
	}

	summary := e.collectPlanSummary(job, onLog)
	if summary != nil {
		_ = e.mergeSummary(ctx, job.RunID, summary)
		e.applyDriftFlag(ctx, job, summary)
		e.maybeCommentPR(ctx, job, status, summary, onLog)
	}

	if err := e.markFinished(ctx, job.RunID, status); err != nil {
		return err
	}
	e.publishStatus(ctx, job.RunID, status)
	// Prefer merged failure+plan summary for notify when available.
	notifySummary := summary
	if runErr != nil && notifySummary == nil {
		notifySummary = map[string]any{"error": runErr.Error()}
	}
	e.maybeSlack(ctx, job, status, notifySummary, onLog)
	return runErr
}

func (e *Executor) maybeSlack(ctx context.Context, job queue.RunJob, status string, summary map[string]any, onLog func(string)) {
	if e.secrets == nil {
		return
	}
	nsID, err := uuid.Parse(job.NamespaceID)
	if err != nil {
		return
	}
	env, err := e.secrets.EnvMap(ctx, nsID)
	if err != nil {
		return
	}
	hook := env["SLACK_WEBHOOK_URL"]
	if hook == "" {
		return
	}
	var slug string
	_ = e.pool.QueryRow(ctx, `SELECT slug FROM namespaces WHERE id = $1`, nsID).Scan(&slug)
	if slug == "" {
		slug = job.NamespaceID
	}
	if summary == nil {
		var raw []byte
		_ = e.pool.QueryRow(ctx, `SELECT summary FROM runs WHERE id = $1`, job.RunID).Scan(&raw)
		if len(raw) > 0 {
			_ = json.Unmarshal(raw, &summary)
		}
	}
	msg := notify.FormatRunMessage(slug, job.Type, status, job.RunID, summary)
	if err := notify.Slack(ctx, hook, msg); err != nil {
		onLog(fmt.Sprintf("WARN: slack notify failed: %v", err))
		return
	}
	onLog("Posted Slack notification")
}

func (e *Executor) collectPlanSummary(job queue.RunJob, onLog func(string)) map[string]any {
	if job.Type != "plan" {
		return nil
	}
	path := filepath.Join(job.RepoPath, ".terraforge", "plan.json")
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil
	}
	parsed, err := planparse.FromShowJSON(raw)
	if err != nil {
		onLog(fmt.Sprintf("WARN: could not parse plan.json: %v", err))
		return nil
	}
	onLog(fmt.Sprintf("Plan summary: +%d ~%d -%d", parsed.Added, parsed.Changed, parsed.Destroyed))
	_ = os.Remove(path)
	return parsed.Map()
}

func (e *Executor) applyDriftFlag(ctx context.Context, job queue.RunJob, summary map[string]any) {
	nsID, err := uuid.Parse(job.NamespaceID)
	if err != nil {
		return
	}
	var isDrift bool
	_ = e.pool.QueryRow(ctx, `
		SELECT COALESCE(summary->>'drift', 'false') = 'true' FROM runs WHERE id = $1
	`, job.RunID).Scan(&isDrift)
	if !isDrift {
		return
	}
	hasChanges, _ := summary["has_changes"].(bool)
	if !hasChanges {
		added, _ := summary["added"].(float64)
		changed, _ := summary["changed"].(float64)
		destroyed, _ := summary["destroyed"].(float64)
		hasChanges = added+changed+destroyed > 0
	}
	if hasChanges {
		_, _ = e.pool.Exec(ctx, `
			UPDATE namespaces SET has_drift = true, drift_detected_at = now() WHERE id = $1
		`, nsID)
	} else {
		_, _ = e.pool.Exec(ctx, `
			UPDATE namespaces SET has_drift = false, drift_detected_at = NULL WHERE id = $1
		`, nsID)
	}
}

func (e *Executor) maybeCommentPR(ctx context.Context, job queue.RunJob, status string, summary map[string]any, onLog func(string)) {
	var meta []byte
	_ = e.pool.QueryRow(ctx, `SELECT summary FROM runs WHERE id = $1`, job.RunID).Scan(&meta)
	var m map[string]any
	if len(meta) > 0 {
		_ = json.Unmarshal(meta, &m)
	}
	if m == nil {
		m = map[string]any{}
	}
	for k, v := range summary {
		m[k] = v
	}
	prNum, ok := asInt(m["github_pr"])
	repo, _ := m["github_repo"].(string)
	if !ok || prNum <= 0 || repo == "" {
		return
	}
	parts := splitRepo(repo)
	if len(parts) != 2 {
		return
	}
	token := ""
	if e.secrets != nil {
		nsID, err := uuid.Parse(job.NamespaceID)
		if err == nil {
			env, _ := e.secrets.EnvMap(ctx, nsID)
			token = env["GITHUB_TOKEN"]
		}
	}
	if token == "" {
		onLog("WARN: github_pr set but GITHUB_TOKEN secret missing — skip PR comment")
		return
	}
	body := githubx.FormatPlanComment(job.RunID, status, m)
	err := githubx.PostPRComment(ctx, token, githubx.PRRef{Owner: parts[0], Repo: parts[1], Number: prNum}, body)
	if err != nil {
		onLog(fmt.Sprintf("WARN: PR comment failed: %v", err))
		return
	}
	onLog(fmt.Sprintf("Posted plan comment to %s#%d", repo, prNum))
}

func (e *Executor) mergeSummary(ctx context.Context, runID string, summary map[string]any) error {
	id, err := uuid.Parse(runID)
	if err != nil {
		return err
	}
	body, err := json.Marshal(summary)
	if err != nil {
		return err
	}
	_, err = e.pool.Exec(ctx, `
		UPDATE runs SET summary = COALESCE(summary, '{}'::jsonb) || $2::jsonb WHERE id = $1
	`, id, body)
	return err
}

func (e *Executor) isCanceled(ctx context.Context, runID string) bool {
	id, err := uuid.Parse(runID)
	if err != nil {
		return false
	}
	var status string
	err = e.pool.QueryRow(ctx, `SELECT status::text FROM runs WHERE id = $1`, id).Scan(&status)
	return err == nil && status == "canceled"
}

func (e *Executor) markRunning(ctx context.Context, runID string) error {
	id, err := uuid.Parse(runID)
	if err != nil {
		return err
	}
	tag, err := e.pool.Exec(ctx, `
		UPDATE runs SET status = 'running', started_at = now()
		WHERE id = $1 AND status = 'queued'
	`, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("run not queued (maybe canceled)")
	}
	return nil
}

func (e *Executor) markFinished(ctx context.Context, runID, status string) error {
	id, err := uuid.Parse(runID)
	if err != nil {
		return err
	}
	_, err = e.pool.Exec(ctx, `
		UPDATE runs SET status = $2::run_status, finished_at = now()
		WHERE id = $1 AND status IN ('queued', 'running')
	`, id, status)
	return err
}

func (e *Executor) publishStatus(ctx context.Context, runID, status string) {
	payload, _ := json.Marshal(map[string]string{"type": "status", "status": status})
	_ = e.rdb.Publish(ctx, logChannel(runID), string(payload)).Err()
}

func logChannel(runID string) string {
	return "terraforge:runlogs:" + runID
}

func mustJSON(job queue.RunJob) string {
	b, _ := json.Marshal(job)
	return string(b)
}

func splitRepo(full string) []string {
	for i := 0; i < len(full); i++ {
		if full[i] == '/' {
			return []string{full[:i], full[i+1:]}
		}
	}
	return nil
}

func asInt(v any) (int, bool) {
	switch n := v.(type) {
	case float64:
		return int(n), true
	case int:
		return n, true
	case int64:
		return int(n), true
	case json.Number:
		i, err := n.Int64()
		return int(i), err == nil
	default:
		return 0, false
	}
}
