import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';

export const data = new SlashCommandBuilder()
  .setName('ban')
  .setDescription('Ban a member from the server.')
  .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
  .addUserOption((option) =>
    option
      .setName('target')
      .setDescription('User to ban')
      .setRequired(true)
  )
  .addStringOption((option) =>
    option
      .setName('reason')
      .setDescription('Reason for the ban')
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

  if (member && !member.bannable) {
    await interaction.reply({ content: 'I do not have permission to ban that user.', ephemeral: true });
    return;
  }

  if (moderation) {
    try {
      await moderation.ban({
        guildId: interaction.guild.id,
        userId: target.id,
        moderatorId: interaction.user.id,
        moderatorTag: interaction.user.tag,
        reason
      });
      await interaction.reply({
        content: `🔨 Banned **${target.tag}**. Reason: ${reason}`,
        allowedMentions: { parse: [] }
      });
      return;
    } catch (error) {
      console.error('Failed to ban member via moderation engine:', error);
      await interaction.reply({
        content: error?.message || 'I could not ban that member.',
        ephemeral: true
      });
      return;
    }
  }

  if (!member) {
    await interaction.reply({ content: 'I could not find that member in the server.', ephemeral: true });
    return;
  }

  await member.ban({ reason });
  await interaction.reply({
    content: `🔨 Banned **${target.tag}**. Reason: ${reason}`,
    allowedMentions: { parse: [] }
  });
}
