-- Tables for the "Was this helpful?" votes and the correction/topic form.
-- These were previously created on every request by the API code; they are now
-- created once here. IF NOT EXISTS keeps this safe if they already exist.
-- No IP addresses or identifiers are stored.

CREATE TABLE IF NOT EXISTS feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  page TEXT NOT NULL CHECK (length(page) <= 80),
  helpful INTEGER NOT NULL CHECK (helpful IN (0, 1)),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_feedback_created_at ON feedback (created_at);

CREATE TABLE IF NOT EXISTS suggestions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL CHECK (type IN ('correction', 'topic')),
  page TEXT NOT NULL CHECK (length(page) <= 80),
  message TEXT NOT NULL CHECK (length(message) <= 2000),
  email TEXT CHECK (email IS NULL OR length(email) <= 254),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_suggestions_created_at ON suggestions (created_at);
