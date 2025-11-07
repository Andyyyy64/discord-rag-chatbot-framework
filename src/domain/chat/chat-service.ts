import { GoogleGenerativeAI } from '@google/generative-ai';

import { loadEnv } from '../../config/env';
import { logger } from '../../infrastructure/logging/logger';
import { getSupabaseClient } from '../../infrastructure/supabase/client';
import { createBaseError } from '../../shared/errors/base-error';
import { createRerankService } from '../common/rerank-service';
import type { RerankResult } from '../common/rerank-service';

import type { ChatAnswer, ChatCommandInput } from './types';

interface MessageWindowRecord {
  window_id: string;
  text: string;
  message_ids: string[];
  start_at: string;
  end_at: string;
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
    const windows = await fetchCandidateWindows(input);

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
   * 質問に関連する候補メッセージウィンドウを取得する
   */
  const fetchCandidateWindows = async (input: ChatCommandInput): Promise<MessageWindowRecord[]> => {
    const { data, error } = await supabase
      .from('message_windows')
      .select('window_id,text,message_ids,start_at,end_at')
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
      .map((w, index) => `[#${index + 1}] (${w.start_at} – ${w.end_at})\n${w.text}`)
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
    const candidates = windows.map((window, index) => ({
      id: window.window_id,
      content: window.text ?? '',
      meta: window,
      score: windows.length - index,
    }));

    const reranked = await rerankService.rerank(input.query, candidates, rerankTopK);
    if (!reranked.length) {
      return windows.slice(0, rerankTopK);
    }

    return reranked
      .map((result: RerankResult) => result.meta as MessageWindowRecord)
      .filter((window): window is MessageWindowRecord => Boolean(window));
  };

  return { answer };
}
