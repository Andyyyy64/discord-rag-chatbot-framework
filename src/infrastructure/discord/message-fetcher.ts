import type { Client, Collection, Message, TextChannel, ThreadChannel } from 'discord.js';
import { ChannelType } from 'discord.js';
import pLimit from 'p-limit';

import { withTimeout } from '../../shared/utils/time';
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
  onProgress?: (completed: number, total: number, phase: string) => void;
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
      let fetchCount = 0;
      while (true) {
        const batch: Collection<string, Message> = await channel.messages.fetch({
          limit: 100,
          before: lastId,
        });

        if (batch.size === 0) break;

        fetchCount++;

        for (const [, msg] of batch) {
          // since より前のメッセージはスキップ
          if (options.since && msg.createdAt < options.since) {
            logger.info(
              `  → ${channel.name}: ${messages.length} messages fetched (${fetchCount} API calls)`
            );
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

        // 進捗ログ（100 件ごと）
        if (fetchCount % 5 === 0) {
          logger.info(`  → ${channel.name}: ${messages.length} messages so far...`);
        }

        // limit に達したら終了
        if (options.limit && messages.length >= options.limit) {
          logger.info(
            `  → ${channel.name}: ${messages.length} messages fetched (${fetchCount} API calls)`
          );
          return messages.slice(0, options.limit);
        }
      }

      logger.info(
        `  → ${channel.name}: ${messages.length} messages fetched (${fetchCount} API calls)`
      );
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
      let fetchCount = 0;
      while (true) {
        const batch: Collection<string, Message> = await thread.messages.fetch({
          limit: 100,
          before: lastId,
        });

        if (batch.size === 0) break;

        fetchCount++;

        for (const [, msg] of batch) {
          if (options.since && msg.createdAt < options.since) {
            logger.info(
              `  → Thread ${thread.name}: ${messages.length} messages fetched (${fetchCount} API calls)`
            );
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
          logger.info(
            `  → Thread ${thread.name}: ${messages.length} messages fetched (${fetchCount} API calls)`
          );
          return messages.slice(0, options.limit);
        }
      }

      if (messages.length > 0) {
        logger.info(
          `  → Thread ${thread.name}: ${messages.length} messages fetched (${fetchCount} API calls)`
        );
      }
    } catch (error) {
      logger.error(`Failed to fetch messages from thread ${thread.id}`, error);
    }

    return messages;
  };

  /**
   * ギルド全体からメッセージを取得（並列化版）
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

    // 並列数制限
    const concurrency = Number(process.env.DISCORD_FETCH_CONCURRENCY ?? 15);
    const channelLimit = pLimit(concurrency);
    // スレッド用の別の limit（デッドロック回避用）
    const threadLimit = pLimit(concurrency);

    // チャンネルを取得
    const channels = await guild.channels.fetch();

    // 並列処理するタスクを集める
    const tasks: Array<() => Promise<FetchedMessage[]>> = [];

    for (const [, channel] of channels) {
      if (!channel) continue;

      // テキストチャンネルのみ処理
      if (channel.type === ChannelType.GuildText) {
        const textChannel = channel as TextChannel;

        // チャンネルのメッセージ取得タスク
        tasks.push(async () => {
          logger.info(`Fetching messages from channel: ${textChannel.name} (${textChannel.id})`);
          return await fetchMessagesFromChannel(textChannel, options);
        });

        // スレッド取得タスク
        tasks.push(async () => {
          try {
            logger.info(`→ Checking threads in channel: ${textChannel.name}`);
            const threadMessages: FetchedMessage[] = [];

            // アクティブなスレッドを取得
            try {
              const activeThreads = await textChannel.threads.fetchActive();
              logger.info(
                `  → Found ${activeThreads.threads.size} active threads in ${textChannel.name}`
              );

              const activePromises = Array.from(activeThreads.threads.values()).map((thread, idx) =>
                threadLimit(async () => {
                  try {
                    logger.info(
                      `  → [${idx + 1}/${activeThreads.threads.size}] Fetching active thread: ${thread.name} (${thread.id})`
                    );
                    // 各スレッドに 30 秒のタイムアウトを設定
                    const result = await withTimeout(
                      fetchMessagesFromThread(thread, options),
                      30000,
                      `active thread ${thread.name}`
                    );
                    logger.info(
                      `  → [${idx + 1}/${activeThreads.threads.size}] Completed: ${thread.name} (${result.length} messages)`
                    );
                    return result;
                  } catch (error) {
                    logger.error(
                      `  → [${idx + 1}/${activeThreads.threads.size}] Failed to fetch thread ${thread.name}:`,
                      error
                    );
                    return [];
                  }
                })
              );

              const activeResults = await Promise.all(activePromises);
              for (const msgs of activeResults) {
                threadMessages.push(...msgs);
              }
            } catch (error) {
              logger.error(`Failed to fetch active threads from ${textChannel.name}`, error);
            }

            // アーカイブされたスレッドを取得
            try {
              logger.info(`  → Fetching archived threads in ${textChannel.name}...`);
              const archivedThreads = await textChannel.threads.fetchArchived();
              logger.info(
                `  → Found ${archivedThreads.threads.size} archived threads in ${textChannel.name}`
              );

              if (archivedThreads.threads.size === 0) {
                logger.info(`  → No archived threads to process in ${textChannel.name}`);
              } else {
                logger.info(`  → Starting to process archived threads in ${textChannel.name}...`);

                const threadArray = Array.from(archivedThreads.threads.values());
                logger.info(`  → Created array of ${threadArray.length} threads`);

                const archivedPromises = threadArray.map((thread, idx) => {
                  logger.info(
                    `  → Mapping thread ${idx + 1}/${threadArray.length}: ${thread.name}`
                  );
                  return threadLimit(async () => {
                    try {
                      logger.info(
                        `  → [${idx + 1}/${threadArray.length}] Fetching archived thread: ${thread.name} (${thread.id})`
                      );
                      // 各スレッドに 30 秒のタイムアウトを設定
                      const result = await withTimeout(
                        fetchMessagesFromThread(thread, options),
                        30000,
                        `archived thread ${thread.name}`
                      );
                      logger.info(
                        `  → [${idx + 1}/${threadArray.length}] Completed: ${thread.name} (${result.length} messages)`
                      );
                      return result;
                    } catch (error) {
                      logger.error(
                        `  → [${idx + 1}/${threadArray.length}] Failed to fetch thread ${thread.name}:`,
                        error
                      );
                      return [];
                    }
                  });
                });

                logger.info(
                  `  → Created ${archivedPromises.length} promises, waiting for results...`
                );
                const archivedResults = await Promise.all(archivedPromises);
                logger.info(`  → Promise.all completed, got ${archivedResults.length} results`);

                for (const msgs of archivedResults) {
                  threadMessages.push(...msgs);
                }
                logger.info(`  → Merged archived thread messages: ${threadMessages.length} total`);
              }
            } catch (error) {
              logger.error(`Failed to fetch archived threads from ${textChannel.name}`, error);
            }

            logger.info(
              `  → Completed threads in ${textChannel.name}: ${threadMessages.length} messages`
            );
            return threadMessages;
          } catch (error) {
            logger.error(`Failed to fetch threads from channel ${textChannel.id}`, error);
            return [];
          }
        });
      }
    }

    // すべてのタスクを並列実行（タイムアウト付き）
    logger.info(`Starting parallel fetch: ${tasks.length} tasks with concurrency ${concurrency}`);

    let completedTasks = 0;
    const totalTasks = tasks.length;

    const results = await Promise.all(
      tasks.map((task, index) =>
        channelLimit(async () => {
          try {
            logger.info(`Starting task ${index + 1}/${totalTasks}`);
            const result = await task();
            completedTasks++;
            logger.info(`Completed task ${index + 1}/${totalTasks}: ${result.length} messages`);
            
            // 進捗を報告
            if (options.onProgress) {
              options.onProgress(completedTasks, totalTasks, 'メッセージ取得中');
            }
            
            return result;
          } catch (error) {
            completedTasks++;
            logger.error(`Task ${index + 1}/${totalTasks} failed`, error);
            
            // エラーでも進捗を報告
            if (options.onProgress) {
              options.onProgress(completedTasks, totalTasks, 'メッセージ取得中');
            }
            
            return [];
          }
        })
      )
    );

    // 結果をマージ
    const allMessages: FetchedMessage[] = [];
    for (const msgs of results) {
      allMessages.push(...msgs);
    }

    // 作成日時順にソート
    allMessages.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

    logger.info(`✓ Total messages fetched from guild ${guildId}: ${allMessages.length}`);

    return allMessages;
  };

  return {
    fetchMessagesFromChannel,
    fetchMessagesFromThread,
    fetchMessagesFromGuild,
  };
}
