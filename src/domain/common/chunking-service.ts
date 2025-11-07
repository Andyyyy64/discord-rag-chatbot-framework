import { DiscordMessage, MessageWindow } from './chunking';
import { createDefaultTokenCounter, type TokenCounter } from './token-counter';

export interface ChunkingOptions {
  maxTokensPerWindow?: number;
  softGapMinutes?: number;
  overlapMessages?: number;
}

/**
 * チャンキングサービスを作成する
 */
export function createChunkingService(
  defaults: Required<ChunkingOptions> = {
    maxTokensPerWindow: Number(process.env.MAX_TOKENS_PER_WINDOW ?? 1200),
    softGapMinutes: Number(process.env.SOFT_GAP_MINUTES ?? 5),
    overlapMessages: Number(process.env.OVERLAP_MESSAGES ?? 0),
  },
  tokenCounter: TokenCounter = createDefaultTokenCounter()
) {
  /**
   * メッセージのオーバーラップを適用する
   */
  const applyOverlap = (messages: DiscordMessage[], overlap: number): DiscordMessage[] => {
    if (!overlap) return [];
    return messages.slice(-overlap);
  };

  /**
   * メッセージをトークン制限と時間間隔に基づいてチャンクに分割する
   */
  const chunk = async (
    messages: DiscordMessage[],
    options?: ChunkingOptions
  ): Promise<MessageWindow[]> => {
    if (!messages.length) return [];

    const cfg = { ...defaults, ...options };
    const out: MessageWindow[] = [];
    let seq = 1;
    let buffer: DiscordMessage[] = [];
    let tokenBudget = 0;
    let lastTimestamp = messages[0]?.createdAt ?? new Date();

    /**
     * バッファ内のメッセージをウィンドウとして確定し、出力に追加する
     */
    const flush = async () => {
      if (!buffer.length) return;
      const text = buffer.map((m) => m.content).join('\n');
      const ensured = await tokenCounter.ensureWithinLimit(text);
      out.push({
        windowSeq: seq++,
        messageIds: buffer.map((m) => m.id),
        startAt: buffer[0].createdAt,
        endAt: buffer[buffer.length - 1].createdAt,
        tokenCount: ensured.tokens,
        text: ensured.text,
      });
      buffer = applyOverlap(buffer, cfg.overlapMessages);
      tokenBudget = buffer.reduce((sum, m) => sum + tokenCounter.estimate(m.content), 0);
    };

    for (const msg of messages) {
      const gapMinutes = (msg.createdAt.getTime() - lastTimestamp.getTime()) / 60000;
      const tokenAdd = tokenCounter.estimate(msg.content);
      const softBreak = gapMinutes > cfg.softGapMinutes || msg.isTopLevel;
      const wouldOverflow = tokenBudget + tokenAdd > cfg.maxTokensPerWindow;

      if (!buffer.length) {
        buffer.push(msg);
        tokenBudget = tokenAdd;
        lastTimestamp = msg.createdAt;
        continue;
      }

      if (wouldOverflow || softBreak) {
        await flush();
      }

      buffer.push(msg);
      tokenBudget += tokenAdd;
      lastTimestamp = msg.createdAt;
    }

    await flush();
    return out;
  };

  return { chunk };
}
