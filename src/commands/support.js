import { SlashCommandBuilder } from 'discord.js'
import { startSupportSession } from '../support/supportWorkflow.js'

export const data = new SlashCommandBuilder()
  .setName('support')
  .setDescription('Open a support ticket or moderation case with the staff team.')
  .setDMPermission(true)

export async function execute(interaction) {
  try {
    await startSupportSession(interaction)
  } catch (error) {
    console.error('Failed to start support session:', error)
    const response = {
      content: 'I could not start a support session right now. Please try again later.',
      ephemeral: interaction.inGuild()
    }
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp(response)
    } else {
      await interaction.reply(response)
    }
  }
}
