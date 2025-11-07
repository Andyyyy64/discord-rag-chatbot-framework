import { Client, GatewayIntentBits, Partials } from 'discord.js';

/**
 * Discordクライアントを作成する
 */
export function createDiscordClient(): Client {
  return new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
    partials: [Partials.Channel],
  });
}
