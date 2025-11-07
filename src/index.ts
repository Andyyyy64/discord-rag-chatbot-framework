import http from 'node:http';

import { loadEnv } from './config/env';
import { buildRouter } from './domain/discord/router/build-router';
import { createSyncRunner } from './domain/sync/sync-runner';
import { createDiscordClient } from './infrastructure/discord/discord-client';
import { registerGlobalCommands } from './infrastructure/discord/register-commands';
import { logger } from './infrastructure/logging/logger';

/**
 * アプリケーションを起動する
 * Discordクライアントの初期化、コマンド登録、同期ワーカーの起動を行う
 */
async function bootstrap() {
  const env = loadEnv();
  const client = createDiscordClient();
  const router = buildRouter();

  client.once('clientReady', () => {
    logger.info(`Logged in as ${client.user?.tag}`);

    // ワーカーを起動（バックグラウンドで実行）
    const runner = createSyncRunner(client);
    runner.start().catch((error) => {
      logger.error('Sync runner crashed', error);
    });
  });

  client.on('interactionCreate', async (interaction) => {
    await router.handle(interaction);
  });

  await registerGlobalCommands();
  await client.login(env.DISCORD_TOKEN);

  const port = Number(process.env.PORT ?? 8080);
  const server = http.createServer((req, res) => {
    if (req.url === '/healthz') {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('ok');
      return;
    }
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('discord-rag-bot running');
  });

  server.listen(port, () => {
    logger.info(`HTTP health server listening on port ${port}`);
  });
}

bootstrap().catch((error) => {
  logger.error('Fatal error during bootstrap', error);
  process.exitCode = 1;
});

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled rejection', reason);
});
