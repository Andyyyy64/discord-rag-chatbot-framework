# Embedding実装仕様

## 概要

本システムは、Discordメッセージを**Gemini Embedding API**を使用して**3072次元のベクトル**に変換し、PostgreSQLの**halfvec(3072)**型で効率的に保存します。

## アーキテクチャ

```
/sync コマンド実行
    ↓
メッセージ取得 & ウィンドウ化
    ↓
embed_queue に登録
    ↓
[Embed Worker] (ポーリング)
    ↓
[1] テキスト取得 & トークン制限
    ↓
[2] Gemini Embedding API 呼び出し
    ↓
[3] message_embeddings に保存 (halfvec)
    ↓
embed_queue を done に更新
```

## データ型: halfvec(3072)

### 概要

- **型**: `halfvec(3072)` - 16ビット浮動小数点数ベクトル
- **メモリ効率**: 通常の `vector` (32ビット) の半分
- **サイズ**: 3072次元 × 2バイト = 6,144バイト/ベクトル

### TypeScript側の扱い

- **保存時**: `number[]` → `JSON.stringify()` → DB (string型として保存)
- **検索時**: DB → `number[]` として RPC 関数に渡す
- **型定義**: `database.types.ts` では `embedding: string`

### DB側の実装

**マイグレーション**: `supabase/migrations/20251108090100_add_vector_search.sql`

- embedding列を halfvec(3072) に変換
- HNSW インデックスを作成 (`halfvec_cosine_ops`)

## Embedding生成フロー

### 1. テキスト取得

**実装場所**: `src/domain/embed/embed-worker.ts` (64-120行目)

**処理内容**:
- `message_windows` テーブルから `text` を取得
- `text` が空の場合は `message_ids` からメッセージを復元
- メッセージの順序を保持して結合

### 2. トークン制限

**実装場所**: `src/domain/embed/embed-worker.ts` (143行目)

**処理内容**:
- Gemini Embedding APIのトークン制限に収める
- 制限超過の場合は truncation（切り詰め）
- 警告ログを出力

### 3. Embedding生成

**実装場所**: 
- `src/domain/embed/embed-worker.ts` (152行目)
- `src/infrastructure/gemini/embedding-service.ts` (93-134行目)

**処理内容**:
- Gemini Embedding APIを呼び出し
- モデル: `gemini-embedding-001`
- 出力次元: 3072次元
- リトライロジック: 最大10回、指数バックオフ + ジッター
- 複数API keyのロードバランシング

### 4. 保存

**実装場所**: `src/domain/embed/embed-worker.ts` (155-165行目)

**処理内容**:
- `message_embeddings` テーブルに upsert
- embedding を JSON文字列として保存
- 競合時は上書き (`onConflict: 'window_id'`)

## Embed Queue システム

### テーブル構造

```
embed_queue
├── id (PK)
├── window_id (FK → message_windows)
├── priority (整数、高いほど優先)
├── status ('ready', 'done', 'failed')
├── attempts (リトライ回数)
└── updated_at
```

### ステータス遷移

```
ready → done      (成功)
ready → failed    (最大リトライ回数超過)
ready → ready     (リトライ可能なエラー)
```

### 優先度

- **priority**: 高い値ほど優先的に処理
- **updated_at**: 同じ優先度の場合は古いものから処理

## Embed Worker

### 設定

**実装場所**: `src/domain/embed/embed-worker.ts` (33-39行目)

| パラメータ | デフォルト | 説明 |
|-----------|-----------|------|
| `pollIntervalMs` | 500ms | ポーリング間隔 |
| `batchSize` | 500 | 一度に取得する件数 |
| `concurrency` | 15 | 並列処理数 |
| `maxAttempts` | 5 | 最大リトライ回数 |

### 動作

1. **バッチ取得**: `status = 'ready'` のレコードを優先度順に取得
2. **並列処理**: `concurrency` 件を並列実行
3. **アイドル時**: 指数バックオフ（最大30秒）
4. **完了チェック**: 全て完了したらログ出力

