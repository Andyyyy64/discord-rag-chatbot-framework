import { REST, Routes } from 'discord.js';

import { loadEnv } from '../../config/env';
import { logger } from '../logging/logger';

import { commandData } from './commands';

/**
 * グローバルスラッシュコマンドを登録する
 */
export async function registerGlobalCommands(): Promise<void> {
  const env = loadEnv();
  const rest = new REST({ version: '10' }).setToken(env.DISCORD_TOKEN);
  logger.info('Registering global slash commands...');
  await rest.put(Routes.applicationCommands(env.DISCORD_APP_ID), { body: commandData });
  logger.info('Slash commands registered.');
}
