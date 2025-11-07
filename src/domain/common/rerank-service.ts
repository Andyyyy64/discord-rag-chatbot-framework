import { loadEnv } from '../../config/env';
import { logger } from '../../infrastructure/logging/logger';

export interface RerankCandidate {
  id: string | number | bigint;
  content: string;
  meta?: unknown;
  score: number;
}

export interface RerankResult extends RerankCandidate {
  rerankScore: number;
  index: number;
  originalIndex: number;
}

type RerankProvider = 'cohere' | 'none';

/**
 * リランクサービスを作成する
 */
export function createRerankService() {
  const env = loadEnv();
  const provider = (env.RERANK_PROVIDER ?? 'none').toLowerCase() as RerankProvider;
  const model = env.RERANK_MODEL;

  /**
   * リランクをスキップして元の順序のまま返すフォールバック関数
   */
  const fallback = (candidates: RerankCandidate[], topK: number): RerankResult[] =>
    candidates.slice(0, topK).map((candidate, index) => ({
      ...candidate,
      rerankScore: candidate.score,
      index,
      originalIndex: index,
    }));

  /**
   * Cohere APIを使用して候補をリランクする
   */
  const rerankWithCohere = async (
    query: string,
    candidates: RerankCandidate[],
    topK: number
  ): Promise<RerankResult[]> => {
    const apiKey = env.COHERE_API_KEY;
    if (!apiKey) {
      throw new Error('COHERE_API_KEY is not configured');
    }

    const response = await fetch('https://api.cohere.com/v1/rerank', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'Cohere-Version': '2024-08-23',
      },
      body: JSON.stringify({
        model,
        query,
        documents: candidates.map((candidate) => candidate.content),
        top_n: topK,
        return_documents: false,
      }),
    });

    if (!response.ok) {
      const errorPayload = await response.text();
      throw new Error(`Cohere rerank failed: ${response.status} ${errorPayload}`);
    }

    const payload = (await response.json()) as {
      results: Array<{ index: number; relevance_score: number }>;
    };

    if (!payload?.results) {
      throw new Error('Invalid Cohere rerank response');
    }

    return payload.results
      .map((result, rankIndex) => {
        const candidate = candidates[result.index];
        if (!candidate) return null;
        return {
          ...candidate,
          rerankScore: result.relevance_score,
          index: rankIndex,
          originalIndex: result.index,
        } satisfies RerankResult;
      })
      .filter((value): value is RerankResult => value !== null);
  };

  /**
   * クエリに関連する候補をリランクする
   * プロバイダーが設定されていない場合は元の順序を返す
   */
  const rerank = async (query: string, candidates: RerankCandidate[], topK: number) => {
    if (!candidates.length) return [];
    const limit = Math.min(topK, candidates.length);

    if (provider === 'none') {
      return fallback(candidates, limit);
    }

    if (provider === 'cohere') {
      try {
        return await rerankWithCohere(query, candidates, limit);
      } catch (error) {
        logger.warn('Cohere rerank failed. Falling back to original order.', error);
        return fallback(candidates, limit);
      }
    }

    return fallback(candidates, limit);
  };

  return { rerank };
}
