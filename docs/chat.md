# Chat実装仕様

## 概要

本システムのchat機能は、**pgvectorベースのセマンティック検索（意味検索）**を採用したRAG（Retrieval-Augmented Generation）システムです。

## アーキテクチャ

```
ユーザークエリ
    ↓
[1] クエリのベクトル化（Gemini Embedding）
    ↓
[2] ベクトル検索（pgvector RPC）
    ↓
[3] 再ランク（オプション）
    ↓
[4] 回答生成（Gemini Chat API）
```

## 実装の詳細

### 1. クエリのベクトル化

**実装場所**: `src/domain/chat/chat-service.ts` (109-113行目)

```typescript
const queryEmbedding = await embedQuery(input.query, 3072);
```

**処理内容**:
- Gemini Embedding APIを使用してクエリを3072次元ベクトルに変換
- モデル: `gemini-embedding-001`
- 出力次元: 3072次元（高精度）

### 2. ベクトル検索（pgvector）

**実装場所**: `src/domain/chat/chat-service.ts` (115-139行目)

```typescript
const { data: matched, error: matchError } = await supabase.rpc(
  'match_windows_in_guild',
  {
    query_embedding: queryEmbedding,
    p_guild_id: input.guildId,
    p_limit: 200,
  }
);
```

**処理内容**:
- PostgreSQL RPC関数 `match_windows_in_guild` を呼び出し
- ギルド内の全embeddingとクエリをコサイン類似度で比較
- 類似度上位200件を取得

**DB側実装**: `supabase/migrations/20251108090100_add_vector_search.sql`

```sql
CREATE OR REPLACE FUNCTION match_windows_in_guild(
  query_embedding halfvec(3072),
  p_guild_id TEXT,
  p_limit INT DEFAULT 200
)
RETURNS TABLE(
  window_id UUID,
  similarity FLOAT
)
AS $$
  SELECT
    me.window_id,
    1 - (me.embedding <=> query_embedding) AS similarity
  FROM message_embeddings AS me
  JOIN message_windows AS mw ON mw.window_id = me.window_id
  WHERE mw.guild_id = p_guild_id
  ORDER BY me.embedding <-> query_embedding
  LIMIT p_limit;
$$;
```

**使用技術**:
- **データ型**: `halfvec(3072)` - 16ビット浮動小数点数、メモリ効率が良く高次元対応
- **インデックス**: HNSW (Hierarchical Navigable Small World)
- **演算子**: `<->` (コサイン距離), `<=>` (コサイン距離の別名)
- **類似度計算**: `1 - (A <=> B)` でコサイン類似度（0〜1）に変換

### 3. 候補の絞り込み

**実装場所**: `src/domain/chat/chat-service.ts` (141-162行目)

```typescript
const byId = new Map(windows?.map((w) => [w.window_id, w]) ?? []);
const ordered = matched
  .map((m: { window_id: string; similarity: number }) => byId.get(m.window_id))
  .filter((w): w is MessageWindowRecord => Boolean(w))
  .slice(0, 15);
```

**処理内容**:
- ベクトル検索で取得した200件のwindow_idから実際のウィンドウ情報を取得
- 類似度順を保持したまま上位15件に絞り込み

### 4. 再ランク（オプション）

**実装場所**: `src/domain/chat/chat-service.ts` (204-227行目)

```typescript
const reranked = await rerankService.rerank(input.query, candidates, rerankTopK);
```

**処理内容**:
- 環境変数 `RERANK_PROVIDER` が `none` 以外の場合に実行
- Cohere Rerank API等を使用して候補をさらに精密化
- デフォルトTop-5を選択（`RERANK_TOPK` で変更可能）

### 5. プロンプト構築

**実装場所**: `src/domain/chat/chat-service.ts` (172-190行目)

```typescript
const prompt = buildPrompt(input, selectedWindows);
```

