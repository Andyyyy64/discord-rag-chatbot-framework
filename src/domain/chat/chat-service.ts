import { GoogleGenerativeAI } from '@google/generative-ai';

import { loadEnv } from '../../config/env';
import { embedQuery } from '../../infrastructure/gemini/embedding-service';
import { logger } from '../../infrastructure/logging/logger';
import { getSupabaseClient } from '../../infrastructure/supabase/client';
import { createBaseError } from '../../shared/errors/base-error';
import { createRerankService } from '../common/rerank-service';
import type { RerankResult } from '../common/rerank-service';

import type { ChatAnswer, ChatCommandInput } from './types';

interface MessageWindowRecord {
  window_id: string;
  text: string | null;
  message_ids: string[];
  start_at: string;
  end_at: string;
  channel_id: string;
  guild_id: string;
}

/**
 * チャットサービスを作成する
 */
export function createChatService(rerankService = createRerankService()) {
  const supabase = getSupabaseClient();
  const env = loadEnv();
  const rerankTopK = Math.max(1, env.RERANK_TOPK ?? 5);
  const model = new GoogleGenerativeAI(env.GEMINI_API_KEY).getGenerativeModel({
    model: env.CHAT_MODEL,
    generationConfig: {
      temperature: 0.3,
      topP: 0.9,
      maxOutputTokens: 2048,
    },
  });

  /**
   * ユーザーの質問に対してRAGベースの回答を生成する
   */
  const answer = async (input: ChatCommandInput): Promise<ChatAnswer> => {
    const started = Date.now();
    logger.info(`[Chat] Step 1: New chat request from user ${input.userId}: "${input.query}"`);

    const windows = await fetchCandidateWindowsHybrid(input);

    if (!windows.length) {
      logger.warn('[Chat] No windows found, sync may be required');
      return {
        answer: 'まだ同期されたメッセージがありません。/sync を実行してから再度お試しください。',
        citations: [],
        latencyMs: Date.now() - started,
      };
    }

    logger.info(`[Chat] Step 3: Found ${windows.length} candidate windows, selecting best for prompt...`);
    const selectedWindows = await selectWindowsForPrompt(input, windows);
    logger.info(`[Chat] Step 4: Selected ${selectedWindows.length} windows for generation`);

    // リトリーバルした内容をログ出力
    logger.info(`[Chat] Step 5: Retrieved content details:`);
    selectedWindows.forEach((window, index) => {
      const preview = (window.text ?? '').substring(0, 100).replace(/\n/g, ' ');
      logger.info(`  [${index + 1}] ${window.start_at} → ${window.end_at}`);
      logger.info(`      "${preview}${(window.text?.length ?? 0) > 100 ? '...' : ''}"`);
    });

    const prompt = buildPrompt(input, selectedWindows);
    const promptTokens = Math.ceil(prompt.length / 4); // 概算
    logger.info(`[Chat] Step 6: Prompt built (~${promptTokens} tokens)`);

    try {
      logger.info(`[Chat] Step 7: Calling Gemini ${env.CHAT_MODEL}...`);
      const genStart = Date.now();
      const response = await model.generateContent({
        contents: [
          {
            role: 'user',
            parts: [{ text: prompt }],
          },
        ],
      });

      logger.info(`[Chat] Step 8: Gemini response received (${Date.now() - genStart}ms)`);

      const text = response.response?.candidates?.[0]?.content?.parts
        ?.map((part) => part.text ?? '')
        .join('')
        .trim();

      const answerLength = text?.length ?? 0;
      logger.info(`[Chat] Step 9: Answer generated (${answerLength} chars, ${Date.now() - started}ms total)`);

      return {
        answer: text?.length ? text : '回答を生成できませんでした。',
        citations: [],
        latencyMs: Date.now() - started,
      };
    } catch (error) {
      logger.error('[Chat] Error: Gemini chat failed', error);
      throw createBaseError('チャット応答の生成中にエラーが発生しました', 'CHAT_FAILED');
    }
  };

  /**
   * ベクトル検索（pgvector RPC）を主軸に候補を取得する
   */
  const fetchCandidateWindowsHybrid = async (
    input: ChatCommandInput
  ): Promise<MessageWindowRecord[]> => {
    const searchStart = Date.now();
    logger.info(`[Chat] Step 2-1: Starting vector search for query: "${input.query}"`);

    try {
      // クエリの embedding を生成
      const embeddingStart = Date.now();
      const queryEmbedding = await embedQuery(input.query, 3072);
      logger.info(
        `[Chat] Step 2-2: Query embedding generated (${Date.now() - embeddingStart}ms, ${queryEmbedding.length} dimensions)`
      );

      // pgvector の RPC でギルド内 Top-K を取得
      const vectorStart = Date.now();
      const VECTOR_LIMIT = 200; // 後段でさらにTop-Nに絞る
      const { data: matched, error: matchError } = await supabase.rpc(
        'match_windows_in_guild',
        {
          query_embedding: queryEmbedding,
          p_guild_id: input.guildId,
          p_limit: VECTOR_LIMIT,
        }
      );

      if (matchError) {
        logger.error('[Chat] Error: Vector RPC error:', matchError);
        return [];
      }

      logger.info(
        `[Chat] Step 2-3: Vector RPC complete (${Date.now() - vectorStart}ms): ${matched?.length ?? 0} candidates`
      );

      if (!matched || matched.length === 0) {
        logger.warn('[Chat] No vector matches');
        return [];
      }

      // window 情報を取得し、類似度順に整列（上位15件）
      const windowIds = matched.map((m: { window_id: string }) => m.window_id);
      const { data: windows, error: windowError } = await supabase
        .from('message_windows')
        .select('window_id,text,message_ids,start_at,end_at,channel_id,guild_id')
        .in('window_id', windowIds);

      if (windowError) {
        logger.error('[Chat] Error: Window fetch error:', windowError);
        return [];
      }

      const byId = new Map(windows?.map((w) => [w.window_id, w]) ?? []);
      const ordered = matched
        .map((m: { window_id: string; similarity: number }) => byId.get(m.window_id))
        .filter((w): w is MessageWindowRecord => Boolean(w))
        .slice(0, 15);

      logger.info(
        `[Chat] Step 2-4: Vector search complete (${Date.now() - searchStart}ms total), returning top ${ordered.length}`
      );
      return ordered;
    } catch (error) {
      logger.error('[Chat] Error: Vector search failed', error);
      return [];
    }
  };

  /**
   * プロンプトを構築する
   */
  const buildPrompt = (input: ChatCommandInput, windows: MessageWindowRecord[]): string => {
    const context = windows
      .map((w) => `(${w.start_at} – ${w.end_at})\n${w.text ?? '(内容なし)'}`)
      .join('\n\n');

    return [
      'あなたはDiscordサーバー専用のRAGアシスタントです。',
      '以下の制約を必ず守ってください:',
      '1. 回答は日本語を既定とし、必要に応じて英語を混在してもよい。',
      '2. 情報が不足している場合は率直に不足を伝える。',
      '3. 提供されたコンテキストのみを元に回答する。',
      '',
      '# コンテキスト',
      context,
      '',
      `# ユーザー (${input.userId}) からの質問`,
      input.query,
    ].join('\n');
  };

  /**
   * プロンプトに使用するウィンドウをリランクして選択する
   */
  const selectWindowsForPrompt = async (
    input: ChatCommandInput,
    windows: MessageWindowRecord[]
  ): Promise<MessageWindowRecord[]> => {
    // Rerank サービスが有効な場合のみリランク
    if (env.RERANK_PROVIDER !== 'none') {
      const candidates = windows.map((window, index) => ({
        id: window.window_id,
        content: window.text ?? '',
        meta: window,
        score: windows.length - index,
      }));

      const reranked = await rerankService.rerank(input.query, candidates, rerankTopK);
      if (reranked.length > 0) {
        return reranked
          .map((result: RerankResult) => result.meta as MessageWindowRecord)
          .filter((window): window is MessageWindowRecord => Boolean(window));
      }
    }

    // リランクしない、または失敗した場合はそのまま返す
    return windows.slice(0, rerankTopK);
  };

  return { answer };
}
