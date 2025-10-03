import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';

const FALLBACK_RESPONSES = [
  'Interessante! Conte-me mais.',
  'Isso parece algo que vale a pena discutir.',
  '😄 Estou aqui para conversar sempre que precisar.',
  'Vamos pensar nisso juntos!'
];

export const data = new SlashCommandBuilder()
  .setName('chat')
  .setDescription('Converse rapidamente com o bot.')
  .addStringOption((option) =>
    option
      .setName('mensagem')
      .setDescription('O que você gostaria de dizer?')
      .setRequired(true)
  );

export async function execute(interaction) {
  const message = interaction.options.getString('mensagem');
  const response = gerarResposta(message);

  const embed = new EmbedBuilder()
    .setTitle('🤖 Bate-papo do bot')
    .setDescription(response)
    .setFooter({ text: `Você disse: ${message}` })
    .setColor(0x5865f2);

  await interaction.reply({ embeds: [embed] });
}

function gerarResposta(message) {
  const normalized = message.toLowerCase();

  if (normalized.includes('olá') || normalized.includes('oi')) {
    return 'Olá! Como posso ajudar hoje?';
  }

  if (normalized.includes('obrigado') || normalized.includes('valeu')) {
    return 'De nada! Sempre que precisar, estou por aqui.';
  }

  if (normalized.includes('triste') || normalized.includes('chateado')) {
    return 'Sinto muito que esteja passando por isso. Talvez conversar com alguém de confiança ajude. 💛';
  }

  const randomIndex = Math.floor(Math.random() * FALLBACK_RESPONSES.length);
  return FALLBACK_RESPONSES[randomIndex];
}
