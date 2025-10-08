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

export function createDashboard(client) {
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

  api.put('/moderation', async (req, res) => {
    try {
      const updated = await saveModerationConfig(req.body ?? {});
      res.json(updated);
    } catch (error) {
      console.error('Failed to save moderation configuration:', error);
      res.status(500).json({ error: 'Could not save moderation configuration.' });
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
