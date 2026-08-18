-- Phase 6: namespace-scoped companion CLI tokens (not session JWTs)

CREATE TABLE IF NOT EXISTS cli_tokens (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    namespace_id  UUID NOT NULL REFERENCES namespaces(id) ON DELETE CASCADE,
    token_hash    TEXT NOT NULL,
    label         TEXT NOT NULL DEFAULT 'connect-pack',
    created_by    UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at    TIMESTAMPTZ NOT NULL,
    revoked_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS cli_tokens_namespace_id_idx ON cli_tokens (namespace_id);
CREATE INDEX IF NOT EXISTS cli_tokens_token_hash_idx ON cli_tokens (token_hash)
    WHERE revoked_at IS NULL;
