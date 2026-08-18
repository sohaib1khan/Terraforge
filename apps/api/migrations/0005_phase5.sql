-- Phase 5: drift alert flags on namespaces

ALTER TABLE namespaces
    ADD COLUMN IF NOT EXISTS has_drift BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS drift_detected_at TIMESTAMPTZ;
