import type { Client, TextChannel } from 'discord.js';

import {
  createMessageFetcher,
  type FetchedMessage,
} from '../../infrastructure/discord/message-fetcher';
import { logger } from '../../infrastructure/logging/logger';
import { getSupabaseClient } from '../../infrastructure/supabase/client';
import type { TypedSyncOperation } from '../../infrastructure/supabase/database-extensions.types';
import { createBaseError } from '../../shared/errors/base-error';
import type { DiscordMessage } from '../common/chunking';
import { createChunkingService } from '../common/chunking-service';

type SyncOperationRow = TypedSyncOperation;

export interface SyncRunnerConfig {
  pollIntervalMs?: number;
}

/**
 * 同期ジョブを処理するワーカー
 */
export function createSyncRunner(client: Client, config: SyncRunnerConfig = {}) {
  const supabase = getSupabaseClient();
  const fetcher = createMessageFetcher(client);
  const chunkingService = createChunkingService();
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
          ? { processed: 100, total: 100, message: '✅ 同期完了しました！' }
          : { processed: 0, total: 0, message: errorMsg ?? 'エラーが発生しました' },
        updated_at: new Date().toISOString(),
      })
      .eq('id', jobId);

    if (error) {
      logger.error('Failed to complete job', error);
    }
  };

  /**
   * 埋め込み処理の完了を待機
   */
  const waitForEmbeddingComplete = async (guildId: string, jobId: string): Promise<void> => {
    const maxWaitTime = 30 * 60 * 1000; // 30分
    const pollInterval = 5000; // 5秒
    const startTime = Date.now();
    let consecutiveErrors = 0;
    const maxConsecutiveErrors = 3;

    while (Date.now() - startTime < maxWaitTime) {
      try {
        // ready状態のembed_queueを取得
        const { data: queueData, error: queryError } = await supabase
          .from('embed_queue')
          .select('window_id')
          .eq('status', 'ready');

        if (queryError) {
          throw queryError;
        }

        if (!queueData || queueData.length === 0) {
          logger.info('All embeddings completed');
          return;
        }

        // windowsが対象ギルドのものかチェック
        const windowIds = queueData.map((q) => q.window_id);

        // バッチでチェック（500件ずつ）
        let remainingCount = 0;
        const batchSize = 500;

        for (let i = 0; i < windowIds.length; i += batchSize) {
          const batch = windowIds.slice(i, i + batchSize);
          const { count, error: batchError } = await supabase
            .from('message_windows')
            .select('window_id', { count: 'exact', head: true })
            .eq('guild_id', guildId)
            .in('window_id', batch);

          if (batchError) {
            logger.warn(`Failed to check batch ${i / batchSize + 1}`, batchError);
            continue;
          }

          remainingCount += count || 0;
        }

        if (remainingCount === 0) {
          logger.info('All embeddings completed for guild');
          return;
        }

        logger.info(`Waiting for embeddings: ${remainingCount} remaining`);
        await updateProgress(jobId, 90, 100, `✨ 埋め込み処理中 (残り${remainingCount}件)...`);

        // エラーカウンターをリセット
        consecutiveErrors = 0;
      } catch (error) {
        consecutiveErrors++;
        logger.warn(
          `Failed to check embed queue status (${consecutiveErrors}/${maxConsecutiveErrors})`,
          error
        );

        // 連続エラーが多すぎる場合は、完了と見なす
        if (consecutiveErrors >= maxConsecutiveErrors) {
          logger.warn('Too many consecutive errors, assuming embeddings are complete');
          return;
        }
      }

      await new Promise((resolve) => setTimeout(resolve, pollInterval));
    }

    logger.warn('Embedding wait timeout, continuing anyway...');
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

    // バッチで保存
    const batchSize = 50;
    const totalBatches = Math.ceil(rows.length / batchSize);
    let savedCount = 0;

    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + batchSize);
      const batchNum = Math.floor(i / batchSize) + 1;

      let retries = 0;
      const maxRetries = 3;

      while (retries <= maxRetries) {
        try {
          const { error } = await supabase.from('messages').upsert(batch, {
            onConflict: 'message_id',
            ignoreDuplicates: false,
          });

          if (error) {
            throw error;
          }

          savedCount += batch.length;
          logger.info(
            `  → Saved batch ${batchNum}/${totalBatches} (${savedCount}/${rows.length} messages)`
          );
          break;
        } catch (error) {
          retries++;
          if (retries > maxRetries) {
            logger.error(`Failed to save batch ${batchNum} after ${maxRetries} retries`, error);
            throw createBaseError('メッセージの保存に失敗しました', 'MESSAGE_SAVE_FAILED', {
              error,
            });
          }

          const waitTime = Math.pow(2, retries) * 1000;
          logger.warn(
            `  → Batch ${batchNum} failed, retrying in ${waitTime}ms (attempt ${retries}/${maxRetries})`,
            error
          );
          await new Promise((resolve) => setTimeout(resolve, waitTime));
        }
      }
    }

    logger.info(`Saved ${messages.length} messages to database`);
  };

  /**
   * メッセージをチャンク化して message_windows と embed_queue に保存
   */
  const createWindows = async (
    guildId: string,
    messages: Array<{
      id: string;
      channelId: string;
      threadId?: string;
      content: string;
      createdAt: Date;
    }>
  ): Promise<void> => {
    if (messages.length === 0) return;

    // カテゴリ → チャンネル → 日付でグループ化
    const groups = new Map<string, typeof messages>();

    for (const msg of messages) {
      const dateKey = msg.createdAt.toISOString().split('T')[0];
      const channelKey = msg.threadId ?? msg.channelId;
      const key = `${channelKey}:${dateKey}`;

      if (!groups.has(key)) {
        groups.set(key, []);
      }
      groups.get(key)!.push(msg);
    }

    let totalWindows = 0;

    // 各グループをチャンク化
    for (const [key, groupMessages] of groups) {
      const [_channelKey, dateStr] = key.split(':');
      const isThread = groupMessages[0].threadId !== undefined;

      // DiscordMessage 形式に変換
      const discordMessages: DiscordMessage[] = groupMessages.map((msg) => ({
        id: msg.id,
        content: msg.content,
        createdAt: msg.createdAt,
        isTopLevel: !isThread, // スレッド内は false
      }));

      // チャンク化
      const windows = await chunkingService.chunk(discordMessages);

      if (windows.length === 0) continue;

      // message_windows に保存
      const windowRows = windows.map((window) => ({
        guild_id: guildId,
        channel_id: groupMessages[0].channelId,
        thread_id: groupMessages[0].threadId ?? null,
        date: dateStr,
        window_seq: window.windowSeq,
        message_ids: window.messageIds,
        start_at: window.startAt.toISOString(),
        end_at: window.endAt.toISOString(),
        token_est: window.tokenCount,
        text: window.text,
      }));

      const { data: insertedWindows, error: windowError } = await supabase
        .from('message_windows')
        .upsert(windowRows, {
          onConflict: 'channel_id,date,window_seq',
          ignoreDuplicates: false,
        })
        .select('window_id');

      if (windowError) {
        logger.error('Failed to save message windows', windowError);
        throw createBaseError('ウィンドウの保存に失敗しました', 'WINDOW_SAVE_FAILED', {
          error: windowError,
        });
      }

      // embed_queue に投入
      if (insertedWindows && insertedWindows.length > 0) {
        const queueRows = insertedWindows.map((w) => ({
          window_id: w.window_id,
          priority: 0,
          status: 'ready',
        }));

        const { error: queueError } = await supabase.from('embed_queue').upsert(queueRows, {
          onConflict: 'window_id',
          ignoreDuplicates: true,
        });

        if (queueError) {
          logger.warn('Failed to enqueue windows for embedding', queueError);
        } else {
          totalWindows += insertedWindows.length;
        }
      }
    }

    logger.info(
      `✓ Created ${totalWindows} windows from ${groups.size} channel-date groups and enqueued for embedding`
    );
  };

  /**
   * 1つのジョブを処理
   */
  const processJob = async (job: SyncOperationRow): Promise<void> => {
    logger.info(`Processing sync job: ${job.id} (scope: ${job.scope}, mode: ${job.mode})`);

    try {
      // 進捗を初期化
      await updateProgress(job.id, 0, 1, '同期を開始しています...');

      // メッセージを取得（進捗コールバック付き）
      const since = job.since ? new Date(job.since) : undefined;
      
      let messages: FetchedMessage[] = [];

      // スコープに応じたメッセージ取得
      if (job.scope === 'channel' && job.target_ids && job.target_ids.length > 0) {
        // チャンネル同期
        const channelId = job.target_ids[0];
        logger.info(
          `Starting message fetch from channel ${channelId} (since: ${since?.toISOString() ?? 'beginning'})`
        );

        const guild = client.guilds.cache.get(job.guild_id);
        if (!guild) {
          throw new Error(`Guild ${job.guild_id} not found`);
        }

        const channel = await guild.channels.fetch(channelId);
        if (!channel || !channel.isTextBased()) {
          throw new Error(`Channel ${channelId} not found or is not a text channel`);
        }

        await updateProgress(job.id, 10, 100, `📥 チャンネルからメッセージを取得中...`);
        messages = await fetcher.fetchMessagesFromChannel(channel as TextChannel, { since });
        logger.info(`✓ Fetched ${messages.length} messages from channel ${channelId}`);
      } else {
        // ギルド全体の同期
        logger.info(
          `Starting message fetch from guild ${job.guild_id} (since: ${since?.toISOString() ?? 'beginning'})`
        );

        messages = await fetcher.fetchMessagesFromGuild(job.guild_id, {
          since,
          onProgress: async (completed, total, phase) => {
            // フェーズ1: メッセージ取得（全体の0-30%）
            const percentage = Math.floor((completed / total) * 30);
            await updateProgress(
              job.id,
              percentage,
              100,
              `📥 ${phase}: ${completed}/${total}チャンネル`
            );
          },
        });

        logger.info(`✓ Fetched ${messages.length} messages from guild ${job.guild_id}`);
      }

      if (messages.length === 0) {
        await completeJob(job.id, true);
        return;
      }

      // フェーズ2: メッセージ保存（30-50%）
      await updateProgress(job.id, 30, 100, `💾 ${messages.length}件のメッセージを保存中...`);
      logger.info(`Saving ${messages.length} messages to database...`);

      await saveMessages(job.guild_id, messages);
      logger.info(`✓ Saved ${messages.length} messages`);

      // フェーズ3: チャンク処理（50-90%）
      await updateProgress(job.id, 50, 100, `🔨 チャンク処理中...`);
      logger.info(`Starting chunking for ${messages.length} messages...`);

      await createWindows(job.guild_id, messages);
      logger.info(`✓ Chunking complete`);

      // フェーズ4: 埋め込み処理を待機（90-99%）
      await updateProgress(job.id, 90, 100, '✨ 埋め込み処理中...');
      logger.info('Waiting for embedding to complete...');

      await waitForEmbeddingComplete(job.guild_id, job.id);
      logger.info(`✓ Embedding complete`);

      // フェーズ5: カーソル更新（99-100%）
      await updateProgress(job.id, 99, 100, '🔄 カーソル更新中...');

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
