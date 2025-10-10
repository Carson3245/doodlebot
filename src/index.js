import 'dotenv/config';
import { Collection, Events } from 'discord.js';
import { createClient } from './bot/client.js';
import { loadCommands } from './bot/loadCommands.js';
import { registerCommands } from './bot/registerCommands.js';
import { createDashboard } from './dashboard/server.js';
import { createChatReply } from './chat/responder.js';
import { recordInteraction } from './brain/brainStore.js';
import { getStyleSync, loadStyle } from './config/styleStore.js';
import { getCommandSettings, incrementCommandUsage, loadCommandConfig } from './config/commandStore.js';
import { ModerationEngine } from './moderation/moderationEngine.js';

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
const moderation = new ModerationEngine(client);
client.moderation = moderation;

async function bootstrap() {
  await loadStyle();
  await loadCommandConfig();
  await moderation.init();
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

    const settings = getCommandSettings(command.data.name);
    if (settings.enabled === false) {
      await interaction.reply({ content: 'This command is currently disabled by an administrator.', ephemeral: true });
      return;
    }

    const cooldownSeconds = settings.cooldown ?? command.cooldown ?? 3;
    const cooldown = applyCooldown(interaction, command, cooldownSeconds);
    if (!cooldown.allowed) {
      await interaction.reply({ content: cooldown.message, ephemeral: true });
      return;
    }

    try {
      await command.execute(interaction);
      incrementCommandUsage(command.data.name).catch((error) => {
        console.error('Failed to track command usage:', error);
      });
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

    if (!message.guild) {
      try {
        const attachments = Array.from(message.attachments?.values?.() ?? []);
        const routed = await moderation.routeMemberDirectMessage({
          user: message.author,
          body: content,
          attachments,
        });
        if (routed) {
          return;
        }
      } catch (error) {
        console.error('Failed to route member DM reply:', error);
      }
    }

    if (content.startsWith(prefix)) {
      const trimmed = content.slice(prefix.length).trim().toLowerCase();

      if (!trimmed.length) {
        return;
      }

      if (trimmed.startsWith('support')) {
        if (!message.guild) {
          await message.reply('Please run this command inside the server so I can reach the moderation team.');
          return;
        }

        const request = content.slice(prefix.length + 'support'.length).trim();
        try {
          const member = message.member ?? (await message.guild.members.fetch(message.author.id).catch(() => null));
          if (!member) {
            await message.reply('I could not verify your membership in this server.');
            return;
          }

          await moderation.postMemberMessage({
            guild: message.guild,
            member,
            body: request || 'Member requested support.'
          });

          await message.reply('Thanks! I passed your request to the moderation team—they will reply here privately soon.');
        } catch (error) {
          console.error('Failed to forward support request:', error);
          await message.reply('I could not forward that request just now. Please try again or ping a moderator.');
        }
        return;
      }

      if (trimmed.startsWith('help')) {
        await message.reply('Use the `/ban` and `/kick` commands or open the web dashboard for more actions.');
        return;
      }

      if (trimmed.startsWith('hi') || trimmed.startsWith('hello')) {
        await message.reply('Hello! I\'m standing by to help with moderation commands.');
        return;
      }

      await message.reply('I do not recognize that command. Use `!help` to see the options.');
      return;
    }

    try {
      const moderationResult = await moderation.handleMessage(message);
      if (moderationResult?.actionTaken) {
        return;
      }
    } catch (error) {
      console.error('Automod failed to process message:', error);
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

    const authorDisplayName = resolveDisplayName(message.author, message.member);
    const botDisplayName = resolveDisplayName(botUser, message.guild?.members?.me);

    const sanitized = sanitizeMessage(content, botUser.id);
    if (!sanitized) {
      await message.reply('Please share a message when you mention me. ChatInputEmpty 1001');
      return;
    }

    const styleSnapshot = getStyleSync();
    if (!styleSnapshot.features?.chatReplies) {
      if (session) {
        endConversation(message.author.id);
      }
      if (mentionedBot) {
        await message.reply(
          'Minhas respostas automáticas estão desligadas no momento. Use `/tune feature toggle` para reativar.'
        );
      }
      return;
    }

    if (styleSnapshot.features?.brainTracking) {
      recordInteraction({
        userId: message.author.id,
        displayName: authorDisplayName,
        message: sanitized
      }).catch((error) => {
        console.error('Failed to record interaction:', error);
      });
    }

    const previousHistory = session?.history ?? [];
    const trimmedHistory = trimHistory(previousHistory);

    let replyText = '';
    try {
      const channelContext = await collectChannelContext({
        message,
        botId: botUser.id,
        activeUserId: message.author.id,
        activeUserName: authorDisplayName
      });

      replyText = await createChatReply({
        message: sanitized,
        history: trimmedHistory,
        authorName: authorDisplayName,
        botName: botDisplayName,
        guildName: message.guild?.name,
        channelContext
      });
    } catch (error) {
      console.error('createChatReply failed 9001', error);
      const errorMessage = error?.message || '';
      // See README.md "Troubleshooting chat replies" for fixes mapped to these error codes.
      if (errorMessage.includes('DreamGenApiKeyMissing 5001') || errorMessage.includes('DreamGenUnauthorized 5008')) {
        await message.reply('DreamGen API is not available. Ask an admin to verify the `DREAMGEN_API_KEY` environment variable.');
        return;
      }

      if (errorMessage.includes('DreamGenModelNotFound 5010')) {
        const model = error?.model || process.env.DREAMGEN_MODEL || 'lucid-v1-medium';
        await message.reply(
          `DreamGen model \`${model}\` is unavailable. Ask an admin to confirm your subscription includes it or update \`DREAMGEN_MODEL\`.`
        );
        return;
      }

      if (errorMessage.includes('DreamGenForbidden 5009')) {
        await message.reply('DreamGen denied the request. Check that your subscription tier includes API access to the selected model.');
        return;
      }

      if (errorMessage.includes('DreamGenRateLimited 5011')) {
        await message.reply('DreamGen is rate limiting us right now. Please wait a moment and try again.');
        return;
      }

      if (errorMessage.includes('DreamGenServerError 5012')) {
        await message.reply('DreamGen is having issues responding right now. Please try again shortly.');
        return;
      }

      if (errorMessage.includes('ChatProvidersNotConfigured 5201')) {
        await message.reply('No chat providers are configured. Ask an admin to set the `CHAT_PROVIDERS` env variable.');
        return;
      }

      if (errorMessage.includes('AllChatProvidersFailed 5202')) {
        await message.reply('All chat providers failed to respond. Please try again shortly.');
        return;
      }

      await message.reply('I had trouble responding just now. Try again in a moment. Chat processing error 9001');
      return;
    }

    try {
      await message.reply(replyText);
    } catch (error) {
      console.error('Failed to send chat reply 9003', error);
      return;
    }

    const updatedHistory = trimmedHistory
      .concat({ role: 'user', content: sanitized, name: authorDisplayName })
      .concat({ role: 'assistant', content: replyText, name: botDisplayName });

    startConversation(message.author.id, message.channelId, updatedHistory);
  });

  const app = createDashboard(client, moderation);
  app.listen(dashboardPort, () => {
    console.log(`Dashboard available at http://localhost:${dashboardPort}`);
  });

  await client.login(token);
}

