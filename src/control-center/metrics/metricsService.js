import { listPeople } from '../data/peopleStore.js';
import { listCases } from '../data/caseStore.js';
import { getEngagementEvents } from '../data/engagementStore.js';
import { listAlertRules, getAlertState } from '../data/alertsStore.js';
import { getHeartbeatStatus } from '../runtime/heartbeat.js';

const CACHE_TTL_MS = 60 * 1000;
const cache = new Map();

export async function getKpis({ guildId = 'default', rangeDays = 7, date } = {}) {
  return cached(`kpis:${guildId}:${rangeDays}:${date ?? 'today'}`, async () => {
    const targetDate = date ? new Date(date) : new Date();
    const prevDate = new Date(targetDate.getTime() - Number(rangeDays) * 24 * 60 * 60 * 1000);

    const [people, cases, engagement] = await Promise.all([
      listPeople(),
      listCases(),
      getEngagementEvents({ sinceMs: rangeDays * 24 * 60 * 60 * 1000 })
    ]);

    const active = countActiveHeadcount(people, targetDate);
    const activePrev = countActiveHeadcount(people, prevDate);

    const flow = computeFlowSeries(people, targetDate, 2);
    const entriesMonth = flow.current.entries;
    const exitsMonth = flow.current.exits;

    const engagementSummary = summarizeEngagement(engagement, rangeDays);
    const engagementPrev = await summarizeEngagementPreviousWindow(rangeDays);

    const openCases = cases.filter((caseRecord) => caseRecord.status === 'open').length;
    const openCasesPrev = cases.filter((caseRecord) => {
      const updatedAt = new Date(caseRecord.updatedAt ?? caseRecord.createdAt ?? 0);
      return updatedAt <= prevDate && caseRecord.status === 'open';
    }).length;

    const heartbeat = getHeartbeatStatus();

    return {
      active,
      entriesMonth,
      exitsMonth,
      openCases,
      engagementPerDay: engagementSummary.avgPerDay,
      botStatus: heartbeat.status,
      deltas: {
        active: makeDelta(active, activePrev),
        entriesMonth: makeDelta(entriesMonth, flow.previous.entries),
        exitsMonth: makeDelta(exitsMonth, flow.previous.exits),
        openCases: makeDelta(openCases, openCasesPrev),
        engagementPerDay: makeDelta(engagementSummary.avgPerDay, engagementPrev.avgPerDay)
      },
      engagementTop: engagementSummary.top
    };
  });
}

export async function getHeadcountSeries({ guildId = 'default', start, end }) {
  return cached(`headcount:${guildId}:${start}:${end}`, async () => {
    const people = await listPeople();
    const months = enumerateMonths(start, end);
    return months.map((month) => {
      const lastDay = new Date(Date.UTC(month.year, month.month + 1, 0, 23, 59, 59, 999));
      const count = people.filter((person) => {
        const joined = new Date(person.dateJoined);
        if (joined > lastDay) {
          return false;
        }
        if (person.dateLeft) {
          const left = new Date(person.dateLeft);
          return left > lastDay;
        }
        return true;
      }).length;
      return {
        month: `${month.year}-${String(month.month + 1).padStart(2, '0')}`,
        count
      };
    });
  });
}

export async function getFlowSeries({ guildId = 'default', start, end }) {
  return cached(`flow:${guildId}:${start}:${end}`, async () => {
    const people = await listPeople();
    const months = enumerateMonths(start, end);
    return months.map((month) => {
      const ym = `${month.year}-${String(month.month + 1).padStart(2, '0')}`;
      const entries = people.filter((person) => monthKey(person.dateJoined) === ym).length;
      const exits = people.filter(
        (person) => person.dateLeft && monthKey(person.dateLeft) === ym
      ).length;
      return { month: ym, entries, exits };
    });
  });
}

export async function getEngagementSummary({ guildId = 'default', days = 7 }) {
  return cached(`engagement:${guildId}:${days}`, async () => {
    const events = await getEngagementEvents({ sinceMs: days * 24 * 60 * 60 * 1000 });
    const summary = summarizeEngagement(events, days);
    const previous = await summarizeEngagementPreviousWindow(days);
    summary.delta = makeDelta(summary.avgPerDay, previous.avgPerDay);
    return summary;
  });
}

