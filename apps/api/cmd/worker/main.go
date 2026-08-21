package main

import (
	"context"
	"log"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/joho/godotenv"
	"github.com/terraforge/terraforge/apps/api/internal/config"
	tfcrypto "github.com/terraforge/terraforge/apps/api/internal/crypto"
	"github.com/terraforge/terraforge/apps/api/internal/db"
	"github.com/terraforge/terraforge/apps/api/internal/executor"
	"github.com/terraforge/terraforge/apps/api/internal/queue"
	"github.com/terraforge/terraforge/apps/api/internal/secrets"
)

func main() {
	_ = godotenv.Load()

	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("config: %v", err)
	}

	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()

	pool, err := db.Connect(ctx, cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("db: %v", err)
	}
	defer pool.Close()

	q, err := queue.Connect(cfg.RedisURL)
	if err != nil {
		log.Fatalf("redis: %v", err)
	}
	defer q.Close()

	secretKey, err := tfcrypto.Key()
	if err != nil {
		log.Fatalf("secrets key: %v", err)
	}
	secretsSvc := secrets.NewService(pool, secretKey)

	ex := executor.New(pool, q.Redis(), executor.Config{
		RunnerImage: cfg.RunnerImage,
		Timeout:     time.Duration(cfg.RunTimeoutSeconds) * time.Second,
		VolumesFrom: cfg.RunnerVolumesFrom,
		DataDir:     cfg.DataDir,
		HostDataDir: cfg.HostDataDir,
	}, secretsSvc)
	if err := ex.Run(ctx); err != nil && err != context.Canceled {
		log.Fatalf("worker: %v", err)
	}
}
