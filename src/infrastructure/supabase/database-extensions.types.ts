// データベース型の拡張定義
// database.types.ts は自動生成されるため、カスタム型はこちらで定義

import type { Database } from './database.types';

// ==========================================
// Sync Operation 型拡張
// ==========================================

export type SyncOperationStatus = 'queued' | 'running' | 'completed' | 'failed';

export type SyncOperationProgress = {
  processed: number;
  total: number;
  message?: string;
};

// 型安全なSync Operation（progressとstatusを具体的な型に）
export interface TypedSyncOperation
  extends Omit<Database['public']['Tables']['sync_operations']['Row'], 'status' | 'progress'> {
  status: SyncOperationStatus;
  progress: SyncOperationProgress | null;
}
