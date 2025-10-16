import express from 'express';
import cors from 'cors';
import session from 'express-session';
import crypto from 'node:crypto';
import { getKpis, getHeadcountSeries, getFlowSeries, getEngagementSummary, getAlertsMetrics } from './metrics/metricsService.js';
import { findPeople, getPerson, upsertPerson, scheduleCheckins, offboardPerson, patchPerson } from './data/peopleStore.js';
import { listCases, getCaseById, createCase, transitionCase, appendCaseNote } from './data/caseStore.js';
import { listCommands, setCommandEnabled, setCommandCooldown } from './data/commandStore.js';
import { acknowledgeAlert, silenceAlert } from './alerts/alertsEngine.js';
import { recordAuditEntry } from './audit/auditLog.js';
import { rbacMiddleware } from './auth/rbac.js';

const sessionSecret = process.env.DASHBOARD_SESSION_SECRET ?? crypto.randomBytes(32).toString('hex');

export function createControlCenterApp({ client } = {}) {
  const app = express();

  app.use(cors({ credentials: true, origin: true }));
  app.use(express.json());
  app.use(
    session({
      secret: sessionSecret,
      resave: false,
      saveUninitialized: false,
      cookie: {
        secure: process.env.NODE_ENV === 'production',
        httpOnly: true,
        sameSite: 'lax',
        maxAge: 1000 * 60 * 60 * 2
      }
    })
  );

  app.use((req, _res, next) => {
    // Temporary dev auth bridge – replace with Discord OAuth integration.
    if (!req.session.user) {
      req.session.user = {
        id: process.env.DEV_USER_ID ?? 'dev-user',
        roles: ['Admin']
      };
    }
    if (!Array.isArray(req.session.user.roles) || req.session.user.roles.length === 0) {
      req.session.user.roles = ['Admin'];
    }
    req.session.roles = req.session.user.roles;
    next();
  });

  app.get('/', (_req, res) => {
    res.json({
      name: 'DoodleBot Control Center',
      status: 'ok',
      docs: '/docs',
      metrics: '/api/metrics/kpis'
    });
  });

  app.get('/healthz', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.get('/api/metrics/kpis', async (req, res) => {
    try {
      const rangeDays = Number(req.query.rangeDays ?? 7);
      const date = typeof req.query.date === 'string' ? req.query.date : undefined;
      const guildId = typeof req.query.guildId === 'string' ? req.query.guildId : 'default';
      const data = await getKpis({ guildId, rangeDays, date });
      res.json(data);
    } catch (error) {
      console.error('Failed to load KPI metrics:', error);
      res.status(500).json({ error: 'Failed to load metrics.' });
    }
  });

  app.get('/api/metrics/headcount', async (req, res) => {
    try {
      const guildId = typeof req.query.guildId === 'string' ? req.query.guildId : 'default';
      const start = typeof req.query.start === 'string' ? req.query.start : undefined;
      const end = typeof req.query.end === 'string' ? req.query.end : undefined;
      const data = await getHeadcountSeries({ guildId, start, end });
      res.json(data);
    } catch (error) {
      console.error('Failed to load headcount metrics:', error);
      res.status(500).json({ error: 'Failed to load headcount metrics.' });
    }
  });

  app.get('/api/metrics/flow', async (req, res) => {
    try {
      const guildId = typeof req.query.guildId === 'string' ? req.query.guildId : 'default';
      const start = typeof req.query.start === 'string' ? req.query.start : undefined;
      const end = typeof req.query.end === 'string' ? req.query.end : undefined;
      const data = await getFlowSeries({ guildId, start, end });
      res.json(data);
    } catch (error) {
      console.error('Failed to load flow metrics:', error);
      res.status(500).json({ error: 'Failed to load flow metrics.' });
    }
  });

  app.get('/api/metrics/engagement', async (req, res) => {
    try {
      const guildId = typeof req.query.guildId === 'string' ? req.query.guildId : 'default';
      const days = Number(req.query.days ?? 7);
      const data = await getEngagementSummary({ guildId, days });
      res.json(data);
    } catch (error) {
      console.error('Failed to load engagement metrics:', error);
      res.status(500).json({ error: 'Failed to load engagement metrics.' });
    }
  });

  app.get('/api/metrics/alerts', async (req, res) => {
    try {
      const guildId = typeof req.query.guildId === 'string' ? req.query.guildId : 'default';
      const days = Number(req.query.days ?? 7);
      const data = await getAlertsMetrics({ guildId, days });
      res.json(data);
    } catch (error) {
      console.error('Failed to load alert metrics:', error);
      res.status(500).json({ error: 'Failed to load alert metrics.' });
    }
  });

  app.get('/api/people/find', rbacMiddleware('people:read'), async (req, res) => {
    try {
      const q = typeof req.query.q === 'string' ? req.query.q : '';
      const results = await findPeople(q);
      res.json(
        results.map((person) => ({
          discordId: person.discordId,
          name: person.name,
          nickname: person.nickname,
          department: person.department,
          status: person.status,
          managerId: person.managerId
        }))
      );
    } catch (error) {
      console.error('Failed to search people:', error);
      res.status(500).json({ error: 'Failed to search people.' });
    }
  });

  app.get('/api/people/:discordId', rbacMiddleware('people:read'), async (req, res) => {
    try {
      const person = await getPerson(req.params.discordId);
      if (!person) {
        res.status(404).json({ error: 'Not found' });
        return;
      }
      const relatedCases = (await listCases({})).filter(
        (entry) => entry.memberId === person.discordId && entry.status !== 'closed'
      );
      const upcomingCheckins = (person.checkins ?? []).filter((entry) => !entry.done);
      res.json({
        ...person,
        openCases: relatedCases,
        upcomingCheckins
      });
    } catch (error) {
      console.error('Failed to load person:', error);
      res.status(500).json({ error: 'Failed to load profile.' });
    }
  });

  app.post('/api/people', rbacMiddleware('people:write'), async (req, res) => {
    try {
      const payload = req.body ?? {};
      if (!payload.discordId) {
        res.status(400).json({ error: 'discordId is required' });
        return;
      }
      await upsertPerson({
        userId: req.session.user.id,
        payload
      });
      res.status(204).end();
    } catch (error) {
      console.error('Failed to upsert person:', error);
      res.status(500).json({ error: 'Failed to save person.' });
    }
  });

  app.post('/api/people/:id/announce', rbacMiddleware('people:*'), async (req, res) => {
    try {
      if (!client) {
        res.status(503).json({ error: 'Bot client not ready.' });
        return;
      }
      const { channelId, message } = req.body ?? {};
      const resolvedChannelId =
        channelId ?? process.env.ANNOUNCE_CHANNEL_ID ?? process.env.DEFAULT_ANNOUNCE_CHANNEL;
      if (!resolvedChannelId) {
        res.status(400).json({ error: 'channelId required for announcement.' });
        return;
      }
      const channel = await client.channels.fetch(resolvedChannelId);
      if (!channel?.isTextBased()) {
        res.status(400).json({ error: 'Channel is not text-capable.' });
        return;
      }

      const person = await getPerson(req.params.id);
      if (!person) {
        res.status(404).json({ error: 'Person not found.' });
        return;
      }

      const announcement =
        message ??
        `Please welcome <@${person.discordId}> (${person.name ?? 'New teammate'}) to the team!`;
      await channel.send(announcement);
      const updated = await patchPerson({
        userId: req.session.user.id,
        discordId: req.params.id,
        updates: { announcedAt: new Date().toISOString() }
      });
      res.json({ success: true, announcedAt: updated.announcedAt });
    } catch (error) {
      console.error('Failed to announce person:', error);
      res.status(500).json({ error: 'Failed to announce person.' });
    }
  });

  app.post('/api/people/:id/rolesync', rbacMiddleware('people:*'), async (req, res) => {
    try {
      if (!client) {
        res.status(503).json({ error: 'Bot client not ready.' });
        return;
      }
      const targetGuildId = req.body?.guildId ?? process.env.GUILD_ID;
      if (!targetGuildId) {
        res.status(400).json({ error: 'guildId required.' });
        return;
      }
      const guild = await client.guilds.fetch(targetGuildId);
      const member = await guild.members.fetch(req.params.id);
      await member.fetch(true);
      await patchPerson({
        userId: req.session.user.id,
        discordId: req.params.id,
        updates: { rolesSyncedAt: new Date().toISOString() }
      });
      await recordAuditEntry({
        userId: req.session.user.id,
        action: 'people.rolesync',
        target: req.params.id,
        payload: { guildId: targetGuildId }
      });
      res.json({ success: true });
    } catch (error) {
      console.error('Failed to role sync person:', error);
      res.status(500).json({ error: 'Failed to role sync person.' });
    }
  });

  app.post('/api/people/:id/dm', rbacMiddleware('people:*'), async (req, res) => {
    try {
      if (!client) {
        res.status(503).json({ error: 'Bot client not ready.' });
        return;
      }
      const message = typeof req.body?.message === 'string' ? req.body.message : null;
      if (!message) {
        res.status(400).json({ error: 'message is required.' });
        return;
      }
      const user = await client.users.fetch(req.params.id);
      await user.send(message);
      await recordAuditEntry({
        userId: req.session.user.id,
        action: 'people.dm',
        target: req.params.id,
        payload: { message }
      });
      res.json({ success: true });
    } catch (error) {
      console.error('Failed to DM person:', error);
      res.status(500).json({ error: 'Failed to send DM.' });
    }
  });

  app.post('/api/people/:id/checkins', rbacMiddleware('people:*'), async (req, res) => {
    try {
      const days = Array.isArray(req.body?.days) ? req.body.days : [];
      const updated = await scheduleCheckins({
        userId: req.session.user.id,
        discordId: req.params.id,
        days
      });
      res.json(updated);
    } catch (error) {
      console.error('Failed to schedule check-ins:', error);
      res.status(500).json({ error: 'Failed to schedule check-ins.' });
    }
  });

  app.post('/api/people/:id/offboard', rbacMiddleware('people:*'), async (req, res) => {
    try {
      const { reason, dateLeft } = req.body ?? {};
      const updated = await offboardPerson({
        userId: req.session.user.id,
        discordId: req.params.id,
        reason,
        dateLeft
      });
      res.json(updated);
    } catch (error) {
      console.error('Failed to offboard person:', error);
      res.status(500).json({ error: 'Failed to offboard person.' });
    }
  });

  app.get('/api/cases', rbacMiddleware('cases:read'), async (req, res) => {
    try {
      const matches = await listCases({
        status: req.query.status,
        assignee: req.query.assignee,
        category: req.query.category,
        sla: req.query.sla,
        search: req.query.search
      });
      res.json(matches);
    } catch (error) {
      console.error('Failed to list cases:', error);
      res.status(500).json({ error: 'Failed to load cases.' });
    }
  });

  app.get('/api/cases/:id', rbacMiddleware('cases:read'), async (req, res) => {
    try {
      const entry = await getCaseById(req.params.id);
      if (!entry) {
        res.status(404).json({ error: 'Not found' });
        return;
      }
      res.json(entry);
    } catch (error) {
      console.error('Failed to load case:', error);
      res.status(500).json({ error: 'Failed to load case.' });
    }
  });

  app.post('/api/cases', rbacMiddleware('cases:write'), async (req, res) => {
    try {
      const payload = req.body ?? {};
      const created = await createCase({
        userId: req.session.user.id,
        payload
      });
      res.status(201).json(created);
    } catch (error) {
      console.error('Failed to create case:', error);
      res.status(500).json({ error: 'Failed to create case.' });
    }
  });

  app.post('/api/cases/:id/transition', rbacMiddleware('cases:write'), async (req, res) => {
    try {
      const { status } = req.body ?? {};
      const updated = await transitionCase({
        userId: req.session.user.id,
        id: req.params.id,
        status
      });
      res.json(updated);
    } catch (error) {
      console.error('Failed to transition case:', error);
      res.status(500).json({ error: 'Failed to update case status.' });
    }
  });

  app.post('/api/cases/:id/note', rbacMiddleware('cases:write'), async (req, res) => {
    try {
      const { text } = req.body ?? {};
      const updated = await appendCaseNote({
        userId: req.session.user.id,
        id: req.params.id,
        text
      });
      res.json(updated);
    } catch (error) {
      console.error('Failed to add case note:', error);
      res.status(500).json({ error: 'Failed to add note.' });
    }
  });

  app.get('/api/commands', rbacMiddleware('commands:update'), async (_req, res) => {
    try {
      const commands = await listCommands();
      res.json(commands);
    } catch (error) {
      console.error('Failed to list commands:', error);
      res.status(500).json({ error: 'Failed to load commands.' });
    }
  });

  app.post('/api/commands/:name/toggle', rbacMiddleware('commands:update'), async (req, res) => {
    try {
      const result = await setCommandEnabled({
        userId: req.session.user.id,
        name: req.params.name,
        enabled: Boolean(req.body?.enabled)
      });
      res.json(result);
    } catch (error) {
      console.error('Failed to toggle command:', error);
      res.status(500).json({ error: 'Failed to update command.' });
    }
  });

  app.post('/api/commands/:name/cooldown', rbacMiddleware('commands:update'), async (req, res) => {
    try {
      const seconds = Number(req.body?.seconds ?? 0);
      const result = await setCommandCooldown({
        userId: req.session.user.id,
        name: req.params.name,
        seconds
      });
      res.json(result);
    } catch (error) {
      console.error('Failed to set command cooldown:', error);
      res.status(500).json({ error: 'Failed to update command cooldown.' });
    }
  });

  app.post('/api/alerts/:key/ack', rbacMiddleware('alerts:ack'), async (req, res) => {
    try {
      const result = await acknowledgeAlert(req.params.key);
      await recordAuditEntry({
        userId: req.session.user.id,
        action: 'alerts.ack',
        target: req.params.key
      });
      res.json(result);
    } catch (error) {
      console.error('Failed to acknowledge alert:', error);
      res.status(500).json({ error: 'Failed to acknowledge alert.' });
    }
  });

  app.post('/api/alerts/:key/silence', rbacMiddleware('alerts:silence'), async (req, res) => {
    try {
      const hours = Number(req.body?.hours ?? 1);
      const result = await silenceAlert(req.params.key, hours);
      await recordAuditEntry({
        userId: req.session.user.id,
        action: 'alerts.silence',
        target: req.params.key,
        payload: { hours }
      });
      res.json(result);
    } catch (error) {
      console.error('Failed to silence alert:', error);
      res.status(500).json({ error: 'Failed to silence alert.' });
    }
  });

  app.post('/api/summary/daily', rbacMiddleware('metrics:read'), async (req, res) => {
    try {
      await recordAuditEntry({
        userId: req.session.user.id,
        action: 'summary.daily',
        target: null,
        payload: req.body ?? {}
      });
      res.json({ success: true });
    } catch (error) {
      console.error('Failed to run daily summary:', error);
      res.status(500).json({ error: 'Failed to run daily summary.' });
    }
  });

  app.post('/api/onboarding/followups', rbacMiddleware('people:*'), async (req, res) => {
    try {
      await recordAuditEntry({
        userId: req.session.user.id,
        action: 'onboarding.followups',
        target: null,
        payload: req.body ?? {}
      });
      res.json({ success: true });
    } catch (error) {
      console.error('Failed to trigger onboarding follow-ups:', error);
      res.status(500).json({ error: 'Failed to trigger follow-ups.' });
    }
  });

  app.post('/api/cases/health', rbacMiddleware('cases:*'), async (req, res) => {
    try {
      const cases = await listCases({});
      const now = Date.now();
      const overdue = cases.filter((entry) => entry.slaAt && new Date(entry.slaAt).getTime() < now);
      const escalated = cases.filter((entry) => entry.status === 'escalated');
      const open = cases.filter((entry) => entry.status === 'open');
      res.json({
        open: open.length,
        escalated: escalated.length,
        overdue: overdue.length
      });
    } catch (error) {
      console.error('Failed to compute case health:', error);
      res.status(500).json({ error: 'Failed to compute case health.' });
    }
  });

  return app;
}
