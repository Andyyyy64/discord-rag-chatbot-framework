-- Supabase Migration: Initial Schema
-- すべてのテーブルを定義

-- チャンネル情報
CREATE TABLE IF NOT EXISTS channels (
  guild_id TEXT NOT NULL,
  channel_id TEXT PRIMARY KEY,
  category_id TEXT,
  name TEXT,
  type INTEGER,
  last_scanned_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- スレッド情報
CREATE TABLE IF NOT EXISTS threads (
  guild_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  thread_id TEXT PRIMARY KEY,
  name TEXT,
  archived BOOLEAN DEFAULT false,
  last_scanned_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- メッセージ
CREATE TABLE IF NOT EXISTS messages (
  guild_id TEXT NOT NULL,
  category_id TEXT,
  channel_id TEXT NOT NULL,
  thread_id TEXT,
  message_id TEXT PRIMARY KEY,
  author_id TEXT,
  content_md TEXT,
  content_plain TEXT,
  created_at TIMESTAMPTZ,
  edited_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ,
  mentions JSONB,
  attachments JSONB,
  jump_link TEXT,
  token_count INTEGER,
  allowed_role_ids TEXT[],
  allowed_user_ids TEXT[]
);

-- メッセージウィンドウ（チャンク）
CREATE TABLE IF NOT EXISTS message_windows (
  window_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  guild_id TEXT NOT NULL,
  category_id TEXT,
  channel_id TEXT NOT NULL,
  thread_id TEXT,
  date DATE NOT NULL,
  window_seq INTEGER NOT NULL,
  message_ids TEXT[] NOT NULL,
  start_at TIMESTAMPTZ NOT NULL,
  end_at TIMESTAMPTZ NOT NULL,
  token_est INTEGER,
  text TEXT,
  UNIQUE(channel_id, date, window_seq)
);

-- ベクトル型を定義（pgvector拡張が必要）
CREATE EXTENSION IF NOT EXISTS vector;

-- メッセージのembedding
CREATE TABLE IF NOT EXISTS message_embeddings (
  window_id UUID PRIMARY KEY REFERENCES message_windows(window_id) ON DELETE CASCADE,
  embedding VECTOR(3072) NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- embedding生成キュー
CREATE TABLE IF NOT EXISTS embed_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  window_id UUID NOT NULL REFERENCES message_windows(window_id) ON DELETE CASCADE,
  priority INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'ready',
  attempts INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(window_id)
);

-- 同期操作
CREATE TABLE IF NOT EXISTS sync_operations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  guild_id TEXT NOT NULL,
  scope TEXT NOT NULL,
  mode TEXT NOT NULL,
  target_ids TEXT[],
  since TIMESTAMPTZ,
  requested_by TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  progress JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 同期カーソル
CREATE TABLE IF NOT EXISTS sync_cursors (
  guild_id TEXT PRIMARY KEY,
  last_message_id TEXT,
  last_synced_at TIMESTAMPTZ DEFAULT NOW()
);

-- 同期チャンク
CREATE TABLE IF NOT EXISTS sync_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  op_id UUID NOT NULL REFERENCES sync_operations(id) ON DELETE CASCADE,
  target_id TEXT NOT NULL,
  date DATE NOT NULL,
  cursor JSONB,
  status TEXT NOT NULL DEFAULT 'ready',
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- インデックス
CREATE INDEX IF NOT EXISTS idx_messages_guild ON messages(guild_id);
CREATE INDEX IF NOT EXISTS idx_messages_channel ON messages(channel_id);
CREATE INDEX IF NOT EXISTS idx_message_windows_guild ON message_windows(guild_id);
CREATE INDEX IF NOT EXISTS idx_message_windows_channel ON message_windows(channel_id);
CREATE INDEX IF NOT EXISTS idx_embed_queue_status ON embed_queue(status, priority);

