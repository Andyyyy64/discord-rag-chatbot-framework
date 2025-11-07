import type { Client, Collection, Message, TextChannel, ThreadChannel } from 'discord.js';
import { ChannelType } from 'discord.js';

import { logger } from '../logging/logger';

export interface FetchedMessage {
  id: string;
  channelId: string;
  threadId?: string;
  authorId: string;
  content: string;
  createdAt: Date;
  editedAt?: Date;
}

export interface FetchOptions {
  since?: Date;
  limit?: number;
}

/**
 * メッセージフェッチャーを作成する
 */
export function createMessageFetcher(client: Client) {
  /**
   * チャンネルからメッセージを取得
   */
  const fetchMessagesFromChannel = async (
    channel: TextChannel,
    options: FetchOptions = {}
  ): Promise<FetchedMessage[]> => {
    const messages: FetchedMessage[] = [];
    let lastId: string | undefined;

    try {
      while (true) {
        const batch: Collection<string, Message> = await channel.messages.fetch({
          limit: 100,
          before: lastId,
        });

        if (batch.size === 0) break;

        for (const [, msg] of batch) {
          // since より前のメッセージはスキップ
          if (options.since && msg.createdAt < options.since) {
            return messages;
          }

          // ボットメッセージはスキップ
          if (msg.author.bot) continue;

          messages.push({
            id: msg.id,
            channelId: msg.channelId,
            authorId: msg.author.id,
            content: msg.content,
            createdAt: msg.createdAt,
            editedAt: msg.editedAt ?? undefined,
          });
        }

        lastId = batch.last()?.id;

        // limit に達したら終了
        if (options.limit && messages.length >= options.limit) {
          return messages.slice(0, options.limit);
        }
      }
    } catch (error) {
      logger.error(`Failed to fetch messages from channel ${channel.id}`, error);
    }

    return messages;
  };

  /**
   * スレッドからメッセージを取得
   */
  const fetchMessagesFromThread = async (
    thread: ThreadChannel,
    options: FetchOptions = {}
  ): Promise<FetchedMessage[]> => {
    const messages: FetchedMessage[] = [];
    let lastId: string | undefined;

    try {
      while (true) {
        const batch: Collection<string, Message> = await thread.messages.fetch({
          limit: 100,
          before: lastId,
        });

        if (batch.size === 0) break;

        for (const [, msg] of batch) {
          if (options.since && msg.createdAt < options.since) {
            return messages;
          }

          if (msg.author.bot) continue;

          messages.push({
            id: msg.id,
            channelId: thread.parentId ?? thread.id,
            threadId: thread.id,
            authorId: msg.author.id,
            content: msg.content,
            createdAt: msg.createdAt,
            editedAt: msg.editedAt ?? undefined,
          });
        }

        lastId = batch.last()?.id;

        if (options.limit && messages.length >= options.limit) {
          return messages.slice(0, options.limit);
        }
      }
    } catch (error) {
      logger.error(`Failed to fetch messages from thread ${thread.id}`, error);
    }

    return messages;
  };

  /**
   * ギルド全体からメッセージを取得
   */
  const fetchMessagesFromGuild = async (
    guildId: string,
    options: FetchOptions = {}
  ): Promise<FetchedMessage[]> => {
    const guild = client.guilds.cache.get(guildId);
    if (!guild) {
      logger.error(`Guild ${guildId} not found`);
      return [];
    }

    const allMessages: FetchedMessage[] = [];

    // チャンネルを取得
    const channels = await guild.channels.fetch();

    for (const [, channel] of channels) {
      if (!channel) continue;

      // テキストチャンネルのみ処理
      if (channel.type === ChannelType.GuildText) {
        const textChannel = channel as TextChannel;
        logger.info(`Fetching messages from channel: ${textChannel.name} (${textChannel.id})`);

        // チャンネルのメッセージを取得
        const channelMessages = await fetchMessagesFromChannel(textChannel, options);
        allMessages.push(...channelMessages);

        // アクティブなスレッドを取得
        try {
          const activeThreads = await textChannel.threads.fetchActive();
          for (const [, thread] of activeThreads.threads) {
            logger.info(`Fetching messages from active thread: ${thread.name} (${thread.id})`);
            const threadMessages = await fetchMessagesFromThread(thread, options);
            allMessages.push(...threadMessages);
          }

          // アーカイブされたスレッドを取得
          const archivedThreads = await textChannel.threads.fetchArchived();
          for (const [, thread] of archivedThreads.threads) {
            logger.info(`Fetching messages from archived thread: ${thread.name} (${thread.id})`);
            const threadMessages = await fetchMessagesFromThread(thread, options);
            allMessages.push(...threadMessages);
          }
        } catch (error) {
          logger.error(`Failed to fetch threads from channel ${textChannel.id}`, error);
        }
      }
    }

    // 作成日時順にソート
    allMessages.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

    return allMessages;
  };

  return {
    fetchMessagesFromChannel,
    fetchMessagesFromThread,
    fetchMessagesFromGuild,
  };
}
