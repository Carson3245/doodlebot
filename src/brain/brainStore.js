import fs from 'node:fs/promises';
import path from 'node:path';

const brainDirectory = path.resolve(process.cwd(), 'data', 'brain');
const brainFile = path.join(brainDirectory, 'users.json');

const defaultBrain = {
  updatedAt: null,
  users: {}
};

export async function recordInteraction({ userId, displayName, message }) {
  if (!userId || !message) {
    return;
  }

  const now = new Date().toISOString();
  const brain = await loadBrain();

  const current = brain.users[userId] ?? {
    userId,
    displayName,
    messageCount: 0,
    averageLength: 0,
    lastMessagePreview: '',
    lastSeenAt: null,
    vocabulary: []
  };

  const trimmed = sanitizeMessage(message);
  const length = trimmed.length;
  const newCount = current.messageCount + 1;
  const newAverage = Math.round(((current.averageLength * current.messageCount) + length) / newCount);

  const vocabulary = updateVocabulary(current.vocabulary ?? [], trimmed);

  brain.users[userId] = {
    ...current,
    displayName: displayName || current.displayName,
    messageCount: newCount,
    averageLength: newAverage,
    lastMessagePreview: trimmed.slice(0, 140),
    lastSeenAt: now,
    vocabulary
  };

  brain.updatedAt = now;
  await persistBrain(brain);
}

export async function getBrainSummary() {
  const brain = await loadBrain();
  const users = Object.values(brain.users);

  const topTalkers = [...users]
    .sort((a, b) => b.messageCount - a.messageCount)
    .slice(0, 5);

  const recentVisitors = [...users]
    .sort((a, b) => new Date(b.lastSeenAt ?? 0) - new Date(a.lastSeenAt ?? 0))
    .slice(0, 8);

  const averageLength =
    users.length === 0
      ? 0
      : Math.round(users.reduce((acc, item) => acc + item.averageLength, 0) / users.length);

  return {
    updatedAt: brain.updatedAt,
    totalTrackedUsers: users.length,
    averageMessageLength: averageLength,
    topTalkers,
    recentVisitors
  };
}

async function loadBrain() {
  try {
    const raw = await fs.readFile(brainFile, 'utf8');
    const parsed = JSON.parse(raw);
    return { ...defaultBrain, ...parsed, users: parsed.users ?? {} };
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.error('Failed to load brain store:', error);
    }
    return { ...defaultBrain };
  }
}

async function persistBrain(data) {
  await fs.mkdir(brainDirectory, { recursive: true });
  await fs.writeFile(brainFile, JSON.stringify(data, null, 2));
}

function sanitizeMessage(message) {
  return String(message).replace(/\s+/g, ' ').trim();
}

function updateVocabulary(currentVocabulary, message) {
  const words = message
    .toLowerCase()
    .replace(/[^a-z0-9\s]/gi, '')
    .split(' ')
    .filter(Boolean);

  const vocabSet = new Set(currentVocabulary);
  for (const word of words) {
    if (word.length >= 4) {
      vocabSet.add(word);
    }
  }

  return Array.from(vocabSet).slice(-25);
}
