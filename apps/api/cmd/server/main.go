package main

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/joho/godotenv"
	"github.com/redis/go-redis/v9"
	"github.com/terraforge/terraforge/apps/api/internal/access"
	"github.com/terraforge/terraforge/apps/api/internal/audit"
	"github.com/terraforge/terraforge/apps/api/internal/auth"
	"github.com/terraforge/terraforge/apps/api/internal/config"
	tfcrypto "github.com/terraforge/terraforge/apps/api/internal/crypto"
	"github.com/terraforge/terraforge/apps/api/internal/db"
	"github.com/terraforge/terraforge/apps/api/internal/drift"
	"github.com/terraforge/terraforge/apps/api/internal/members"
	"github.com/terraforge/terraforge/apps/api/internal/modules"
	"github.com/terraforge/terraforge/apps/api/internal/namespaces"
	"github.com/terraforge/terraforge/apps/api/internal/providers"
	"github.com/terraforge/terraforge/apps/api/internal/queue"
	"github.com/terraforge/terraforge/apps/api/internal/runs"
	"github.com/terraforge/terraforge/apps/api/internal/secrets"
	"github.com/terraforge/terraforge/apps/api/internal/tfgraph"
	"github.com/terraforge/terraforge/apps/api/internal/tfstate"
	"github.com/terraforge/terraforge/apps/api/internal/webhooks"
	tfws "github.com/terraforge/terraforge/apps/api/internal/websocket"
)

func main() {
	_ = godotenv.Load()

	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("config: %v", err)
	}
	if abs, err := filepath.Abs(cfg.DataDir); err == nil {
		cfg.DataDir = abs
	}

	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()

	pool, err := db.Connect(ctx, cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("db: %v", err)
	}
	defer pool.Close()

	if err := db.Migrate(ctx, pool, cfg.MigrationsDir); err != nil {
		log.Fatalf("migrate: %v", err)
	}
	log.Printf("migrations applied from %s", cfg.MigrationsDir)

	if err := os.MkdirAll(cfg.DataDir, 0o755); err != nil {
		log.Fatalf("data dir: %v", err)
	}

	q, err := queue.Connect(cfg.RedisURL)
	if err != nil {
		log.Fatalf("redis: %v", err)
	}
	defer q.Close()

	hub := tfws.NewHub()
	go bridgeRunLogs(ctx, q.Redis(), hub)

	authSvc := auth.NewService(pool, cfg.JWTSecret, cfg.JWTTTL)
	authHandler := auth.NewHandler(authSvc)
	membersSvc := members.NewService(pool)
	auditSvc := audit.NewService(pool)
	gate := &access.Checker{Members: membersSvc}

	nsSvc := namespaces.NewService(pool, cfg.DataDir)
	nsHandler := namespaces.NewHandler(nsSvc, membersSvc, auditSvc, gate)
	runsSvc := runs.NewService(pool, q, nsSvc, cfg.DataDir)
	runsHandler := runs.NewHandler(runsSvc, hub, cfg.DataDir, gate, auditSvc)
	secretKey, err := tfcrypto.Key()
	if err != nil {
		log.Fatalf("secrets key: %v", err)
	}
	secretsSvc := secrets.NewService(pool, secretKey)
	secretsHandler := secrets.NewHandler(secretsSvc, nsSvc, gate, auditSvc)
	tfstateSvc := tfstate.NewService(pool)
	tfstateHandler := tfstate.NewHandler(tfstateSvc, secretsSvc, runsSvc)
	membersHandler := members.NewHandler(membersSvc, authSvc, auditSvc)
	webhooksSvc := webhooks.NewService(pool)
	webhooksHandler := webhooks.NewHandler(webhooksSvc, runsSvc, auditSvc, gate)
	auditHandler := audit.NewHandler(auditSvc)
	providersHandler := providers.NewHandler(providers.NewService())
	modulesHandler := modules.NewHandler(modules.NewService())
	graphHandler := tfgraph.NewHandler(nsSvc, tfstateSvc, gate)

	go drift.NewScheduler(nsSvc, runsSvc, auditSvc).Start(ctx)

	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) {
		if err := pool.Ping(r.Context()); err != nil {
			http.Error(w, "db unavailable", http.StatusServiceUnavailable)
			return
		}
		if err := q.Ping(r.Context()); err != nil {
			http.Error(w, "redis unavailable", http.StatusServiceUnavailable)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
	})
	runAuth := authHandler.MiddlewareJWTOrCLI(secretsSvc)

	authHandler.Register(mux)
	nsHandler.Register(mux, authHandler.Middleware)
	nsHandler.RegisterImport(mux, runAuth)
	runsHandler.Register(mux, authHandler.Middleware, runAuth)
	secretsHandler.Register(mux, authHandler.Middleware)
	secretsHandler.RegisterConnectPublic(mux)
	mux.Handle("GET /api/namespaces/{id}/cli-check", runAuth(http.HandlerFunc(secretsHandler.CLICheck)))
	membersHandler.Register(mux, authHandler.Middleware)
	webhooksHandler.Register(mux, authHandler.Middleware)
	auditHandler.Register(mux, authHandler.Middleware)
	providersHandler.Register(mux, authHandler.Middleware)
	modulesHandler.Register(mux, authHandler.Middleware)
	graphHandler.Register(mux, authHandler.Middleware)
	tfstateHandler.Register(mux)
	tfstateHandler.RegisterUI(mux, authHandler.Middleware, gate)

	srv := &http.Server{
		Addr:              cfg.Addr,
		Handler:           withCORS(mux),
		ReadHeaderTimeout: 10 * time.Second,
	}

	go func() {
		log.Printf("api listening on %s", cfg.Addr)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("listen: %v", err)
		}
	}()

	<-ctx.Done()
	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer shutdownCancel()
	_ = srv.Shutdown(shutdownCtx)
	log.Println("api stopped")
}

func bridgeRunLogs(ctx context.Context, rdb *redis.Client, hub *tfws.Hub) {
	pubsub := rdb.PSubscribe(ctx, "terraforge:runlogs:*")
	defer pubsub.Close()
	ch := pubsub.Channel()
	for {
		select {
		case <-ctx.Done():
			return
		case msg, ok := <-ch:
			if !ok {
				return
			}
			runID := strings.TrimPrefix(msg.Channel, "terraforge:runlogs:")
			payload := msg.Payload
			if strings.HasPrefix(payload, "{") {
				var envelope struct {
					Type   string `json:"type"`
					Status string `json:"status"`
				}
				if err := json.Unmarshal([]byte(payload), &envelope); err == nil && envelope.Type == "status" {
					hub.PublishStatus(runID, envelope.Status)
					continue
				}
			}
			hub.PublishLine(runID, payload)
		}
	}
}

func withCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Terraforge-Secret")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, LOCK, UNLOCK, OPTIONS")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}
