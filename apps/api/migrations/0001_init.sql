-- Phase 1 schema: users, namespaces, runs

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS schema_migrations (
    version    TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE users (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email         TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    is_admin      BOOLEAN NOT NULL DEFAULT false,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE namespaces (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name              TEXT NOT NULL,
    slug              TEXT NOT NULL UNIQUE,
    terraform_version TEXT NOT NULL DEFAULT '1.9.0',
    has_remote        BOOLEAN NOT NULL DEFAULT false,
    remote_url        TEXT,
    default_branch    TEXT NOT NULL DEFAULT 'main',
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TYPE run_type AS ENUM ('init', 'plan', 'apply', 'destroy');
CREATE TYPE run_status AS ENUM ('queued', 'running', 'success', 'failed', 'canceled');
CREATE TYPE run_source AS ENUM ('web', 'cli', 'webhook');

CREATE TABLE runs (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    namespace_id UUID NOT NULL REFERENCES namespaces(id) ON DELETE CASCADE,
    type         run_type NOT NULL,
    status       run_status NOT NULL DEFAULT 'queued',
    source       run_source NOT NULL DEFAULT 'web',
    commit_sha   TEXT,
    triggered_by UUID REFERENCES users(id) ON DELETE SET NULL,
    started_at   TIMESTAMPTZ,
    finished_at  TIMESTAMPTZ,
    log_path     TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX runs_namespace_id_created_at_idx ON runs (namespace_id, created_at DESC);
CREATE INDEX runs_namespace_id_status_idx ON runs (namespace_id, status);
