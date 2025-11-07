export interface ChatCommandInput {
  guildId: string;
  channelId: string;
  userId: string;
  query: string;
}

export interface ChatAnswer {
  answer: string;
  citations: Array<{ label: string; jumpLink: string }>;
  latencyMs: number;
}
