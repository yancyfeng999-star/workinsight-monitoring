-- Worker tables for classification, aggregation, and team summaries.

CREATE TABLE IF NOT EXISTS activity_classifications (
    id BIGSERIAL PRIMARY KEY,
    org_id TEXT NOT NULL,
    subject_id TEXT NOT NULL,
    event_id TEXT NOT NULL UNIQUE,
    app_id TEXT NOT NULL,
    registrable_domain TEXT,
    category TEXT NOT NULL DEFAULT 'uncategorized',
    subcategory TEXT,
    classified_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    rule_version INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_classifications_org_subject
    ON activity_classifications (org_id, subject_id, classified_at DESC);
CREATE INDEX IF NOT EXISTS idx_classifications_category
    ON activity_classifications (category);

CREATE TABLE IF NOT EXISTS daily_aggregates (
    id BIGSERIAL PRIMARY KEY,
    org_id TEXT NOT NULL,
    subject_id TEXT NOT NULL,
    date DATE NOT NULL,
    category TEXT NOT NULL,
    app_id TEXT,
    registrable_domain TEXT,
    total_seconds INTEGER NOT NULL DEFAULT 0,
    segment_count INTEGER NOT NULL DEFAULT 0,
    first_active_at TIMESTAMPTZ,
    last_active_at TIMESTAMPTZ,
    aggregated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (org_id, subject_id, date, category, app_id, registrable_domain)
);

CREATE INDEX IF NOT EXISTS idx_aggregates_org_date
    ON daily_aggregates (org_id, subject_id, date DESC);

CREATE TABLE IF NOT EXISTS team_summaries (
    id BIGSERIAL PRIMARY KEY,
    org_id TEXT NOT NULL,
    team_id TEXT NOT NULL,
    date DATE NOT NULL,
    member_count INTEGER NOT NULL DEFAULT 0,
    coverage_rate NUMERIC(5,4),
    avg_active_seconds INTEGER,
    top_categories JSONB,
    generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (org_id, team_id, date)
);

CREATE INDEX IF NOT EXISTS idx_team_summaries_org_date
    ON team_summaries (org_id, date DESC);

CREATE TABLE IF NOT EXISTS worker_watermarks (
    job_name TEXT PRIMARY KEY,
    last_processed_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
