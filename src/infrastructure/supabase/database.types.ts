export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "13.0.5"
  }
  public: {
    Tables: {
      channels: {
        Row: {
          category_id: string | null
          channel_id: string
          created_at: string | null
          guild_id: string
          last_scanned_at: string | null
          name: string | null
          type: number | null
        }
        Insert: {
          category_id?: string | null
          channel_id: string
          created_at?: string | null
          guild_id: string
          last_scanned_at?: string | null
          name?: string | null
          type?: number | null
        }
        Update: {
          category_id?: string | null
          channel_id?: string
          created_at?: string | null
          guild_id?: string
          last_scanned_at?: string | null
          name?: string | null
          type?: number | null
        }
        Relationships: []
      }
      embed_queue: {
        Row: {
          attempts: number
          id: string
          priority: number
          status: string
          updated_at: string | null
          window_id: string
        }
        Insert: {
          attempts?: number
          id?: string
          priority?: number
          status?: string
          updated_at?: string | null
          window_id: string
        }
        Update: {
          attempts?: number
          id?: string
          priority?: number
          status?: string
          updated_at?: string | null
          window_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "embed_queue_window_id_message_windows_window_id_fk"
            columns: ["window_id"]
            isOneToOne: true
            referencedRelation: "message_windows"
            referencedColumns: ["window_id"]
          },
        ]
      }
      message_embeddings: {
        Row: {
          embedding: string
          updated_at: string | null
          window_id: string
        }
        Insert: {
          embedding: string
          updated_at?: string | null
          window_id: string
        }
        Update: {
          embedding?: string
          updated_at?: string | null
          window_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "message_embeddings_window_id_message_windows_window_id_fk"
            columns: ["window_id"]
            isOneToOne: true
            referencedRelation: "message_windows"
            referencedColumns: ["window_id"]
          },
        ]
      }
      message_windows: {
        Row: {
          category_id: string | null
          channel_id: string
          date: string
          end_at: string
          guild_id: string
          message_ids: string[]
          start_at: string
          text: string | null
          thread_id: string | null
          token_est: number | null
          window_id: string
          window_seq: number
        }
        Insert: {
          category_id?: string | null
          channel_id: string
          date: string
          end_at: string
          guild_id: string
          message_ids: string[]
          start_at: string
          text?: string | null
          thread_id?: string | null
          token_est?: number | null
          window_id?: string
          window_seq: number
        }
        Update: {
          category_id?: string | null
          channel_id?: string
          date?: string
          end_at?: string
          guild_id?: string
          message_ids?: string[]
          start_at?: string
          text?: string | null
          thread_id?: string | null
          token_est?: number | null
          window_id?: string
          window_seq?: number
        }
        Relationships: []
      }
      messages: {
        Row: {
          allowed_role_ids: string[] | null
          allowed_user_ids: string[] | null
          attachments: Json | null
          author_id: string | null
          category_id: string | null
          channel_id: string
          content_md: string | null
          content_plain: string | null
          created_at: string | null
          deleted_at: string | null
          edited_at: string | null
          guild_id: string
          jump_link: string | null
          mentions: Json | null
          message_id: string
          thread_id: string | null
          token_count: number | null
        }
        Insert: {
          allowed_role_ids?: string[] | null
          allowed_user_ids?: string[] | null
          attachments?: Json | null
          author_id?: string | null
          category_id?: string | null
          channel_id: string
          content_md?: string | null
          content_plain?: string | null
          created_at?: string | null
          deleted_at?: string | null
          edited_at?: string | null
          guild_id: string
          jump_link?: string | null
          mentions?: Json | null
          message_id: string
          thread_id?: string | null
          token_count?: number | null
        }
        Update: {
          allowed_role_ids?: string[] | null
          allowed_user_ids?: string[] | null
          attachments?: Json | null
          author_id?: string | null
          category_id?: string | null
          channel_id?: string
          content_md?: string | null
          content_plain?: string | null
          created_at?: string | null
          deleted_at?: string | null
          edited_at?: string | null
          guild_id?: string
          jump_link?: string | null
          mentions?: Json | null
          message_id?: string
          thread_id?: string | null
          token_count?: number | null
        }
        Relationships: []
      }
      sync_chunks: {
        Row: {
          attempts: number
          cursor: Json | null
          date: string
          id: string
          last_error: string | null
          op_id: string
          status: string
          target_id: string
          updated_at: string | null
        }
        Insert: {
          attempts?: number
          cursor?: Json | null
          date: string
          id?: string
          last_error?: string | null
          op_id: string
          status?: string
          target_id: string
          updated_at?: string | null
        }
        Update: {
          attempts?: number
          cursor?: Json | null
          date?: string
          id?: string
          last_error?: string | null
          op_id?: string
          status?: string
          target_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sync_chunks_op_id_sync_operations_id_fk"
            columns: ["op_id"]
            isOneToOne: false
            referencedRelation: "sync_operations"
            referencedColumns: ["id"]
          },
        ]
      }
      sync_cursors: {
        Row: {
          guild_id: string
          last_message_id: string | null
          last_synced_at: string | null
        }
        Insert: {
          guild_id: string
          last_message_id?: string | null
          last_synced_at?: string | null
        }
        Update: {
          guild_id?: string
          last_message_id?: string | null
          last_synced_at?: string | null
        }
        Relationships: []
      }
      sync_operations: {
        Row: {
          created_at: string | null
          guild_id: string
          id: string
          mode: string
          progress: Json | null
          requested_by: string
          scope: string
          since: string | null
          status: string
          target_ids: string[] | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          guild_id: string
          id?: string
          mode: string
          progress?: Json | null
          requested_by: string
          scope: string
          since?: string | null
          status?: string
          target_ids?: string[] | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          guild_id?: string
          id?: string
          mode?: string
          progress?: Json | null
          requested_by?: string
          scope?: string
          since?: string | null
          status?: string
          target_ids?: string[] | null
          updated_at?: string | null
        }
        Relationships: []
      }
      threads: {
        Row: {
          archived: boolean | null
          channel_id: string
          created_at: string | null
          guild_id: string
          last_scanned_at: string | null
          name: string | null
          thread_id: string
        }
        Insert: {
          archived?: boolean | null
          channel_id: string
          created_at?: string | null
          guild_id: string
          last_scanned_at?: string | null
          name?: string | null
          thread_id: string
        }
        Update: {
          archived?: boolean | null
          channel_id?: string
          created_at?: string | null
          guild_id?: string
          last_scanned_at?: string | null
          name?: string | null
          thread_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      match_windows_in_guild: {
        Args: {
          query_embedding: number[]
          p_guild_id: string
          p_limit?: number
        }
        Returns: {
          window_id: string
          similarity: number
        }[]
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
