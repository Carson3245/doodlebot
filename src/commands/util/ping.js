import { SlashCommandBuilder } from 'discord.js';

export const data = new SlashCommandBuilder()
  .setName('ping')
  .setDescription('Show the bot latency.');

export async function execute(interaction) {
  const sent = await interaction.reply({ content: 'Calculating ping...', fetchReply: true });
  const latency = sent.createdTimestamp - interaction.createdTimestamp;
  const apiLatency = Math.round(interaction.client.ws.ping);
  await interaction.editReply(`🏓 Bot latency: ${latency}ms | API latency: ${apiLatency}ms`);
}
