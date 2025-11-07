import { MessageFlags, type ChatInputCommandInteraction } from 'discord.js';

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
      await interaction.reply({ content: 'query を入力してください。', ephemeral: true });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      const answer = await service.answer({
        guildId: interaction.guildId ?? 'unknown',
        channelId: interaction.channelId,
        userId: interaction.user.id,
        query,
      });

      const citations = answer.citations.map((c) => `${c.label}: ${c.jumpLink}`).join('\n');

      await interaction.editReply(`**回答**\n${answer.answer}\n\n**出典**\n${citations || 'なし'}`);
    } catch (error) {
      logger.error('Chat command failed', error);
      await interaction.editReply('回答を生成できませんでした。後ほど再度お試しください。');
    }
  };
}
