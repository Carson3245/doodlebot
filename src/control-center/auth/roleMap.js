import fs from 'node:fs/promises';
import path from 'node:path';

const MAP_PATH = path.resolve(process.cwd(), 'data', 'roles.map.json');
let cache;
let loadedAt = 0;
const TTL = 60 * 1000;

async function loadRoleMap() {
  const now = Date.now();
  if (cache && now - loadedAt < TTL) {
    return cache;
  }
  try {
    const buffer = await fs.readFile(MAP_PATH, 'utf8');
    cache = JSON.parse(buffer || '{}');
    loadedAt = now;
    return cache;
  } catch (error) {
    if (error.code === 'ENOENT') {
      cache = {};
      loadedAt = now;
      return cache;
    }
    throw error;
  }
}

export async function resolveRolesForMember(discordRoleIds = []) {
  const roleMap = await loadRoleMap();
  const resolved = new Set();
  for (const roleId of discordRoleIds) {
    const mapped = roleMap[roleId];
    if (!mapped) {
      continue;
    }
    if (Array.isArray(mapped)) {
      for (const entry of mapped) {
        resolved.add(entry);
      }
    } else if (typeof mapped === 'string') {
      resolved.add(mapped);
    }
  }
  if (!resolved.size) {
    resolved.add('Viewer');
  }
  return Array.from(resolved);
}

export async function saveRoleMap(map) {
  const payload = JSON.stringify(map, null, 2);
  await fs.writeFile(MAP_PATH, payload, 'utf8');
  cache = map;
  loadedAt = Date.now();
  return map;
}
