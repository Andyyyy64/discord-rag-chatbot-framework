import { MessageFlags, type ChatInputCommandInteraction } from 'discord.js';

import { logger } from '../../../infrastructure/logging/logger';
import { createSyncService } from '../../sync/sync-service';
import type { CommandController } from '../router/command-router';

/**
 * 同期コマンドのコントローラーを作成する
 */
export function createSyncController(service = createSyncService()): CommandController {
  /**
   * 同期コマンドを処理する
   */
  return async (interaction: ChatInputCommandInteraction): Promise<void> => {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      const status = await service.requestSync({
        guildId: interaction.guildId ?? 'unknown',
        requestedBy: interaction.user.id,
      });

      await interaction.editReply(
        `同期ジョブを受け付けました (ID: ${status.jobId}).\n` +
          `進捗: ${status.processed}/${status.total} 状態: ${status.status}`
      );
    } catch (error) {
      logger.error('Sync command failed', error);
      await interaction.editReply('同期ジョブの登録に失敗しました。ログを確認してください。');
    }
  };
}
