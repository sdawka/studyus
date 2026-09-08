ALTER TABLE kcs ADD COLUMN revision INTEGER NOT NULL DEFAULT 0 CONSTRAINT kcs_revision_nonnegative CHECK (revision >= 0);
