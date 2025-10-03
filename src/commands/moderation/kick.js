import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';

export const data = new SlashCommandBuilder()
  .setName('kick')
  .setDescription('Expulsa um membro do servidor.')
  .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers)
  .addUserOption((option) =>
    option
      .setName('alvo')
      .setDescription('Usuário a ser expulso')
      .setRequired(true)
  )
  .addStringOption((option) =>
    option
      .setName('motivo')
      .setDescription('Motivo da expulsão')
      .setMaxLength(512)
  );

export async function execute(interaction) {
  const target = interaction.options.getUser('alvo');
  const reason = interaction.options.getString('motivo') ?? 'Sem motivo informado';

  if (!interaction.guild) {
    await interaction.reply({ content: 'Este comando só pode ser usado em servidores.', ephemeral: true });
    return;
  }

  const member = await interaction.guild.members.fetch(target.id).catch(() => null);

  if (!member) {
    await interaction.reply({ content: 'Não consegui encontrar esse membro no servidor.', ephemeral: true });
    return;
  }

  if (!member.kickable) {
    await interaction.reply({ content: 'Não tenho permissão para expulsar esse usuário.', ephemeral: true });
    return;
  }

  await member.kick(reason);
  await interaction.reply(`👢 **${target.tag}** foi expulso. Motivo: ${reason}`);
}
