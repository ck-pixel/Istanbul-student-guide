-- Migration 0001: private star-rating feedback from students.
-- Stores no IP address, name, email, or other identifier. Rows are private:
-- the site has no endpoint that reads, lists, edits, or deletes them.
CREATE TABLE IF NOT EXISTS student_feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  topic TEXT NOT NULL CHECK (length(topic) BETWEEN 1 AND 40),
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5 AND rating = CAST(rating AS INTEGER)),
  comment TEXT CHECK (comment IS NULL OR length(comment) BETWEEN 1 AND 1000),
  moderation_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (moderation_status IN ('pending', 'approved', 'rejected', 'spam')),
  -- Set by the database, never by the client. ISO 8601 UTC, e.g. 2026-10-16T12:00:00.000Z
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_student_feedback_created_at ON student_feedback (created_at);
CREATE INDEX IF NOT EXISTS idx_student_feedback_status ON student_feedback (moderation_status, created_at);
