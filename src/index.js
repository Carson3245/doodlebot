import 'dotenv/config';
import { Collection, Events } from 'discord.js';
import { createClient } from './bot/client.js';
import { loadCommands } from './bot/loadCommands.js';
import { registerCommands } from './bot/registerCommands.js';
import { createDashboard } from './dashboard/server.js';

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.CLIENT_ID;
const guildId = process.env.GUILD_ID;
const dashboardPort = process.env.DASHBOARD_PORT ?? 3000;
const prefix = process.env.BOT_PREFIX ?? '!';

if (!token) {
  console.error('Defina DISCORD_TOKEN no arquivo .env antes de iniciar o bot.');
  process.exit(1);
}

const client = createClient();

async function bootstrap() {
  const commands = await loadCommands();

  commands.forEach((command) => {
    client.commands.set(command.data.name, command);
  });

  await registerCommands({ commands, clientId, guildId, token });

  client.once(Events.ClientReady, (readyClient) => {
    console.log(`🤖 Bot conectado como ${readyClient.user.tag}`);
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand()) {
      return;
    }

    const command = client.commands.get(interaction.commandName);
    if (!command) {
      await interaction.reply({ content: 'Comando não encontrado.', ephemeral: true });
      return;
    }

    const cooldown = aplicarCooldown(interaction, command);
    if (!cooldown.allowed) {
      await interaction.reply({ content: cooldown.message, ephemeral: true });
      return;
    }

    try {
      await command.execute(interaction);
    } catch (error) {
      console.error(error);
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply('Ocorreu um erro ao executar este comando.');
      } else {
        await interaction.reply({ content: 'Ocorreu um erro ao executar este comando.', ephemeral: true });
      }
    }
  });

  client.on(Events.MessageCreate, async (message) => {
    if (message.author.bot || !message.content.startsWith(prefix)) {
      return;
    }

    const content = message.content.slice(prefix.length).trim().toLowerCase();

    if (!content.length) {
      return;
    }

    if (content.startsWith('ajuda')) {
      await message.reply(
        'Use os comandos `/ban`, `/kick` e `/chat` ou explore o painel web para mais ações.'
      );
      return;
    }

    if (content.startsWith('oi') || content.startsWith('ola') || content.startsWith('olá')) {
      await message.reply('Olá! Use `/chat` para conversar comigo.');
      return;
    }

    await message.reply('Não reconheço esse comando. Use `!ajuda` para ver as opções.');
  });

  const app = createDashboard(client);
  app.listen(dashboardPort, () => {
    console.log(`🌐 Painel disponível em http://localhost:${dashboardPort}`);
  });

  await client.login(token);
}

function aplicarCooldown(interaction, command) {
  const now = Date.now();
  const cooldownAmount = (command.cooldown ?? 3) * 1000;

  if (!client.cooldowns.has(command.data.name)) {
    client.cooldowns.set(command.data.name, new Collection());
  }

  const timestamps = client.cooldowns.get(command.data.name);
  const expirationTime = timestamps.get(interaction.user.id) ?? 0;

  if (now < expirationTime) {
    const timeLeft = Math.round((expirationTime - now) / 1000);
    return {
      allowed: false,
      message: `Espere ${timeLeft}s antes de usar este comando novamente.`
    };
  }

  timestamps.set(interaction.user.id, now + cooldownAmount);
  setTimeout(() => timestamps.delete(interaction.user.id), cooldownAmount);

  return { allowed: true };
}

bootstrap().catch((error) => {
  console.error('Erro ao inicializar o bot:', error);
  process.exit(1);
});
