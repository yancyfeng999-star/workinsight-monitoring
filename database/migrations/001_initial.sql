-- Phase 1 thin slice: minimal ingestion tables.

CREATE TABLE IF NOT EXISTS devices (
    device_id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL DEFAULT 'org_default',
    subject_id TEXT NOT NULL DEFAULT 'subject_unknown',
    agent_version TEXT NOT NULL DEFAULT 'unknown',
    os TEXT NOT NULL DEFAULT 'unknown',
    last_heartbeat_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    revoked_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS activity_segments (
    org_id TEXT NOT NULL,
    device_id TEXT NOT NULL,
    sequence_no BIGINT NOT NULL,
    event_id TEXT NOT NULL,
    subject_id TEXT NOT NULL,
    source TEXT NOT NULL,
    started_at TIMESTAMPTZ NOT NULL,
    ended_at TIMESTAMPTZ NOT NULL,
    app_id TEXT NOT NULL,
    app_name TEXT NOT NULL,
    window_title TEXT,
    registrable_domain TEXT,
    payload JSONB NOT NULL,
    received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (org_id, device_id, sequence_no)
);

CREATE INDEX IF NOT EXISTS idx_segments_org_time ON activity_segments (org_id, subject_id, started_at);
CREATE INDEX IF NOT EXISTS idx_segments_device ON activity_segments (device_id);

CREATE TABLE IF NOT EXISTS agent_health_samples (
    id BIGSERIAL PRIMARY KEY,
    device_id TEXT NOT NULL,
    agent_version TEXT NOT NULL,
    os TEXT NOT NULL,
    collected_at TIMESTAMPTZ NOT NULL,
    queue_depth INTEGER NOT NULL DEFAULT 0,
    permissions_ok BOOLEAN NOT NULL DEFAULT true,
    autostart_enabled BOOLEAN NOT NULL DEFAULT true
);
CREATE INDEX IF NOT EXISTS idx_health_device ON agent_health_samples (device_id, collected_at DESC);

CREATE TABLE IF NOT EXISTS audit_logs (
    id BIGSERIAL PRIMARY KEY,
    actor TEXT NOT NULL,
    action TEXT NOT NULL,
    target TEXT,
    detail JSONB,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_time ON audit_logs (occurred_at DESC);
