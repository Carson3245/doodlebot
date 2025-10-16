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
import { requirePermission, Permissions } from '../auth/rbac.js';
import {
  listPeople,
  createPerson,
  updatePerson,
  upsertPeople,
  markPersonAnnounced,
  markPersonRolesSynced,
  offboardPerson,
  listCheckinsForPerson,
  recordCheckin,
  getPeopleSummary
} from '../people/peopleStore.js';
import { getUserAccessSummary } from './rbacStore.js';
import { getDueCheckins } from '../people/checkinScheduler.js';
import { listAuditEntries, getAuditStats, recordAuditEntry } from '../audit/auditLog.js';
import {
  getEngagementSnapshot,
  getFlowSeries,
  getHeadcountSeries,
  getOverviewKpis
} from './metricsStore.js';
import { generatePeopleCsv, generatePeoplePdf } from './peopleExport.js';
import { generateCaseCsv, generateCasePdf } from './caseExport.js';

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

  app.get('/auth/status', async (req, res) => {
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

    try {
      const access = await getUserAccessSummary(user.id);
      req.session.dashboardRoles = access.roles;
      res.json({
        authenticated: true,
        oauthEnabled,
        user: {
          id: user.id,
          username: user.username,
          discriminator: user.discriminator,
          globalName: user.globalName,
          avatar: user.avatar,
          displayName,
          roles: access.roles,
          permissions: Array.from(access.permissions ?? [])
        }
      });
    } catch (error) {
      console.error('Failed to resolve dashboard access for user:', error);
      res.json({
        authenticated: true,
        oauthEnabled,
        user: {
          id: user.id,
          username: user.username,
          discriminator: user.discriminator,
          globalName: user.globalName,
          avatar: user.avatar,
          displayName,
          roles: [],
          permissions: []
        }
      });
    }
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

  const attachRbac = async (req, _res, next) => {
    const user = req.session?.user;
    if (!user) {
      req.rbac = { userId: null, roles: [], permissions: new Set() };
      next();
      return;
    }

    try {
      const access = await getUserAccessSummary(user.id);
      req.rbac = {
        userId: user.id,
        roles: access.roles ?? [],
        permissions:
          access.permissions instanceof Set
            ? access.permissions
            : new Set(access.permissions ?? [])
      };
      req.session.dashboardRoles = access.roles ?? [];
    } catch (error) {
      console.error('Failed to load RBAC context for dashboard request:', error);
      req.rbac = { userId: user.id, roles: [], permissions: new Set() };
    }
    next();
  };

  const api = express.Router();

  api.get('/metrics/kpis', async (req, res) => {
    try {
      const guildId = sanitizeSnowflake(req.query.guildId);
      const period = typeof req.query.period === 'string' ? req.query.period : '30d';
      const date = parseMetricsDate(req.query.date);

      let memberCount = null;
      if (guildId) {
        const guild = await resolveGuild(client, guildId);
        memberCount = guild?.memberCount ?? null;
      }

      const payload = await getOverviewKpis({
        guildId,
        period,
        date,
        memberCount,
        moderation,
        clientReady: client.isReady()
      });
      res.json(payload);
    } catch (error) {
      console.error('Failed to load overview KPIs:', error);
      res.status(500).json({ error: 'Failed to load overview metrics.' });
    }
  });

  api.get('/metrics/headcount', async (req, res) => {
    try {
      const guildId = sanitizeSnowflake(req.query.guildId);
      const period = typeof req.query.period === 'string' ? req.query.period : '30d';
      const date = parseMetricsDate(req.query.date);

      let memberCount = null;
      if (guildId) {
        const guild = await resolveGuild(client, guildId);
        memberCount = guild?.memberCount ?? null;
      }

      const payload = await getHeadcountSeries({ guildId, period, date, memberCount });
      res.json(payload);
    } catch (error) {
      console.error('Failed to load headcount metrics:', error);
      res.status(500).json({ error: 'Failed to load headcount metrics.' });
    }
  });

  api.get('/metrics/flow', async (req, res) => {
    try {
      const guildId = sanitizeSnowflake(req.query.guildId);
      const period = typeof req.query.period === 'string' ? req.query.period : '30d';
      const date = parseMetricsDate(req.query.date);
      const payload = await getFlowSeries({ guildId, period, date });
      res.json(payload);
    } catch (error) {
      console.error('Failed to load flow metrics:', error);
      res.status(500).json({ error: 'Failed to load entries and exits metrics.' });
    }
  });

  api.get('/metrics/engagement', async (req, res) => {
    try {
      const guildId = sanitizeSnowflake(req.query.guildId);
      const period = typeof req.query.period === 'string' ? req.query.period : '30d';
      const payload = await getEngagementSnapshot({ guildId, period });
      res.json(payload);
    } catch (error) {
      console.error('Failed to load engagement metrics:', error);
      res.status(500).json({ error: 'Failed to load engagement metrics.' });
    }
  });

  api.get('/people/summary', requirePermission(Permissions.VIEW_PEOPLE), async (_req, res) => {
    try {
      const summary = await getPeopleSummary();
      res.json(summary);
    } catch (error) {
      console.error('Failed to load people summary:', error);
      res.status(500).json({ error: 'Failed to load people summary.' });
    }
  });

  api.get('/people', requirePermission(Permissions.VIEW_PEOPLE), async (req, res) => {
    try {
      const result = await listPeople({
        guildId: sanitizeSnowflake(req.query.guildId),
        status: req.query.status,
        search: req.query.search,
        department: req.query.department,
        tag: req.query.tag,
        limit: req.query.limit,
        offset: req.query.offset,
        sortBy: req.query.sortBy,
        direction: req.query.direction
      });
      res.json(result);
    } catch (error) {
      console.error('Failed to list people:', error);
      res.status(500).json({ error: 'Failed to load roster.' });
    }
  });

  api.post('/people', requirePermission(Permissions.MANAGE_PEOPLE), async (req, res) => {
    try {
      const created = await createPerson(req.body ?? {}, buildAuditContext(req));
      res.status(201).json(created);
    } catch (error) {
      console.error('Failed to create person:', error);
      res.status(500).json({ error: error?.message ?? 'Failed to create person.' });
    }
  });

  api.put('/people/:personId', requirePermission(Permissions.MANAGE_PEOPLE), async (req, res) => {
    try {
      const updated = await updatePerson(req.params.personId, req.body ?? {}, buildAuditContext(req));
      res.json(updated);
    } catch (error) {
      console.error('Failed to update person:', error);
      res.status(500).json({ error: error?.message ?? 'Failed to update person.' });
    }
  });

    api.post('/people/import', requirePermission(Permissions.IMPORT_PEOPLE), async (req, res) => {
      try {
        const records = Array.isArray(req.body) ? req.body : Array.isArray(req.body?.records) ? req.body.records : [];
        const result = await upsertPeople(records, buildAuditContext(req));
        res.json(result);
      } catch (error) {
        console.error('Failed to import people:', error);
        res.status(500).json({ error: error?.message ?? 'Failed to import people.' });
      }
    });

    api.get('/people/export', requirePermission(Permissions.VIEW_PEOPLE), async (req, res) => {
      try {
        const format = typeof req.query.format === 'string' ? req.query.format.toLowerCase() : 'csv';
        const filters = {
          guildId: sanitizeSnowflake(req.query.guildId),
          status: req.query.status ?? null,
          department: req.query.department ?? null,
          tag: req.query.tag ?? null,
          search: req.query.search ?? null,
          sortBy: req.query.sortBy ?? 'displayName',
          direction: req.query.direction ?? 'asc'
        };
        const exportLimit = Number.isFinite(Number(req.query.limit)) ? Number(req.query.limit) : null;

        const people = await collectPeopleForExport(filters, exportLimit);
        const nameLookup = new Map(people.map((person) => [person.id, person.displayName]));
        const enriched = people.map((person) => ({
          ...person,
          managerName: person.managerId ? nameLookup.get(person.managerId) ?? null : null
        }));

        const auditContext = buildAuditContext(req);
        await recordAuditEntry({
          action: 'people.export',
          actorId: auditContext.actorId,
          actorTag: auditContext.actorTag,
          actorRoles: auditContext.actorRoles,
          guildId: filters.guildId,
          targetType: 'people',
          targetId: null,
          metadata: {
            format,
            filters: {
              status: filters.status,
              department: filters.department,
              tag: filters.tag,
              search: filters.search
            },
            total: enriched.length
          }
        });

        if (format === 'pdf') {
          const pdfBuffer = await generatePeoplePdf(enriched, {
            title: 'People export',
            generatedAt: new Date()
          });
          res.setHeader('Content-Type', 'application/pdf');
          res.setHeader(
            'Content-Disposition',
            `attachment; filename="people-${filters.guildId ?? 'all'}-${Date.now()}.pdf"`
          );
          res.send(pdfBuffer);
          return;
        }

        const csv = generatePeopleCsv(enriched);
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader(
          'Content-Disposition',
          `attachment; filename="people-${filters.guildId ?? 'all'}-${Date.now()}.csv"`
        );
        res.send(csv);
      } catch (error) {
        console.error('Failed to export people:', error);
        res.status(500).json({ error: 'Failed to export people.' });
      }
    });

  api.post(
    '/people/:personId/actions/announce',
    requirePermission(Permissions.ANNOUNCE_PEOPLE),
    async (req, res) => {
      try {
        const updated = await markPersonAnnounced(req.params.personId, buildAuditContext(req));
        res.json(updated);
      } catch (error) {
        console.error('Failed to mark announcement:', error);
        res.status(500).json({ error: error?.message ?? 'Failed to mark announcement.' });
      }
    }
  );

  api.post(
    '/people/:personId/actions/rolesync',
    requirePermission(Permissions.ROLESYNC),
    async (req, res) => {
      try {
        const updated = await markPersonRolesSynced(req.params.personId, buildAuditContext(req));
        res.json(updated);
      } catch (error) {
        console.error('Failed to sync roles for person:', error);
        res.status(500).json({ error: error?.message ?? 'Failed to sync roles.' });
      }
    }
  );

  api.post(
    '/people/:personId/actions/offboard',
    requirePermission(Permissions.OFFBOARD),
    async (req, res) => {
      try {
        const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : null;
        const updated = await offboardPerson(req.params.personId, { reason }, buildAuditContext(req));
        res.json(updated);
      } catch (error) {
        console.error('Failed to offboard person:', error);
        res.status(500).json({ error: error?.message ?? 'Failed to offboard person.' });
      }
    }
  );

  api.get(
    '/people/:personId/checkins',
    requirePermission(Permissions.VIEW_CHECKINS),
    async (req, res) => {
      try {
        const checkins = await listCheckinsForPerson(req.params.personId);
        res.json({ checkins });
      } catch (error) {
        console.error('Failed to list check-ins:', error);
        res.status(500).json({ error: error?.message ?? 'Failed to load check-ins.' });
      }
    }
  );

  api.post(
    '/people/:personId/checkins/:cadence',
    requirePermission(Permissions.UPDATE_CHECKINS),
    async (req, res) => {
      try {
        const payload = {
          status: req.body?.status,
          notes: req.body?.notes,
          assignedTo: sanitizeSnowflake(req.body?.assignedTo),
          assignedToTag: req.body?.assignedToTag,
          completedAt: req.body?.completedAt
        };
        const updated = await recordCheckin(req.params.personId, req.params.cadence, {
          ...payload,
          actorId: req.session?.user?.id ?? null,
          actorTag: buildUserTag(req.session?.user ?? null)
        });
        res.json({ checkins: updated.checkins, person: updated });
      } catch (error) {
        console.error('Failed to update check-in:', error);
        res.status(500).json({ error: error?.message ?? 'Failed to update check-in.' });
      }
    }
  );

  api.get('/people/checkins/due', requirePermission(Permissions.VIEW_CHECKINS), async (req, res) => {
    try {
      const withinHours = req.query.withinHours ? Number(req.query.withinHours) : 24;
      const includeMissed = String(req.query.includeMissed ?? '').toLowerCase() === 'true';
      const due = await getDueCheckins({ withinHours, includeMissed });
      const results = due.map(({ person, checkin }) => ({
        personId: person.id,
        displayName: person.displayName,
        department: person.department,
        cadence: checkin.cadence,
        status: checkin.status,
        dueAt: checkin.dueAt,
        assignedTo: checkin.assignedTo ?? null,
        assignedToTag: checkin.assignedToTag ?? null
      }));
      res.json({ results });
    } catch (error) {
      console.error('Failed to load due check-ins:', error);
      res.status(500).json({ error: 'Failed to load due check-ins.' });
    }
  });

  api.get('/audit/log', requirePermission(Permissions.VIEW_AUDIT), async (req, res) => {
    try {
      const payload = await listAuditEntries({
        limit: req.query.limit,
        offset: req.query.offset,
        actorId: req.query.actorId,
        targetId: req.query.targetId,
        guildId: req.query.guildId,
        action: req.query.action
      });
      res.json(payload);
    } catch (error) {
      console.error('Failed to load audit log:', error);
      res.status(500).json({ error: 'Failed to load audit log.' });
    }
  });

  api.get('/audit/stats', requirePermission(Permissions.VIEW_AUDIT), async (_req, res) => {
    try {
      const stats = await getAuditStats();
      res.json(stats);
    } catch (error) {
      console.error('Failed to load audit stats:', error);
      res.status(500).json({ error: 'Failed to load audit stats.' });
    }
  });

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
        const category = typeof req.query.category === 'string' ? req.query.category : 'all';
        const assignee = typeof req.query.assignee === 'string' ? req.query.assignee : 'all';
        const search = typeof req.query.search === 'string' ? req.query.search : '';
        const sla = typeof req.query.sla === 'string' ? req.query.sla : 'all';
        const limit = Number.isFinite(Number(req.query.limit)) ? Number(req.query.limit) : 50;
        const offset = Number.isFinite(Number(req.query.offset)) ? Number(req.query.offset) : 0;
        const sortBy = typeof req.query.sortBy === 'string' ? req.query.sortBy : 'updatedAt';
        const direction = typeof req.query.direction === 'string' ? req.query.direction : 'desc';
        const includeArchived = req.query.includeArchived !== 'false';
        const mine = req.query.mine === 'true';
        const result = await moderation.listCasesForGuild(req.params.guildId, {
          status,
          category,
          assignee,
          search,
          sla,
          limit,
          offset,
          sortBy,
          direction,
          includeArchived,
          mine,
          userId: req.session?.user?.id ?? null
        });
        res.json(result);
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

    guildRouter.post('/cases/:caseId/assignee', async (req, res) => {
      if (!moderation) {
        res.status(503).json({ error: 'Moderation engine not ready.' });
        return;
      }

      const moderator = req.session?.user;

      try {
        const updated = await moderation.setCaseAssignee({
          guildId: req.params.guildId,
          caseId: req.params.caseId,
          assigneeId: req.body?.assigneeId ?? req.body?.assignee ?? null,
          assigneeTag: typeof req.body?.assigneeTag === 'string' ? req.body.assigneeTag : null,
          assigneeDisplayName:
            typeof req.body?.assigneeDisplayName === 'string' ? req.body.assigneeDisplayName : null,
          moderatorId: moderator?.id ?? null,
          moderatorTag: moderator ? buildUserTag(moderator) : null
        });
        res.json(updated);
      } catch (error) {
        console.error('Failed to update case assignee:', error);
        res.status(500).json({ error: error?.message ?? 'Failed to update case assignee.' });
      }
    });

    guildRouter.post('/cases/:caseId/sla', async (req, res) => {
      if (!moderation) {
        res.status(503).json({ error: 'Moderation engine not ready.' });
        return;
      }

      const moderator = req.session?.user;

      try {
        const updated = await moderation.setCaseSla({
          guildId: req.params.guildId,
          caseId: req.params.caseId,
          dueAt: req.body?.dueAt ?? req.body?.slaDueAt ?? null,
          moderatorId: moderator?.id ?? null,
          moderatorTag: moderator ? buildUserTag(moderator) : null
        });
        res.json(updated);
      } catch (error) {
        console.error('Failed to update case SLA:', error);
        res.status(500).json({ error: error?.message ?? 'Failed to update case SLA.' });
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
        const auditContext = buildAuditContext(req);
        await recordAuditEntry({
          action: 'commands.update',
          actorId: auditContext.actorId,
          actorTag: auditContext.actorTag,
          actorRoles: auditContext.actorRoles,
          guildId: null,
          targetId: commandName,
          targetType: 'command',
          targetLabel: commandName,
          metadata: saved.commands[commandName] ?? null
        });
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

  const streamCaseEvents = (req, res) => {
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
  };

  api.get('/moderation/events', streamCaseEvents);
  api.get('/cases/events', streamCaseEvents);

  const resolveCaseContext = async (caseId, guildHint = null) => {
    const explicitGuildId = sanitizeSnowflake(guildHint);
    if (explicitGuildId) {
      const caseEntry = await moderation.getCaseDetails(explicitGuildId, caseId);
      return { guildId: caseEntry ? caseEntry.guildId : explicitGuildId, caseEntry };
    }
    const caseEntry = await moderation.getCase(caseId);
    return { guildId: caseEntry?.guildId ?? null, caseEntry };
  };

  api.get('/cases', async (req, res) => {
    if (!moderation) {
      res.status(503).json({ error: 'Moderation engine not ready.' });
      return;
    }
    try {
      const guildId = sanitizeSnowflake(req.query.guildId);
      if (!guildId) {
        res.status(400).json({ error: 'guildId is required.' });
        return;
      }
      const status = typeof req.query.status === 'string' ? req.query.status : 'all';
      const category = typeof req.query.category === 'string' ? req.query.category : 'all';
      const assignee = typeof req.query.assignee === 'string' ? req.query.assignee : 'all';
      const search = typeof req.query.search === 'string' ? req.query.search : '';
      const sla = typeof req.query.sla === 'string' ? req.query.sla : 'all';
      const limit = Number.isFinite(Number(req.query.limit)) ? Number(req.query.limit) : 50;
      const offset = Number.isFinite(Number(req.query.offset)) ? Number(req.query.offset) : 0;
      const sortBy = typeof req.query.sortBy === 'string' ? req.query.sortBy : 'updatedAt';
      const direction = typeof req.query.direction === 'string' ? req.query.direction : 'desc';
      const includeArchived = req.query.includeArchived !== 'false';
      const mine = req.query.mine === 'true';

      const result = await moderation.listCasesForGuild(guildId, {
        status,
        category,
        assignee,
        search,
        sla,
        limit,
        offset,
        sortBy,
        direction,
        includeArchived,
        mine,
        userId: req.session?.user?.id ?? null
      });

      res.json({ ...result, guildId });
    } catch (error) {
      console.error('Failed to load cases:', error);
      res.status(500).json({ error: 'Failed to load cases.' });
    }
  });

  api.get('/cases/export', async (req, res) => {
    if (!moderation) {
      res.status(503).json({ error: 'Moderation engine not ready.' });
      return;
    }
    const guildId = sanitizeSnowflake(req.query.guildId);
    if (!guildId) {
      res.status(400).json({ error: 'guildId is required.' });
      return;
    }

    try {
      const format = typeof req.query.format === 'string' ? req.query.format.toLowerCase() : 'csv';
      const status = typeof req.query.status === 'string' ? req.query.status : 'all';
      const category = typeof req.query.category === 'string' ? req.query.category : 'all';
      const assignee = typeof req.query.assignee === 'string' ? req.query.assignee : 'all';
      const search = typeof req.query.search === 'string' ? req.query.search : '';
      const sla = typeof req.query.sla === 'string' ? req.query.sla : 'all';
      const sortBy = typeof req.query.sortBy === 'string' ? req.query.sortBy : 'updatedAt';
      const direction = typeof req.query.direction === 'string' ? req.query.direction : 'desc';
      const includeArchived = req.query.includeArchived !== 'false';
      const mine = req.query.mine === 'true';
      const exportLimit = Number.isFinite(Number(req.query.limit)) ? Number(req.query.limit) : null;

      const cases = await collectCasesForExport(
        moderation,
        guildId,
        {
          status,
          category,
          assignee,
          search,
          sla,
          sortBy,
          direction,
          includeArchived,
          mine,
          userId: req.session?.user?.id ?? null
        },
        exportLimit
      );

      const auditContext = buildAuditContext(req);
      await recordAuditEntry({
        action: 'cases.export',
        actorId: auditContext.actorId,
        actorTag: auditContext.actorTag,
        actorRoles: auditContext.actorRoles,
        guildId,
        targetType: 'case',
        targetId: null,
        metadata: {
          format,
          filters: { status, category, assignee, search, sla, mine },
          total: cases.length
        }
      });

      if (format === 'pdf') {
        const pdfBuffer = await generateCasePdf(cases, {
          title: `Cases export (${guildId})`,
          generatedAt: new Date()
        });
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader(
          'Content-Disposition',
          `attachment; filename="cases-${guildId}-${Date.now()}.pdf"`
        );
        res.send(pdfBuffer);
        return;
      }

      const csv = generateCaseCsv(cases);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="cases-${guildId}-${Date.now()}.csv"`
      );
      res.send(csv);
    } catch (error) {
      console.error('Failed to export cases:', error);
      res.status(500).json({ error: 'Failed to export cases.' });
    }
  });

  api.get('/cases/:caseId', async (req, res) => {
    if (!moderation) {
      res.status(503).json({ error: 'Moderation engine not ready.' });
      return;
    }
    const caseId = String(req.params.caseId ?? '').trim();
    if (!caseId) {
      res.status(400).json({ error: 'caseId is required.' });
      return;
    }
    try {
      const { caseEntry } = await resolveCaseContext(caseId, req.query.guildId);
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

  api.post('/cases/:caseId/messages', async (req, res) => {
    if (!moderation) {
      res.status(503).json({ error: 'Moderation engine not ready.' });
      return;
    }
    const caseId = String(req.params.caseId ?? '').trim();
    if (!caseId) {
      res.status(400).json({ error: 'caseId is required.' });
      return;
    }

    const moderator = req.session?.user;

    try {
      const { guildId, caseEntry } = await resolveCaseContext(
        caseId,
        req.query.guildId ?? req.body?.guildId
      );
      if (!caseEntry || !guildId) {
        res.status(404).json({ error: 'Case not found.' });
        return;
      }

      const body =
        typeof req.body?.body === 'string'
          ? req.body.body
          : typeof req.body?.content === 'string'
            ? req.body.content
            : '';

      const message = await moderation.postModeratorMessage({
        guildId,
        caseId,
        moderatorId: moderator?.id ?? null,
        moderatorTag: moderator ? buildUserTag(moderator) : null,
        body
      });
      const updatedCase = await moderation.getCaseDetails(guildId, caseId);
      res.json({ message, case: updatedCase ?? caseEntry });
    } catch (error) {
      console.error('Failed to post moderator message:', error);
      res.status(500).json({ error: error?.message ?? 'Failed to send message.' });
    }
  });

  api.post('/cases/:caseId/status', async (req, res) => {
    if (!moderation) {
      res.status(503).json({ error: 'Moderation engine not ready.' });
      return;
    }
    const caseId = String(req.params.caseId ?? '').trim();
    if (!caseId) {
      res.status(400).json({ error: 'caseId is required.' });
      return;
    }

    const moderator = req.session?.user;

    try {
      const { guildId, caseEntry } = await resolveCaseContext(
        caseId,
        req.query.guildId ?? req.body?.guildId
      );
      if (!caseEntry || !guildId) {
        res.status(404).json({ error: 'Case not found.' });
        return;
      }

      const status = typeof req.body?.status === 'string' ? req.body.status : null;
      if (!status) {
        res.status(400).json({ error: 'status is required.' });
        return;
      }

      const updated = await moderation.setCaseStatus({
        guildId,
        caseId,
        status,
        moderatorId: moderator?.id ?? null,
        moderatorTag: moderator ? buildUserTag(moderator) : null,
        note: typeof req.body?.note === 'string' ? req.body.note : null
      });
      res.json(updated);
    } catch (error) {
      console.error('Failed to update case status:', error);
      res.status(500).json({ error: error?.message ?? 'Failed to update case status.' });
    }
  });

  api.post('/cases/:caseId/assignee', async (req, res) => {
    if (!moderation) {
      res.status(503).json({ error: 'Moderation engine not ready.' });
      return;
    }
    const caseId = String(req.params.caseId ?? '').trim();
    if (!caseId) {
      res.status(400).json({ error: 'caseId is required.' });
      return;
    }

    const moderator = req.session?.user;

    try {
      const { guildId, caseEntry } = await resolveCaseContext(
        caseId,
        req.query.guildId ?? req.body?.guildId
      );
      if (!caseEntry || !guildId) {
        res.status(404).json({ error: 'Case not found.' });
        return;
      }

      const updated = await moderation.setCaseAssignee({
        guildId,
        caseId,
        assigneeId: req.body?.assigneeId ?? req.body?.assignee ?? null,
        assigneeTag: typeof req.body?.assigneeTag === 'string' ? req.body.assigneeTag : null,
        assigneeDisplayName:
          typeof req.body?.assigneeDisplayName === 'string' ? req.body.assigneeDisplayName : null,
        moderatorId: moderator?.id ?? null,
        moderatorTag: moderator ? buildUserTag(moderator) : null
      });
      res.json(updated);
    } catch (error) {
      console.error('Failed to update case assignee:', error);
      res.status(500).json({ error: error?.message ?? 'Failed to update case assignee.' });
    }
  });

  api.post('/cases/:caseId/sla', async (req, res) => {
    if (!moderation) {
      res.status(503).json({ error: 'Moderation engine not ready.' });
      return;
    }
    const caseId = String(req.params.caseId ?? '').trim();
    if (!caseId) {
      res.status(400).json({ error: 'caseId is required.' });
      return;
    }

    const moderator = req.session?.user;

    try {
      const { guildId, caseEntry } = await resolveCaseContext(
        caseId,
        req.query.guildId ?? req.body?.guildId
      );
      if (!caseEntry || !guildId) {
        res.status(404).json({ error: 'Case not found.' });
        return;
      }

      const updated = await moderation.setCaseSla({
        guildId,
        caseId,
        dueAt:
          typeof req.body?.dueAt === 'string'
            ? req.body.dueAt
            : typeof req.body?.slaDueAt === 'string'
              ? req.body.slaDueAt
              : null,
        moderatorId: moderator?.id ?? null,
        moderatorTag: moderator ? buildUserTag(moderator) : null
      });
      res.json(updated);
    } catch (error) {
      console.error('Failed to update case SLA:', error);
      res.status(500).json({ error: error?.message ?? 'Failed to update case SLA.' });
    }
  });

  api.delete('/cases/:caseId', async (req, res) => {
    if (!moderation) {
      res.status(503).json({ error: 'Moderation engine not ready.' });
      return;
    }
    const caseId = String(req.params.caseId ?? '').trim();
    if (!caseId) {
      res.status(400).json({ error: 'caseId is required.' });
      return;
    }

    const moderator = req.session?.user;

    try {
      const { guildId, caseEntry } = await resolveCaseContext(
        caseId,
        req.query.guildId ?? req.body?.guildId
      );
      if (!caseEntry || !guildId) {
        res.status(404).json({ error: 'Case not found.' });
        return;
      }

      await moderation.deleteCase({
        guildId,
        caseId,
        moderatorId: moderator?.id ?? null,
        moderatorTag: moderator ? buildUserTag(moderator) : null
      });
      res.json({ success: true });
    } catch (error) {
      console.error('Failed to delete case:', error);
      res.status(500).json({ error: error?.message ?? 'Failed to delete case.' });
    }
  });

  api.post('/cases', async (req, res) => {
    if (!moderation) {
      res.status(503).json({ error: 'Moderation engine not ready.' });
      return;
    }
    const guildId = sanitizeSnowflake(req.body?.guildId ?? req.body?.guild);
    if (!guildId) {
      res.status(400).json({ error: 'guildId is required.' });
      return;
    }

    try {
      const guild = await resolveGuild(client, guildId);
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

  api.post('/quick-actions', async (req, res) => {
    const action = typeof req.body?.action === 'string' ? req.body.action.toLowerCase() : null;
    if (!action) {
      res.status(400).json({ error: 'action is required.' });
      return;
    }

    const guildId = sanitizeSnowflake(req.body?.guildId);
    const period = typeof req.body?.period === 'string' ? req.body.period : '30d';
    const now = new Date();
    const auditContext = buildAuditContext(req);

    try {
      let payload;

      if (action === 'daily-summary') {
        const metrics = await getOverviewKpis({
          guildId,
          period,
          date: now,
          moderation,
          clientReady: client.isReady()
        });
        payload = {
          message: [
            `Active members: ${metrics.active} (${formatSignedDelta(metrics.activeDelta)})`,
            `Net flow: ${formatSignedDelta((metrics.entriesMonth ?? 0) - (metrics.exitsMonth ?? 0))}`,
            `Open cases: ${metrics.openCases} (${formatSignedDelta(metrics.openCasesDelta)})`,
            `Engagement per day: ${metrics.engagementPerDay} (${formatSignedDelta(metrics.engagementDelta)})`
          ].join(' | ')
        };
      } else if (action === 'onboarding-followup') {
        const roster = await listPeople({
          guildId,
          status: 'onboarding',
          limit: 10,
          offset: 0
        });
        const results = Array.isArray(roster?.results) ? roster.results : [];
        const names = results.slice(0, 5).map((entry) => entry.displayName).join(', ');
        payload = {
          message: results.length
            ? `${results.length} onboarding members need follow-up${names ? `: ${names}` : ''}.`
            : 'No onboarding members need follow-up right now.'
        };
      } else if (action === 'case-health') {
        if (!guildId) {
          res.status(400).json({ error: 'guildId is required for this quick action.' });
          return;
        }
        if (!moderation) {
          throw new Error('Moderation engine not ready.');
        }
        const response = await moderation.listCasesForGuild(guildId, {
          status: 'active',
          limit: 25,
          includeArchived: false,
          userId: req.session?.user?.id ?? null
        });
        const items = Array.isArray(response?.items)
          ? response.items
          : Array.isArray(response)
            ? response
            : [];
        const escalated = items.filter((entry) => String(entry.status ?? '').toLowerCase() === 'escalated');
        const overdue = items.filter((entry) => evaluateSlaState(entry.sla, entry.status) === 'overdue');
        payload = {
          message: items.length
            ? `${items.length} active cases (${escalated.length} escalated, ${overdue.length} SLA overdue).`
            : 'No active cases on queue.'
        };
      } else {
        res.status(400).json({ error: 'Unsupported quick action.' });
        return;
      }

      await recordAuditEntry({
        action: `quick.${action}`,
        actorId: auditContext.actorId,
        actorTag: auditContext.actorTag,
        actorRoles: auditContext.actorRoles,
        guildId,
        targetType: 'quick-action',
        targetId: action,
        metadata: {
          period,
          guildId,
          result: payload.message ?? null
        }
      });

      res.json({ success: true, ...payload });
    } catch (error) {
      console.error(`Failed to run quick action (${action}):`, error);
      res.status(500).json({ error: error?.message ?? 'Quick action failed.' });
    }
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
      const category = typeof req.query.category === 'string' ? req.query.category : 'all';
      if (guildId) {
        const result = await moderation.listCasesForGuild(guildId, { status, category, limit });
        const items = Array.isArray(result?.items) ? result.items : Array.isArray(result) ? result : [];
        res.json(items);
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
      } else if (action === 'kick') {
        await moderation.kick({ guildId, userId, moderatorId, moderatorTag, reason });
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

  app.use('/api', requireAuth, attachRbac, api);

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

async function collectPeopleForExport(filters = {}, limit = null) {
  const pageSize = 250;
  const collected = [];
  let offset = 0;

  while (true) {
    const page = await listPeople({ ...filters, limit: pageSize, offset });
    const results = Array.isArray(page?.results) ? page.results : [];
    if (!results.length) {
      break;
    }
    for (const person of results) {
      collected.push(person);
      if (limit && collected.length >= limit) {
        return collected.slice(0, limit);
      }
    }
    offset += results.length;
    const total = page?.total ?? collected.length;
    if (collected.length >= total) {
      break;
    }
    if (results.length < pageSize) {
      break;
    }
  }

  return limit ? collected.slice(0, limit) : collected;
}

async function collectCasesForExport(moderation, guildId, options = {}, limit = null) {
  if (!guildId) {
    return [];
  }
  const pageSize = Math.min(Number(options.limit) || 200, 200);
  const collected = [];
  let offset = 0;

  while (true) {
    const result = await moderation.listCasesForGuild(guildId, {
      ...options,
      limit: pageSize,
      offset
    });
    const items = Array.isArray(result?.items) ? result.items : [];
    if (!items.length) {
      break;
    }
    for (const entry of items) {
      collected.push(entry);
      if (limit && collected.length >= limit) {
        return collected.slice(0, limit);
      }
    }
    offset += items.length;
    const total = result?.total ?? collected.length;
    if (collected.length >= total) {
      break;
    }
    if (items.length < pageSize) {
      break;
    }
  }

  return limit ? collected.slice(0, limit) : collected;
}

function parseMetricsDate(value) {
  if (typeof value === 'string' && value.trim()) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }
  return new Date();
}

function formatSignedDelta(value) {
  const number = Number(value) || 0;
  if (number === 0) {
    return '0';
  }
  return number > 0 ? `+${number}` : String(number);
}

function evaluateSlaState(sla, status) {
  if (!sla || !sla.dueAt) {
    return 'none';
  }
  if (sla.completedAt) {
    return 'met';
  }
  const normalizedStatus = typeof status === 'string' ? status.toLowerCase() : null;
  if (normalizedStatus === 'closed' || normalizedStatus === 'archived') {
    return 'met';
  }
  const due = Date.parse(sla.dueAt);
  if (!Number.isFinite(due)) {
    return 'none';
  }
  const now = Date.now();
  if (due < now) {
    return 'overdue';
  }
  const hours = (due - now) / (1000 * 60 * 60);
  if (hours <= 24) {
    return 'due-soon';
  }
  return 'pending';
}

function buildAuditContext(req) {
  const user = req.session?.user ?? null;
  const roles = req.rbac?.roles ?? [];
  return {
    actorId: user?.id ?? null,
    actorTag: user ? buildUserTag(user) : null,
    actorRoles: roles
  };
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
