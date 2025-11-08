/**
 * 進捗表示のフォーマッター
 */

/**
 * 進捗バーを作成する
 * @param processed 完了数
 * @param total 総数
 * @param length バーの長さ（デフォルト10）
 * @returns 進捗バー文字列
 */
export function createProgressBar(
  processed: number,
  total: number,
  length: number = 10
): string {
  if (total === 0) return '░'.repeat(length) + ' 0%';

  const percentage = Math.min(100, Math.floor((processed / total) * 100));
  const filled = Math.floor((percentage / 100) * length);
  const empty = length - filled;

  return '█'.repeat(filled) + '░'.repeat(empty) + ` ${percentage}%`;
}

/**
 * パーセンテージを計算する
 * @param processed 完了数
 * @param total 総数
 * @returns パーセンテージ（0-100）
 */
export function calculatePercentage(processed: number, total: number): number {
  if (total === 0) return 0;
  return Math.min(100, Math.floor((processed / total) * 100));
}

/**
 * 簡易的な進捗バー（短縮版）
 * @param processed 完了数
 * @param total 総数
 * @returns 簡易進捗バー
 */
export function createCompactProgressBar(processed: number, total: number): string {
  if (total === 0) return '░░░░░ 0%';

  const percentage = Math.min(100, Math.floor((processed / total) * 100));
  const filled = Math.floor(percentage / 20); // 5段階
  const empty = 5 - filled;

  return '▓'.repeat(filled) + '░'.repeat(empty) + ` ${percentage}%`;
}

/**
 * 進捗情報を人間が読みやすい形式でフォーマット
 * @param processed 完了数
 * @param total 総数
 * @param unit 単位（例: "件", "個"）
 * @returns フォーマットされた文字列（例: "42/100 件 (42%)"）
 */
export function formatProgress(
  processed: number,
  total: number,
  unit: string = '件'
): string {
  const percentage = calculatePercentage(processed, total);
  return `${processed}/${total} ${unit} (${percentage}%)`;
}

