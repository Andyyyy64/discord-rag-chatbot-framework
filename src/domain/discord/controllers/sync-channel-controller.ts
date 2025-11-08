import type { ChatInputCommandInteraction } from 'discord.js';

import { logger } from '../../../infrastructure/logging/logger';
import { createProgressBar } from '../../../shared/formatters/progress';
import { getStatusEmoji } from '../../../shared/formatters/status';
import { createSyncService } from '../../sync/sync-service';
import type { CommandController } from '../router/command-router';

/**
 * チャンネル同期コマンドのコントローラーを作成する
 */
export function createSyncChannelController(service = createSyncService()): CommandController {
  /**
   * チャンネル同期コマンドを処理する
   */
  return async (interaction: ChatInputCommandInteraction): Promise<void> => {
    await interaction.deferReply();

    try {
      const status = await service.requestChannelSync({
        guildId: interaction.guildId ?? 'unknown',
        channelId: interaction.channelId,
        requestedBy: interaction.user.id,
      });

      await interaction.editReply(
        `🔄 チャンネル同期ジョブを受け付けました (ID: ${status.jobId})\n` +
          `進捗: ${status.processed}/${status.total} | 状態: ${status.status}`
      );

      // 状態表示のアニメーション用カウンター
      let animationCounter = 0;

      // 進捗を定期的にポーリングして更新
      const pollInterval = setInterval(async () => {
        try {
          const currentStatus = await service.getJobStatus(status.jobId);

          if (!currentStatus) {
            clearInterval(pollInterval);
            return;
          }

          // 進捗メッセージを構築
          const progressBar = createProgressBar(currentStatus.processed, currentStatus.total);
          const statusEmoji = getStatusEmoji(currentStatus.status);

          // 状態表示のアニメーション
          let statusText: string = currentStatus.status;
          if (currentStatus.status === 'running') {
            const dots = '.'.repeat(animationCounter % 4);
            statusText = `running${dots}`;
            animationCounter++;
          }

          await interaction.editReply(
            `${statusEmoji} チャンネル同期ジョブ (ID: ${status.jobId})\n` +
              `進捗: ${currentStatus.processed}/${currentStatus.total}\n` +
              `${progressBar}\n` +
              `状態: ${statusText}` +
              (currentStatus.message ? `\n${currentStatus.message}` : '')
          );

          // 完了またはエラーの場合はポーリングを停止
          if (
            currentStatus.status === 'completed' ||
            currentStatus.status === 'failed'
          ) {
            clearInterval(pollInterval);
          }
        } catch (error) {
          logger.error('Failed to poll job status', error);
          clearInterval(pollInterval);
        }
      }, 3000); // 3秒ごとに更新

      // 5分後にポーリングを停止（タイムアウト）
      setTimeout(() => {
        clearInterval(pollInterval);
      }, 5 * 60 * 1000);
    } catch (error) {
      logger.error('Sync channel command failed', error);
      await interaction.editReply('❌ チャンネル同期ジョブの登録に失敗しました。ログを確認してください。');
    }
  };
}

