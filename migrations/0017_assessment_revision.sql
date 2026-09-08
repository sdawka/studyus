-- Atomic update batches deliberately fail this check when a stale snapshot loses.
ALTER TABLE assessments ADD COLUMN revision INTEGER NOT NULL DEFAULT 0 CONSTRAINT assessments_revision_nonnegative CHECK(revision >= 0);
