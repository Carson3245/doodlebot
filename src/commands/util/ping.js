import { SlashCommandBuilder } from 'discord.js';

export const data = new SlashCommandBuilder()
  .setName('ping')
  .setDescription('Mostra a latência do bot.');

export async function execute(interaction) {
  const sent = await interaction.reply({ content: 'Calculando ping...', fetchReply: true });
  const latency = sent.createdTimestamp - interaction.createdTimestamp;
  const apiLatency = Math.round(interaction.client.ws.ping);
  await interaction.editReply(`🏓 Latência do bot: ${latency}ms | Latência da API: ${apiLatency}ms`);
}
