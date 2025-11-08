import type { ChatInputCommandInteraction } from 'discord.js';

import { logger } from '../../../infrastructure/logging/logger';
import { createChatService } from '../../chat/chat-service';
import type { CommandController } from '../router/command-router';

/**
 * チャットコマンドのコントローラーを作成する
 */
export function createChatController(service = createChatService()): CommandController {
  /**
   * チャットコマンドを処理する
   */
  return async (interaction: ChatInputCommandInteraction): Promise<void> => {
    const query = interaction.options.getString('query');
    if (!query) {
      await interaction.reply({ content: 'query を入力してください。' });
      return;
    }

    await interaction.deferReply();

    try {
      const answer = await service.answer({
        guildId: interaction.guildId ?? 'unknown',
        channelId: interaction.channelId,
        userId: interaction.user.id,
        query,
      });

      await interaction.editReply(`**回答**\n${answer.answer}`);
    } catch (error) {
      logger.error('Chat command failed', error);
      await interaction.editReply('回答を生成できませんでした。後ほど再度お試しください。');
    }
  };
}
