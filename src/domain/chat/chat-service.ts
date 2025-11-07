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
    const windows = await fetchCandidateWindowsHybrid(input);

    if (!windows.length) {
      return {
        answer: 'まだ同期されたメッセージがありません。/sync を実行してから再度お試しください。',
        citations: [],
        latencyMs: Date.now() - started,
      };
    }

    const selectedWindows = await selectWindowsForPrompt(input, windows);
    const prompt = buildPrompt(input, selectedWindows);
    try {
      const response = await model.generateContent({
        contents: [
          {
            role: 'user',
            parts: [{ text: prompt }],
          },
        ],
      });

      const text = response.response?.candidates?.[0]?.content?.parts
        ?.map((part) => part.text ?? '')
        .join('')
        .trim();

      return {
        answer: text?.length ? text : '回答を生成できませんでした。',
        citations: buildCitations(input, selectedWindows),
        latencyMs: Date.now() - started,
      };
    } catch (error) {
      logger.error('Gemini chat failed', error);
      throw createBaseError('チャット応答の生成中にエラーが発生しました', 'CHAT_FAILED');
    }
  };

  /**
   * ハイブリッド検索：テキスト検索 → Vector
   */
  const fetchCandidateWindowsHybrid = async (
    input: ChatCommandInput
  ): Promise<MessageWindowRecord[]> => {
    try {
      // ステップ 1: テキスト検索で粗検索（Supabase の textSearch を使用）
      const { data: roughResults, error: roughError } = await supabase
        .from('message_windows')
        .select('window_id,text,message_ids,start_at,end_at,channel_id,guild_id')
        .eq('guild_id', input.guildId)
        .eq('channel_id', input.channelId)
        .textSearch('text', input.query, {
          type: 'plain',
          config: 'simple',
        })
        .order('start_at', { ascending: false })
        .limit(100);

      if (roughError || !roughResults || roughResults.length === 0) {
        logger.warn('[Chat] Text search returned no results, falling back to recent windows');
        return await fallbackRecentWindows(input);
      }

      // ステップ 2: クエリの embedding を生成
      const queryEmbedding = await embedQuery(input.query, 3072);

      // ステップ 3: Vector 検索で精密化（embedding がある window のみ）
      const windowIds = roughResults.map((r) => r.window_id);

      const { data: vectorResults, error: vectorError } = await supabase
        .from('message_embeddings')
        .select('window_id,embedding')
        .in('window_id', windowIds);

      if (vectorError || !vectorResults || vectorResults.length === 0) {
        logger.warn('[Chat] Vector search failed, using text search results');
        return roughResults.slice(0, 15);
      }

      // cosine 類似度を計算してソート
      const scoredResults = vectorResults
        .map((embeddingRow: { window_id: string; embedding: string }) => {
          const embedding = JSON.parse(embeddingRow.embedding) as number[];
          const windowInfo = roughResults.find((w) => w.window_id === embeddingRow.window_id);

          if (!windowInfo) return null;

          // cosine 類似度を計算
          let dotProduct = 0;
          let normA = 0;
          let normB = 0;
          for (let i = 0; i < queryEmbedding.length; i++) {
            dotProduct += queryEmbedding[i] * embedding[i];
            normA += queryEmbedding[i] * queryEmbedding[i];
            normB += embedding[i] * embedding[i];
          }
          const similarity = dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));

          return {
            ...windowInfo,
            similarity,
          };
        })
        .filter((item): item is MessageWindowRecord & { similarity: number } => item !== null)
        .sort((a, b) => b.similarity - a.similarity);

      return scoredResults.slice(0, 15);
    } catch (error) {
      logger.error('[Chat] Hybrid search failed', error);
      return await fallbackRecentWindows(input);
    }
  };

  /**
   * フォールバック：最新の windows を返す
   */
  const fallbackRecentWindows = async (input: ChatCommandInput): Promise<MessageWindowRecord[]> => {
    const { data, error } = await supabase
      .from('message_windows')
      .select('window_id,text,message_ids,start_at,end_at,channel_id,guild_id')
      .eq('guild_id', input.guildId)
      .eq('channel_id', input.channelId)
      .order('end_at', { ascending: false })
      .limit(12);

    if (error) {
      throw createBaseError('メッセージコンテキストの取得に失敗しました', 'WINDOW_FETCH_FAILED', {
        error,
      });
    }

    return data ?? [];
  };

  /**
   * プロンプトを構築する
   */
  const buildPrompt = (input: ChatCommandInput, windows: MessageWindowRecord[]): string => {
    const context = windows
      .map((w, index) => `[#${index + 1}] (${w.start_at} – ${w.end_at})\n${w.text ?? '(内容なし)'}`)
      .join('\n\n');

    return [
      'あなたはDiscordサーバー専用のRAGアシスタントです。',
      '以下の制約を必ず守ってください:',
      '1. 参照した証拠には [#番号] の形で根拠番号を付ける。',
      '2. 回答は日本語を既定とし、必要に応じて英語を混在してもよい。',
      '3. 情報が不足している場合は率直に不足を伝える。',
      '',
      '# コンテキスト',
      context,
      '',
      `# ユーザー (${input.userId}) からの質問`,
      input.query,
    ].join('\n');
  };

  /**
   * 引用情報を構築する
   */
  const buildCitations = (input: ChatCommandInput, windows: MessageWindowRecord[]) =>
    windows.slice(0, 3).map((window, index) => ({
      label: `[#${index + 1}] ${new Date(window.start_at).toLocaleString('ja-JP')}`,
      jumpLink: `https://discord.com/channels/${input.guildId}/${input.channelId}/${window.message_ids?.[0] ?? ''}`,
    }));

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
