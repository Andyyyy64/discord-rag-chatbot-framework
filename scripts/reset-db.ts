import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

/**
 * リトライ付きで関数を実行する
 */
async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 3,
  delayMs = 1000
): Promise<T> {
  let lastError: unknown;

  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (i < maxRetries - 1) {
        console.log(`  ⏳ リトライ ${i + 1}/${maxRetries - 1}...`);
        await new Promise(resolve => setTimeout(resolve, delayMs * (i + 1)));
      }
    }
  }

  throw lastError;
}

/**
 * データベースの全テーブルをリセットするスクリプト
 * Supabaseクライアント経由でDELETE実行
 */
async function resetDatabase() {
  console.log('🔄 データベースリセットを開始します...');

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error('❌ SUPABASE_URLまたはSUPABASE_KEYが設定されていません');
    process.exit(1);
  }

  console.log(`  ℹ️  接続先: ${supabaseUrl}`);
  console.log(`  ℹ️  使用中のキー: ${supabaseKey.substring(0, 20)}...`);

  // Supabaseクライアントを初期化（タイムアウト設定を追加）
  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (url, options = {}) => {
        return fetch(url, {
          ...options,
          // タイムアウトを60秒に設定
          signal: AbortSignal.timeout(60000),
        });
      },
    },
  });

  try {
    console.log('  ➤ 全テーブルをクリア中...');

    // 外部キー制約を考慮して、依存関係の逆順で削除
    // message_embeddingsはmessage_windowsのON DELETE CASCADEで自動削除される
    const tables = [
      'embed_queue',
      'message_windows',  // message_embeddingsも同時に削除される
      'messages',
      'sync_chunks',
      'sync_operations',
      'sync_cursors',
      'threads',
      'channels',
    ];

    for (const table of tables) {
      try {
        // message_windowsは大量データでタイムアウトする可能性があるためバッチ削除
        if (table === 'message_windows') {
          console.log(`  ➤ ${table}: バッチ削除中...`);
          let totalDeleted = 0;
          const batchSize = 100; // バッチサイズを小さくして安定性を向上
          let consecutiveErrors = 0;
          const maxConsecutiveErrors = 5;

          // 小さいバッチで繰り返し削除
          while (consecutiveErrors < maxConsecutiveErrors) {
            try {
              // 上位N件を取得（リトライ付き）
              const { data: batch } = await withRetry(
                async () => {
                  const result = await supabase
                    .from(table)
                    .select('window_id')
                    .limit(batchSize);

                  if (result.error) {
                    throw new Error(`Fetch error: ${result.error.message}`);
                  }

                  return result;
                },
                3,
                2000
              );

              if (!batch || batch.length === 0) {
                break;
              }

              // 少量のIDずつ削除（.in()の制限を考慮）
              const chunkSize = 100;
              for (let i = 0; i < batch.length; i += chunkSize) {
                const chunk = batch.slice(i, i + chunkSize);
                const ids = chunk.map(row => row.window_id);

                const { error: deleteError, count } = await withRetry(
                  async () => {
                    const result = await supabase
                      .from(table)
                      .delete()
                      .in('window_id', ids);

                    if (result.error) {
                      throw new Error(`Delete error: ${result.error.message}`);
                    }

                    return result;
                  },
                  3,
                  1000
                );

                if (!deleteError) {
                  totalDeleted += count ?? chunk.length;
                  consecutiveErrors = 0; // エラーカウントをリセット
                }
              }

              process.stdout.write(`\r  ➤ ${table}: ${totalDeleted}行削除中...`);

              // バッチサイズより少ない場合は最後のバッチ
              if (batch.length < batchSize) {
                break;
              }
            } catch (error) {
              consecutiveErrors++;
              console.log(`\n  ⚠️  エラーが発生しました (${consecutiveErrors}/${maxConsecutiveErrors})`);

              if (error instanceof Error) {
                console.log(`  ℹ️  エラー詳細: ${error.message}`);
              }

              if (consecutiveErrors >= maxConsecutiveErrors) {
                console.log(`  ⚠️  ${table}: 連続エラーが多すぎるためスキップします`);
                break;
              }

              // 次のバッチまで少し待機
              await new Promise(resolve => setTimeout(resolve, 3000));
            }
          }
          console.log(`\n  ✓ ${table} (${totalDeleted}行削除)          `);
        } else {
          // 通常のテーブルは一括削除
          let query;

          if (['embed_queue', 'sync_operations', 'sync_chunks'].includes(table)) {
            query = supabase.from(table).delete().neq('id', '00000000-0000-0000-0000-000000000000');
          } else if (table === 'messages') {
            query = supabase.from(table).delete().neq('message_id', '');
          } else if (table === 'channels') {
            query = supabase.from(table).delete().neq('channel_id', '');
          } else if (table === 'threads') {
            query = supabase.from(table).delete().neq('thread_id', '');
          } else if (table === 'sync_cursors') {
            query = supabase.from(table).delete().neq('guild_id', '');
          } else {
            console.warn(`  ⚠️  ${table}: スキップ（削除条件が未定義）`);
            continue;
          }

          const { error, count } = await query;

          if (error) {
            throw error;
          }
          console.log(`  ✓ ${table}${count !== null ? ` (${count}行削除)` : ''}`);
        }
      } catch (error) {
        // エラーの詳細を表示
        console.log(`  ⚠️  ${table}テーブルの削除中にエラーが発生しました`);

        if (error instanceof Error) {
          console.log(`     エラー: ${error.message}`);
          if (error.stack) {
            console.log(`     スタックトレース: ${error.stack.split('\n').slice(0, 3).join('\n')}`);
          }

          // fetch failedエラーの場合、追加情報を表示
          if (error.message.includes('fetch failed')) {
            console.log(`     💡 ヒント: ネットワーク接続を確認してください`);
            console.log(`     💡 Supabase URLが正しいか確認してください: ${supabaseUrl}`);
          }
        } else if (typeof error === 'object' && error !== null) {
          console.log(`     詳細:`, JSON.stringify(error, null, 2));
        } else {
          console.log(`     エラー: ${String(error)}`);
        }

        console.log(`  ℹ️  ${table}テーブルはスキップして続行します\n`);
      }
    }

    console.log('  ✅ 全テーブルをクリアしました');
    console.log('\n✨ データベースのリセットが完了しました！');
  } catch (error) {
    console.error('\n❌ データベースのリセット中にエラーが発生しました:', error);
    process.exit(1);
  }
}

// スクリプト実行
resetDatabase()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error('予期しないエラー:', error);
    process.exit(1);
  });
