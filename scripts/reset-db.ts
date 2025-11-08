import { getSupabaseClient } from '../src/infrastructure/supabase/client.js';

/**
 * データベースの全テーブルをリセットするスクリプト
 * Supabase JS ClientのRPC経由で全データを削除
 */
async function resetDatabase() {
  console.log('🔄 データベースリセットを開始します...');

  const supabase = getSupabaseClient();

  try {
    // 各テーブルを個別に削除（Supabase JS ClientではTRUNCATEの直接実行ができないため）
    const tables = [
      'embed_queue',
      'message_embeddings', 
      'message_windows',
      'messages',
      'sync_chunks',
      'sync_cursors',
      'sync_operations',
      'threads',
      'channels',
    ] as const;

    console.log('  ➤ 全テーブルをクリア中...');

    for (const table of tables) {
      const { error } = await supabase.from(table).delete().neq('id', '00000000-0000-0000-0000-000000000000');
      
      if (error && error.code !== 'PGRST116') {
        console.warn(`  ⚠️  ${table}: ${error.message}`);
      } else {
        console.log(`  ✓ ${table}`);
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
