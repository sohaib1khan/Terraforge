-- One-time connect install codes (for curl | sh). Code itself is the secret.

CREATE TABLE IF NOT EXISTS connect_install_codes (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    namespace_id  UUID NOT NULL REFERENCES namespaces(id) ON DELETE CASCADE,
    code_hash     TEXT NOT NULL UNIQUE,
    created_by    UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at    TIMESTAMPTZ NOT NULL,
    used_at       TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS connect_install_codes_ns_idx ON connect_install_codes (namespace_id);
CREATE INDEX IF NOT EXISTS connect_install_codes_hash_idx ON connect_install_codes (code_hash)
    WHERE used_at IS NULL;
