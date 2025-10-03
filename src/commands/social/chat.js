import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';

const FALLBACK_RESPONSES = [
  'Interesting! Tell me more.',
  'That sounds like something worth talking about.',
  '😄 I am here to chat whenever you need.',
  "Let's think about it together!"
];

export const data = new SlashCommandBuilder()
  .setName('chat')
  .setDescription('Have a quick conversation with the bot.')
  .addStringOption((option) =>
    option
      .setName('message')
      .setDescription('What would you like to say?')
      .setRequired(true)
  );

export async function execute(interaction) {
  const message = interaction.options.getString('message');
  const response = generateResponse(message);

  const embed = new EmbedBuilder()
    .setTitle('🤖 Bot chat')
    .setDescription(response)
    .setFooter({ text: `You said: ${message}` })
    .setColor(0x5865f2);

  await interaction.reply({ embeds: [embed] });
}

function generateResponse(message) {
  const normalized = message.toLowerCase();

  if (normalized.includes('hello') || normalized.includes('hi')) {
    return 'Hello! How can I help today?';
  }

  if (normalized.includes('thank')) {
    return 'You are welcome! I am here whenever you need me.';
  }

  if (normalized.includes('sad') || normalized.includes('upset')) {
    return 'I am sorry you are going through that. Maybe talking to someone you trust could help. 💛';
  }

  const randomIndex = Math.floor(Math.random() * FALLBACK_RESPONSES.length);
  return FALLBACK_RESPONSES[randomIndex];
}
