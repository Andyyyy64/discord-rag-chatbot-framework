# Chat実装仕様

## 概要

本システムのchat機能は、**pgvectorベースのセマンティック検索（意味検索）**を採用したRAG（Retrieval-Augmented Generation）システムです。

> **Note**: Embedding生成の詳細は [embedding.md](./embedding.md) を参照してください。

## アーキテクチャ

```
ユーザークエリ
    ↓
[1] クエリのベクトル化
    ↓
[2] ベクトル検索（pgvector RPC）
    ↓
[3] 候補の絞り込み（Top-15）
    ↓
[4] 再ランク（オプション、Top-5）
    ↓
[5] プロンプト構築
    ↓
[6] 回答生成（Gemini Chat API）
```

## 実装の詳細

### 1. クエリのベクトル化

**実装場所**: `src/domain/chat/chat-service.ts` (110行目)

**処理内容**:
- Gemini Embedding APIを使用してクエリを3072次元ベクトルに変換
- 詳細は [embedding.md](./embedding.md) を参照

### 2. ベクトル検索（pgvector）

**実装場所**: `src/domain/chat/chat-service.ts` (118-125行目)

**処理内容**:
- PostgreSQL RPC関数 `match_windows_in_guild` を呼び出し
- ギルド内の全embeddingとクエリをコサイン類似度で比較
- 類似度上位200件を取得

**DB側実装**: `supabase/migrations/20251108090100_add_vector_search.sql`

**使用技術**:
- **データ型**: `halfvec(3072)` - 詳細は [embedding.md](./embedding.md) を参照
- **インデックス**: HNSW (Hierarchical Navigable Small World)
  - `m = 16`: 各ノードの接続数
  - `ef_construction = 64`: 構築時の探索幅
- **演算子**: `<=>` (コサイン距離)
- **類似度計算**: `1 - (A <=> B)` でコサイン類似度（0〜1）に変換

### 3. 候補の絞り込み

**実装場所**: `src/domain/chat/chat-service.ts` (142-157行目)

**処理内容**:
- ベクトル検索で取得した200件のwindow_idから実際のウィンドウ情報を取得
- `message_windows` テーブルから必要なフィールドのみを SELECT
- 類似度順を保持したまま上位15件に絞り込み
- Map を使用して効率的にマッピング

### 4. 再ランク（オプション）

**実装場所**: `src/domain/chat/chat-service.ts` (204-227行目)

**処理内容**:
- 環境変数 `RERANK_PROVIDER` が `none` 以外の場合に実行
- Cohere Rerank API等を使用して候補をさらに精密化
- デフォルトTop-5を選択（`RERANK_TOPK` で変更可能）
- リランク失敗時はベクトル検索の結果をそのまま使用

### 5. プロンプト構築

**実装場所**: `src/domain/chat/chat-service.ts` (172-190行目)

**処理内容**:
- 選択されたウィンドウを番号付きコンテキストとしてフォーマット
- 各ウィンドウに `[#番号]` と時間範囲を付与
- システムプロンプトで制約（根拠番号、日本語、不足時の対応）を指示
- ユーザーIDと質問を含む構造化プロンプトを生成

### 6. 回答生成

**実装場所**: `src/domain/chat/chat-service.ts` (30-37行目、66-95行目)

**処理内容**:
- Gemini Chat APIを使用（デフォルト: `gemini-2.5-flash-lite`）
- 設定:
  - temperature: 0.3（一貫性重視）
  - topP: 0.9
  - maxOutputTokens: 2048
- 回答から複数の part を結合して返却
- 引用情報（citations）を含む構造化レスポンスを返却
- レイテンシ計測を含む

## データフロー

### 検索フロー

1. **ユーザーが `/chat 質問内容` を実行**
   - 入力例: "andyって誰？"

2. **クエリをベクトル化**
   - Gemini Embedding API → 3072次元ベクトル

3. **pgvectorで類似検索**
   - `message_embeddings` テーブルでコサイン距離検索
   - ギルドIDでフィルタリング
   - 上位200件を取得

4. **候補の絞り込み**
   - 200件 → 類似度上位15件

5. **再ランク（オプション）**
   - 15件 → Cohere Rerank → Top-5

6. **プロンプト構築 + LLM回答生成**
   - コンテキスト(5件) + 質問 → Gemini → 回答

## パフォーマンス

### 典型的なレイテンシ（約2万件のembedding）

| フェーズ | 時間 |
|---------|------|
| クエリベクトル化 | 300-500ms |
| pgvector検索 | 100-300ms |
| 候補絞り込み | 50-100ms |
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

- 公式: `cos(θ) = (A · B) / (|A| × |B|)`
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

- **m = 16**: 各ノードの接続数（デフォルト）
  - 大きいほど精度向上、インデックスサイズ増加
- **ef_construction = 64**: 構築時の探索幅（デフォルト）
  - 大きいほど構築時間増加、検索精度向上

## エラーハンドリング

### ケース1: 検索結果0件

- メッセージ: "まだ同期されたメッセージがありません。/sync を実行してから再度お試しください。"
- citations: 空配列
- latencyMs: レスポンス時間を含む

### ケース2: ベクトル検索失敗

- エラーログを出力
- 空配列を返却してグレースフルに処理

### ケース3: LLM回答生成失敗

- エラーログを出力
- `CHAT_FAILED` エラーをスロー

## トラブルシューティング

### Q1: 検索結果が0件になる

**原因**:
- embeddingが未生成（`/sync`未実行）
- ギルドIDが間違っている
- pgvector RPC関数が未作成

**対処**:
- マイグレーション適用: `npx supabase db push`
- 同期実行: `/sync`（Discordコマンド）
- Embedding生成の詳細は [embedding.md](./embedding.md) を参照

### Q2: 検索が遅い（1秒以上）

**原因**:
- HNSWインデックスが未作成
- embedding件数が10万件超

**対処**:
- インデックス確認: `pg_indexes` テーブルで確認
- インデックス再構築: パラメータ調整（m = 24, ef_construction = 128 など）

### Q3: 回答精度が低い

**原因**:
- 候補数が少なすぎる
- 再ランクが無効

**対処**:
- 再ランクを有効化: `.env` で `RERANK_PROVIDER=cohere`、`RERANK_TOPK=8` など設定
- 候補数を増やす: コード内の `VECTOR_LIMIT` を 200 → 500 などに変更

## 今後の改善案

### 1. ハイブリッド検索の追加

全文検索（FTS）とベクトル検索を統合し、RRF（Reciprocal Rank Fusion）で結果をマージ。ベクトル検索と全文検索の結果をスコア統合することで、より精度の高い検索を実現。

### 2. クエリ拡張

関連キーワードを自動抽出してマルチクエリ検索を実行。

### 3. メタデータフィルタリング

チャンネル、日付範囲、ユーザーなどでフィルタリング可能に。

## 参考実装

- pgvector演算子: https://github.com/pgvector/pgvector#operators
- HNSW詳細: https://arxiv.org/abs/1603.09320
- RRF統合: https://plg.uwaterloo.ca/~gvcormac/cormacksigir09-rrf.pdf