function applyCooldown(interaction, command, cooldownSeconds) {
  const now = Date.now();
  const cooldownAmount = (cooldownSeconds ?? 3) * 1000;

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
  if (existing?.timeoutId) {
    clearTimeout(existing.timeoutId);
  }

  const timeoutId = setTimeout(() => {
    activeConversations.delete(userId);
  }, conversationTimeoutMs);

  activeConversations.set(userId, {
    history,
    channelId,
    timeoutId
  });
}

function endConversation(userId) {
  const existing = activeConversations.get(userId);
  if (existing?.timeoutId) {
    clearTimeout(existing.timeoutId);
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

async function collectChannelContext({ message, botId, activeUserId, activeUserName }) {
  try {
    if (!message.channel?.messages?.fetch) {
      return [];
    }
    const fetched = await message.channel.messages.fetch({ limit: 20, before: message.id });
    const sorted = Array.from(fetched.values()).sort(
      (a, b) => (a.createdTimestamp ?? 0) - (b.createdTimestamp ?? 0)
    );

    const contextLines = [];
    let lastNormalized = '';

    for (const entry of sorted) {
      if (entry.author.bot || entry.system) {
        continue;
      }

      const sanitized = sanitizeMessage(entry.content ?? '', botId);
      if (!sanitized) {
        continue;
      }

      const speaker =
        entry.author.id === activeUserId
          ? activeUserName || resolveDisplayName(entry.author, entry.member)
          : resolveDisplayName(entry.author, entry.member);

      const line = `${speaker}: ${truncateLine(sanitized, 220)}`;
      const normalized = line.replace(/\s+/g, ' ').toLowerCase();
      if (normalized === lastNormalized) {
        continue;
      }

      contextLines.push(line);
      lastNormalized = normalized;

      if (contextLines.length >= 6) {
        break;
      }
    }

    return contextLines;
  } catch (error) {
    console.error('Failed to collect channel context 9002', error);
    return [];
  }
}

function truncateLine(text, maxLength) {
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength - 3)}...`;
}

function trimHistory(history) {
  if (!Array.isArray(history) || history.length === 0) {
    return [];
  }

  const recent = history.slice(-MAX_HISTORY_LENGTH * 2);
  const cleaned = [];
  let lastKey = '';

  for (const entry of recent) {
    if (!entry || !entry.content) {
      continue;
    }

    const content = String(entry.content).trim();
    if (!content) {
      continue;
    }

    const normalized = `${entry.role}:${content.replace(/\s+/g, ' ').toLowerCase()}`;
    if (normalized === lastKey) {
      continue;
    }

    cleaned.push({
      ...entry,
      content
    });
    lastKey = normalized;
  }

  if (cleaned.length <= MAX_HISTORY_LENGTH) {
    return cleaned;
  }

  return cleaned.slice(-MAX_HISTORY_LENGTH);
}

function resolveDisplayName(user, member) {
  if (!user) {
    return 'Member';
  }

  if (member?.nickname) {
    return member.nickname;
  }

  if (member?.displayName) {
    return member.displayName;
  }

  if (user.globalName) {
    return user.globalName;
  }

  if (user.username) {
    return user.username;
  }

  return user.tag ?? 'Member';
}

bootstrap().catch((error) => {
  console.error('Error while initializing the bot:', error);
  process.exit(1);
});
