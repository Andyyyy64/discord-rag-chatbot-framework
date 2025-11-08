/**
 * ステータス表示のフォーマッター
 */

/**
 * ジョブステータスに応じた絵文字を取得する
 * @param status ジョブステータス
 * @returns 対応する絵文字
 */
export function getStatusEmoji(status: string): string {
  switch (status) {
    case 'queued':
      return '⏳';
    case 'running':
      return '🔄';
    case 'completed':
      return '✅';
    case 'failed':
      return '❌';
    case 'cancelled':
      return '🚫';
    case 'paused':
      return '⏸️';
    default:
      return '❓';
  }
}

/**
 * ジョブステータスを日本語に変換する
 * @param status ジョブステータス
 * @returns 日本語のステータス文字列
 */
export function getStatusText(status: string): string {
  switch (status) {
    case 'queued':
      return '待機中';
    case 'running':
      return '実行中';
    case 'completed':
      return '完了';
    case 'failed':
      return '失敗';
    case 'cancelled':
      return 'キャンセル';
    case 'paused':
      return '一時停止';
    default:
      return '不明';
  }
}

/**
 * フェーズに応じた絵文字を取得する
 * @param phase フェーズ名
 * @returns 対応する絵文字
 */
export function getPhaseEmoji(phase: string): string {
  if (phase.includes('取得') || phase.includes('fetch')) return '📥';
  if (phase.includes('保存') || phase.includes('save')) return '💾';
  if (phase.includes('処理') || phase.includes('process')) return '🔨';
  if (phase.includes('更新') || phase.includes('update')) return '🔄';
  if (phase.includes('削除') || phase.includes('delete')) return '🗑️';
  if (phase.includes('検索') || phase.includes('search')) return '🔍';
  if (phase.includes('生成') || phase.includes('generate')) return '✨';
  return '📋';
}

/**
 * ステータスと絵文字を組み合わせた表示文字列を生成
 * @param status ステータス
 * @param includeText 日本語テキストを含めるか
 * @returns フォーマットされた文字列
 */
export function formatStatus(status: string, includeText: boolean = true): string {
  const emoji = getStatusEmoji(status);
  if (!includeText) return emoji;
  const text = getStatusText(status);
  return `${emoji} ${text}`;
}

