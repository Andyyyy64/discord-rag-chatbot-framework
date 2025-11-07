import type { Client } from 'discord.js';

import { embedWindow } from '../../infrastructure/gemini/embedding-service';
import { logger } from '../../infrastructure/logging/logger';
import { getSupabaseClient } from '../../infrastructure/supabase/client';
import { createDefaultTokenCounter } from '../common/token-counter';

type EmbedQueueRow = {
  id: string;
  window_id: string;
  priority: number;
  status: string;
  attempts: number;
  updated_at: string;
};

type MessageRow = {
  message_id: string;
  content_plain: string | null;
};

export interface EmbedWorkerConfig {
  pollIntervalMs?: number;
  batchSize?: number;
  concurrency?: number;
  maxAttempts?: number;
}

/**
 * Embedding 生成ワーカー
 */
export function createEmbedWorker(_client: Client, config: EmbedWorkerConfig = {}) {
  const supabase = getSupabaseClient();
  const tokenCounter = createDefaultTokenCounter();
  const pollIntervalMs = config.pollIntervalMs ?? 500;
  const batchSize = config.batchSize ?? 500;
  const concurrency = config.concurrency ?? 30;
  const maxAttempts = config.maxAttempts ?? 5;

  /**
   * 処理待ちの embed_queue レコードを取得
   */
  const acquireBatch = async (): Promise<EmbedQueueRow[]> => {
    const { data, error } = await supabase
      .from('embed_queue')
      .select('*')
      .eq('status', 'ready')
      .order('priority', { ascending: false })
      .order('updated_at', { ascending: true })
      .limit(batchSize);

    if (error) {
      logger.error('[Embed Worker] Failed to acquire batch', error);
      return [];
    }

    return (data || []) as EmbedQueueRow[];
  };

  /**
   * Window のテキストを取得
   */
  const fetchWindowText = async (windowId: string): Promise<string | null> => {
    // まず message_windows からテキストを取得
    const { data: window, error: windowError } = await supabase
      .from('message_windows')
      .select('text, message_ids')
      .eq('window_id', windowId)
      .maybeSingle();

    if (windowError) {
      logger.error(`[Embed Worker] Failed to fetch window ${windowId}`, windowError);
      return null;
    }

    if (!window) {
      logger.warn(`[Embed Worker] Window ${windowId} not found`);
      return null;
    }

    // text が既にあればそれを使用
    if (window.text) {
      return window.text;
    }

    // なければ message_ids から復元
    if (!window.message_ids || window.message_ids.length === 0) {
      logger.warn(`[Embed Worker] Window ${windowId} has no message_ids`);
      return null;
    }

    const { data: messages, error: messagesError } = await supabase
      .from('messages')
      .select('message_id, content_plain')
      .in('message_id', window.message_ids);

    if (messagesError) {
      logger.error(`[Embed Worker] Failed to fetch messages for window ${windowId}`, messagesError);
      return null;
    }

    if (!messages || messages.length === 0) {
      return null;
    }

    // message_ids の順序を保持して結合
    const messageMap = new Map<string, string>();
    for (const msg of messages as MessageRow[]) {
      if (msg.content_plain) {
        messageMap.set(msg.message_id, msg.content_plain);
      }
    }

    const orderedTexts = window.message_ids
      .map((id: string) => messageMap.get(id))
      .filter((text): text is string => Boolean(text));

    return orderedTexts.join('\n');
  };

  /**
   * 1つの window を処理
   */
  const processWindow = async (queueItem: EmbedQueueRow): Promise<boolean> => {
    try {
      // Window のテキストを取得
      const text = await fetchWindowText(queueItem.window_id);

      if (!text) {
        logger.warn(`[Embed Worker] No text for window ${queueItem.window_id}, marking as failed`);
        await supabase
          .from('embed_queue')
          .update({
            status: 'failed',
            attempts: queueItem.attempts + 1,
            updated_at: new Date().toISOString(),
          })
          .eq('id', queueItem.id);
        return false;
      }

      // トークン制限内に収める
      const ensured = await tokenCounter.ensureWithinLimit(text);

      if (ensured.truncated) {
        logger.warn(
          `[Embed Worker] Window ${queueItem.window_id} truncated from ${text.length} to ${ensured.text.length} chars`
        );
      }

      // Embedding を生成
      const embedding = await embedWindow(ensured.text, 3072);

      // message_embeddings に保存
      const { error: embedError } = await supabase.from('message_embeddings').upsert(
        {
          window_id: queueItem.window_id,
          embedding: JSON.stringify(embedding),
          updated_at: new Date().toISOString(),
        },
        {
          onConflict: 'window_id',
          ignoreDuplicates: false,
        }
      );

      if (embedError) {
        logger.error(
          `[Embed Worker] Failed to save embedding for window ${queueItem.window_id}`,
          embedError
        );
        throw embedError;
      }

      // embed_queue を完了に更新
      const { error: updateError } = await supabase
        .from('embed_queue')
        .update({
          status: 'done',
          updated_at: new Date().toISOString(),
        })
        .eq('id', queueItem.id);

      if (updateError) {
        logger.warn(
          `[Embed Worker] Failed to update queue status for ${queueItem.window_id}`,
          updateError
        );
      }

      logger.info(
        `  → Window ${queueItem.window_id.substring(0, 8)}... embedded (${ensured.tokens} tokens)`
      );

      return true;
    } catch (error) {
      logger.error(`[Embed Worker] Error processing window ${queueItem.window_id}`, error);

      // リトライ可能か判定
      const newAttempts = queueItem.attempts + 1;
      const newStatus = newAttempts >= maxAttempts ? 'failed' : 'ready';

      await supabase
        .from('embed_queue')
        .update({
          status: newStatus,
          attempts: newAttempts,
          updated_at: new Date().toISOString(),
        })
        .eq('id', queueItem.id);

      return false;
    }
  };

  /**
   * バッチを並列処理
   */
  const processBatch = async (batch: EmbedQueueRow[]): Promise<void> => {
    if (batch.length === 0) return;

    logger.info(`[Embed Worker] Processing batch of ${batch.length} windows...`);

    // 並列処理（concurrency で制限）
    const promises: Promise<boolean>[] = [];
    for (let i = 0; i < batch.length; i += concurrency) {
      const chunk = batch.slice(i, i + concurrency);
      const chunkPromises = chunk.map((item) => processWindow(item));
      promises.push(...chunkPromises);

      // 並列数制限のため、chunk ごとに await
      await Promise.allSettled(chunkPromises);
    }

    const results = await Promise.allSettled(promises);
    const succeeded = results.filter((r) => r.status === 'fulfilled' && r.value === true).length;
    const failed = results.length - succeeded;

    logger.info(
      `[Embed Worker] ✓ Batch complete: ${succeeded}/${batch.length} succeeded, ${failed} failed`
    );
  };

  /**
   * ワーカーを開始（ポーリング）
   */
  const start = async (): Promise<void> => {
    logger.info('[Embed Worker] Embed worker started');

    let idleCount = 0;

    while (true) {
      try {
        const batch = await acquireBatch();

        if (batch.length > 0) {
          idleCount = 0;
          await processBatch(batch);
        } else {
          // アイドル時は指数バックオフ（最大 30 秒）
          idleCount = Math.min(idleCount + 1, 10);
          const backoff = Math.min(pollIntervalMs * Math.pow(1.5, idleCount), 30000);
          await new Promise((resolve) => setTimeout(resolve, backoff));
        }
      } catch (error) {
        logger.error('[Embed Worker] Error in worker loop', error);
        await new Promise((resolve) => setTimeout(resolve, pollIntervalMs * 2));
      }
    }
  };

  return {
    start,
  };
}
