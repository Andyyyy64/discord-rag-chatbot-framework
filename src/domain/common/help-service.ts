/**
 * ヘルプメッセージを取得する
 */
export function getHelpMessage(): string {
  return [
    'discord-rag-framework へようこそ！',
    '',
    '/sync  : ギルド全体を同期します（初回・差分とも同じコマンド）。',
    '/chat  : RAG 検索して回答。例) /chat query:"昨日の議事録"',
    '/help  : このヘルプを表示。',
    '',
    'すべての応答は既定でエフェメラルです。詳細は README を参照してください。',
  ].join('\n');
}
