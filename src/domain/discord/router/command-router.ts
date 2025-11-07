import type { ChatInputCommandInteraction, Interaction } from 'discord.js';

import { logger } from '../../../infrastructure/logging/logger';

export type CommandController = (interaction: ChatInputCommandInteraction) => Promise<void>;

/**
 * コマンドルーターを作成する
 */
export function createCommandRouter() {
  const controllers = new Map<string, CommandController>();

  /**
   * コマンド名とコントローラーを登録する
   */
  const register = (commandName: string, controller: CommandController) => {
    controllers.set(commandName, controller);
  };

  /**
   * Discordインタラクションを処理し、対応するコントローラーを実行する
   */
  const handle = async (interaction: Interaction) => {
    if (!interaction.isChatInputCommand()) return;
    const controller = controllers.get(interaction.commandName);

    if (!controller) {
      logger.warn(`No controller registered for command ${interaction.commandName}`);
      if (!interaction.deferred && !interaction.replied) {
        await interaction.reply({
          content: 'まだ実装されていないコマンドです。',
          ephemeral: true,
        });
      }
      return;
    }

    try {
      await controller(interaction);
    } catch (error) {
      logger.error('Command handling failed', error);
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp({ content: '内部エラーが発生しました。', ephemeral: true });
      } else {
        await interaction.reply({ content: '内部エラーが発生しました。', ephemeral: true });
      }
    }
  };

  return { register, handle };
}
