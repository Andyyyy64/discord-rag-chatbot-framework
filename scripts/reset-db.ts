import postgres from 'postgres';

import { loadEnv } from '../src/config/env';

/**
 * データベースの全テーブルをリセットするスクリプト
 * TRUNCATEコマンドで高速に全データを削除
 */
async function resetDatabase() {
  console.log('🔄 データベースリセットを開始します...');

  const env = loadEnv();
  
  // DATABASE_URLを使用してPostgresに接続
  const sql = postgres(env.DATABASE_URL, {
    ssl: 'require',
  });

  try {
    // TRUNCATEで全テーブルを一括削除（外部キー制約も自動的に処理）
    const tables = [
      'embed_queue',
      'message_embeddings',
      'message_windows',
      'messages',
      'sync_cursors',
      'sync_operations',
    ];

    console.log('  ➤ 全テーブルをTRUNCATEで削除中...');

    // CASCADE を使って外部キー制約も含めて削除
    const tableList = tables.join(', ');
    await sql.unsafe(`TRUNCATE TABLE ${tableList} CASCADE`);

    console.log('  ✅ 全テーブルをクリアしました');
    console.log('\n✨ データベースのリセットが完了しました！');

    await sql.end();
  } catch (error) {
    console.error('\n❌ データベースのリセット中にエラーが発生しました:', error);
    await sql.end();
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
