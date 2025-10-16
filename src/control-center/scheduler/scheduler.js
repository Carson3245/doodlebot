import { listPeople, markCheckinDone } from '../data/peopleStore.js';
import { evaluateAlerts } from '../alerts/alertsEngine.js';
import { refreshHeartbeat } from '../runtime/heartbeat.js';

const TICK_INTERVAL_MS = 60 * 1000;

export function startControlCenterScheduler({ client, notifyAlert }) {
  const timer = setInterval(async () => {
    try {
      await Promise.all([handleDueCheckins(client), evaluateAndNotify(notifyAlert)]);
      refreshHeartbeat();
    } catch (error) {
      console.error('Scheduler tick failed:', error);
    }
  }, TICK_INTERVAL_MS);

  return () => clearInterval(timer);
}

async function handleDueCheckins(client) {
  const people = await listPeople();
  const now = Date.now();
  const due = [];
  for (const person of people) {
    for (const checkin of person.checkins ?? []) {
      if (checkin.done) {
        continue;
      }
      const dueAt = new Date(checkin.dueAt).getTime();
      if (Number.isNaN(dueAt)) {
        continue;
      }
      if (dueAt <= now) {
        due.push({ person, checkin });
      }
    }
  }

  for (const { person, checkin } of due) {
    if (!client) {
      continue;
    }
    try {
      const user = await client.users.fetch(person.discordId);
      const message = buildCheckinMessage(person, checkin);
      await user.send(message).catch(() => null);
      await markCheckinDone({
        userId: 'system',
        discordId: person.discordId,
        dueAt: checkin.dueAt
      });
    } catch (error) {
      console.error('Failed to send check-in DM:', error);
    }
  }
}

function buildCheckinMessage(person, checkin) {
  const typeLabel = { '7': 'Week 1', '30': 'Month 1', '90': 'Month 3' }[checkin.type] ?? 'Check-in';
  return `Hi ${person.name ?? 'there'}! This is your ${typeLabel} onboarding check-in. Reply here if you need anything.`;
}

async function evaluateAndNotify(notifyAlert) {
  const alerts = await evaluateAlerts({});
  if (!alerts.length) {
    return;
  }
  if (typeof notifyAlert === 'function') {
    for (const alert of alerts) {
      await notifyAlert(alert);
    }
  } else {
    for (const alert of alerts) {
      console.log('[Alert]', alert.key, alert.text);
    }
  }
}