**実装場所**: `src/domain/embed/embed-worker.ts` (252-275行目)

## リトライロジック

### Embedding API呼び出し

**実装場所**: `src/infrastructure/gemini/embedding-service.ts` (93-180行目)

**リトライ条件**:
- レート制限エラー
- 一時的なネットワークエラー
- タイムアウト

**リトライ戦略**:
- 最大10回まで
- 指数バックオフ: `2^attempt + jitter`
- ジッター: 0〜2秒のランダム値

### Embed Worker

**実装場所**: `src/domain/embed/embed-worker.ts` (192-209行目)

**リトライ条件**:
- `attempts < maxAttempts` の場合のみ
- 失敗時は `attempts` をインクリメント
- 最大回数超過で `status = 'failed'`

## エラーハンドリング

### ケース1: テキスト取得失敗

- Window が存在しない
- message_ids が空
- メッセージが見つからない

**対処**: `status = 'failed'` に更新

### ケース2: Embedding生成失敗

- API エラー
- ネットワークエラー

**対処**: リトライロジックに従って再試行

### ケース3: 保存失敗

- DB エラー
- 接続エラー

**対処**: エラーログを出力して例外をスロー

## 同期処理との連携

**実装場所**: `src/domain/sync/sync-runner.ts` (107-182行目)

### 待機処理

`/sync` コマンド実行後、embedding生成の完了を待機します。

**処理内容**:
- 5秒ごとにポーリング
- `status = 'ready'` のレコード数をチェック
- 対象ギルドのwindow_idのみカウント
- 最大30分まで待機
- 完了したら進捗を100%に更新

## パフォーマンス

### 典型的な処理時間

| 処理 | 時間 |
|-----|------|
| テキスト取得 | 10-50ms |
| トークンカウント | 5-20ms |
| Embedding生成 | 300-800ms |
| DB保存 | 10-50ms |
| **合計** | **350-950ms/window** |

### スケーラビリティ

- **並列数 15**: 約1,000件/分 の処理速度
- **並列数 30**: 約2,000件/分 の処理速度
- **制限**: Gemini API のレート制限に依存

### 最適化

- 複数のAPI keyでロードバランシング
- 指数バックオフでレート制限を回避
- p-limitで並列数を制御

## トラブルシューティング

### Q1: Embedding生成が遅い

**原因**:
- API レート制限
- 並列数が少ない
- ネットワーク遅延

**対処**:
- 複数のAPI keyを設定
- `concurrency` を増やす（例: 30）
- リトライ間隔を調整

### Q2: 処理が失敗する

**原因**:
- API key が無効
- トークン制限超過
- DB接続エラー

**対処**:
- `.env` で `GEMINI_API_KEY` を確認
- `maxAttempts` を増やす
- ログで詳細を確認

### Q3: embed_queue が溜まる

**原因**:
- Embed Worker が停止
- 処理速度より同期速度が速い

**対処**:
- Embed Worker が起動しているか確認
- `batchSize` や `concurrency` を増やす

## 設定パラメータ

### 環境変数

| 変数名 | デフォルト | 説明 |
|--------|-----------|------|
| `GEMINI_API_KEY` | (必須) | Gemini API キー（カンマ区切りで複数可） |

### コード内定数

| 定数 | 値 | 場所 |
|------|---|------|
| Embedding次元数 | 3072 | `embedWindow()`, `embedQuery()` |
| ポーリング間隔 | 500ms | `createEmbedWorker()` |
| バッチサイズ | 500 | `createEmbedWorker()` |
| 並列数 | 15 | `createEmbedWorker()` |
| 最大リトライ | 10 (API), 5 (Worker) | `embedWindow()`, `processWindow()` |

## 参考実装

- Gemini Embedding API: https://ai.google.dev/docs/embeddings
- pgvector halfvec: https://github.com/pgvector/pgvector#half-precision-vectors
- p-limit: https://github.com/sindresorhus/p-limit


