CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  author TEXT NOT NULL CHECK(author IN ('me','partner')),
  text TEXT NOT NULL CHECK(length(text) BETWEEN 1 AND 1000),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS messages_created ON messages(created_at DESC);
CREATE TABLE IF NOT EXISTS media (
  id TEXT PRIMARY KEY,
  object_key TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  size INTEGER NOT NULL CHECK(size > 0),
  status TEXT NOT NULL CHECK(status IN ('uploading','ready')),
  upload_id TEXT,
  created_at TEXT NOT NULL,
  last_activity TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS media_created ON media(status,created_at DESC);
