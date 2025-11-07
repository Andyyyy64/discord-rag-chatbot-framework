import { getSupabaseClient } from '../src/infrastructure/supabase/client';

/**
 * データベースの全テーブルをリセットするスクリプト
 * 全てのデータを削除して初期状態に戻す
 */
async function resetDatabase() {
    console.log('🔄 データベースリセットを開始します...');

    const supabase = getSupabaseClient();

    try {
        // 各テーブルを削除（外部キー制約を考慮した順序）
        // 各テーブルの主キーに応じて削除条件を設定
        const tables = [
            { name: 'embed_queue', key: 'id' },
            { name: 'message_embeddings', key: 'window_id' },
            { name: 'message_windows', key: 'window_id' },
            { name: 'messages', key: 'message_id' },
            { name: 'sync_cursors', key: 'guild_id' },
            { name: 'sync_operations', key: 'id' },
        ];

        for (const table of tables) {
            console.log(`  ➤ ${table.name} テーブルをクリア中...`);

            // NULL以外の全レコードを削除（実質的に全行削除）
            const { error } = await supabase.from(table.name).delete().not(table.key, 'is', null);

            if (error) {
                console.error(`    ❌ ${table.name} のクリアに失敗:`, error.message);
                throw error;
            }

            console.log(`    ✅ ${table.name} をクリアしました`);
        }

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
