import fs from 'node:fs/promises';
import path from 'node:path';

const CONFIG_PATH = path.resolve(process.cwd(), 'config', 'rbac.json');
let cache;
let loadedAt = 0;
const CACHE_TTL_MS = 5 * 60 * 1000;

async function loadConfig() {
  const now = Date.now();
  if (cache && now - loadedAt < CACHE_TTL_MS) {
    return cache;
  }
  const buffer = await fs.readFile(CONFIG_PATH, 'utf8');
  cache = JSON.parse(buffer);
  loadedAt = now;
  return cache;
}

function patternMatches(permission, pattern) {
  if (pattern === '*') {
    return true;
  }
  if (!pattern.includes('*')) {
    return permission === pattern;
  }
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  const regex = new RegExp(`^${escaped}$`);
  return regex.test(permission);
}

export async function listRoles() {
  const config = await loadConfig();
  return Object.keys(config);
}

export async function getPermissionsForRole(role) {
  const config = await loadConfig();
  const rules = config[role];
  if (!rules) {
    return [];
  }
  return Array.from(new Set(rules));
}

export async function resolvePermissions(roles = []) {
  const config = await loadConfig();
  const patterns = roles.flatMap((role) => config[role] ?? []);
  return Array.from(new Set(patterns));
}

export async function hasPermission(roles = [], permission) {
  if (!permission) {
    return true;
  }
  const config = await loadConfig();
  for (const role of roles) {
    const patterns = config[role];
    if (!patterns) {
      continue;
    }
    for (const pattern of patterns) {
      if (patternMatches(permission, pattern)) {
        return true;
      }
    }
  }
  return false;
}

export function rbacMiddleware(permission) {
  return async (req, res, next) => {
    const roles = req.session?.roles ?? [];
    const allowed = await hasPermission(roles, permission);
    if (!allowed) {
      res.status(403).json({ error: 'forbidden' });
      return;
    }
    next();
  };
}
