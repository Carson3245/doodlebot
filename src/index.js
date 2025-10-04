import 'dotenv/config';
import { Collection, Events } from 'discord.js';
import { createClient } from './bot/client.js';
import { loadCommands } from './bot/loadCommands.js';
import { registerCommands } from './bot/registerCommands.js';
import { createDashboard } from './dashboard/server.js';
import { personalityStore } from './config/personalityStore.js';
import { createChatReply } from './chat/responder.js';

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.CLIENT_ID;
const guildId = process.env.GUILD_ID;
const dashboardPort = process.env.DASHBOARD_PORT ?? 3000;
const prefix = process.env.BOT_PREFIX ?? '!';
const conversationTimeoutMs = Number(process.env.CONVERSATION_TIMEOUT_MS ?? 2 * 60 * 1000);

const activeConversations = new Map();
const MAX_HISTORY_LENGTH = 12;

if (!token) {
  console.error('Set DISCORD_TOKEN in the .env file before starting the bot.');
  process.exit(1);
}

const client = createClient();

async function bootstrap() {
  await personalityStore.load();

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
    const personality = personalityStore.get();
    const history = session?.history ? [...session.history] : [];

    const channelContext = await collectChannelContext({
      message,
      botId: botUser.id,
      activeUserId: message.author.id
    });

    let replyText;
    try {
      replyText = await createChatReply({
        message: textForResponse,
        personality,
        history,
        authorName: message.author.username,
        botName: botUser.username,
        guildName: message.guild?.name,
        channelContext
      });
    } catch (error) {
      console.error('createChatReply failed 9001', error);
      await message.reply('Chat processing error 9001');
      return;
    }

    if (!replyText) {
      return;
    }

    await message.reply(replyText);
    const updatedHistory = history
      .concat({ role: 'user', content: textForResponse })
      .concat({ role: 'assistant', content: replyText });
    startConversation(message.author.id, message.channelId, updatedHistory);
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

function startConversation(userId, channelId, history = []) {
  const existing = activeConversations.get(userId);
  if (existing?.timeout) {
    clearTimeout(existing.timeout);
  }

  const timeout = setTimeout(() => {
    activeConversations.delete(userId);
  }, conversationTimeoutMs);

  activeConversations.set(userId, {
    channelId,
    timeout,
    history: trimHistory(history)
  });
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

async function collectChannelContext({ message, botId, activeUserId }) {
  try {
    if (!message.channel?.messages?.fetch) {
      return [];
    }
    const fetched = await message.channel.messages.fetch({ limit: 25, before: message.id });
    const sorted = Array.from(fetched.values()).sort(
      (a, b) => (a.createdTimestamp ?? 0) - (b.createdTimestamp ?? 0)
    );

    const contextLines = [];

    for (const entry of sorted) {
      if (entry.author.bot || entry.system) {
        continue;
      }

      const sanitized = sanitizeMessage(entry.content ?? '', botId);
      if (!sanitized) {
        continue;
      }

      const truncated = sanitized.length > 240 ? `${sanitized.slice(0, 237)}...` : sanitized;

      const speaker = entry.author.id === activeUserId ? 'You' : entry.author.username;
      contextLines.push(`${speaker}: ${truncated}`);
      if (contextLines.length > 8) {
        contextLines.shift();
      }
    }

    return contextLines;
  } catch (error) {
    console.error('Failed to collect channel context 9002', error);
    return [];
  }
}

function trimHistory(history) {
  if (!Array.isArray(history) || history.length === 0) {
    return [];
  }

  if (history.length <= MAX_HISTORY_LENGTH) {
    return history;
  }

  return history.slice(-MAX_HISTORY_LENGTH);
}

bootstrap().catch((error) => {
  console.error('Error while initializing the bot:', error);
  process.exit(1);
});
