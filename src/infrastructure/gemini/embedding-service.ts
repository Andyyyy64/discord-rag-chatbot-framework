import { GoogleGenAI } from '@google/genai';

import { logger } from '../logging/logger';

/**
 * 利用可能な Gemini API キーを取得
 */
function listGeminiKeys(): string[] {
  const keys: string[] = [];
  const base = process.env.GEMINI_API_KEY;
  if (base) keys.push(String(base));

  // 最大 20 個のキーを受け付ける
  for (let i = 2; i <= 20; i++) {
    const k = process.env[`GEMINI_API_KEY${i}` as keyof NodeJS.ProcessEnv];
    if (k) keys.push(String(k));
  }

  return Array.from(new Set(keys));
}

/**
 * ランダムに Gemini クライアントを取得
 */
function getRandomGeminiClient(): GoogleGenAI {
  const keys = listGeminiKeys();
  if (!keys.length) {
    throw new Error('GEMINI_API_KEY is not configured');
  }

  const pick = keys[Math.floor(Math.random() * keys.length)];
  return new GoogleGenAI({ apiKey: pick });
}

/**
 * リトライ可能なエラーかどうかを判定
 */
function isRetryableError(error: unknown): boolean {
  let errorMessage = '';
  if (typeof error === 'string') {
    errorMessage = error;
  } else if (error instanceof Error) {
    errorMessage = error.message || String(error);
  } else {
    try {
      errorMessage = `${error}`;
    } catch {
      errorMessage = '';
    }
  }

  const retryableStatusCodes = ['429', '500', '502', '503', '504'];
  const hasRetryableStatusCode = retryableStatusCodes.some(
    (code) => errorMessage.includes(code) || errorMessage.includes(`status: ${code}`)
  );

  const retryableMessages = [
    'Rate limit',
    'rate limit',
    'Too Many Requests',
    'Service Unavailable',
    'Internal Server Error',
    'Bad Gateway',
    'Gateway Timeout',
    'The model is overloaded',
    'overloaded',
    'UNAVAILABLE',
    'RESOURCE_EXHAUSTED',
    'DEADLINE_EXCEEDED',
    'fetch failed',
    'ECONNRESET',
    'ETIMEDOUT',
    'timeout',
  ];

  const hasRetryableMessage = retryableMessages.some((msg) =>
    errorMessage.toLowerCase().includes(msg.toLowerCase())
  );

  return hasRetryableStatusCode || hasRetryableMessage;
}

/**
 * 指定秒数待機
 */
function sleep(seconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, seconds * 1000));
}

/**
 * Window のテキストに対して embedding を生成
 */
export async function embedWindow(text: string, _dim = 3072): Promise<number[]> {
  const maxRetries = 10;
  let attempt = 1;

  while (attempt <= maxRetries) {
    try {
      const client = getRandomGeminiClient();

      const response = await client.models.embedContent({
        model: 'gemini-embedding-001',
        contents: text,
      });

      const embedding = response?.embeddings?.[0]?.values;
      if (!embedding) {
        throw new Error('Gemini から埋め込みが取得できませんでした');
      }

      return Array.from(embedding);
    } catch (error) {
      if (isRetryableError(error) && attempt < maxRetries) {
        const baseDelay = Math.pow(2, attempt);
        const jitter = Math.random() * 2;
        const delaySeconds = baseDelay + jitter;

        logger.warn(
          `[Gemini Embedding] リトライ可能なエラー - ${delaySeconds.toFixed(1)}秒後にリトライ (${attempt}/${maxRetries})`,
          error
        );

        await sleep(delaySeconds);
        attempt++;
        continue;
      } else {
        logger.error(`[Gemini Embedding] 埋め込み生成失敗 (${attempt}/${maxRetries})`, error);
        throw error;
      }
    }
  }

  throw new Error(`最大リトライ回数(${maxRetries})に到達しました`);
}

/**
 * クエリ文に対して embedding を生成
 */
export async function embedQuery(text: string, _dim = 3072): Promise<number[]> {
  const maxRetries = 10;
  let attempt = 1;

  while (attempt <= maxRetries) {
    try {
      const client = getRandomGeminiClient();

      const response = await client.models.embedContent({
        model: 'gemini-embedding-001',
        contents: text,
      });

      const embedding = response?.embeddings?.[0]?.values;
      if (!embedding) {
        throw new Error('Gemini から埋め込みが取得できませんでした');
      }

      return Array.from(embedding);
    } catch (error) {
      if (isRetryableError(error) && attempt < maxRetries) {
        const baseDelay = Math.pow(2, attempt);
        const jitter = Math.random() * 2;
        const delaySeconds = baseDelay + jitter;

        logger.warn(
          `[Gemini Query Embedding] リトライ可能なエラー - ${delaySeconds.toFixed(1)}秒後にリトライ (${attempt}/${maxRetries})`,
          error
        );

        await sleep(delaySeconds);
        attempt++;
        continue;
      } else {
        logger.error(`[Gemini Query Embedding] 埋め込み生成失敗 (${attempt}/${maxRetries})`, error);
        throw error;
      }
    }
  }

  throw new Error(`最大リトライ回数(${maxRetries})に到達しました`);
}
