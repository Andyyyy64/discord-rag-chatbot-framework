ALTER TABLE message_embeddings 
ALTER COLUMN embedding TYPE halfvec(3072) 
USING embedding::text::halfvec(3072);

CREATE INDEX IF NOT EXISTS idx_message_embeddings_embedding_hnsw
ON message_embeddings USING hnsw (embedding halfvec_cosine_ops)
WITH (m = 16, ef_construction = 64);

CREATE OR REPLACE FUNCTION match_windows_in_guild(
  query_embedding halfvec(3072),
  p_guild_id TEXT,
  p_limit INT DEFAULT 200
)
RETURNS TABLE(
  window_id UUID,
  similarity FLOAT
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    me.window_id,
    1 - (me.embedding <=> query_embedding) AS similarity
  FROM message_embeddings AS me
  JOIN message_windows AS mw ON mw.window_id = me.window_id
  WHERE mw.guild_id = p_guild_id
  ORDER BY me.embedding <=> query_embedding
  LIMIT p_limit;
$$;
