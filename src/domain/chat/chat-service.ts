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
    logger.info(`[Chat] 💬 New chat request from user ${input.userId}: "${input.query}"`);
    
    const windows = await fetchCandidateWindowsHybrid(input);

    if (!windows.length) {
      logger.warn('[Chat] ⚠️ No windows found, sync may be required');
      return {
        answer: 'まだ同期されたメッセージがありません。/sync を実行してから再度お試しください。',
        citations: [],
        latencyMs: Date.now() - started,
      };
    }

    logger.info(`[Chat] 📋 Found ${windows.length} candidate windows, selecting best for prompt...`);
    const selectedWindows = await selectWindowsForPrompt(input, windows);
    logger.info(`[Chat] ✅ Selected ${selectedWindows.length} windows for generation`);
    
    const prompt = buildPrompt(input, selectedWindows);
    const promptTokens = Math.ceil(prompt.length / 4); // 概算
    logger.info(`[Chat] 📝 Prompt built (~${promptTokens} tokens)`);
    
    try {
      logger.info(`[Chat] 🤖 Calling Gemini ${env.CHAT_MODEL}...`);
      const genStart = Date.now();
      const response = await model.generateContent({
        contents: [
          {
            role: 'user',
            parts: [{ text: prompt }],
          },
        ],
      });

      logger.info(`[Chat] ✅ Gemini response received (${Date.now() - genStart}ms)`);

      const text = response.response?.candidates?.[0]?.content?.parts
        ?.map((part) => part.text ?? '')
        .join('')
        .trim();

      const answerLength = text?.length ?? 0;
      logger.info(`[Chat] 📤 Answer generated (${answerLength} chars, ${Date.now() - started}ms total)`);

      return {
        answer: text?.length ? text : '回答を生成できませんでした。',
        citations: buildCitations(input, selectedWindows),
        latencyMs: Date.now() - started,
      };
    } catch (error) {
      logger.error('[Chat] ❌ Gemini chat failed', error);
      throw createBaseError('チャット応答の生成中にエラーが発生しました', 'CHAT_FAILED');
    }
  };

  /**
   * ハイブリッド検索：テキスト検索 → Vector
   */
  const fetchCandidateWindowsHybrid = async (
    input: ChatCommandInput
  ): Promise<MessageWindowRecord[]> => {
    const searchStart = Date.now();
    logger.info(`[Chat] 🔍 Starting hybrid search for query: "${input.query}"`);
    
    try {
      // ステップ 1: テキスト検索で粗検索（ILIKE による部分一致）
      // ギルド全体から検索（チャンネル制限なし）
      const keywords = input.query.split(/\s+/).filter((k) => k.length > 0);
      logger.info(`[Chat] 📝 Keywords extracted: ${keywords.join(', ')}`);
      
      let query = supabase
        .from('message_windows')
        .select('window_id,text,message_ids,start_at,end_at,channel_id,guild_id')
        .eq('guild_id', input.guildId);

      // 各キーワードで OR 検索
      if (keywords.length > 0) {
        const orConditions = keywords.map((keyword) => `text.ilike.%${keyword}%`).join(',');
        query = query.or(orConditions);
      }

      const textSearchStart = Date.now();
      const { data: roughResults, error: roughError } = await query
        .order('start_at', { ascending: false })
        .limit(100);
      
      logger.info(`[Chat] 📄 Text search complete (${Date.now() - textSearchStart}ms): ${roughResults?.length ?? 0} candidates found`);

      if (roughError) {
        logger.error('[Chat] ❌ Text search error:', roughError);
      }

      if (roughError || !roughResults || roughResults.length === 0) {
        logger.warn('[Chat] ⚠️ Text search returned no results, falling back to vector-only search');
        return await fallbackVectorSearch(input);
      }

      // ステップ 2: クエリの embedding を生成
      const embeddingStart = Date.now();
      logger.info('[Chat] 🧬 Generating query embedding...');
      const queryEmbedding = await embedQuery(input.query, 3072);
      logger.info(`[Chat] ✅ Query embedding generated (${Date.now() - embeddingStart}ms, ${queryEmbedding.length} dimensions)`);

      // ステップ 3: Vector 検索で精密化（embedding がある window のみ）
      const windowIds = roughResults.map((r) => r.window_id);
      logger.info(`[Chat] 🔎 Fetching embeddings for ${windowIds.length} candidates...`);

      const vectorSearchStart = Date.now();
      const { data: vectorResults, error: vectorError } = await supabase
        .from('message_embeddings')
        .select('window_id,embedding')
        .in('window_id', windowIds);

      logger.info(`[Chat] 📊 Vector fetch complete (${Date.now() - vectorSearchStart}ms): ${vectorResults?.length ?? 0} embeddings found`);

      if (vectorError) {
        logger.error('[Chat] ❌ Vector search error:', vectorError);
      }

      if (vectorError || !vectorResults || vectorResults.length === 0) {
        logger.warn('[Chat] ⚠️ No embeddings found, using text search results only');
        return roughResults.slice(0, 15);
      }

      // cosine 類似度を計算してソート
      logger.info('[Chat] 🧮 Computing cosine similarity...');
      const similarityStart = Date.now();
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

      logger.info(`[Chat] 🎯 Similarity computed (${Date.now() - similarityStart}ms)`);
      
      // トップ5の類似度スコアを表示
      const top5 = scoredResults.slice(0, 5);
      logger.info(`[Chat] 🏆 Top 5 results:`);
      top5.forEach((result, index) => {
        const preview = result.text?.slice(0, 50).replace(/\n/g, ' ') ?? '(no text)';
        logger.info(`[Chat]   #${index + 1}: similarity=${result.similarity.toFixed(4)} | "${preview}..."`);
      });

      logger.info(`[Chat] ✨ Hybrid search complete (${Date.now() - searchStart}ms total), returning top 15`);
      return scoredResults.slice(0, 15);
    } catch (error) {
      logger.error('[Chat] Hybrid search failed', error);
      return await fallbackRecentWindows(input);
    }
  };

  /**
   * フォールバック：Vector 検索のみでギルド全体から検索
   */
  const fallbackVectorSearch = async (input: ChatCommandInput): Promise<MessageWindowRecord[]> => {
    try {
      logger.info('[Chat] 🔄 Using vector-only search across entire guild');
      
      const embeddingStart = Date.now();
      const queryEmbedding = await embedQuery(input.query, 3072);
      logger.info(`[Chat] ✅ Query embedding generated (${Date.now() - embeddingStart}ms)`);

      // ギルド全体の embedding を取得（最大1000件）
      logger.info('[Chat] 📥 Fetching all embeddings (limit 1000)...');
      const fetchStart = Date.now();
      const { data: allEmbeddings, error: embeddingError } = await supabase
        .from('message_embeddings')
        .select('window_id,embedding')
        .limit(1000);

      logger.info(`[Chat] 📊 Fetched ${allEmbeddings?.length ?? 0} embeddings (${Date.now() - fetchStart}ms)`);

      if (embeddingError) {
        logger.error('[Chat] ❌ Embedding fetch error:', embeddingError);
      }

      if (embeddingError || !allEmbeddings || allEmbeddings.length === 0) {
        logger.warn('[Chat] ⚠️ Vector search failed, falling back to recent windows');
        return await fallbackRecentWindows(input);
      }

      // cosine 類似度を計算
      logger.info('[Chat] 🧮 Computing cosine similarity for all embeddings...');
      const similarityStart = Date.now();
      const scoredEmbeddings = allEmbeddings
        .map((row: { window_id: string; embedding: string }) => {
          const embedding = JSON.parse(row.embedding) as number[];
          let dotProduct = 0;
          let normA = 0;
          let normB = 0;
          for (let i = 0; i < queryEmbedding.length; i++) {
            dotProduct += queryEmbedding[i] * embedding[i];
            normA += queryEmbedding[i] * queryEmbedding[i];
            normB += embedding[i] * embedding[i];
          }
          const similarity = dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
          return { window_id: row.window_id, similarity };
        })
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, 15);

      logger.info(`[Chat] 🎯 Similarity computed (${Date.now() - similarityStart}ms)`);
      logger.info(`[Chat] 🏆 Top 5 similarity scores: ${scoredEmbeddings.slice(0, 5).map((s, i) => `#${i + 1}=${s.similarity.toFixed(4)}`).join(', ')}`);

      // window 情報を取得
      const windowIds = scoredEmbeddings.map((r) => r.window_id);
      const { data: windows, error: windowError } = await supabase
        .from('message_windows')
        .select('window_id,text,message_ids,start_at,end_at,channel_id,guild_id')
        .eq('guild_id', input.guildId)
        .in('window_id', windowIds);

      if (windowError) {
        logger.error('[Chat] ❌ Window fetch error:', windowError);
        return await fallbackRecentWindows(input);
      }

      if (!windows) {
        logger.warn('[Chat] ⚠️ No windows found');
        return await fallbackRecentWindows(input);
      }

      // similarity スコア順にソート
      const results = scoredEmbeddings
        .map((scored) => windows.find((w) => w.window_id === scored.window_id))
        .filter((w): w is MessageWindowRecord => w !== null && w !== undefined);
      
      logger.info(`[Chat] ✨ Vector-only search complete, returning ${results.length} results`);
      return results;
    } catch (error) {
      logger.error('[Chat] ❌ Vector-only search failed', error);
      return await fallbackRecentWindows(input);
    }
  };

  /**
   * フォールバック：最新の windows を返す（実行チャンネルのみ）
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
