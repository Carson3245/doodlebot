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
const conversationTimeoutMs = Number(process.env.CONVERSATION_TIMEOUT_MS ?? 2 * 60 * 1000);

const activeConversations = new Map();

if (!token) {
  console.error('Set DISCORD_TOKEN in the .env file before starting the bot.');
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
    console.log(`Bot connected as ${readyClient.user.tag}`);
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand()) {
      return;
    }

    const command = client.commands.get(interaction.commandName);
    if (!command) {
      await interaction.reply({ content: 'Command not found.', ephemeral: true });
      return;
    }

    const cooldown = applyCooldown(interaction, command);
    if (!cooldown.allowed) {
      await interaction.reply({ content: cooldown.message, ephemeral: true });
      return;
    }

    try {
      await command.execute(interaction);
    } catch (error) {
      console.error(error);
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply('Something went wrong while running this command.');
      } else {
        await interaction.reply({ content: 'Something went wrong while running this command.', ephemeral: true });
      }
    }
  });

  client.on(Events.MessageCreate, async (message) => {
    if (message.author.bot) {
      return;
    }

    const content = message.content ?? '';

    if (content.startsWith(prefix)) {
      const trimmed = content.slice(prefix.length).trim().toLowerCase();

      if (!trimmed.length) {
        return;
      }

      if (trimmed.startsWith('help')) {
        await message.reply('Use the `/ban` and `/kick` commands or open the web dashboard for more actions.');
        return;
      }

      if (trimmed.startsWith('hi') || trimmed.startsWith('hello')) {
        await message.reply('Hello! Mention me in a channel to start a conversation.');
        return;
      }

      await message.reply('I do not recognize that command. Use `!help` to see the options.');
      return;
    }

    const botUser = client.user;
    if (!botUser) {
      return;
    }

    const session = activeConversations.get(message.author.id);
    const sameChannel = session?.channelId === message.channelId;
    const mentionedBot = message.mentions.has(botUser);

    if (!mentionedBot && !sameChannel) {
      return;
    }

    const mentionsOtherUsers = message.mentions.users.some((user) => user.id !== botUser.id);
    const repliedUser = message.mentions.repliedUser;
    const replyingToOtherUser = Boolean(repliedUser && repliedUser.id !== botUser.id);

    if (!mentionedBot) {
      if (!session || !sameChannel) {
        return;
      }

      if (mentionsOtherUsers || replyingToOtherUser) {
        endConversation(message.author.id);
        return;
      }
    }

    const textForResponse = sanitizeMessage(content, botUser.id);
    const replyText = generateChatResponse(textForResponse);

    if (!replyText) {
      return;
    }

    await message.reply(replyText);
    startConversation(message.author.id, message.channelId);
  });

  const app = createDashboard(client);
  app.listen(dashboardPort, () => {
    console.log(`Dashboard available at http://localhost:${dashboardPort}`);
  });

  await client.login(token);
}

function applyCooldown(interaction, command) {
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
      message: `Wait ${timeLeft}s before using this command again.`
    };
  }

  timestamps.set(interaction.user.id, now + cooldownAmount);
  setTimeout(() => timestamps.delete(interaction.user.id), cooldownAmount);

  return { allowed: true };
}

function startConversation(userId, channelId) {
  const existing = activeConversations.get(userId);
  if (existing?.timeout) {
    clearTimeout(existing.timeout);
  }

  const timeout = setTimeout(() => {
    activeConversations.delete(userId);
  }, conversationTimeoutMs);

  activeConversations.set(userId, { channelId, timeout });
}

function endConversation(userId) {
  const existing = activeConversations.get(userId);
  if (existing?.timeout) {
    clearTimeout(existing.timeout);
  }
  activeConversations.delete(userId);
}

function sanitizeMessage(content, botId) {
  if (!content) {
    return '';
  }

  const mentionPattern = new RegExp(`<@!?${botId}>`, 'g');
  return content.replace(mentionPattern, '').trim();
}

function generateChatResponse(message) {
  const normalized = message.toLowerCase();

  if (!normalized.length) {
    return 'How can I help?';
  }

  if (normalized.includes('hello') || normalized.includes('hi')) {
    return 'Hello! What would you like to talk about?';
  }

  if (normalized.includes('thank')) {
    return 'You are welcome! Let me know if you need anything else.';
  }

  if (normalized.includes('sad') || normalized.includes('upset')) {
    return 'I am sorry you are going through that. Maybe talking to someone you trust could help.';
  }

  const fallbackResponses = [
    'Interesting. Tell me more about that.',
    'That sounds like something worth exploring.',
    'I am here to chat whenever you need me.',
    'Let us think about it together.'
  ];

  const randomIndex = Math.floor(Math.random() * fallbackResponses.length);
  return fallbackResponses[randomIndex];
}

bootstrap().catch((error) => {
  console.error('Error while initializing the bot:', error);
  process.exit(1);
});