export async function getAlertsMetrics({ guildId = 'default', days = 7 }) {
  return cached(`alerts:${guildId}:${days}`, async () => {
    const [rules, state] = await Promise.all([listAlertRules(), getAlertState()]);
    const active = [];
    for (const rule of rules) {
      const entry = state[rule.key];
      if (!entry) {
        continue;
      }
      if (entry.status === 'active' || entry.status === 'ack') {
        active.push({
          key: rule.key,
          severity: rule.severity,
          status: entry.status,
          lastTriggered: entry.lastTriggered,
          cooldownUntil: entry.cooldownUntil,
          text: rule.text,
          link: rule.link
        });
      }
    }
    return active;
  });
}

function makeDelta(curr, prev) {
  const absolute = curr - (prev ?? 0);
  const percent = prev ? (curr / prev - 1) : null;
  return {
    absolute,
    percent
  };
}

function summarizeEngagement(events, days) {
  if (!Array.isArray(events) || !events.length) {
    return { avgPerDay: 0, total: 0, top: [] };
  }
  const total = events.length;
  const avgPerDay = Math.round(total / Number(days));
  const perChannel = events.reduce((acc, event) => {
    const key = event.channelId ?? 'unknown';
    const value = acc.get(key) ?? 0;
    acc.set(key, value + 1);
    return acc;
  }, new Map());
  const top = Array.from(perChannel.entries())
    .map(([channelId, count]) => ({ channelId, name: channelId, messages: count }))
    .sort((a, b) => b.messages - a.messages)
    .slice(0, 10);
  return { avgPerDay, total, top };
}

async function summarizeEngagementPreviousWindow(days) {
  const events = await getEngagementEvents({ sinceMs: days * 24 * 60 * 60 * 1000 * 2 });
  if (!events.length) {
    return { avgPerDay: 0, total: 0, top: [] };
  }
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const previous = events.filter((event) => event.ts < cutoff);
  return summarizeEngagement(previous, days);
}

function countActiveHeadcount(people, atDate) {
  return people.filter((person) => {
    const joined = new Date(person.dateJoined);
    if (joined > atDate) {
      return false;
    }
    if (person.dateLeft) {
      const left = new Date(person.dateLeft);
      return left > atDate;
    }
    return true;
  }).length;
}

function computeFlowSeries(people, targetDate, depth = 2) {
  const currentMonth = monthKey(targetDate);
  const previousMonth = monthKey(new Date(targetDate.getFullYear(), targetDate.getMonth() - 1, 1));
  return {
    current: {
      month: currentMonth,
      entries: people.filter((person) => monthKey(person.dateJoined) === currentMonth).length,
      exits: people.filter((person) => person.dateLeft && monthKey(person.dateLeft) === currentMonth)
        .length
    },
    previous: {
      month: previousMonth,
      entries: people.filter((person) => monthKey(person.dateJoined) === previousMonth).length,
      exits: people.filter((person) => person.dateLeft && monthKey(person.dateLeft) === previousMonth)
        .length
    }
  };
}

function enumerateMonths(start, end) {
  const startDate = parseYearMonth(start);
  const endDate = parseYearMonth(end);
  const months = [];
  let year = startDate.year;
  let month = startDate.month;
  while (year < endDate.year || (year === endDate.year && month <= endDate.month)) {
    months.push({ year, month });
    month += 1;
    if (month > 11) {
      month = 0;
      year += 1;
    }
  }
  return months;
}

function parseYearMonth(value) {
  if (!value) {
    const now = new Date();
    return { year: now.getUTCFullYear(), month: now.getUTCMonth() };
  }
  const [yearStr, monthStr] = value.split('-');
  return {
    year: Number(yearStr),
    month: Number(monthStr) - 1
  };
}

function monthKey(input) {
  if (!input) {
    return null;
  }
  const date = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function cached(key, factory) {
  const entry = cache.get(key);
  const now = Date.now();
  if (entry && now - entry.createdAt < CACHE_TTL_MS) {
    return entry.value;
  }
  const promise = Promise.resolve().then(factory);
  cache.set(key, { createdAt: now, value: promise });
  promise.catch(() => cache.delete(key));
  return promise;
}
