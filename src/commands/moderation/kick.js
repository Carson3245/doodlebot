import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';

export const data = new SlashCommandBuilder()
  .setName('kick')
  .setDescription('Kick a member from the server.')
  .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers)
  .addUserOption((option) =>
    option
      .setName('target')
      .setDescription('User to kick')
      .setRequired(true)
  )
  .addStringOption((option) =>
    option
      .setName('reason')
      .setDescription('Reason for the kick')
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
  const member = await interaction.guild.members.fetch(target.id).catch(() => null);

  if (!member) {
    await interaction.reply({ content: 'I could not find that member in the server.', ephemeral: true });
    return;
  }

  if (!member.kickable) {
    await interaction.reply({ content: 'I do not have permission to kick that user.', ephemeral: true });
    return;
  }

  if (moderation) {
    try {
      await moderation.kick({
        guildId: interaction.guild.id,
        userId: target.id,
        moderatorId: interaction.user.id,
        moderatorTag: interaction.user.tag,
        reason
      });
      await interaction.reply({
        content: `👢 Kicked **${target.tag}**. Reason: ${reason}`,
        allowedMentions: { parse: [] }
      });
      return;
    } catch (error) {
      console.error('Failed to kick member via moderation engine:', error);
      await interaction.reply({
        content: error?.message || 'I could not kick that member.',
        ephemeral: true
      });
      return;
    }
  }

  await member.kick(reason);
  await interaction.reply({
    content: `👢 Kicked **${target.tag}**. Reason: ${reason}`,
    allowedMentions: { parse: [] }
  });
}
