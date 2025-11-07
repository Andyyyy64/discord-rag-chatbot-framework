import { MessageFlags, type ChatInputCommandInteraction } from 'discord.js';

import { getHelpMessage } from '../../common/help-service';
import type { CommandController } from '../router/command-router';

/**
 * ヘルプコマンドのコントローラーを作成する
 */
export function createHelpController(): CommandController {
  /**
   * ヘルプコマンドを処理する
   */
  return async (interaction: ChatInputCommandInteraction): Promise<void> => {
    await interaction.reply({ content: getHelpMessage(), flags: MessageFlags.Ephemeral });
  };
}
