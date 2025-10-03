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

  const member = await interaction.guild.members.fetch(target.id).catch(() => null);

  if (!member) {
    await interaction.reply({ content: 'I could not find that member in the server.', ephemeral: true });
    return;
  }

  if (!member.bannable) {
    await interaction.reply({ content: 'I do not have permission to ban that user.', ephemeral: true });
    return;
  }

  await member.ban({ reason });
  await interaction.reply(`**${target.tag}** was banned. Reason: ${reason}`);
}
