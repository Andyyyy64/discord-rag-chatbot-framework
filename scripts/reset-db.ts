import dotenv from 'dotenv';
import postgres from 'postgres';

dotenv.config();

/**
 * データベースの全テーブルをリセットするスクリプト
 * PostgreSQL直接接続でTRUNCATE実行
 */
async function resetDatabase() {
  console.log('🔄 データベースリセットを開始します...');

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('❌ DATABASE_URLが設定されていません');
    process.exit(1);
  }

  // PostgreSQL接続（タイムアウト設定を長くする）
  const sql = postgres(databaseUrl, {
    max: 1,
    idle_timeout: 0,
    connect_timeout: 30,
  });

  try {
    console.log('  ➤ 全テーブルをクリア中...');

    // statement_timeoutを60秒に設定
    await sql`SET statement_timeout = '60s'`;

    // 全テーブルをTRUNCATEで削除（CASCADE指定で外部キー制約も考慮）
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
        await sql`TRUNCATE TABLE ${sql(table)} CASCADE`;
        console.log(`  ✓ ${table}`);
      } catch (error) {
        console.warn(`  ⚠️  ${table}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    console.log('  ✅ 全テーブルをクリアしました');
    console.log('\n✨ データベースのリセットが完了しました！');
  } catch (error) {
    console.error('\n❌ データベースのリセット中にエラーが発生しました:', error);
    process.exit(1);
  } finally {
    await sql.end();
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