**フォーマット**:
```
あなたはDiscordサーバー専用のRAGアシスタントです。
以下の制約を必ず守ってください:
1. 参照した証拠には [#番号] の形で根拠番号を付ける。
2. 回答は日本語を既定とし、必要に応じて英語を混在してもよい。
3. 情報が不足している場合は率直に不足を伝える。

# コンテキスト
[#1] (2025-11-08T12:00:00 – 2025-11-08T13:00:00)
メッセージ内容...

[#2] (2025-11-08T14:00:00 – 2025-11-08T15:00:00)
メッセージ内容...

# ユーザー (user_id) からの質問
質問内容
```

### 6. 回答生成

**実装場所**: `src/domain/chat/chat-service.ts` (65-95行目)

```typescript
const response = await model.generateContent({
  contents: [
    {
      role: 'user',
      parts: [{ text: prompt }],
    },
  ],
});
```

**処理内容**:
- Gemini Chat APIを使用（デフォルト: `gemini-2.5-flash-lite`）
- 設定:
  - temperature: 0.3（一貫性重視）
  - topP: 0.9
  - maxOutputTokens: 2048

## データフロー

### テーブル構造

```
message_windows          message_embeddings
├── window_id (PK)       ├── window_id (PK, FK)
├── guild_id             ├── embedding (halfvec(3072))
├── text                 └── updated_at
├── message_ids
├── start_at
└── end_at
```

### 検索クエリの流れ

1. **ユーザーが `/chat 質問内容` を実行**
   ```
   入力: "andyって誰？"
   ```

2. **クエリをベクトル化**
   ```
   Gemini Embedding API
   → [0.234, -0.456, ..., 0.789] (3072次元)
   ```

3. **pgvectorで類似検索**
   ```sql
   SELECT window_id, 1 - (embedding <=> query) AS similarity
   FROM message_embeddings
   JOIN message_windows USING (window_id)
   WHERE guild_id = 'xxx'
   ORDER BY embedding <-> query
   LIMIT 200;
   ```

4. **Top-15を選択**
   ```
   200件 → 類似度上位15件
   ```

5. **再ランク（オプション）**
   ```
   15件 → Cohere Rerank → Top-5
   ```

6. **プロンプト構築 + LLM回答生成**
   ```
   コンテキスト(5件) + 質問 → Gemini → 回答
   ```

## パフォーマンス

### 典型的なレイテンシ（約2万件のembedding）

| フェーズ | 時間 |
|---------|------|
| クエリベクトル化 | 300-500ms |
| pgvector検索 | 100-300ms |
| ウィンドウ取得 | 50-100ms |
| 再ランク | 200-500ms（有効時） |
| LLM回答生成 | 1000-2000ms |
| **合計** | **2-4秒** |

### スケーラビリティ

- **2万件**: 検索時間 100-300ms
- **10万件**: 検索時間 200-500ms（HNSWインデックス利用時）
- **100万件以上**: インデックスパラメータ調整が必要

## 設定パラメータ

### 環境変数

| 変数名 | デフォルト | 説明 |
|--------|-----------|------|
| `CHAT_MODEL` | `gemini-2.5-flash-lite` | 回答生成に使用するGeminiモデル |
| `RERANK_PROVIDER` | `none` | 再ランクサービス（`none`, `cohere`, `voyage`） |
| `RERANK_TOPK` | `5` | 再ランク後のTop-K件数 |
| `GEMINI_API_KEY` | (必須) | Gemini API キー |

### コード内定数

| 定数 | 値 | 場所 |
|------|---|------|
| `VECTOR_LIMIT` | 200 | ベクトル検索の候補数 |
| 最終候補数 | 15 | プロンプトに渡す前の候補数 |
| `rerankTopK` | 5 | 最終的にプロンプトに含める件数 |

## ベクトル検索の数学的背景

### コサイン類似度

```
cos(θ) = (A · B) / (|A| × |B|)
```

- **A · B**: 内積（ドット積）
- **|A|, |B|**: ベクトルのノルム（大きさ）
- **結果**: -1〜1の範囲（1に近いほど類似）

### pgvectorの演算子

