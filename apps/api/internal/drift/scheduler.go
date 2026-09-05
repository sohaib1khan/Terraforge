package drift

import (
	"context"
	"log"
	"time"

	"github.com/google/uuid"
	"github.com/terraforge/terraforge/apps/api/internal/audit"
	"github.com/terraforge/terraforge/apps/api/internal/namespaces"
	"github.com/terraforge/terraforge/apps/api/internal/runs"
)

type Scheduler struct {
	ns    *namespaces.Service
	runs  *runs.Service
	audit *audit.Service
	every time.Duration
	// warned tracks namespaces already logged as skipped, so the reason is
	// stated once instead of every tick.
	warned map[uuid.UUID]bool
}

func NewScheduler(ns *namespaces.Service, runsSvc *runs.Service, auditSvc *audit.Service) *Scheduler {
	return &Scheduler{
		ns:     ns,
		runs:   runsSvc,
		audit:  auditSvc,
		every:  time.Minute,
		warned: map[uuid.UUID]bool{},
	}
}

func (s *Scheduler) Start(ctx context.Context) {
	t := time.NewTicker(s.every)
	defer t.Stop()
	s.tick(ctx)
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			s.tick(ctx)
		}
	}
}

func (s *Scheduler) tick(ctx context.Context) {
	due, err := s.ns.ListDueForDrift(ctx)
	if err != nil {
		log.Printf("drift: list due: %v", err)
		return
	}
	for _, ns := range due {
		if ns.DriftIntervalMinutes == nil || *ns.DriftIntervalMinutes <= 0 {
			continue
		}
		// Without config in the namespace, `terraform plan` can only fail. That
		// happens on backend-only namespaces where the config stays local, so
		// skip quietly instead of filling the run history with red rows.
		if !s.ns.HasTerraformConfig(ns.ID.String()) {
			if s.warned[ns.ID] {
				continue
			}
			s.warned[ns.ID] = true
			log.Printf("drift: skipping %s — no .tf files in the namespace (config is local only)", ns.Slug)
			continue
		}
		delete(s.warned, ns.ID)
		run, err := s.runs.CreateDriftPlan(ctx, ns.ID)
		if err != nil {
			log.Printf("drift: enqueue plan for %s: %v", ns.Slug, err)
			continue
		}
		s.audit.Write(ctx, "system", "run.drift", ns.ID.String(), map[string]any{
			"run_id": run.ID.String(),
		})
		log.Printf("drift: queued plan %s for namespace %s", run.ID, ns.Slug)
	}
}
