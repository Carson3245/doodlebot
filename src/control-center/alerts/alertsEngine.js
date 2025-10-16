import { listAlertRules, getAlertState, updateAlertState, setAlertStatus } from '../data/alertsStore.js';
import { listPeople } from '../data/peopleStore.js';
import { listModActions } from '../data/modActionsStore.js';
import { getEngagementEvents } from '../data/engagementStore.js';
import { getHeartbeatStatus } from '../runtime/heartbeat.js';

const HOUR_MS = 60 * 60 * 1000;

export async function evaluateAlerts({ guildId = 'default', now = new Date() } = {}) {
  const [rules, state, people] = await Promise.all([
    listAlertRules(),
    getAlertState(),
    listPeople()
  ]);
  const nowMs = now.getTime();
  const nextState = { ...state };
  const triggered = [];

  for (const rule of rules) {
    const windowDays = rule.window === '30d' ? 30 : 7;
    const scope = await buildScope({ windowDays, now: nowMs, people, guildId });
    const meetsSamples = !rule.minSamples || deriveSampleCount(rule, scope) >= rule.minSamples;
    if (!meetsSamples) {
      continue;
    }

    const conditionMet = evaluateCondition(rule.condition, scope);
    const entry = nextState[rule.key] ?? {};
    const cooldownUntil = entry.cooldownUntil ? new Date(entry.cooldownUntil).getTime() : 0;
    const inCooldown = cooldownUntil && cooldownUntil > nowMs;

    if (conditionMet && !inCooldown) {
      const lastTriggered = new Date(nowMs).toISOString();
      const cooldownMs = Number(rule.cooldownHours ?? 1) * HOUR_MS;
      const newState = {
        lastTriggered,
        status: entry.status === 'ack' ? 'ack' : 'active',
        cooldownUntil: new Date(nowMs + cooldownMs).toISOString()
      };
      nextState[rule.key] = newState;
      triggered.push({
        key: rule.key,
        severity: rule.severity,
        text: rule.text,
        link: rule.link,
        status: newState.status,
        lastTriggered
      });
    } else if (!conditionMet && entry && entry.status === 'active') {
      nextState[rule.key] = { ...entry, status: 'recovered' };
    }
  }

  await updateAlertState(nextState);
  return triggered;
}

export async function acknowledgeAlert(key) {
  const result = await setAlertStatus(key, (entry) => ({
    ...entry,
    status: 'ack',
    acknowledgedAt: new Date().toISOString()
  }));
  return result;
}

export async function silenceAlert(key, hours) {
  const result = await setAlertStatus(key, (entry) => ({
    ...entry,
    status: 'silenced',
    cooldownUntil: new Date(Date.now() + Number(hours ?? 1) * HOUR_MS).toISOString()
  }));
  return result;
}

async function buildScope({ windowDays, now, people, guildId }) {
  const windowMs = windowDays * 24 * 60 * 60 * 1000;
  const previousStart = now - windowMs * 2;
  const currentStart = now - windowMs;

  const [modActions, engagement] = await Promise.all([
    listModActions({ sinceMs: windowMs * 2 }),
    getEngagementEvents({ sinceMs: windowMs * 2 })
  ]);

  const modCurr = modActions.filter((entry) => entry.ts >= currentStart && entry.ts <= now);
  const modPrev = modActions.filter((entry) => entry.ts >= previousStart && entry.ts < currentStart);

  const engagementCurr = engagement.filter((entry) => entry.ts >= currentStart && entry.ts <= now);
  const engagementPrev = engagement.filter(
    (entry) => entry.ts >= previousStart && entry.ts < currentStart
  );

  const exitsCurr = people.filter((person) => {
    if (!person.dateLeft) {
      return false;
    }
    const ts = new Date(person.dateLeft).getTime();
    return ts >= currentStart && ts <= now;
  }).length;

  const exitsPrev = people.filter((person) => {
    if (!person.dateLeft) {
      return false;
    }
    const ts = new Date(person.dateLeft).getTime();
    return ts >= previousStart && ts < currentStart;
  }).length;

  const heartbeat = getHeartbeatStatus();

  return {
    exits: {
      curr: exitsCurr,
      prev: exitsPrev
    },
    eng: {
      total: {
        curr: engagementCurr.length,
        prev: engagementPrev.length
      },
      avg: {
        curr: engagementCurr.length / windowDays,
        prev: engagementPrev.length / windowDays
      }
    },
    mod: {
      auto: {
        curr: modCurr.filter((entry) => entry.type === 'auto').length,
        prev: modPrev.filter((entry) => entry.type === 'auto').length
      }
    },
    heartbeatStale: heartbeat.status !== 'Online',
    windowDays
  };
}

function deriveSampleCount(rule, scope) {
  if (rule.condition.includes('eng.')) {
    return scope.eng.total.curr;
  }
  if (rule.condition.includes('exits.')) {
    return scope.exits.curr;
  }
  if (rule.condition.includes('mod.')) {
    return scope.mod.auto.curr;
  }
  return scope.eng.total.curr;
}

function evaluateCondition(condition, scope) {
  try {
    const fn = new Function('exits', 'eng', 'mod', 'heartbeatStale', 'windowDays', `return (${condition});`);
    return Boolean(fn(scope.exits, scope.eng, scope.mod, scope.heartbeatStale, scope.windowDays));
  } catch (error) {
    console.error('Failed to evaluate alert condition:', condition, error);
    return false;
  }
}
