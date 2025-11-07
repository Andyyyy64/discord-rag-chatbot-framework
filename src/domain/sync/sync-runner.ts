import type { Client } from 'discord.js';

import { createMessageFetcher } from '../../infrastructure/discord/message-fetcher';
import { logger } from '../../infrastructure/logging/logger';
import type { Database } from '../../infrastructure/supabase/client';
import { getSupabaseClient } from '../../infrastructure/supabase/client';
import { createBaseError } from '../../shared/errors/base-error';

type SyncOperationRow = Database['public']['Tables']['sync_operations']['Row'];

export interface SyncRunnerConfig {
  pollIntervalMs?: number;
}

/**
 * 同期ジョブを処理するワーカー
 */
export function createSyncRunner(client: Client, config: SyncRunnerConfig = {}) {
  const supabase = getSupabaseClient();
  const fetcher = createMessageFetcher(client);
  const pollIntervalMs = config.pollIntervalMs ?? 5000;

  /**
   * queued 状態のジョブを1つ取得してロック
   */
  const acquireJob = async (): Promise<SyncOperationRow | null> => {
    const { data, error } = await supabase
      .from('sync_operations')
      .select('*')
      .eq('status', 'queued')
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle<SyncOperationRow>();

    if (error) {
      logger.error('Failed to acquire job', error);
      return null;
    }

    if (!data) return null;

    // ジョブを running に更新
    const { error: updateError } = await supabase
      .from('sync_operations')
      .update({
        status: 'running',
        updated_at: new Date().toISOString(),
      })
      .eq('id', data.id);

    if (updateError) {
      logger.error('Failed to update job status to running', updateError);
      return null;
    }

    return data;
  };

  /**
   * ジョブの進捗を更新
   */
  const updateProgress = async (
    jobId: string,
    processed: number,
    total: number,
    message?: string
  ): Promise<void> => {
    const { error } = await supabase
      .from('sync_operations')
      .update({
        progress: { processed, total, message },
        updated_at: new Date().toISOString(),
      })
      .eq('id', jobId);

    if (error) {
      logger.error('Failed to update progress', error);
    }
  };

  /**
   * ジョブを完了状態に更新
   */
  const completeJob = async (jobId: string, success: boolean, errorMsg?: string): Promise<void> => {
    const { error } = await supabase
      .from('sync_operations')
      .update({
        status: success ? 'completed' : 'failed',
        progress: success
          ? { processed: 100, total: 100, message: '同期完了' }
          : { processed: 0, total: 0, message: errorMsg ?? 'エラーが発生しました' },
        updated_at: new Date().toISOString(),
      })
      .eq('id', jobId);

    if (error) {
      logger.error('Failed to complete job', error);
    }
  };

  /**
   * メッセージを保存
   */
  const saveMessages = async (
    guildId: string,
    messages: Array<{
      id: string;
      channelId: string;
      threadId?: string;
      authorId: string;
      content: string;
      createdAt: Date;
      editedAt?: Date;
    }>
  ): Promise<void> => {
    if (messages.length === 0) return;

    // messages テーブルに保存（upsert）
    const rows = messages.map((msg) => ({
      guild_id: guildId,
      channel_id: msg.channelId,
      thread_id: msg.threadId ?? null,
      message_id: msg.id,
      author_id: msg.authorId,
      content_plain: msg.content,
      content_md: msg.content,
      created_at: msg.createdAt.toISOString(),
      edited_at: msg.editedAt?.toISOString() ?? null,
      jump_link: `https://discord.com/channels/${guildId}/${msg.channelId}/${msg.id}`,
    }));

    // バッチで保存（Supabase は一度に大量のレコードを insert できるが、念のため分割）
    const batchSize = 100;
    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + batchSize);
      const { error } = await supabase.from('messages').upsert(batch, {
        onConflict: 'message_id',
        ignoreDuplicates: false,
      });

      if (error) {
        logger.error('Failed to save messages', error);
        throw createBaseError('メッセージの保存に失敗しました', 'MESSAGE_SAVE_FAILED', { error });
      }
    }

    logger.info(`Saved ${messages.length} messages to database`);
  };

  /**
   * 1つのジョブを処理
   */
  const processJob = async (job: SyncOperationRow): Promise<void> => {
    logger.info(`Processing sync job: ${job.id} (mode: ${job.mode})`);

    try {
      // 進捗を初期化
      await updateProgress(job.id, 0, 100, 'メッセージ取得中...');

      // メッセージを取得
      const since = job.since ? new Date(job.since) : undefined;
      const messages = await fetcher.fetchMessagesFromGuild(job.guild_id, { since });

      logger.info(`Fetched ${messages.length} messages from guild ${job.guild_id}`);

      if (messages.length === 0) {
        await completeJob(job.id, true);
        return;
      }

      // 進捗を更新
      await updateProgress(job.id, 30, 100, 'メッセージ保存中...');

      // メッセージを保存
      await saveMessages(job.guild_id, messages);

      // 進捗を更新
      await updateProgress(job.id, 60, 100, 'チャンク処理中...');

      // TODO: チャンク化と埋め込み生成はここに追加
      // 現在は保存までで完了とする

      // sync_cursors を更新
      const { error: cursorError } = await supabase.from('sync_cursors').upsert({
        guild_id: job.guild_id,
        last_synced_at: new Date().toISOString(),
        last_message_id: messages[messages.length - 1]?.id ?? null,
      });

      if (cursorError) {
        logger.warn('Failed to update sync cursor', cursorError);
      }

      // 完了
      await completeJob(job.id, true);
      logger.info(`Sync job ${job.id} completed successfully`);
    } catch (error) {
      logger.error(`Sync job ${job.id} failed`, error);
      await completeJob(job.id, false, String(error));
    }
  };

  /**
   * ワーカーを開始（ポーリング）
   */
  const start = async (): Promise<void> => {
    logger.info('Sync runner started');

    while (true) {
      try {
        const job = await acquireJob();

        if (job) {
          await processJob(job);
        } else {
          // ジョブがない場合は待機
          await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
        }
      } catch (error) {
        logger.error('Sync runner error', error);
        await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
      }
    }
  };

  return {
    start,
    processJob,
  };
}
