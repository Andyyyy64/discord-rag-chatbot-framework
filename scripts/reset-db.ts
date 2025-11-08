import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

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

  // Supabaseクライアントを初期化
  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false },
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
          const batchSize = 500;

          // 小さいバッチで繰り返し削除
          while (true) {
            // 上位N件を取得
            const { data: batch, error: fetchError } = await supabase
              .from(table)
              .select('window_id')
              .limit(batchSize);

            if (fetchError) {
              throw fetchError;
            }

            if (!batch || batch.length === 0) {
              break;
            }

            // 少量のIDずつ削除（.in()の制限を考慮）
            const chunkSize = 500;
            for (let i = 0; i < batch.length; i += chunkSize) {
              const chunk = batch.slice(i, i + chunkSize);
              const ids = chunk.map(row => row.window_id);

              const { error: deleteError, count } = await supabase
                .from(table)
                .delete()
                .in('window_id', ids);

              if (deleteError) {
                console.warn(`\n  警告: バッチ削除に失敗: ${deleteError.message}`);
              } else {
                totalDeleted += count ?? chunk.length;
              }
            }

            process.stdout.write(`\r  ➤ ${table}: ${totalDeleted}行削除中...`);

            // バッチサイズより少ない場合は最後のバッチ
            if (batch.length < batchSize) {
              break;
            }
          }
          console.log(`\r  ✓ ${table} (${totalDeleted}行削除)          `);
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
        if (error instanceof Error) {
          console.warn(`  ⚠️  ${table}: ${error.message}`);
        } else if (typeof error === 'object' && error !== null) {
          console.warn(`  ⚠️  ${table}:`, JSON.stringify(error, null, 2));
        } else {
          console.warn(`  ⚠️  ${table}: ${String(error)}`);
        }
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
