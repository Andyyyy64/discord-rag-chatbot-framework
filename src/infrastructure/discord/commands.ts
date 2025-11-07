import { SlashCommandBuilder } from 'discord.js';

export const commandBuilders = [
  new SlashCommandBuilder().setName('sync').setDescription('Guild 全体の同期ジョブを実行します'),
  new SlashCommandBuilder()
    .setName('chat')
    .setDescription('Discord RAG に質問します')
    .addStringOption((option) =>
      option.setName('query').setDescription('質問内容').setRequired(true)
    ),
  new SlashCommandBuilder().setName('help').setDescription('利用方法を表示します'),
];

export const commandData = commandBuilders.map((builder) => builder.toJSON());
