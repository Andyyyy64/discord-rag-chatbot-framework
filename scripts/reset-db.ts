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
    ];

    for (const table of tables) {
      try {
        // テーブルごとに適切な削除条件を設定
        let query;
        
        // UUIDのidカラムを持つテーブル
        if (['embed_queue', 'sync_operations', 'sync_chunks'].includes(table)) {
          query = supabase.from(table).delete().neq('id', '00000000-0000-0000-0000-000000000000');
        }
        // window_idをプライマリキーとするテーブル
        else if (table === 'message_windows') {
          query = supabase.from(table).delete().neq('window_id', '00000000-0000-0000-0000-000000000000');
        }
        else if (table === 'message_embeddings') {
          query = supabase.from(table).delete().neq('window_id', '00000000-0000-0000-0000-000000000000');
        }
        // 文字列のプライマリキーを持つテーブル
        else if (table === 'messages') {
          query = supabase.from(table).delete().neq('message_id', '');
        }
        else if (table === 'channels') {
          query = supabase.from(table).delete().neq('channel_id', '');
        }
        else if (table === 'threads') {
          query = supabase.from(table).delete().neq('thread_id', '');
        }
        else if (table === 'sync_cursors') {
          query = supabase.from(table).delete().neq('guild_id', '');
        }
        else {
          console.warn(`  ⚠️  ${table}: スキップ（削除条件が未定義）`);
          continue;
        }
        
        const { error, count } = await query;
        
        if (error) {
          throw error;
        }
        console.log(`  ✓ ${table}${count !== null ? ` (${count}行削除)` : ''}`);
      } catch (error) {
        console.warn(`  ⚠️  ${table}: ${error instanceof Error ? error.message : String(error)}`);
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
