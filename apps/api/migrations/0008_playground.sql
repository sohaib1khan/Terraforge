-- Playground: mark namespaces and store reusable user templates

ALTER TABLE namespaces
    ADD COLUMN IF NOT EXISTS is_playground BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_namespaces_is_playground ON namespaces (is_playground)
    WHERE is_playground = true;

CREATE TABLE IF NOT EXISTS playground_templates (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name                TEXT NOT NULL,
    description         TEXT NOT NULL DEFAULT '',
    files               JSONB NOT NULL DEFAULT '{}'::jsonb,
    source_namespace_id UUID REFERENCES namespaces(id) ON DELETE SET NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_playground_templates_owner ON playground_templates (owner_user_id, created_at DESC);
