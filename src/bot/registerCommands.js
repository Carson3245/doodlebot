import { REST, Routes } from 'discord.js';

export async function registerCommands({ commands, clientId, guildId, token }) {
  if (!clientId || !guildId) {
    console.warn('Missing CLIENT_ID or GUILD_ID. Slash commands will not be registered automatically.');
    return;
  }

  const rest = new REST({ version: '10' }).setToken(token);
  const body = commands.map((command) => command.data.toJSON());
  const commandNames = commands.map((command) => command.data.name);

  try {
    console.log(`Registering ${body.length} commands in guild ${guildId}...`);
    await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body });
    await pruneUnusedCommands(rest, clientId, { names: commandNames });
    await pruneUnusedCommands(rest, clientId, { guildId, names: commandNames });
    console.log('Commands registered successfully!');
  } catch (error) {
    console.error('Error while registering commands:', error);
  }
}

async function pruneUnusedCommands(rest, clientId, { guildId = null, names = [] }) {
  const keepNames = new Set((names ?? []).map((name) => String(name).toLowerCase()));
  const scopeLabel = guildId ? `guild ${guildId}` : 'global';

  try {
    const listRoute = guildId
      ? Routes.applicationGuildCommands(clientId, guildId)
      : Routes.applicationCommands(clientId);
    const existing = await rest.get(listRoute);

    for (const command of existing ?? []) {
      const commandName = String(command?.name ?? '').toLowerCase();
      if (!keepNames.has(commandName)) {
        if (!command?.id) {
          continue;
        }
        const deleteRoute = guildId
          ? Routes.applicationGuildCommand(clientId, guildId, command.id)
          : Routes.applicationCommand(clientId, command.id);
        await rest.delete(deleteRoute);
        console.log(`Removed unused ${scopeLabel} command ${command?.name ?? command.id}`);
      }
    }
  } catch (error) {
    console.error(`Failed to prune unused ${scopeLabel} commands:`, error);
  }
}
