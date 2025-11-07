import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { loadEnv } from '../../config/env';

// データベーステーブルの型定義
export type Database = {
  public: {
    Tables: {
      sync_operations: {
        Row: {
          id: string;
          guild_id: string;
          scope: 'guild' | 'channel' | 'thread';
          mode: 'full' | 'delta';
          target_ids: string[] | null;
          since: string | null;
          requested_by: string;
          status: 'queued' | 'running' | 'completed' | 'failed';
          progress: {
            processed: number;
            total: number;
            message?: string;
          };
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          guild_id: string;
          scope: 'guild' | 'channel' | 'thread';
          mode: 'full' | 'delta';
          target_ids?: string[] | null;
          since?: string | null;
          requested_by: string;
          status?: 'queued' | 'running' | 'completed' | 'failed';
          progress?: {
            processed: number;
            total: number;
            message?: string;
          };
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          guild_id?: string;
          scope?: 'guild' | 'channel' | 'thread';
          mode?: 'full' | 'delta';
          target_ids?: string[] | null;
          since?: string | null;
          requested_by?: string;
          status?: 'queued' | 'running' | 'completed' | 'failed';
          progress?: {
            processed: number;
            total: number;
            message?: string;
          };
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      sync_cursors: {
        Row: {
          guild_id: string;
          last_message_id: string | null;
          last_synced_at: string | null;
        };
        Insert: {
          guild_id: string;
          last_message_id?: string | null;
          last_synced_at?: string | null;
        };
        Update: {
          guild_id?: string;
          last_message_id?: string | null;
          last_synced_at?: string | null;
        };
        Relationships: [];
      };
      messages: {
        Row: {
          guild_id: string;
          category_id: string | null;
          channel_id: string;
          thread_id: string | null;
          message_id: string;
          author_id: string | null;
          content_md: string | null;
          content_plain: string | null;
          created_at: string | null;
          edited_at: string | null;
          deleted_at: string | null;
          mentions: unknown;
          attachments: unknown;
          jump_link: string | null;
          token_count: number | null;
          allowed_role_ids: string[] | null;
          allowed_user_ids: string[] | null;
        };
        Insert: {
          guild_id: string;
          category_id?: string | null;
          channel_id: string;
          thread_id?: string | null;
          message_id: string;
          author_id?: string | null;
          content_md?: string | null;
          content_plain?: string | null;
          created_at?: string | null;
          edited_at?: string | null;
          deleted_at?: string | null;
          mentions?: unknown;
          attachments?: unknown;
          jump_link?: string | null;
          token_count?: number | null;
          allowed_role_ids?: string[] | null;
          allowed_user_ids?: string[] | null;
        };
        Update: {
          guild_id?: string;
          category_id?: string | null;
          channel_id?: string;
          thread_id?: string | null;
          message_id?: string;
          author_id?: string | null;
          content_md?: string | null;
          content_plain?: string | null;
          created_at?: string | null;
          edited_at?: string | null;
          deleted_at?: string | null;
          mentions?: unknown;
          attachments?: unknown;
          jump_link?: string | null;
          token_count?: number | null;
          allowed_role_ids?: string[] | null;
          allowed_user_ids?: string[] | null;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
  };
};

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
