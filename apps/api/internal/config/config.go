package config

import (
	"fmt"
	"os"
	"strconv"
	"time"
)

type Config struct {
	Addr              string
	DatabaseURL       string
	RedisURL          string
	JWTSecret         string
	JWTTTL            time.Duration
	DataDir           string
	MigrationsDir     string
	RunnerImage       string
	RunTimeoutSeconds int
	RunnerVolumesFrom string
	HostDataDir       string
}

func Load() (Config, error) {
	cfg := Config{
		Addr:              getenv("API_ADDR", ":8080"),
		DatabaseURL:       os.Getenv("DATABASE_URL"),
		RedisURL:          getenv("REDIS_URL", "redis://localhost:6379/0"),
		JWTSecret:         os.Getenv("JWT_SECRET"),
		JWTTTL:            getenvDuration("JWT_TTL", 24*time.Hour),
		DataDir:           getenv("DATA_DIR", "./data"),
		MigrationsDir:     getenv("MIGRATIONS_DIR", "migrations"),
		RunnerImage:       getenv("RUNNER_IMAGE", "terraforge-runner:local"),
		RunTimeoutSeconds: getenvInt("RUN_TIMEOUT_SECONDS", 600),
		RunnerVolumesFrom: os.Getenv("RUNNER_VOLUMES_FROM"),
		HostDataDir:       os.Getenv("HOST_DATA_DIR"),
	}
	if cfg.DatabaseURL == "" {
		return Config{}, fmt.Errorf("DATABASE_URL is required")
	}
	if cfg.JWTSecret == "" {
		return Config{}, fmt.Errorf("JWT_SECRET is required")
	}
	return cfg, nil
}

func getenv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func getenvInt(key string, fallback int) int {
	v := os.Getenv(key)
	if v == "" {
		return fallback
	}
	n, err := strconv.Atoi(v)
	if err != nil {
		return fallback
	}
	return n
}

func getenvDuration(key string, fallback time.Duration) time.Duration {
	v := os.Getenv(key)
	if v == "" {
		return fallback
	}
	d, err := time.ParseDuration(v)
	if err != nil {
		return fallback
	}
	return d
}
