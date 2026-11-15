-- App-wide AI provider budget. Per-learner budgets live in each LearnerAgent
-- Durable Object, which cannot see other learners; this single D1 row per UTC
-- day is the shared ceiling that bounds total spend across all accounts.
CREATE TABLE ai_usage_global (
  utc_day TEXT PRIMARY KEY NOT NULL,
  attempted_calls INTEGER NOT NULL CHECK (attempted_calls >= 0)
);
