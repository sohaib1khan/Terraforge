-- Phase 4: encrypted namespace secrets + user lifecycle

CREATE TABLE IF NOT EXISTS namespace_secrets (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    namespace_id    UUID NOT NULL REFERENCES namespaces(id) ON DELETE CASCADE,
    key             TEXT NOT NULL,
    ciphertext      BYTEA NOT NULL,
    nonce           BYTEA NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (namespace_id, key)
);

CREATE INDEX IF NOT EXISTS namespace_secrets_namespace_id_idx
    ON namespace_secrets (namespace_id);

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS disabled_at TIMESTAMPTZ;
