import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import express from 'express';
import session from 'express-session';
import cors from 'cors';
import morgan from 'morgan';
import { loadStyle, saveStyle } from '../config/styleStore.js';
import { getBrainSummary } from '../brain/brainStore.js';
import { loadCommandConfig, saveCommandConfig } from '../config/commandStore.js';
import { loadModerationConfig, saveModerationConfig } from '../config/moderationStore.js';
import { onModerationStoreEvent } from '../moderation/caseStore.js';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const legacyPublicDir = path.join(__dirname, 'public');
const clientDistDir = path.join(__dirname, 'client', 'dist');

function resolveRedirectUri() {
  const explicit = process.env.DASHBOARD_REDIRECT_URI;
  if (explicit) {
    return explicit;
  }
  const port = process.env.DASHBOARD_PORT ?? 3000;
  return `http://localhost:${port}/auth/callback`;
}

const oauthConfig = {
  clientId: process.env.DASHBOARD_CLIENT_ID ?? process.env.CLIENT_ID ?? '',
  clientSecret: process.env.DASHBOARD_CLIENT_SECRET ?? '',
  redirectUri: resolveRedirectUri()
};

const sessionSecret = process.env.DASHBOARD_SESSION_SECRET;
const sessionSecretValue = sessionSecret || crypto.randomBytes(32).toString('hex');

if (!sessionSecret) {
  console.warn(
    'DASHBOARD_SESSION_SECRET is not set. Using an ephemeral secret; restart will invalidate dashboard sessions.'
  );
}

const oauthEnabled = Boolean(oauthConfig.clientId && oauthConfig.clientSecret && oauthConfig.redirectUri);

const defaultCommandCategories = new Map(
  Object.entries({
    ban: 'Moderation',
    kick: 'Moderation',
    timeout: 'Moderation',
    warn: 'Moderation',
    ping: 'Utility'
  })
);

function inferCategory(name) {
  const normalized = String(name || '').toLowerCase();
  if (defaultCommandCategories.has(normalized)) {
    return defaultCommandCategories.get(normalized);
  }
  if (normalized.includes('ban') || normalized.includes('kick') || normalized.includes('warn')) {
    return 'Moderation';
  }
  if (normalized.includes('ping') || normalized.includes('info')) {
    return 'Utility';
  }
  return 'General';
}

