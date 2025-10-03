import { REST, Routes } from 'discord.js';

export async function registerCommands({ commands, clientId, guildId, token }) {
  if (!clientId || !guildId) {
    console.warn('Missing CLIENT_ID or GUILD_ID. Slash commands will not be registered automatically.');
    return;
  }

  const rest = new REST({ version: '10' }).setToken(token);
  const body = commands.map((command) => command.data.toJSON());

  try {
    console.log(`Registering ${body.length} commands in guild ${guildId}...`);
    await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body });
    console.log('Commands registered successfully!');
  } catch (error) {
    console.error('Error while registering commands:', error);
  }
}
