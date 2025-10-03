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

  const member = await interaction.guild.members.fetch(target.id).catch(() => null);

  if (!member) {
    await interaction.reply({ content: 'I could not find that member in the server.', ephemeral: true });
    return;
  }

  if (!member.kickable) {
    await interaction.reply({ content: 'I do not have permission to kick that user.', ephemeral: true });
    return;
  }

  await member.kick(reason);
  await interaction.reply(`👢 **${target.tag}** was kicked. Reason: ${reason}`);
}
