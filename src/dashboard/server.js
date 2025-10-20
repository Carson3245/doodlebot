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
  getPeopleSummary,
  scheduleCheckin,
  getOnboardingChecklist,
  getPerson
} from '../people/peopleStore.js';
import { getDueCheckins } from '../people/checkinScheduler.js';
import { listAuditEntries, getAuditStats, recordAuditEntry } from '../audit/auditLog.js';
import {
  getEngagementSnapshot,
  getFlowSeries,
  getHeadcountSeries,
  getOverviewKpis
} from './metricsStore.js';
import { startAlertsEngine, listGuildAlerts, resolveAlertById, listActiveAlerts, evaluateAlertsForGuild } from './alertsService.js';
import {
  buildOverviewSummary,
  buildHeadcountSeries as buildHeadcountSeriesData,
  buildFlowSeries as buildFlowSeriesData,
  buildEngagementSnapshot as buildEngagementSnapshotData,
  buildAlerts as buildAlertsData,
  buildPeopleCounters,
  loadPeople,
  loadCases
} from './analytics/overviewMetrics.js';
import { buildOverviewSnapshot } from './overviewService.js';
import { resolveDashboardAccess } from './accessResolver.js';
import { callDreamGen } from '../chat/providers/dreamgen.js';
import { recordModerationAction } from '../moderation/moderationActionsStore.js';
import { getGuildAssignments, setGuildAssignments } from '../ops/rbacAssignmentsStore.js';
import { getVerificationConfig, setVerificationConfig } from '../ops/verificationConfigStore.js';
import { listVerifications, updateVerificationState } from '../ops/verificationStore.js';
import { listModerationActions } from '../moderation/moderationActionsStore.js';
import {
  getTelemetrySettings,
  setTelemetryEnabled,
  getCommandTelemetry
} from './telemetryStore.js';
import { generatePeopleCsv, generatePeoplePdf } from './peopleExport.js';
import { generateCaseCsv, generateCasePdf } from './caseExport.js';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const clientDistDir = path.join(__dirname, 'client', 'dist');
let clientBuildVerified = false;

