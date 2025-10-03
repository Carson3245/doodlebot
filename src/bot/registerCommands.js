import { REST, Routes } from 'discord.js';

export async function registerCommands({ commands, clientId, guildId, token }) {
  if (!clientId || !guildId) {
    console.warn('CLIENT_ID ou GUILD_ID ausentes. Os comandos slash não serão registrados automaticamente.');
    return;
  }

  const rest = new REST({ version: '10' }).setToken(token);
  const body = commands.map((command) => command.data.toJSON());

  try {
    console.log(`Registrando ${body.length} comandos no servidor ${guildId}...`);
    await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body });
    console.log('Comandos registrados com sucesso!');
  } catch (error) {
    console.error('Erro ao registrar comandos:', error);
  }
}
