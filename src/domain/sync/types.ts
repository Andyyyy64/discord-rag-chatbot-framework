export type SyncScope = 'guild' | 'channel' | 'thread';
export type SyncMode = 'full' | 'delta';

export interface SyncCommandInput {
  guildId: string;
  requestedBy: string;
}

export interface ChannelSyncCommandInput {
  guildId: string;
  channelId: string;
  requestedBy: string;
}

export interface SyncJobStatus {
  jobId: string;
  processed: number;
  total: number;
  status: 'queued' | 'running' | 'completed' | 'failed';
  message?: string;
}
