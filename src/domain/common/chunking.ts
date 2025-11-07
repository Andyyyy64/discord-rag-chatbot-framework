export interface DiscordMessage {
  id: string;
  content: string;
  createdAt: Date;
  isTopLevel: boolean;
}

export interface MessageWindow {
  windowSeq: number;
  messageIds: string[];
  startAt: Date;
  endAt: Date;
  tokenCount: number;
  text: string;
}
