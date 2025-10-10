import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';

export const data = new SlashCommandBuilder()
  .setName('warn')
  .setDescription('Issue a formal warning and log it in the moderation case system.')
  .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
  .addUserOption((option) =>
    option
      .setName('target')
      .setDescription('Member to warn')
      .setRequired(true)
  )
  .addStringOption((option) =>
    option
      .setName('reason')
      .setDescription('Reason for the warning')
      .setMaxLength(512)
  );

export async function execute(interaction) {
  const target = interaction.options.getUser('target');
  const reason = interaction.options.getString('reason') ?? 'No reason provided';

  if (!interaction.guild) {
    await interaction.reply({ content: 'This command can only be used in servers.', ephemeral: true });
    return;
  }

  const moderation = interaction.client?.moderation;
  if (!moderation) {
    await interaction.reply({ content: 'The moderation engine is not ready yet. Try again shortly.', ephemeral: true });
    return;
  }

  const member = await interaction.guild.members.fetch(target.id).catch(() => null);
  if (!member) {
    await interaction.reply({ content: 'I could not find that member in the server.', ephemeral: true });
    return;
  }

  try {
    await moderation.warn({
      guildId: interaction.guild.id,
      userId: target.id,
      moderatorId: interaction.user.id,
      moderatorTag: interaction.user.tag,
      reason
    });

    await interaction.reply({
      content: `⚠️ Warned **${target.tag}**. Reason: ${reason}`,
      allowedMentions: { parse: [] }
    });
  } catch (error) {
    console.error('Failed to warn member via moderation engine:', error);
    await interaction.reply({
      content: error?.message || 'I could not issue that warning.',
      ephemeral: true
    });
  }
}
