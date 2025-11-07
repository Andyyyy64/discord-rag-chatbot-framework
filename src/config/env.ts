import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  DISCORD_TOKEN: z.string().min(1),
  DISCORD_APP_ID: z.string().min(1),
  DISCORD_PUBLIC_KEY: z.string().min(1),
  SUPABASE_URL: z.string().url(),
  SUPABASE_ANON_KEY: z.string().min(1),
  GEMINI_API_KEY: z.string().min(1),
  CHAT_MODEL: z.string().default('gemini-2.5-flash-lite'),
  EMBEDDING_MODEL: z.string().default('gemini-embedding-001'),
  EMBEDDING_DIM: z.coerce.number().default(3072),
  RERANK_PROVIDER: z.string().default('none'),
  RERANK_MODEL: z.string().default('rerank-3.5'),
  RERANK_TOPK: z.coerce.number().default(5),
  COHERE_API_KEY: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

/**
 * 環境変数を読み込み、バリデーションして返す
 */
export function loadEnv(): Env {
  if (!cached) {
    cached = envSchema.parse(process.env);
  }
  return cached;
}
