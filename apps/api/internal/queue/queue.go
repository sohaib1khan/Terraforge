package queue

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/redis/go-redis/v9"
)

const RunsQueueKey = "terraforge:runs"

type RunJob struct {
	RunID            string `json:"run_id"`
	NamespaceID      string `json:"namespace_id"`
	Type             string `json:"type"`
	RepoPath         string `json:"repo_path"`
	TerraformVersion string `json:"terraform_version"`
	LogPath          string `json:"log_path"`
}

type Client struct {
	rdb *redis.Client
}

func Connect(redisURL string) (*Client, error) {
	opts, err := redis.ParseURL(redisURL)
	if err != nil {
		return nil, fmt.Errorf("parse redis url: %w", err)
	}
	rdb := redis.NewClient(opts)
	if err := rdb.Ping(context.Background()).Err(); err != nil {
		return nil, fmt.Errorf("redis ping: %w", err)
	}
	return &Client{rdb: rdb}, nil
}

func (c *Client) Close() error {
	return c.rdb.Close()
}

func (c *Client) EnqueueRun(ctx context.Context, job RunJob) error {
	body, err := json.Marshal(job)
	if err != nil {
		return err
	}
	return c.rdb.RPush(ctx, RunsQueueKey, body).Err()
}

func (c *Client) Ping(ctx context.Context) error {
	return c.rdb.Ping(ctx).Err()
}

// Redis exposes the underlying client for the worker consumer (Phase 1 later).
func (c *Client) Redis() *redis.Client {
	return c.rdb
}
