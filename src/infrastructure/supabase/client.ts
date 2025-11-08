import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { loadEnv } from '../../config/env';

import type { Database } from './database.types';

let cached: SupabaseClient<Database> | null = null;

/**
 * Supabaseクライアントを取得する
 */
export function getSupabaseClient(): SupabaseClient<Database> {
  if (!cached) {
    const env = loadEnv();
    cached = createClient<Database>(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: {
        headers: {
          'x-client-info': 'discord-rag-framework-anon',
        },
      },
    });
  }
  return cached;
}
