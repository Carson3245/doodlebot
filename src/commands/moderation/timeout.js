import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';

export const data = new SlashCommandBuilder()
  .setName('timeout')
  .setDescription('Temporarily mute a member and log the action in the moderation system.')
  .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
  .addUserOption((option) =>
    option
      .setName('target')
      .setDescription('Member to timeout')
      .setRequired(true)
  )
  .addIntegerOption((option) =>
    option
      .setName('duration')
      .setDescription('Duration in minutes (1 to 10080)')
      .setRequired(true)
      .setMinValue(1)
      .setMaxValue(10_080)
  )
  .addStringOption((option) =>
    option
      .setName('reason')
      .setDescription('Reason for the timeout')
      .setMaxLength(512)
  );

export async function execute(interaction) {
  const target = interaction.options.getUser('target');
  const duration = interaction.options.getInteger('duration');
  const reason = interaction.options.getString('reason') ?? 'No reason provided';

  if (!interaction.guild) {
    await interaction.reply({ content: 'This command can only be used in servers.', ephemeral: true });
    return;
  }

  if (!duration || Number.isNaN(duration)) {
    await interaction.reply({ content: 'Provide a valid timeout duration in minutes.', ephemeral: true });
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
    await moderation.timeout({
      guildId: interaction.guild.id,
      userId: target.id,
      moderatorId: interaction.user.id,
      moderatorTag: interaction.user.tag,
      reason,
      durationMinutes: duration
    });

    await interaction.reply({
      content: `⏳ Timed out **${target.tag}** for ${duration} minute(s). Reason: ${reason}`,
      allowedMentions: { parse: [] }
    });
  } catch (error) {
    console.error('Failed to timeout member via moderation engine:', error);
    await interaction.reply({
      content: error?.message || 'I could not timeout that member.',
      ephemeral: true
    });
  }
}
