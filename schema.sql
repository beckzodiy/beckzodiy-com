CREATE TABLE IF NOT EXISTS articles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  content_html TEXT NOT NULL DEFAULT '',
  author TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_articles_created_at ON articles(created_at DESC);

-- View stats (the Worker also creates these on first use).
CREATE TABLE IF NOT EXISTS view_totals (slug TEXT PRIMARY KEY, views INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS view_daily (day TEXT NOT NULL, slug TEXT NOT NULL, views INTEGER NOT NULL DEFAULT 0, visitors INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (day, slug));
CREATE TABLE IF NOT EXISTS view_sources (day TEXT NOT NULL, kind TEXT NOT NULL, value TEXT NOT NULL, views INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (day, kind, value));
CREATE TABLE IF NOT EXISTS view_visitors (day TEXT NOT NULL, hash TEXT NOT NULL, PRIMARY KEY (day, hash));
