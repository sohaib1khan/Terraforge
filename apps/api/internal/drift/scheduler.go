package drift

import (
	"context"
	"log"
	"time"

	"github.com/terraforge/terraforge/apps/api/internal/audit"
	"github.com/terraforge/terraforge/apps/api/internal/namespaces"
	"github.com/terraforge/terraforge/apps/api/internal/runs"
)

type Scheduler struct {
	ns    *namespaces.Service
	runs  *runs.Service
	audit *audit.Service
	every time.Duration
}

func NewScheduler(ns *namespaces.Service, runsSvc *runs.Service, auditSvc *audit.Service) *Scheduler {
	return &Scheduler{ns: ns, runs: runsSvc, audit: auditSvc, every: time.Minute}
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