function ensureClientBuild() {
  if (clientBuildVerified) {
    return;
  }
  if (!fs.existsSync(clientDistDir)) {
    const message = [
      'Dashboard client build not found.',
      `Expected bundle at ${clientDistDir}.`,
      'Run `npm run dashboard:build` to generate the latest assets before starting the server.'
    ].join(' ');
    const error = new Error(message);
    error.code = 'DASHBOARD_CLIENT_BUILD_MISSING';
    throw error;
  }
  clientBuildVerified = true;
}

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
  ensureClientBuild();
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
      const requestedGuildId =
        sanitizeSnowflake(req.query.guild_id ?? req.query.guildId) ??
        req.session?.dashboardGuildId ??
        process.env.GUILD_ID ??
        null;
      const access = await resolveDashboardAccess({
        client,
        userId: user.id,
        guildId: requestedGuildId
      });
      req.session.dashboardRoles = access.roles;
      req.session.dashboardGuildId = access.guildId ?? requestedGuildId ?? null;
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
          permissions: Array.from(access.permissions ?? []),
          guildId: access.guildId ?? null
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
      req.rbac = { userId: null, roles: [], permissions: new Set(), guildId: null };
      next();
      return;
    }

    try {
      const requestedGuildId =
        sanitizeSnowflake(req.query.guild_id ?? req.query.guildId) ??
        sanitizeSnowflake(req.body?.guildId) ??
        req.session?.dashboardGuildId ??
        process.env.GUILD_ID ??
        null;
      const access = await resolveDashboardAccess({
        client,
        userId: user.id,
        guildId: requestedGuildId
      });
      req.rbac = {
        userId: user.id,
        guildId: access.guildId ?? requestedGuildId ?? null,
        roles: access.roles ?? [],
        permissions:
          access.permissions instanceof Set
            ? access.permissions
            : new Set(access.permissions ?? [])
      };
      req.session.dashboardRoles = access.roles ?? [];
      req.session.dashboardGuildId = access.guildId ?? requestedGuildId ?? null;
    } catch (error) {
      console.error('Failed to load RBAC context for dashboard request:', error);
      req.rbac = { userId: user.id, guildId: null, roles: [], permissions: new Set() };
    }
    next();
  };

  const api = express.Router();
  const internal = express.Router();

  startAlertsEngine(client);

  api.get(
    '/overview',
    requirePermission(Permissions.VIEW_OVERVIEW),
    async (req, res) => {
      try {
        const guildId = sanitizeSnowflake(req.query.guild_id ?? req.query.guildId);
        const from =
          typeof req.query.from === 'string' && req.query.from.trim().length
            ? req.query.from
            : null;
        const to =
          typeof req.query.to === 'string' && req.query.to.trim().length
            ? req.query.to
            : null;
        const snapshot = await buildOverviewSnapshot({ guildId, from, to });
        res.json(snapshot);
      } catch (error) {
        console.error('Failed to load overview snapshot:', error);
        res.status(500).json({ error: 'Failed to load overview snapshot.' });
      }
    }
  );

  api.get('/overview/summary', async (req, res) => {
    try {
      const guildId = sanitizeSnowflake(req.query.guildId);
      const date = parseMetricsDate(req.query.date);

      const [people, cases] = await Promise.all([loadPeople({ guildId }), loadCases({ guildId })]);

      let fallbackMemberCount = null;
      if ((!people || people.length === 0) && guildId) {
        const guild = await resolveGuild(client, guildId);
        fallbackMemberCount = guild?.memberCount ?? null;
      }

      const payload = await buildOverviewSummary({
        guildId,
        date,
        people,
        cases
      });

      if (fallbackMemberCount !== null && !payload.active_members) {
        payload.active_members = fallbackMemberCount;
      }
      res.json(payload);
    } catch (error) {
      console.error('Failed to load overview summary:', error);
      res.status(500).json({ error: 'Failed to load overview summary.' });
    }
  });

  api.get('/overview/headcount', async (req, res) => {
    try {
      const guildId = sanitizeSnowflake(req.query.guildId);
      const date = parseMetricsDate(req.query.date);
      const range =
        typeof req.query.range === 'string' && req.query.range.trim().length
          ? req.query.range
          : 'last_6_months';

      const people = await loadPeople({ guildId });
      const months = range === 'last_12_months' ? 12 : 6;

      const payload = await buildHeadcountSeriesData({ guildId, months, date, people });
      res.json(payload);
    } catch (error) {
      console.error('Failed to load headcount overview:', error);
      res.status(500).json({ error: 'Failed to load headcount overview.' });
    }
  });

  api.get('/overview/flow', async (req, res) => {
    try {
      const guildId = sanitizeSnowflake(req.query.guildId);
      const date = parseMetricsDate(req.query.date);

      const range =
        typeof req.query.range === 'string' && req.query.range.trim().length
          ? req.query.range
          : 'last_6_months';
      const months = range === 'last_12_months' ? 12 : 6;
      const people = await loadPeople({ guildId });
      const payload = await buildFlowSeriesData({ guildId, months, date, people });
      res.json(payload);
    } catch (error) {
      console.error('Failed to load flow overview:', error);
      res.status(500).json({ error: 'Failed to load membership flow overview.' });
    }
  });

  api.get('/overview/engagement', async (req, res) => {
    try {
      const guildId = sanitizeSnowflake(req.query.guildId);
      const range =
        typeof req.query.range === 'string' && req.query.range.trim().length
          ? req.query.range
          : 'last_30_days';
      const payload = await buildEngagementSnapshotData({ guildId, range });
      res.json(payload);
    } catch (error) {
      console.error('Failed to load engagement overview:', error);
      res.status(500).json({ error: 'Failed to load engagement overview.' });
    }
  });

  api.get('/overview/alerts', async (req, res) => {
    try {
      const guildId = sanitizeSnowflake(req.query.guildId);
      const date = parseMetricsDate(req.query.date);

      const [people, cases] = await Promise.all([
        loadPeople({ guildId }),
        loadCases({ guildId })
      ]);

      const alerts = await buildAlertsData({ guildId, date, people, cases });
      res.json(Array.isArray(alerts) ? alerts : []);
    } catch (error) {
      console.error('Failed to load overview alerts:', error);
      res.status(500).json({ error: 'Failed to load overview alerts.' });
    }
  });

  internal.post('/dreamgen/send', async (req, res) => {
    try {
      const channelId = sanitizeSnowflake(req.body?.channel ?? req.body?.channelId);
      const userId = sanitizeSnowflake(req.body?.user ?? req.body?.userId);
      const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
      const tags = Array.isArray(req.body?.tags)
        ? req.body.tags.filter((tag) => typeof tag === 'string')
        : [];

      const delivery = await deliverDreamGenMessage(client, { channelId, userId, text });
      res.json({
        success: true,
        target: delivery.target,
        tags,
        messageId: delivery.messageId ?? null
      });
    } catch (error) {
      if (error?.statusCode) {
        res.status(error.statusCode).json({ error: error.message });
        return;
      }
      console.error('DreamGen send failed:', error);
      res.status(500).json({ error: 'Failed to deliver DreamGen message.' });
    }
  });

  internal.post('/dreamgen/summary', async (req, res) => {
    const kind = typeof req.body?.kind === 'string' ? req.body.kind.trim() : '';
    const inputs =
      req.body?.inputs && typeof req.body.inputs === 'object' && req.body.inputs !== null
        ? req.body.inputs
        : {};

    if (!kind) {
      res.status(400).json({ error: 'kind is required.' });
      return;
    }

    if (kind !== 'daily_overview') {
      res.status(400).json({ error: 'Unsupported summary kind.' });
      return;
    }

    try {
      const guildHint =
        inputs.guildId ?? inputs.guild ?? req.body?.guildId ?? req.query?.guildId ?? null;
      const guildId = sanitizeSnowflake(guildHint);
      const date = parseMetricsDate(inputs.date ?? req.body?.date);

      let memberCount = null;
      if (guildId) {
        const guild = await resolveGuild(client, guildId);
        memberCount = guild?.memberCount ?? null;
      }

      const summaryResult = await generateDailyOverviewSummary({
        client,
        moderation,
        guildId,
        date,
        inputs,
        memberCount
      });

      res.json({ text: summaryResult.text, payload: summaryResult.payload });
    } catch (error) {
      if (error?.message?.startsWith('DreamGen')) {
        res.status(503).json({ error: error.message });
        return;
      }
      console.error('DreamGen summary failed:', error);
      res.status(500).json({ error: 'Failed to generate DreamGen summary.' });
    }
  });

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
      const counters =
        (await buildPeopleCounters().catch(() => null)) ?? {
          total: result.total ?? 0,
          active: 0,
          onboarding: 0,
          offboarded: 0
        };
      res.json({ ...result, counters });
    } catch (error) {
      console.error('Failed to list people:', error);
      res.status(500).json({ error: 'Failed to load roster.' });
    }
  });

  api.get('/people/checkins/upcoming', requirePermission(Permissions.VIEW_PEOPLE), async (req, res) => {
    try {
      const horizonDays = Number.isFinite(Number(req.query.days)) ? Number(req.query.days) : 90;
      const includeMissed = req.query.includeMissed === 'true';
      const withinHours = Math.max(1, horizonDays) * 24;
      const due = await getDueCheckins({ withinHours, includeMissed });
      const allowedCadences = new Set(['7d', '30d', '90d']);
      const items = due
        .filter(
          (entry) =>
            entry?.person &&
            entry?.checkin &&
            allowedCadences.has(String(entry.checkin.cadence ?? '').toLowerCase()) &&
            entry.checkin.dueAt
        )
        .map((entry) => ({
          person_id: entry.person.id,
          name: entry.person.displayName,
          due_at: entry.checkin.dueAt,
          type: entry.checkin.cadence,
          status: entry.checkin.status ?? 'pending',
          department: entry.person.department ?? null
        }))
        .sort((a, b) => new Date(a.due_at).getTime() - new Date(b.due_at).getTime());
      res.json(items);
    } catch (error) {
      console.error('Failed to load upcoming check-ins:', error);
      res.status(500).json({ error: 'Failed to load upcoming check-ins.' });
    }
  });

  api.get('/people/onboarding/checklist', requirePermission(Permissions.VIEW_PEOPLE), async (req, res) => {
    try {
      const departmentFilter =
        typeof req.query.department === 'string' && req.query.department.trim().length
          ? req.query.department.trim().toLowerCase()
          : null;
      const checklist = await getOnboardingChecklist();
      const filtered = departmentFilter
        ? checklist.filter(
            (entry) =>
              (entry.department ?? '').toLowerCase() === departmentFilter ||
              entry.checklist.some(
                (item) => (item.notes ?? '').toLowerCase().includes(departmentFilter)
              )
          )
        : checklist;
      res.json(filtered);
    } catch (error) {
      console.error('Failed to load onboarding checklist:', error);
      res.status(500).json({ error: 'Failed to load onboarding checklist.' });
    }
  });

  api.post('/people/:personId/actions', requirePermission(Permissions.MANAGE_PEOPLE), async (req, res) => {
    const personId = req.params.personId;
    const action = typeof req.body?.action === 'string' ? req.body.action.trim().toLowerCase() : null;
    if (!action) {
      res.status(400).json({ error: 'action is required.' });
      return;
    }

    const auditContext = buildAuditContext(req);

    try {
      const person = await getPerson(personId);
      if (!person) {
        res.status(404).json({ error: 'Person not found.' });
        return;
      }

      const resolvedGuildId =
        sanitizeSnowflake(req.body?.guildId) ??
        sanitizeSnowflake(person.guildId) ??
        sanitizeSnowflake(req.query.guildId);
      const resolvedMemberId = sanitizeSnowflake(
        req.body?.memberId ?? person.discordId ?? person.externalId ?? person.id
      );

      let payload = null;
      let toast = null;
      let updatedPerson = null;

      if (['warn', 'timeout', 'kick', 'ban', 'note', 'dm'].includes(action)) {
        if (!resolvedGuildId || !resolvedMemberId) {
          res.status(400).json({ error: 'guildId and memberId are required for moderation actions.' });
          return;
        }
        if (!client.comm) {
          res.status(503).json({ error: 'Messaging adapter not ready.' });
          return;
        }
        const dmUser = req.body?.dmUser !== undefined ? Boolean(req.body.dmUser) : true;
        const reason =
          typeof req.body?.reason === 'string' && req.body.reason.trim().length ? req.body.reason.trim() : null;
        const evidenceUrl =
          typeof req.body?.evidenceUrl === 'string' && req.body.evidenceUrl.trim().length
            ? req.body.evidenceUrl.trim()
            : null;
        const durationSec = Number.isFinite(Number(req.body?.durationSec)) ? Number(req.body.durationSec) : null;
        const deleteMessageDays = Number.isFinite(Number(req.body?.deleteMessageDays))
          ? Number(req.body.deleteMessageDays)
          : 0;
        const dmMessage =
          typeof req.body?.message === 'string' && req.body.message.trim().length
            ? req.body.message.trim()
            : reason
              ? `You have received a ${action.toUpperCase()} from the staff. Reason: ${reason}`
              : `You have received a ${action.toUpperCase()} from the staff.`;

        const moderationAction = await recordModerationAction({
          guildId: resolvedGuildId,
          memberId: resolvedMemberId,
          action,
          reason,
          actor_id: auditContext.actorId,
          actor_tag: auditContext.actorTag,
          duration_sec: durationSec,
          evidence_url: evidenceUrl,
          dm_user: dmUser
        });

        if (dmUser) {
          try {
            await client.comm.dm(resolvedMemberId, dmMessage);
          } catch (error) {
            console.error('Failed to DM member:', error);
          }
        }

        if (action === 'timeout' && durationSec) {
          await client.comm.timeout(resolvedMemberId, durationSec, reason ?? undefined, resolvedGuildId).catch((error) => {
            console.error('Failed to timeout member:', error);
          });
        } else if (action === 'kick') {
          await client.comm.kick(resolvedMemberId, reason ?? undefined, resolvedGuildId).catch((error) => {
            console.error('Failed to kick member:', error);
          });
        } else if (action === 'ban') {
          await client.comm
            .ban(resolvedMemberId, deleteMessageDays, reason ?? undefined, resolvedGuildId)
            .catch((error) => {
              console.error('Failed to ban member:', error);
            });
        }

        await recordAuditEntry({
          action: `people.moderation.${action}`,
          actorId: auditContext.actorId ?? null,
          actorTag: auditContext.actorTag ?? null,
          actorRoles: auditContext.actorRoles ?? [],
          guildId: resolvedGuildId,
          targetId: personId,
          targetType: 'person',
          targetLabel: person.displayName,
          metadata: {
            memberId: resolvedMemberId,
            reason,
            durationSec,
            evidenceUrl,
            dmUser,
            deleteMessageDays
          }
        });

        res.json({
          success: true,
          action,
          person,
          data: { moderationActionId: moderationAction.id ?? null, caseId: null },
          counters: null,
          toast: `Action ${action} recorded.`
        });
        return;
      } else if (action === 'schedule_checkin') {
        const type = typeof req.body?.type === 'string' ? req.body.type : 'custom';
        const dueAt = req.body?.due_at ?? req.body?.dueAt ?? null;
        const notes = typeof req.body?.notes === 'string' ? req.body.notes : null;
        updatedPerson = await scheduleCheckin(personId, type, {
          dueAt,
          notes,
          actorId: auditContext.actorId,
          actorTag: auditContext.actorTag
        });
        payload = updatedPerson;
        toast = 'Check-in scheduled.';
      } else if (action === 'assign_department') {
        const department =
          typeof req.body?.department === 'string' && req.body.department.trim().length
            ? req.body.department.trim()
            : null;
        updatedPerson = await updatePerson(
          personId,
          { department },
          { ...auditContext, action: 'people.department.assign' }
        );
        payload = updatedPerson;
        toast = 'Department updated.';
      } else if (action === 'open_case') {
        if (!moderation) {
          res.status(503).json({ error: 'Moderation engine not ready.' });
          return;
        }
        if (!resolvedGuildId) {
          res.status(400).json({ error: 'guildId is required to open a case.' });
          return;
        }
        const guild = await resolveGuild(client, resolvedGuildId);
        if (!guild) {
          res.status(404).json({ error: 'Guild not found.' });
          return;
        }
        if (!resolvedMemberId) {
          res.status(400).json({ error: 'memberId is required to open a case.' });
          return;
        }
        const member = await guild.members.fetch(resolvedMemberId).catch(() => null);
        if (!member) {
          res.status(404).json({ error: 'Member not found in this guild.' });
          return;
        }
        const reason = typeof req.body?.title === 'string' ? req.body.title : req.body?.notes ?? null;
        const notes = typeof req.body?.notes === 'string' ? req.body.notes : null;
        const caseEntry = await moderation.openMemberCase({
          guild,
          member,
          reason,
          initialMessage: notes
        });
        payload = { case: caseEntry };
        toast = 'Case opened for this person.';
      } else if (action === 'set_status') {
        const status =
          typeof req.body?.status === 'string' && req.body.status.trim().length
            ? req.body.status.trim().toLowerCase()
            : null;
        if (!status) {
          res.status(400).json({ error: 'status is required.' });
          return;
        }
        updatedPerson = await updatePerson(
          personId,
          { status },
          { ...auditContext, action: 'people.status.set' }
        );
        payload = updatedPerson;
        toast = 'Status updated.';
      } else if (action === 'dm') {
        const text = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
        if (!text) {
          res.status(400).json({ error: 'message is required for DM action.' });
          return;
        }
        const channelId = sanitizeSnowflake(req.body?.channel ?? req.body?.channelId);
        const userId = sanitizeSnowflake(req.body?.user ?? req.body?.userId);
        const delivery = await deliverDreamGenMessage(client, { channelId, userId, text });
        await recordAuditEntry({
          action: 'people.dm',
          actorId: auditContext.actorId ?? null,
          actorTag: auditContext.actorTag ?? null,
          actorRoles: auditContext.actorRoles ?? [],
          guildId: delivery.guildId ?? null,
          targetId: personId,
          targetType: 'person',
          targetLabel: delivery.target?.tag ?? delivery.target?.name ?? null,
          metadata: {
            text,
            channelId: delivery.target?.id ?? null,
            delivery
          }
        });
        payload = delivery;
        toast = 'Message sent via DreamGen.';
      } else {
        res.status(400).json({ error: 'Unsupported action.' });
        return;
      }

      if (!updatedPerson) {
        updatedPerson = await getPerson(personId).catch(() => null);
      }

      const counters = await getPeopleSummary().catch(() => null);
      res.json({
        success: true,
        action,
        person: updatedPerson,
        data: payload,
        counters: counters
          ? {
              total: counters.total ?? 0,
              active: counters.active ?? 0,
              onboarding: counters.onboarding ?? 0,
              offboarded: counters.offboarded ?? 0
            }
          : null,
        toast
      });
    } catch (error) {
      if (error?.statusCode) {
        res.status(error.statusCode).json({ error: error.message });
        return;
      }
      console.error('Failed to execute people action:', error);
      res.status(500).json({ error: error?.message ?? 'Failed to execute action.' });
    }
  });

  api.get('/people/:personId/actions/log', requirePermission(Permissions.VIEW_PEOPLE), async (req, res) => {
    try {
      const person = await getPerson(req.params.personId);
      if (!person) {
        res.status(404).json({ error: 'Person not found.' });
        return;
      }
      const guildId = sanitizeSnowflake(req.query.guildId ?? req.query.guild_id ?? person.guildId);
      const memberId = sanitizeSnowflake(
        req.query.memberId ?? req.query.member_id ?? person.discordId ?? person.externalId ?? person.id
      );
      if (!guildId || !memberId) {
        res.json([]);
        return;
      }
      const history = await listModerationActions({ guildId, memberId });
      res.json(
        history.map((entry) => ({
          id: entry.id,
          action: entry.action,
          reason: entry.reason ?? null,
          actorId: entry.actorId ?? null,
          actorTag: entry.actorTag ?? null,
          createdAt: entry.createdAt ?? null,
          durationSec: entry.durationSec ?? null,
          dmUser: entry.dmUser ?? false,
          evidenceUrl: entry.evidenceUrl ?? null,
          guildId: entry.guildId ?? guildId,
          memberId: entry.memberId ?? memberId
        }))
      );
    } catch (error) {
      console.error('Failed to load moderation history for person:', error);
      res.status(500).json({ error: 'Failed to load moderation history.' });
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

      const limit = Math.min(Math.max(Number(req.query.limit) || 25, 1), 250);
      const rawQuery = String(req.query.query ?? '').trim();
      const normalizedQuery = rawQuery.toLowerCase();

      let membersList = [];

      if (rawQuery.length >= 2) {
        if (typeof guild.members?.search === 'function') {
          const results = await guild.members.search({ query: rawQuery, limit });
          membersList = Array.from(results.values());
        } else {
          let collection;
          try {
            collection = await guild.members.fetch({ limit: 1000, withPresences: false });
          } catch (fetchError) {
            console.error('Failed to fetch guild members for search:', fetchError);
            collection = guild.members.cache;
          }
          membersList = Array.from(collection.values()).filter((member) => {
            const display = (member.displayName ?? '').toLowerCase();
            const username = (member.user?.username ?? '').toLowerCase();
            const tag = (member.user?.tag ?? '').toLowerCase();
            return (
              display.includes(normalizedQuery) ||
              username.includes(normalizedQuery) ||
              (tag ? tag.includes(normalizedQuery) : false)
            );
          });
          if (membersList.length > limit) {
            membersList = membersList.slice(0, limit);
          }
        }
      } else {
        let collection = guild.members.cache;
        const needsFetch = !collection?.size || collection.size < limit;
        if (needsFetch) {
          try {
            collection = await guild.members.fetch({ limit, withPresences: false });
          } catch (fetchError) {
            console.error('Failed to fetch guild members list:', fetchError);
            collection = guild.members.cache;
          }
        }

        membersList = Array.from(collection.values());
        membersList.sort((a, b) => {
          const left = (a.displayName ?? a.user?.username ?? '').toLowerCase();
          const right = (b.displayName ?? b.user?.username ?? '').toLowerCase();
          if (left < right) {
            return -1;
          }
          if (left > right) {
            return 1;
          }
          return 0;
        });
        if (membersList.length > limit) {
          membersList = membersList.slice(0, limit);
        }
      }

      const members = membersList.map((member) => ({
        id: member.id,
        displayName: member.displayName,
        username: member.user?.username ?? null,
        tag: member.user?.tag ?? null,
        avatar: member.displayAvatarURL({ size: 64, extension: 'png' }),
        joinedAt:
          member.joinedAt instanceof Date ? member.joinedAt.toISOString() : null
      }));

      res.json(members);
    } catch (error) {
      console.error('Failed to retrieve guild members:', error);
      res.status(500).json({ error: 'Failed to load members.' });
    }
  });

    guildRouter.get('/cases', async (req, res) => {
      if (!moderation) {
        res.status(503).json({ error: 'Moderation engine not ready.' });
        return;
      }
      try {
        const limit = Number.isFinite(Number(req.query.limit)) ? Number(req.query.limit) : 50;
        const offset = Number.isFinite(Number(req.query.offset)) ? Number(req.query.offset) : 0;
        const filters = resolveCaseFilters(req.query, req.session?.user?.id ?? null);
        const result = await moderation.listCasesForGuild(req.params.guildId, {
          status: filters.status,
          category: filters.category,
          assignee: filters.assignee,
          search: filters.search,
          sla: filters.sla,
          limit,
          offset,
          sortBy: filters.sortBy,
          direction: filters.direction,
          includeArchived: filters.includeArchived,
          mine: filters.mine,
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
      const limit = Number.isFinite(Number(req.query.limit)) ? Number(req.query.limit) : 50;
      const offset = Number.isFinite(Number(req.query.offset)) ? Number(req.query.offset) : 0;
      const filters = resolveCaseFilters(req.query, req.session?.user?.id ?? null);

      const result = await moderation.listCasesForGuild(guildId, {
        status: filters.status,
        category: filters.category,
        assignee: filters.assignee,
        search: filters.search,
        sla: filters.sla,
        limit,
        offset,
        sortBy: filters.sortBy,
        direction: filters.direction,
        includeArchived: filters.includeArchived,
        mine: filters.mine,
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
      const filters = resolveCaseFilters(req.query, req.session?.user?.id ?? null);
      const exportLimit = Number.isFinite(Number(req.query.limit)) ? Number(req.query.limit) : null;

      const cases = await collectCasesForExport(
        moderation,
        guildId,
        {
          status: filters.status,
          category: filters.category,
          assignee: filters.assignee,
          search: filters.search,
          sla: filters.sla,
          sortBy: filters.sortBy,
          direction: filters.direction,
          includeArchived: filters.includeArchived,
          mine: filters.mine,
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
          filters: {
            status: filters.status,
            category: filters.category,
            assignee: filters.assignee,
            search: filters.search,
            sla: filters.sla,
            mine: filters.mine
          },
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

  api.post('/cases/:caseId/escalate', async (req, res) => {
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

      const updated = await moderation.setCaseStatus({
        guildId,
        caseId,
        status: 'escalated',
        moderatorId: moderator?.id ?? null,
        moderatorTag: moderator ? buildUserTag(moderator) : null,
        note: typeof req.body?.note === 'string' ? req.body.note : null
      });
      res.json(updated);
    } catch (error) {
      console.error('Failed to escalate case:', error);
      res.status(500).json({ error: error?.message ?? 'Failed to escalate case.' });
    }
  });

  api.post('/cases/:caseId/resolve', async (req, res) => {
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
      const updated = await moderation.setCaseStatus({
        guildId,
        caseId,
        status: 'closed',
        moderatorId: moderator?.id ?? null,
        moderatorTag: moderator ? buildUserTag(moderator) : null,
        note: typeof req.body?.note === 'string' ? req.body.note : null
      });
      res.json(updated);
    } catch (error) {
      console.error('Failed to resolve case:', error);
      res.status(500).json({ error: error?.message ?? 'Failed to resolve case.' });
    }
  });

  api.patch('/cases/:caseId', async (req, res) => {
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

      const updates = [];

      if (typeof req.body?.status === 'string' && req.body.status.trim().length) {
        await moderation.setCaseStatus({
          guildId,
          caseId,
          status: req.body.status,
          moderatorId: moderator?.id ?? null,
          moderatorTag: moderator ? buildUserTag(moderator) : null,
          note: typeof req.body?.note === 'string' ? req.body.note : null
        });
        updates.push('status');
      }

      if (
        'assigneeId' in req.body ||
        'assignee' in req.body ||
        'assigneeTag' in req.body ||
        'assigneeDisplayName' in req.body
      ) {
        await moderation.setCaseAssignee({
          guildId,
          caseId,
          assigneeId: req.body?.assigneeId ?? req.body?.assignee ?? null,
          assigneeTag: typeof req.body?.assigneeTag === 'string' ? req.body.assigneeTag : null,
          assigneeDisplayName:
            typeof req.body?.assigneeDisplayName === 'string' ? req.body.assigneeDisplayName : null,
          moderatorId: moderator?.id ?? null,
          moderatorTag: moderator ? buildUserTag(moderator) : null
        });
        updates.push('assignee');
      }

      if ('slaDueAt' in req.body || 'dueAt' in req.body) {
        await moderation.setCaseSla({
          guildId,
          caseId,
          dueAt:
            typeof req.body?.slaDueAt === 'string'
              ? req.body.slaDueAt
              : typeof req.body?.dueAt === 'string'
                ? req.body.dueAt
                : null,
          moderatorId: moderator?.id ?? null,
          moderatorTag: moderator ? buildUserTag(moderator) : null
        });
        updates.push('sla');
      }

      if (!updates.length) {
        res.status(400).json({ error: 'No supported fields provided for update.' });
        return;
      }

      const latest = await moderation.getCaseDetails(guildId, caseId);
      res.json({
        success: true,
        updates,
        case: latest ?? caseEntry
      });
    } catch (error) {
      console.error('Failed to patch case:', error);
      res.status(500).json({ error: error?.message ?? 'Failed to update case.' });
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

  api.post('/actions/daily-summary', async (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    if (typeof res.flushHeaders === 'function') {
      res.flushHeaders();
    }

    const writeEvent = (payload) => {
      try {
        res.write(`data: ${JSON.stringify(payload)}

`);
      } catch (error) {
        console.error('Failed to stream daily summary event:', error);
      }
    };

    const guildId = sanitizeSnowflake(req.body?.guildId ?? req.query?.guildId);
    const channelId = sanitizeSnowflake(req.body?.channelId ?? req.body?.channel);
    const date = parseMetricsDate(req.body?.date);

    const auditContext = buildAuditContext(req);

    writeEvent({ status: 'collecting', guildId, channelId });

    try {
      let memberCount = null;
      let guild = null;
      if (guildId) {
        guild = await resolveGuild(client, guildId);
        memberCount = guild?.memberCount ?? null;
      }

      writeEvent({ status: 'generating' });
      const summaryResult = await generateDailyOverviewSummary({
        client,
        moderation,
        guildId,
        date,
        inputs: req.body ?? {},
        memberCount
      });

      writeEvent({ status: 'generated', summary: summaryResult.text });

      let delivery = null;
      if (channelId) {
        delivery = await deliverDreamGenMessage(client, {
          channelId,
          text: summaryResult.text
        });
        writeEvent({ status: 'delivered', delivery });
      }

      await recordAuditEntry({
        action: 'actions.daily-summary',
        actorId: auditContext.actorId ?? null,
        actorTag: auditContext.actorTag ?? null,
        actorRoles: auditContext.actorRoles ?? [],
        guildId: delivery?.guildId ?? guildId ?? null,
        targetType: 'channel',
        targetId: delivery?.target?.id ?? channelId ?? null,
        metadata: {
          summary: summaryResult.payload,
          delivery
        }
      });

      writeEvent({
        status: 'completed',
        summary: summaryResult.text,
        delivery
      });
    } catch (error) {
      if (error?.statusCode) {
        writeEvent({ status: 'error', error: error.message, code: error.statusCode });
      } else if (error?.message?.startsWith?.('DreamGen')) {
        writeEvent({ status: 'error', error: error.message, code: 503 });
      } else {
        console.error('Failed to generate daily summary:', error);
        writeEvent({ status: 'error', error: 'Failed to generate daily summary.' });
      }
    } finally {
      res.end();
    }
  });

  api.get(
    '/settings/rbac',
    requirePermission(Permissions.MANAGE_RBAC),
    async (req, res) => {
      const guildId = sanitizeSnowflake(req.query.guild_id ?? req.query.guildId);
      if (!guildId) {
        res.status(400).json({ error: 'guild_id is required.' });
        return;
      }
      try {
        const config = await getGuildAssignments(guildId);
        res.json({
          guildId: config.guildId,
          defaultRole: config.defaultRole,
          assignments: Object.entries(config.assignments ?? {}).map(([rbacKey, roleIds]) => ({
            rbacKey,
            discordRoleIds: Array.isArray(roleIds) ? roleIds : []
          }))
        });
      } catch (error) {
        console.error('Failed to load RBAC assignments:', error);
        res.status(500).json({ error: 'Failed to load RBAC assignments.' });
      }
    }
  );

  api.post(
    '/settings/rbac',
    requirePermission(Permissions.MANAGE_RBAC),
    async (req, res) => {
      const guildId = sanitizeSnowflake(req.body?.guildId ?? req.body?.guild_id);
      if (!guildId) {
        res.status(400).json({ error: 'guildId is required.' });
        return;
      }
      const defaultRole =
        typeof req.body?.defaultRole === 'string' && req.body.defaultRole.trim().length
          ? req.body.defaultRole.trim().toLowerCase()
          : undefined;
      const assignmentsInput = Array.isArray(req.body?.assignments) ? req.body.assignments : [];
      const assignments = {};
      for (const entry of assignmentsInput) {
        const key =
          typeof entry?.rbacKey === 'string' && entry.rbacKey.trim().length
            ? entry.rbacKey.trim().toLowerCase()
            : null;
        if (!key) {
          continue;
        }
        assignments[key] = Array.isArray(entry.discordRoleIds)
          ? entry.discordRoleIds
              .map((roleId) => (roleId ? String(roleId) : null))
              .filter(Boolean)
          : [];
      }
      try {
        const updated = await setGuildAssignments(guildId, {
          defaultRole,
          assignments
        });
        await recordAuditEntry({
          action: 'settings.rbac.update',
          actorId: req.session?.user?.id ?? null,
          actorTag: buildUserTag(req.session?.user) ?? null,
          guildId,
          targetType: 'settings',
          targetId: 'rbac',
          metadata: updated
        });
        res.json({
          ok: true,
          guildId: updated.guildId,
          defaultRole: updated.defaultRole,
          assignments: updated.assignments
        });
      } catch (error) {
        console.error('Failed to update RBAC assignments:', error);
        res.status(500).json({ error: 'Failed to update RBAC assignments.' });
      }
    }
  );

  api.get(
    '/settings/verification',
    requirePermission(Permissions.MANAGE_VERIFICATION),
    async (req, res) => {
      const guildId = sanitizeSnowflake(req.query.guild_id ?? req.query.guildId);
      if (!guildId) {
        res.status(400).json({ error: 'guild_id is required.' });
        return;
      }
      try {
        const config = await getVerificationConfig(guildId);
        res.json({
          guildId: config.guildId,
          channelId: config.channelId,
          staffChannelId: config.staffChannelId,
          approvedRoleIds: config.approvedRoleIds,
          questions: config.questions
        });
      } catch (error) {
        console.error('Failed to load verification config:', error);
        res.status(500).json({ error: 'Failed to load verification settings.' });
      }
    }
  );

  api.post(
    '/settings/verification',
    requirePermission(Permissions.MANAGE_VERIFICATION),
    async (req, res) => {
      const guildId = sanitizeSnowflake(req.body?.guildId ?? req.body?.guild_id);
      if (!guildId) {
        res.status(400).json({ error: 'guildId is required.' });
        return;
      }
      const config = {
        channelId: sanitizeSnowflake(req.body?.channelId ?? req.body?.channel_id),
        staffChannelId: sanitizeSnowflake(req.body?.staffChannelId ?? req.body?.staff_channel_id),
        approvedRoleIds: Array.isArray(req.body?.approvedRoleIds)
          ? req.body.approvedRoleIds.map((roleId) => (roleId ? String(roleId) : null)).filter(Boolean)
          : [],
        questions: Array.isArray(req.body?.questions) ? req.body.questions : []
      };
      try {
        const updated = await setVerificationConfig(guildId, config);
        await recordAuditEntry({
          action: 'settings.verification.update',
          actorId: req.session?.user?.id ?? null,
          actorTag: buildUserTag(req.session?.user) ?? null,
          guildId,
          targetType: 'settings',
          targetId: 'verification',
          metadata: updated
        });
        res.json({
          ok: true,
          config: updated
        });
      } catch (error) {
        console.error('Failed to update verification settings:', error);
        res.status(500).json({ error: 'Failed to update verification settings.' });
      }
    }
  );

  api.post('/telemetry/enable', requirePermission(Permissions.VIEW_INSIGHTS), async (req, res) => {
    try {
      const settings = await setTelemetryEnabled(true);
      const auditContext = buildAuditContext(req);
      await recordAuditEntry({
        action: 'telemetry.enable',
        actorId: auditContext.actorId ?? null,
        actorTag: auditContext.actorTag ?? null,
        actorRoles: auditContext.actorRoles ?? [],
        targetType: 'telemetry',
        targetId: null,
        metadata: {
          enabled: settings.enabled,
          enabledAt: settings.enabledAt
        }
      });
      res.json({ enabled: settings.enabled, enabled_at: settings.enabledAt });
    } catch (error) {
      console.error('Failed to enable telemetry:', error);
      res.status(500).json({ error: 'Failed to enable telemetry.' });
    }
  });

  api.get(
    '/insights/commands',
    requirePermission(Permissions.VIEW_INSIGHTS),
    async (req, res) => {
      try {
        const range =
          typeof req.query.range === 'string' && req.query.range.trim().length
            ? req.query.range.trim()
            : 'last_7_days';
        const telemetry = await getCommandTelemetry(range);
        res.json(telemetry);
      } catch (error) {
        console.error('Failed to load command telemetry:', error);
        res.status(500).json({ error: 'Failed to load command insights.' });
      }
    }
  );

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

  app.use('/internal', requireAuth, attachRbac, internal);
  app.use('/api', requireAuth, attachRbac, api);

  app.use(express.static(clientDistDir));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(clientDistDir, 'index.html'));
  });

  return app;
}

async function deliverDreamGenMessage(client, { channelId = null, userId = null, text }) {
  if (!text || !String(text).trim().length) {
    const error = new Error('text is required.');
    error.statusCode = 400;
    throw error;
  }

  if (channelId) {
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel || !channel.isTextBased?.()) {
      const error = new Error('Channel not found or not text based.');
      error.statusCode = 404;
      throw error;
    }
    const message = await channel.send({ content: text });
    return {
      target: {
        type: 'channel',
        id: channel.id,
        name: channel.name ?? null
      },
      messageId: message?.id ?? null,
      guildId: channel.guild?.id ?? null
    };
  }

  if (userId) {
    const user = await client.users.fetch(userId).catch(() => null);
    if (!user) {
      const error = new Error('User not found.');
      error.statusCode = 404;
      throw error;
    }
    const dm = user.dmChannel ?? (await user.createDM().catch(() => null));
    if (!dm) {
      const error = new Error('Could not open DM channel.');
      error.statusCode = 500;
      throw error;
    }
    const message = await dm.send({ content: text });
    return {
      target: {
        type: 'user',
        id: user.id,
        tag: user.tag ?? user.username ?? null
      },
      messageId: message?.id ?? null,
      guildId: null
    };
  }

  const error = new Error('channel or user is required.');
  error.statusCode = 400;
  throw error;
}

function resolveCaseFilters(query = {}, userId = null) {
  const filters = {
    status:
      typeof query.status === 'string' && query.status.trim().length
        ? query.status.trim().toLowerCase()
        : 'all',
    category:
      typeof query.category === 'string' && query.category.trim().length
        ? query.category.trim().toLowerCase()
        : 'all',
    assignee:
      typeof query.assignee === 'string' && query.assignee.trim().length
        ? query.assignee.trim().toLowerCase()
        : 'all',
    search: typeof query.search === 'string' ? query.search : '',
    sla:
      typeof query.sla === 'string' && query.sla.trim().length
        ? query.sla.trim().toLowerCase()
        : 'all',
    mine: query.mine === 'true',
    includeArchived: query.includeArchived !== 'false',
    sortBy:
      typeof query.sortBy === 'string' && query.sortBy.trim().length
        ? query.sortBy.trim()
        : typeof query.sort === 'string' && query.sort.trim().length
          ? query.sort.trim()
          : 'updatedAt',
    direction:
      typeof query.direction === 'string' && query.direction.trim().length
        ? query.direction.trim()
        : 'desc'
  };

  const queue =
    typeof query.queue === 'string' && query.queue.trim().length
      ? query.queue.trim().toLowerCase()
      : null;

  if (queue === 'active') {
    filters.status = 'active';
  } else if (queue === 'mine') {
    filters.status = 'active';
    filters.mine = true;
  } else if (queue === 'sla_overdue') {
    filters.status = 'active';
    filters.sla = 'overdue';
  } else if (queue === 'escalated') {
    filters.status = 'escalated';
  }

  if (filters.assignee === 'me' && userId) {
    filters.mine = true;
  }

  const normalizedSort = filters.sortBy.toLowerCase();
  if (normalizedSort === 'last_update' || normalizedSort === 'last-update') {
    filters.sortBy = 'updatedAt';
  } else if (normalizedSort === 'opened') {
    filters.sortBy = 'createdAt';
  }

  return filters;
}

async function generateDailyOverviewSummary({
  client,
  moderation,
  guildId = null,
  date = new Date(),
  inputs = {},
  memberCount = null
} = {}) {
  const [summary, engagement, alerts] = await Promise.all([
    getOverviewSummary({ guildId, date, memberCount, moderation, clientReady: client.isReady() }),
    getOverviewEngagement({ guildId, range: 'last_30_days' }),
    getOverviewAlerts({ guildId, date, moderation, memberCount })
  ]);

  const payload = {
    kind: 'daily_overview',
    context: {
      summary,
      engagement,
      alerts,
      inputs
    }
  };

  const text = await callDreamGen({
    messages: [
      {
        role: 'system',
        content:
          'You are DreamGen, an assistant that writes concise leadership-ready summaries about community activity. Keep tone factual, upbeat, and actionable.'
      },
      {
        role: 'user',
        content: [
          'Create a short daily overview (3-5 bullet sentences) using the following JSON metrics.',
          'Highlight major changes, note risks, and suggest one quick action if relevant.',
          'JSON:',
          JSON.stringify(payload, null, 2)
        ].join('\n')
      }
    ],
    controls: {
      temperature: 0.4,
      topP: 0.8
    }
  });

  return { text, payload };
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












