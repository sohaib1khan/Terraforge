-- Phase 3: RBAC, webhooks, approval, audit, drift

CREATE TYPE member_role AS ENUM ('admin', 'writer', 'viewer');

CREATE TABLE namespace_members (
    namespace_id UUID NOT NULL REFERENCES namespaces(id) ON DELETE CASCADE,
    user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role         member_role NOT NULL DEFAULT 'viewer',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (namespace_id, user_id)
);

CREATE INDEX namespace_members_user_id_idx ON namespace_members (user_id);

ALTER TABLE namespaces
    ADD COLUMN IF NOT EXISTS require_approval BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS drift_interval_minutes INT;

ALTER TABLE runs
    ADD COLUMN IF NOT EXISTS awaiting_approval BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;

CREATE TABLE webhook_configs (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    namespace_id  UUID NOT NULL UNIQUE REFERENCES namespaces(id) ON DELETE CASCADE,
    secret_hash   TEXT NOT NULL,
    enabled       BOOLEAN NOT NULL DEFAULT true,
    last_delivery TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE audit_log (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor      TEXT NOT NULL,
    action     TEXT NOT NULL,
    target     TEXT,
    metadata   JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX audit_log_created_at_idx ON audit_log (created_at DESC);

INSERT INTO namespace_members (namespace_id, user_id, role)
SELECT n.id, u.id, 'admin'::member_role
FROM namespaces n
CROSS JOIN users u
WHERE u.is_admin = true
ON CONFLICT DO NOTHING;
