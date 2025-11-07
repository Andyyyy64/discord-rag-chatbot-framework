import { GoogleGenerativeAI } from '@google/generative-ai';
import { encodingForModel, getEncoding } from 'js-tiktoken';
import type { Tiktoken } from 'js-tiktoken';

import { loadEnv } from '../../config/env';
import { logger } from '../../infrastructure/logging/logger';
import { sleep } from '../../shared/utils/time';

const MAX_SUFFIX = 20;
const RETRYABLE_ERRORS = ['429', '500', '502', '503', '504', 'rate limit', 'timeout'];

/**
 * 環境変数からGemini APIキーのリストを取得する
 */
function listGeminiKeys(): string[] {
  const keys = new Set<string>();
  const base = process.env.GEMINI_API_KEY;
  if (base) keys.add(base);
  for (let i = 2; i <= MAX_SUFFIX; i++) {
    const k = process.env[`GEMINI_API_KEY_${i}`];
    if (k) keys.add(k);
  }
  return Array.from(keys);
}

/**
 * 利用可能なGemini APIキーからランダムに1つを選択してクライアントを作成する
 */
function pickGeminiClient(): GoogleGenerativeAI {
  const keys = listGeminiKeys();
  if (!keys.length) {
    throw new Error('GEMINI_API_KEY is not configured');
  }
  const key = keys[Math.floor(Math.random() * keys.length)];
  return new GoogleGenerativeAI(key);
}

// サポートされているエンコーディング名の型定義
type EncodingName = 'cl100k_base' | 'p50k_base' | 'r50k_base' | 'gpt2';

/**
 * モデル名またはエンコーディング名からTiktokenエンコーダーを解決する
 */
function resolveEncoding(modelHint: string = 'cl100k_base'): Tiktoken {
  try {
    // 標準的なエンコーディング名であればgetEncodingを使用
    const knownEncodings: EncodingName[] = ['cl100k_base', 'p50k_base', 'r50k_base', 'gpt2'];
    if (knownEncodings.includes(modelHint as EncodingName)) {
      return getEncoding(modelHint as EncodingName);
    }
    // それ以外はencodingForModelを試みる
    return encodingForModel(modelHint as Parameters<typeof encodingForModel>[0]);
  } catch {
    logger.warn(`encodingForModel(${modelHint}) failed, falling back to cl100k_base`);
    return getEncoding('cl100k_base');
  }
}

export interface TokenCounter {
  estimate(text: string): number;
  countPrecisely(text: string): Promise<number>;
  ensureWithinLimit(text: string): Promise<{ text: string; tokens: number; truncated: boolean }>;
  truncate(text: string, limit: number): Promise<string>;
}

/**
 * トークンカウンターを作成する
 */
export function createTokenCounter(
  countModel = 'gemini-2.0-flash-lite',
  opts?: { safetyMargin?: number; maxTokens?: number; encodingModel?: string }
): TokenCounter {
  const encoding = resolveEncoding(opts?.encodingModel ?? 'cl100k_base');
  const safetyMargin = opts?.safetyMargin ?? 128;
  const maxTokens = opts?.maxTokens ?? Number(process.env.MAX_INPUT_TOKENS ?? 2048);

  const estimate = (text: string) => encoding.encode(text ?? '').length;

  /**
   * Gemini APIを使用してテキストのトークン数を正確にカウントする
   * リトライ可能なエラーの場合は自動的にリトライする
   */
  const countPrecisely = async (text: string): Promise<number> => {
    let attempt = 0;
    const maxRetries = 5;
    while (attempt < maxRetries) {
      try {
        const client = pickGeminiClient();
        const model = client.getGenerativeModel({ model: countModel });
        const res = await model.countTokens({ contents: [{ parts: [{ text }], role: 'user' }] });
        return res.totalTokens ?? estimate(text);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (RETRYABLE_ERRORS.some((sig) => message.includes(sig)) && attempt < maxRetries - 1) {
          const wait = Math.pow(2, attempt) * 250;
          logger.warn(`countTokens retry after ${wait}ms: ${message}`);
          await sleep(wait);
          attempt += 1;
          continue;
        }
        logger.error('Gemini token counting failed', error);
        return estimate(text);
      }
    }
    return estimate(text);
  };

  /**
   * テキストを指定されたトークン数以内に切り詰める
   * バイナリサーチを使用して効率的に切り詰め位置を決定する
   */
  const truncate = async (text: string, limit: number) => {
    let left = 0;
    let right = text.length;
    let best = 0;

    while (left <= right) {
      const mid = Math.floor((left + right) / 2);
      const candidate = text.slice(0, mid);
      const tokens = await countPrecisely(candidate);
      if (tokens <= limit) {
        best = mid;
        left = mid + 1;
      } else {
        right = mid - 1;
      }
    }

    let output = text.slice(0, best);
    const breakPoints = ['\n', '。', '、', '.', ',', ' ', '}', ']', ')'];
    for (let i = output.length - 1; i >= Math.max(0, output.length - 100); i--) {
      if (breakPoints.includes(output[i])) {
        output = output.slice(0, i + 1);
        break;
      }
    }

    return output;
  };

  /**
   * テキストがトークン制限内であることを確認し、必要に応じて切り詰める
   */
  const ensureWithinLimit = async (text: string) => {
    const approx = estimate(text);
    if (approx <= maxTokens - safetyMargin) {
      return { text, tokens: approx, truncated: false } as const;
    }

    const precise = await countPrecisely(text);
    if (precise <= maxTokens) {
      return { text, tokens: precise, truncated: false } as const;
    }

    const truncated = await truncate(text, maxTokens - safetyMargin);
    const finalTokens = await countPrecisely(truncated);
    return { text: truncated, tokens: finalTokens, truncated: true } as const;
  };

  return {
    estimate,
    countPrecisely,
    truncate,
    ensureWithinLimit,
  };
}

/**
 * デフォルト設定でトークンカウンターを作成する
 */
export function createDefaultTokenCounter(): TokenCounter {
  const env = loadEnv();
  return createTokenCounter('gemini-2.0-flash-lite', {
    maxTokens: Number(process.env.MAX_INPUT_TOKENS ?? 2048),
    safetyMargin: Number(process.env.LLM_TOKEN_SAFETY_MARGIN ?? 128),
    encodingModel: env.EMBEDDING_MODEL,
  });
}
