-- Monitor-side Insight jobs and validated reports. Credentials stay in Worker env only.

CREATE TABLE IF NOT EXISTS insight_jobs (
    id BIGSERIAL PRIMARY KEY,
    org_id TEXT NOT NULL,
    team_id TEXT NOT NULL,
    date DATE NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'succeeded', 'failed')),
    attempts INTEGER NOT NULL DEFAULT 0,
    provider TEXT NOT NULL DEFAULT 'deepseek',
    model TEXT,
    evidence_snapshot JSONB NOT NULL,
    evidence_snapshot_hash TEXT NOT NULL,
    error_code TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    started_at TIMESTAMPTZ,
    finished_at TIMESTAMPTZ,
    UNIQUE (org_id, team_id, date)
);

CREATE INDEX IF NOT EXISTS idx_insight_jobs_org_status
    ON insight_jobs (org_id, status, date DESC);

CREATE TABLE IF NOT EXISTS insight_reports (
    id BIGSERIAL PRIMARY KEY,
    org_id TEXT NOT NULL,
    team_id TEXT NOT NULL,
    date DATE NOT NULL,
    job_id BIGINT REFERENCES insight_jobs(id),
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    output JSONB NOT NULL,
    evidence_snapshot_hash TEXT NOT NULL,
    generated_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (org_id, team_id, date)
);

CREATE INDEX IF NOT EXISTS idx_insight_reports_org_date
    ON insight_reports (org_id, date DESC);
