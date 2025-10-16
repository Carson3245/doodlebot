import { EmbedBuilder, SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';

const TERMINAL_STATUSES = new Set(['closed', 'archived']);

export const data = new SlashCommandBuilder()
  .setName('cases')
  .setDescription('Show moderation case totals for a member.')
  .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
  .addUserOption((option) =>
    option
      .setName('target')
      .setDescription('Member to inspect')
      .setRequired(false)
  );

export async function execute(interaction) {
  const target = interaction.options.getUser('target') ?? interaction.user;

  if (!interaction.guild) {
    await interaction.reply({ content: 'This command can only be used in servers.', ephemeral: true });
    return;
  }

  const moderation = interaction.client?.moderation;
  if (!moderation) {
    await interaction.reply({ content: 'The moderation engine is not ready yet. Try again shortly.', ephemeral: true });
    return;
  }

  try {
    const totals = await moderation.getUserTotals(interaction.guild.id, target.id);
    const response = await moderation.listCasesForGuild(interaction.guild.id, { status: 'all', limit: 50 });
    const cases = Array.isArray(response?.items) ? response.items : Array.isArray(response) ? response : [];
    const matchingCases = cases.filter((entry) => entry.userId === target.id);
    const activeCases = matchingCases.filter(
      (entry) => !TERMINAL_STATUSES.has(String(entry.status ?? 'open').toLowerCase())
    );

    const embed = new EmbedBuilder()
      .setTitle(`Moderation summary for ${target.tag}`)
      .setColor(0x4f86f7)
      .addFields(
        { name: 'Warnings', value: String(totals.warnings ?? 0), inline: true },
        { name: 'Timeouts', value: String(totals.timeouts ?? 0), inline: true },
        { name: 'Kicks', value: String(totals.kicks ?? 0), inline: true },
        { name: 'Bans', value: String(totals.bans ?? 0), inline: true },
        { name: 'Cases on record', value: String(totals.cases ?? matchingCases.length), inline: true }
      );

    const lastAction = totals.lastActionAt ? new Date(totals.lastActionAt) : null;
    embed.addFields({
      name: 'Last action',
      value: lastAction ? `<t:${Math.floor(lastAction.getTime() / 1000)}:R>` : 'No actions recorded yet.',
      inline: false
    });

    const activeSummary = activeCases.slice(0, 3).map((entry) => {
      const openedAt = entry.createdAt ? `<t:${Math.floor(new Date(entry.createdAt).getTime() / 1000)}:R>` : 'unknown time';
      const status = String(entry.status ?? 'open').toLowerCase();
      const subject = entry.subject ?? entry.reason ?? 'No subject';
      return `• Case \`${entry.id}\` (${status}) — ${subject} • opened ${openedAt}`;
    });

    embed.addFields({
      name: 'Active cases',
      value: activeSummary.length ? activeSummary.join('\n') : 'No active cases for this member.',
      inline: false
    });

    await interaction.reply({ embeds: [embed], allowedMentions: { parse: [] } });
  } catch (error) {
    console.error('Failed to load moderation summary:', error);
    await interaction.reply({
      content: error?.message || 'I could not load the case history for that member.',
      ephemeral: true
    });
  }
}

