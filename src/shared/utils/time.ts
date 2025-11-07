/**
 * 指定されたミリ秒数だけ待機する
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