| 演算子 | 意味 | 用途 |
|--------|------|------|
| `<->` | コサイン距離 | ORDER BY（距離が小さい順） |
| `<=>` | コサイン距離（別名） | WHERE句での閾値比較 |
| `1 - (A <=> B)` | コサイン類似度 | 0〜1の範囲に正規化 |

### HNSWインデックスのパラメータ

```sql
WITH (m = 16, ef_construction = 64)
```

- **m**: 各ノードの接続数（デフォルト16）
  - 大きいほど精度向上、インデックスサイズ増加
- **ef_construction**: 構築時の探索幅（デフォルト64）
  - 大きいほど構築時間増加、検索精度向上

## エラーハンドリング

### ケース1: 検索結果0件

```typescript
if (!windows.length) {
  return {
    answer: 'まだ同期されたメッセージがありません。/sync を実行してから再度お試しください。',
    citations: [],
    latencyMs: Date.now() - started,
  };
}
```

### ケース2: ベクトル検索失敗

```typescript
if (matchError) {
  logger.error('[Chat] Vector RPC error:', matchError);
  return []; // 空配列を返す
}
```

### ケース3: LLM回答生成失敗

```typescript
catch (error) {
  logger.error('[Chat] Gemini chat failed', error);
  throw createBaseError('チャット応答の生成中にエラーが発生しました', 'CHAT_FAILED');
}
```

## トラブルシューティング

### Q1: 検索結果が0件になる

**原因**:
- embeddingが未生成（`/sync`未実行）
- ギルドIDが間違っている
- pgvector RPC関数が未作成

**対処**:
```bash
# マイグレーション適用
npx supabase db push

# 同期実行
/sync（Discordコマンド）
```

### Q2: 検索が遅い（1秒以上）

**原因**:
- HNSWインデックスが未作成
- embedding件数が10万件超

**対処**:
```sql
-- インデックス確認
SELECT indexname, indexdef 
FROM pg_indexes 
WHERE tablename = 'message_embeddings';

-- インデックス再構築（必要に応じて）
DROP INDEX IF EXISTS idx_message_embeddings_embedding_hnsw;
CREATE INDEX idx_message_embeddings_embedding_hnsw
ON message_embeddings USING hnsw (embedding halfvec_cosine_ops)
WITH (m = 24, ef_construction = 128); -- パラメータ調整
```

### Q3: 回答精度が低い

**原因**:
- 候補数が少なすぎる
- 再ランクが無効

**対処**:
```bash
# 再ランクを有効化（.env）
RERANK_PROVIDER=cohere
COHERE_API_KEY=your_key
RERANK_TOPK=8

# または候補数を増やす（コード修正）
const VECTOR_LIMIT = 500; // 200 → 500
```

## 今後の改善案

### 1. ハイブリッド検索の追加

全文検索（FTS）とベクトル検索を統合し、RRF（Reciprocal Rank Fusion）で結果をマージ。

```sql
WITH vector AS (
  SELECT window_id, (1.0 / (1 + ROW_NUMBER() OVER (...))) AS r
  FROM message_embeddings
  ORDER BY embedding <-> query
  LIMIT 200
),
lexical AS (
  SELECT window_id, (1.0 / (60 + ROW_NUMBER() OVER (...))) AS r
  FROM message_windows
  WHERE text @@ websearch_to_tsquery('japanese', query)
  LIMIT 200
)
SELECT window_id, SUM(r) AS score
FROM (SELECT * FROM vector UNION ALL SELECT * FROM lexical)
GROUP BY window_id
ORDER BY score DESC;
```

### 2. クエリ拡張

関連キーワードを自動抽出してマルチクエリ検索を実行。

### 3. メタデータフィルタリング

チャンネル、日付範囲、ユーザーなどでフィルタリング可能に。

## 参考実装

- pgvector演算子: https://github.com/pgvector/pgvector#operators
- HNSW詳細: https://arxiv.org/abs/1603.09320
- RRF統合: https://plg.uwaterloo.ca/~gvcormac/cormacksigir09-rrf.pdf

