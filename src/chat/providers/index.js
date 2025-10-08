import { callDreamGen } from './dreamgen.js';

const AVAILABLE_PROVIDERS = {
  dreamgen: callDreamGen
};

function getProviderOrder() {
  const raw = process.env.CHAT_PROVIDERS || 'dreamgen';
  return String(raw)
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

export async function generateWithProviders({ messages, controls }) {
  const order = getProviderOrder();
  if (order.length === 0) {
    throw new Error('ChatProvidersNotConfigured 5201');
  }

  const errors = [];

  for (const key of order) {
    const provider = AVAILABLE_PROVIDERS[key];
    if (!provider) {
      errors.push(new Error(`ChatProviderUnknown ${key}`));
      continue;
    }

    try {
      const reply = await provider({ messages, controls });
      if (reply) {
        return reply;
      }
      errors.push(new Error(`ChatProviderEmptyResponse ${key}`));
    } catch (error) {
      errors.push(error);
    }
  }

  const merged = new Error('AllChatProvidersFailed 5202');
  merged.causes = errors;
  throw merged;
}
