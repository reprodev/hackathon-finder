-- Migration: 0001_create_tables
-- Creates core tables, indexes, FTS5 virtual table, and sync triggers
-- for the Hackathon Discovery Platform.

CREATE TABLE IF NOT EXISTS hackathons (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT,
  start_date TEXT NOT NULL,
  end_date TEXT,
  location TEXT,
  format TEXT NOT NULL DEFAULT 'virtual',
  organizer TEXT,
  prizes TEXT,
  source_url TEXT NOT NULL,
  sources TEXT NOT NULL DEFAULT '[]',
  tags TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_dedup ON hackathons(title, start_date);
CREATE INDEX IF NOT EXISTS idx_start_date ON hackathons(start_date);
CREATE INDEX IF NOT EXISTS idx_format ON hackathons(format);

-- FTS5 virtual table for full-text search (D1 requires lowercase 'fts5')
CREATE VIRTUAL TABLE IF NOT EXISTS hackathon_fts USING fts5(
  title,
  description,
  tags,
  content='hackathons',
  content_rowid='rowid',
  tokenize='porter unicode61'
);

-- Triggers to keep FTS5 index in sync
CREATE TRIGGER IF NOT EXISTS hackathon_fts_insert AFTER INSERT ON hackathons BEGIN
  INSERT INTO hackathon_fts(rowid, title, description, tags)
  VALUES (new.rowid, new.title, new.description, new.tags);
END;

CREATE TRIGGER IF NOT EXISTS hackathon_fts_delete AFTER DELETE ON hackathons BEGIN
  INSERT INTO hackathon_fts(hackathon_fts, rowid, title, description, tags)
  VALUES ('delete', old.rowid, old.title, old.description, old.tags);
END;

CREATE TRIGGER IF NOT EXISTS hackathon_fts_update AFTER UPDATE ON hackathons BEGIN
  INSERT INTO hackathon_fts(hackathon_fts, rowid, title, description, tags)
  VALUES ('delete', old.rowid, old.title, old.description, old.tags);
  INSERT INTO hackathon_fts(rowid, title, description, tags)
  VALUES (new.rowid, new.title, new.description, new.tags);
END;

-- Aggregation logging
CREATE TABLE IF NOT EXISTS aggregation_logs (
  id TEXT PRIMARY KEY,
  timestamp TEXT NOT NULL,
  source_name TEXT NOT NULL,
  status TEXT NOT NULL,
  events_found INTEGER NOT NULL DEFAULT 0,
  events_created INTEGER NOT NULL DEFAULT 0,
  events_updated INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  error_type TEXT,
  duration_ms INTEGER NOT NULL
);

-- Refresh state tracking
CREATE TABLE IF NOT EXISTS refresh_metadata (
  id TEXT PRIMARY KEY DEFAULT 'singleton',
  last_refresh_at TEXT NOT NULL,
  next_refresh_at TEXT NOT NULL,
  interval_minutes INTEGER NOT NULL DEFAULT 60,
  all_sources_failed INTEGER NOT NULL DEFAULT 0
);
