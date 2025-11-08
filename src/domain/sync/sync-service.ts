import { logger } from '../../infrastructure/logging/logger';
import { getSupabaseClient } from '../../infrastructure/supabase/client';
import type { TypedSyncOperation } from '../../infrastructure/supabase/database-extensions.types';
import type { Database } from '../../infrastructure/supabase/database.types';
import { createBaseError } from '../../shared/errors/base-error';

import type { SyncCommandInput, SyncJobStatus, SyncMode } from './types';

// データベースから返される行の型定義
type SyncOperationRow = TypedSyncOperation;
type SyncCursorRow = Database['public']['Tables']['sync_cursors']['Row'];

/**
 * 同期サービスを作成する
 */
export function createSyncService() {
  const supabase = getSupabaseClient();

  /**
   * データベースの行をジョブステータスに変換する
   */
  const mapStatus = (row: SyncOperationRow): SyncJobStatus => ({
    jobId: row.id,
    processed: row.progress?.processed ?? 0,
    total: row.progress?.total ?? 0,
    status: row.status,
    message: row.progress?.message,
  });

  /**
   * ギルドの同期カーソルを取得する
   */
  const fetchCursor = async (guildId: string): Promise<SyncCursorRow | null> => {
    const { data, error } = await supabase
      .from('sync_cursors')
      .select('*')
      .eq('guild_id', guildId)
      .maybeSingle<SyncCursorRow>();

    if (error && error.code !== 'PGRST116') {
      logger.error('Failed to load sync cursor', error);
      throw createBaseError('同期状態の取得に失敗しました', 'SYNC_CURSOR_READ_FAILED', { error });
    }

    return data ?? null;
  };

  /**
   * ギルドの同期カーソルを更新または作成する
   */
  const upsertCursor = async (guildId: string) => {
    const { error } = await supabase
      .from('sync_cursors')
      .upsert({ guild_id: guildId, last_synced_at: new Date().toISOString() })
      .select('guild_id');

    if (error) {
      logger.warn('Failed to upsert sync cursor', error);
    }
  };

  /**
   * 同期ジョブをリクエストする
   * カーソルが存在する場合は差分同期、存在しない場合はフル同期を実行する
   */
  const requestSync = async (input: SyncCommandInput): Promise<SyncJobStatus> => {
    const cursor = await fetchCursor(input.guildId);
    const mode: SyncMode = cursor ? 'delta' : 'full';

    const payload: Database['public']['Tables']['sync_operations']['Insert'] = {
      guild_id: input.guildId,
      scope: 'guild',
      mode,
      target_ids: null,
      since: cursor?.last_synced_at ?? null,
      requested_by: input.requestedBy,
      status: 'queued',
      progress: { processed: 0, total: 0 },
    };

    const { data, error } = await supabase
      .from('sync_operations')
      .insert(payload)
      .select('*')
      .single<SyncOperationRow>();

    if (error || !data) {
      logger.error('Failed to enqueue sync job', error);
      throw createBaseError('同期ジョブの登録に失敗しました', 'SYNC_ENQUEUE_FAILED', { error });
    }

    await upsertCursor(input.guildId);

    return mapStatus(data);
  };

  return { requestSync };
}
