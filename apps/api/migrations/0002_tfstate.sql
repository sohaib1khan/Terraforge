-- Phase 1.5: HTTP backend state + tokens + run summaries

CREATE TABLE backend_tokens (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    namespace_id  UUID NOT NULL REFERENCES namespaces(id) ON DELETE CASCADE,
    token_hash    TEXT NOT NULL,
    label         TEXT NOT NULL DEFAULT 'default',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    revoked_at    TIMESTAMPTZ
);

CREATE INDEX backend_tokens_namespace_id_idx ON backend_tokens (namespace_id);
CREATE INDEX backend_tokens_token_hash_idx ON backend_tokens (token_hash) WHERE revoked_at IS NULL;

CREATE TABLE terraform_states (
    namespace_id  UUID PRIMARY KEY REFERENCES namespaces(id) ON DELETE CASCADE,
    state_json    JSONB,
    lock_id       TEXT,
    lock_info     JSONB,
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE runs ADD COLUMN IF NOT EXISTS summary JSONB;