export function createDashboard(client, moderation) {
  const app = express();

  app.use(cors());
  app.use(express.json());
  app.use(
    session({
      secret: sessionSecretValue,
      resave: false,
      saveUninitialized: false,
      cookie: {
        secure: process.env.NODE_ENV === 'production',
        httpOnly: true,
        sameSite: 'lax',
        maxAge: 1000 * 60 * 60 * 2 // 2 hours
      }
    })
  );
  app.use(morgan('dev'));

  app.get('/auth/status', (req, res) => {
    const user = req.session?.user;
    if (!user) {
      res.json({ authenticated: false, oauthEnabled });
      return;
    }
    const displayName =
      user.globalName ||
      (user.discriminator && user.discriminator !== '0'
        ? `${user.username}#${user.discriminator}`
        : user.username);

    res.json({
      authenticated: true,
      oauthEnabled,
      user: {
        id: user.id,
        username: user.username,
        discriminator: user.discriminator,
        globalName: user.globalName,
        avatar: user.avatar,
        displayName
      }
    });
  });

  app.get('/auth/login', (req, res) => {
    if (!oauthEnabled) {
      res.status(500).send('Discord OAuth2 is not configured.');
      return;
    }

    const state = crypto.randomBytes(24).toString('hex');
    req.session.oauthState = state;

    const params = new URLSearchParams({
      client_id: oauthConfig.clientId,
      response_type: 'code',
      scope: 'identify',
      redirect_uri: oauthConfig.redirectUri,
      state
    });

    req.session.save((error) => {
      if (error) {
        console.error('Failed to persist OAuth state:', error);
        res.redirect('/?auth=failed');
        return;
      }
      res.redirect(`https://discord.com/api/oauth2/authorize?${params.toString()}`);
    });
  });

  app.get('/auth/callback', async (req, res) => {
    if (!oauthEnabled) {
      res.redirect('/?auth=failed');
      return;
    }

    const { code, state, error } = req.query;

    if (error || !code || !state || state !== req.session?.oauthState) {
      res.redirect('/?auth=failed');
      return;
    }

    try {
      const tokenResponse = await fetch('https://discord.com/api/oauth2/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams({
          client_id: oauthConfig.clientId,
          client_secret: oauthConfig.clientSecret,
          grant_type: 'authorization_code',
          code: String(code),
          redirect_uri: oauthConfig.redirectUri
        })
      });

      if (!tokenResponse.ok) {
        throw new Error(`Token exchange failed with status ${tokenResponse.status}`);
      }

      const tokenData = await tokenResponse.json();
      const tokenType = tokenData.token_type ?? 'Bearer';

      const userResponse = await fetch('https://discord.com/api/users/@me', {
        headers: {
          Authorization: `${tokenType} ${tokenData.access_token}`
        }
      });

      if (!userResponse.ok) {
        throw new Error(`Failed to fetch user profile. Status ${userResponse.status}`);
      }

      const userData = await userResponse.json();

      req.session.oauthState = undefined;
      req.session.user = {
        id: userData.id,
        username: userData.username,
        discriminator: userData.discriminator,
        globalName: userData.global_name,
        avatar: userData.avatar
      };

      req.session.save((saveError) => {
        if (saveError) {
          console.error('Failed to establish session after login:', saveError);
          res.redirect('/?auth=failed');
          return;
        }

        res.redirect('/');
      });
    } catch (authError) {
      console.error('Discord OAuth callback failed:', authError);
      req.session.user = undefined;
      res.redirect('/?auth=failed');
    }
  });

  app.post('/auth/logout', (req, res) => {
    if (!req.session) {
      res.json({ success: true });
      return;
    }

    req.session.destroy((error) => {
      if (error) {
        console.error('Failed to destroy session:', error);
        res.status(500).json({ error: 'Could not log out.' });
        return;
      }
      res.clearCookie('connect.sid', {
        path: '/',
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production'
      });
      res.json({ success: true });
    });
  });

  const requireAuth = (req, res, next) => {
    if (req.session?.user) {
      next();
      return;
    }
    res.status(401).json({ error: 'Unauthorized' });
  };

  const api = express.Router();

  api.get('/status', (_req, res) => {
    const isReady = client.isReady();
    const guilds = isReady
      ? client.guilds.cache.map((guild) => ({
          id: guild.id,
          name: guild.name,
          icon: guild.icon,
          memberCount: guild.memberCount ?? null,
          description: guild.description ?? null
        }))
      : [];
    res.json({
      status: isReady ? 'online' : 'offline',
      username: isReady ? client.user.tag : null,
      uptime: isReady ? client.uptime : 0,
      guilds
    });
  });

  api.get('/guilds', async (_req, res) => {
    if (!client.isReady()) {
      res.json({ guilds: [] });
      return;
    }

    const guilds = await Promise.all(
      client.guilds.cache.map(async (guild) => {
        if (!guild.available) {
          guild = await client.guilds.fetch(guild.id).catch(() => null);
        }
        return guild ? serializeGuildSummary(guild) : null;
      })
    );

    res.json({ guilds: guilds.filter(Boolean) });
  });

  api.get('/guilds/:guildId', async (req, res) => {
    try {
      const guild = await resolveGuild(client, req.params.guildId);
      if (!guild) {
        res.status(404).json({ error: 'Guild not found.' });
        return;
      }
      res.json(serializeGuildSummary(guild));
    } catch (error) {
      console.error('Failed to load guild:', error);
      res.status(500).json({ error: 'Failed to load guild details.' });
    }
  });

  const guildRouter = express.Router({ mergeParams: true });
  api.use('/guilds/:guildId', guildRouter);

  guildRouter.get('/members', async (req, res) => {
    try {
      const guild = await resolveGuild(client, req.params.guildId);
      if (!guild) {
        res.status(404).json({ error: 'Guild not found.' });
        return;
      }

      const query = String(req.query.query ?? '').trim();
      if (!query || query.length < 2) {
        res.json([]);
        return;
      }

      const limit = Math.min(Math.max(Number(req.query.limit) || 25, 1), 50);
      const results =
        guild.members?.search
          ? await guild.members.search({ query, limit })
          : await guild.members.fetch({ query, limit });

      const members = Array.from(results.values()).map((member) => ({
        id: member.id,
        displayName: member.displayName,
        username: member.user?.username ?? null,
        tag: member.user?.tag ?? null,
        avatar: member.displayAvatarURL({ size: 64, extension: 'png' })
      }));

      res.json(members);
    } catch (error) {
      console.error('Failed to search guild members:', error);
      res.status(500).json({ error: 'Failed to search members.' });
    }
  });

  guildRouter.get('/cases', async (req, res) => {
    if (!moderation) {
      res.status(503).json({ error: 'Moderation engine not ready.' });
      return;
    }
    try {
      const status = typeof req.query.status === 'string' ? req.query.status : 'all';
      const limit = req.query.limit ? Number(req.query.limit) : 50;
      const cases = await moderation.listCasesForGuild(req.params.guildId, { status, limit });
      res.json(cases);
    } catch (error) {
      console.error('Failed to list cases:', error);
      res.status(500).json({ error: 'Failed to list cases.' });
    }
  });

  guildRouter.get('/cases/:caseId', async (req, res) => {
    if (!moderation) {
      res.status(503).json({ error: 'Moderation engine not ready.' });
      return;
    }
    try {
      const caseEntry = await moderation.getCaseDetails(req.params.guildId, req.params.caseId);
      if (!caseEntry) {
        res.status(404).json({ error: 'Case not found.' });
        return;
      }
      res.json(caseEntry);
    } catch (error) {
      console.error('Failed to load case:', error);
      res.status(500).json({ error: 'Failed to load case.' });
    }
  });

  guildRouter.post('/cases/:caseId/messages', async (req, res) => {
    if (!moderation) {
      res.status(503).json({ error: 'Moderation engine not ready.' });
      return;
    }

    const moderator = req.session?.user;
    const moderatorId = moderator?.id ?? null;
    const moderatorTag = moderator ? buildUserTag(moderator) : null;

    try {
      const message = await moderation.postModeratorMessage({
        guildId: req.params.guildId,
        caseId: req.params.caseId,
        moderatorId,
        moderatorTag,
        body: req.body?.body ?? req.body?.content ?? ''
      });
      const caseEntry = await moderation.getCaseDetails(req.params.guildId, req.params.caseId);
      res.json({ message, case: caseEntry });
    } catch (error) {
      console.error('Failed to post moderator message:', error);
      res.status(500).json({ error: error?.message ?? 'Failed to send message.' });
    }
  });

  guildRouter.post('/cases/:caseId/status', async (req, res) => {
    if (!moderation) {
      res.status(503).json({ error: 'Moderation engine not ready.' });
      return;
    }

    const moderator = req.session?.user;

    try {
      const updated = await moderation.setCaseStatus({
        guildId: req.params.guildId,
        caseId: req.params.caseId,
        status: String(req.body?.status ?? 'open'),
        moderatorId: moderator?.id ?? null,
        moderatorTag: moderator ? buildUserTag(moderator) : null,
        note: req.body?.note ?? null
      });
      res.json(updated);
    } catch (error) {
      console.error('Failed to update case status:', error);
      res.status(500).json({ error: error?.message ?? 'Failed to update case status.' });
    }
  });

  guildRouter.delete('/cases/:caseId', async (req, res) => {
    if (!moderation) {
      res.status(503).json({ error: 'Moderation engine not ready.' });
      return;
    }

    const moderator = req.session?.user;

    try {
      await moderation.deleteCase({
        guildId: req.params.guildId,
        caseId: req.params.caseId,
        moderatorId: moderator?.id ?? null,
        moderatorTag: moderator ? buildUserTag(moderator) : null
      });
      res.json({ success: true });
    } catch (error) {
      console.error('Failed to delete moderation case:', error);
      res.status(500).json({ error: error?.message ?? 'Failed to delete case.' });
    }
  });

  guildRouter.post('/cases', async (req, res) => {
    if (!moderation) {
      res.status(503).json({ error: 'Moderation engine not ready.' });
      return;
    }

    try {
      const guild = await resolveGuild(client, req.params.guildId);
      if (!guild) {
        res.status(404).json({ error: 'Guild not found.' });
        return;
      }

      const userId = sanitizeSnowflake(req.body?.userId ?? req.body?.user);
      if (!userId) {
        res.status(400).json({ error: 'userId is required.' });
        return;
      }

      const member = await guild.members.fetch(userId).catch(() => null);
      if (!member) {
        res.status(404).json({ error: 'Member not found in this guild.' });
        return;
      }

      const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : null;
      const message = typeof req.body?.message === 'string' ? req.body.message.trim() : null;

      const caseEntry = await moderation.openMemberCase({
        guild,
        member,
        reason,
        initialMessage: message
      });

      res.json(caseEntry);
    } catch (error) {
      console.error('Failed to create manual case:', error);
      res.status(500).json({ error: 'Failed to create case.' });
    }
  });

  api.get('/commands', async (_req, res) => {
    try {
      const config = await loadCommandConfig();
      const commands = [...client.commands.values()].map((command) => {
        const key = command.data.name;
        const stored = config.commands[key] ?? {};
        return {
          name: key,
          description: command.data.description,
          cooldown: command.cooldown ?? 3,
          customCooldown: stored.cooldown ?? null,
          enabled: stored.enabled !== undefined ? stored.enabled : true,
          category: stored.category ?? inferCategory(key),
          notes: stored.notes ?? null,
          usage: stored.usage ?? 0
        };
      });

      res.json(commands);
    } catch (error) {
      console.error('Failed to load commands with configuration:', error);
      res.status(500).json({ error: 'Could not load command configuration.' });
    }
  });

  api.put('/commands/:name', async (req, res) => {
    const commandName = String(req.params.name || '').toLowerCase();
    if (!client.commands.has(commandName)) {
      res.status(404).json({ error: 'Command not found.' });
      return;
    }

    try {
      const current = await loadCommandConfig();
      const existing = current.commands[commandName] ?? {};
      const updated = {
        commands: {
          ...current.commands,
          [commandName]: {
            enabled:
              req.body?.enabled !== undefined
                ? Boolean(req.body.enabled)
                : existing.enabled !== undefined
                  ? existing.enabled
                  : true,
            cooldown:
              req.body?.customCooldown !== undefined && req.body.customCooldown !== null && req.body.customCooldown !== ''
                ? Number(req.body.customCooldown)
                : existing.cooldown ?? null,
            category:
              typeof req.body?.category === 'string' && req.body.category.trim().length
                ? req.body.category.trim()
                : existing.category ?? inferCategory(commandName),
            notes:
              typeof req.body?.notes === 'string' && req.body.notes.trim().length ? req.body.notes.trim() : existing.notes ?? null,
            usage: existing.usage ?? 0
          }
        }
      };

      const saved = await saveCommandConfig(updated);
      res.json(saved.commands[commandName]);
    } catch (error) {
      console.error('Failed to update command configuration:', error);
      res.status(500).json({ error: 'Could not update command configuration.' });
    }
  });

  api.get('/style', async (_req, res) => {
    try {
      const style = await loadStyle();
      res.json(style);
    } catch (error) {
      console.error('Failed to load style configuration via API:', error);
      res.status(500).json({ error: 'Could not load style configuration.' });
    }
  });

  api.put('/style', async (req, res) => {
    try {
      const updated = await saveStyle(req.body ?? {});
      res.json(updated);
    } catch (error) {
      console.error('Failed to save style configuration:', error);
      res.status(500).json({ error: 'Could not save style configuration.' });
    }
  });

  api.get('/brain', async (_req, res) => {
    try {
      const summary = await getBrainSummary();
      res.json(summary);
    } catch (error) {
      console.error('Failed to load brain summary:', error);
      res.status(500).json({ error: 'Could not load brain data.' });
    }
  });

  api.get('/moderation', async (_req, res) => {
    try {
      const config = await loadModerationConfig();
      res.json(config);
    } catch (error) {
      console.error('Failed to load moderation configuration:', error);
      res.status(500).json({ error: 'Could not load moderation configuration.' });
    }
  });

  api.get('/moderation/stats', async (_req, res) => {
    try {
      const stats = moderation ? await moderation.getStats() : null;
      res.json(
        stats || {
          updatedAt: null,
          warnings: 0,
          timeouts: 0,
          bans: 0,
          cases: 0
        }
      );
    } catch (error) {
      console.error('Failed to load moderation stats:', error);
      res.status(500).json({ error: 'Could not load moderation stats.' });
    }
  });

  api.get('/moderation/events', (req, res) => {
    if (!moderation) {
      res.status(503).json({ error: 'Moderation engine not ready.' });
      return;
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    if (typeof res.flushHeaders === 'function') {
      res.flushHeaders();
    }

    const writeEvent = (event) => {
      if (!event) {
        return;
      }
      try {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      } catch (error) {
        console.error('Failed to stream moderation event:', error);
      }
    };

    const initialEnvelope = {
      type: 'connected',
      payload: { source: 'moderation-events' },
      timestamp: new Date().toISOString()
    };
    writeEvent(initialEnvelope);

    const unsubscribe = onModerationStoreEvent((event) => {
      writeEvent(event);
    });

    const heartbeat = setInterval(() => {
      res.write(':heartbeat\n\n');
    }, 30000);

    req.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
    });

    moderation
      .getStats()
      .then((stats) => {
        writeEvent({ type: 'stats:updated', payload: stats, timestamp: new Date().toISOString() });
      })
      .catch((error) => {
        console.error('Failed to send initial stats snapshot:', error);
      });
  });

  api.get('/moderation/cases', async (req, res) => {
    if (!moderation) {
      res.status(503).json({ error: 'Moderation engine not ready.' });
      return;
    }
    try {
      const guildId = sanitizeSnowflake(req.query.guildId);
      const limit = req.query.limit ? Number(req.query.limit) : 50;
      const status = typeof req.query.status === 'string' ? req.query.status : 'all';
      if (guildId) {
        const cases = await moderation.listCasesForGuild(guildId, { status, limit });
        res.json(cases);
      } else {
        const cases = await moderation.getRecentCases(limit);
        res.json(cases);
      }
    } catch (error) {
      console.error('Failed to load moderation cases:', error);
      res.status(500).json({ error: 'Could not load moderation cases.' });
    }
  });

  api.get('/moderation/cases/:caseId', async (req, res) => {
    if (!moderation) {
      res.status(503).json({ error: 'Moderation engine not ready.' });
      return;
    }

    try {
      const caseEntry = await moderation.getCase(req.params.caseId);
      if (!caseEntry) {
        res.status(404).json({ error: 'Case not found.' });
        return;
      }

      const details = await moderation.getCaseDetails(caseEntry.guildId, caseEntry.id);
      if (!details) {
        res.status(404).json({ error: 'Case not found.' });
        return;
      }

      res.json(details);
    } catch (error) {
      console.error('Failed to load moderation case:', error);
      res.status(500).json({ error: 'Could not load moderation case.' });
    }
  });

  api.post('/moderation/cases/:caseId/messages', async (req, res) => {
    if (!moderation) {
      res.status(503).json({ error: 'Moderation engine not ready.' });
      return;
    }

    const moderator = req.session?.user;

    try {
      const caseEntry = await moderation.getCase(req.params.caseId);
      if (!caseEntry) {
        res.status(404).json({ error: 'Case not found.' });
        return;
      }

      const message = await moderation.postModeratorMessage({
        guildId: caseEntry.guildId,
        caseId: caseEntry.id,
        moderatorId: moderator?.id ?? null,
        moderatorTag: moderator ? buildUserTag(moderator) : null,
        body: req.body?.body ?? req.body?.content ?? ''
      });

      const details = await moderation.getCaseDetails(caseEntry.guildId, caseEntry.id);
      res.json({ message, case: details });
    } catch (error) {
      console.error('Failed to post moderator message:', error);
      res.status(500).json({ error: error?.message ?? 'Failed to send message.' });
    }
  });

  api.post('/moderation/cases/:caseId/status', async (req, res) => {
    if (!moderation) {
      res.status(503).json({ error: 'Moderation engine not ready.' });
      return;
    }

    const moderator = req.session?.user;

    try {
      const caseEntry = await moderation.getCase(req.params.caseId);
      if (!caseEntry) {
        res.status(404).json({ error: 'Case not found.' });
        return;
      }

      const updated = await moderation.setCaseStatus({
        guildId: caseEntry.guildId,
        caseId: caseEntry.id,
        status: String(req.body?.status ?? 'open'),
        moderatorId: moderator?.id ?? null,
        moderatorTag: moderator ? buildUserTag(moderator) : null,
        note: req.body?.note ?? null
      });

      res.json(updated);
    } catch (error) {
      console.error('Failed to update case status:', error);
      res.status(500).json({ error: error?.message ?? 'Failed to update case status.' });
    }
  });

  api.delete('/moderation/cases/:caseId', async (req, res) => {
    if (!moderation) {
      res.status(503).json({ error: 'Moderation engine not ready.' });
      return;
    }

    const moderator = req.session?.user;

    try {
      const caseEntry = await moderation.getCase(req.params.caseId);
      if (!caseEntry) {
        res.status(404).json({ error: 'Case not found.' });
        return;
      }

      await moderation.deleteCase({
        guildId: caseEntry.guildId,
        caseId: caseEntry.id,
        moderatorId: moderator?.id ?? null,
        moderatorTag: moderator ? buildUserTag(moderator) : null
      });

      res.json({ success: true });
    } catch (error) {
      console.error('Failed to delete moderation case:', error);
      res.status(500).json({ error: error?.message ?? 'Failed to delete case.' });
    }
  });

  api.put('/moderation', async (req, res) => {
    try {
      const updated = await saveModerationConfig(req.body ?? {});
      res.json(updated);
    } catch (error) {
      console.error('Failed to save moderation configuration:', error);
      res.status(500).json({ error: 'Could not save moderation configuration.' });
    }
  });

  api.post('/moderation/actions/:action', async (req, res) => {
    const action = String(req.params.action || '').toLowerCase();
    if (!moderation) {
      res.status(503).json({ error: 'Moderation engine not ready.' });
      return;
    }

    const payload = req.body ?? {};
    const guildId = sanitizeSnowflake(payload.guildId);
    const userId = sanitizeSnowflake(payload.userId ?? payload.user);
    const reason =
      typeof payload.reason === 'string' && payload.reason.trim().length ? payload.reason.trim() : 'No reason provided.';
    const duration = payload.durationMinutes ?? payload.duration;
    const durationMinutes =
      duration === undefined || duration === null || duration === ''
        ? null
        : Math.min(Math.max(Number(duration), 1), 10_080);

    if (!guildId || !userId) {
      res.status(400).json({ error: 'guildId and userId are required.' });
      return;
    }

    const moderator = req.session?.user;
    const moderatorId = moderator?.id ?? null;
    const moderatorTag = moderator ? buildUserTag(moderator) : null;
    const caseId = typeof payload.caseId === 'string' ? payload.caseId.trim() : null;

    try {
      if (action === 'warn') {
        await moderation.warn({ guildId, userId, moderatorId, moderatorTag, reason });
      } else if (action === 'timeout') {
        if (!durationMinutes) {
          res.status(400).json({ error: 'durationMinutes is required for timeout actions.' });
          return;
        }
        await moderation.timeout({ guildId, userId, moderatorId, moderatorTag, reason, durationMinutes });
      } else if (action === 'ban') {
        await moderation.ban({ guildId, userId, moderatorId, moderatorTag, reason });
      } else {
        res.status(400).json({ error: 'Unsupported moderation action.' });
        return;
      }

      const stats = await moderation.getStats();
      const caseEntry = caseId ? await moderation.getCaseDetails(guildId, caseId) : null;
      res.json({ success: true, stats, case: caseEntry });
    } catch (error) {
      console.error(`Failed to execute moderation action (${action}):`, error);
      res.status(500).json({ error: error?.message ?? 'Unable to execute moderation action.' });
    }
  });

  api.post('/send-message', async (req, res) => {
    const { channelId, message } = req.body;

    if (!channelId || !message) {
      res.status(400).json({ error: 'channelId and message are required.' });
      return;
    }

    try {
      const channel = await client.channels.fetch(channelId);
      if (!channel || !channel.isTextBased()) {
        res.status(400).json({ error: 'Invalid or non-text channel.' });
        return;
      }

      await channel.send(message);
      res.json({ success: true });
    } catch (error) {
      console.error('Failed to send message via dashboard:', error);
      res.status(500).json({ error: 'Failed to send the message. Check the server logs.' });
    }
  });

  app.use('/api', requireAuth, api);

  if (fs.existsSync(clientDistDir)) {
    app.use(express.static(clientDistDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(clientDistDir, 'index.html'));
    });
  } else {
    app.use(express.static(legacyPublicDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(legacyPublicDir, 'index.html'));
    });
  }

  return app;
}

function sanitizeSnowflake(input) {
  if (input === null || input === undefined) {
    return null;
  }
  const stripped = String(input).trim().replace(/[<@#!&>]/g, '');
  if (!/^\d{5,}$/.test(stripped)) {
    return null;
  }
  return stripped;
}

async function resolveGuild(client, guildId) {
  if (!guildId) {
    return null;
  }
  const cached = client.guilds.cache.get(guildId);
  if (cached) {
    return cached.available ? cached : await client.guilds.fetch(guildId).catch(() => null);
  }
  return client.guilds.fetch(guildId).catch(() => null);
}

function serializeGuildSummary(guild) {
  return {
    id: guild.id,
    name: guild.name,
    icon: guild.icon,
    memberCount: guild.memberCount ?? null,
    description: guild.description ?? null,
    ownerId: guild.ownerId ?? null
  };
}

function buildUserTag(user) {
  if (!user) {
    return null;
  }
  if (user.tag) {
    return user.tag;
  }
  if (user.username) {
    return user.discriminator && user.discriminator !== '0'
      ? `${user.username}#${user.discriminator}`
      : user.username;
  }
  return null;
}
