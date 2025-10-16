import crypto from 'node:crypto';
import { readJson, writeJson } from '../data/jsonStore.js';

const AUDIT_FILE = 'audit.log.json';
const MAX_ENTRIES = 5000;

export async function listAuditEntries(limit = 200, offset = 0) {
  const entries = await readJson(AUDIT_FILE, []);
  const start = Math.max(entries.length - limit - offset, 0);
  const end = entries.length - offset;
  return entries.slice(start, end).reverse();
}

export async function recordAuditEntry({ at = new Date().toISOString(), userId, action, target, payload }) {
  const entries = await readJson(AUDIT_FILE, []);
  const payloadHash = payload ? hashPayload(payload) : undefined;
  const entry = { at, userId, action, target, payloadHash };
  const next = [...entries, entry];
  const trimmed = next.length > MAX_ENTRIES ? next.slice(next.length - MAX_ENTRIES) : next;
  await writeJson(AUDIT_FILE, trimmed);
  return entry;
}

function hashPayload(payload) {
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}
