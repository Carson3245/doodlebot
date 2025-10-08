const DEFAULT_MODEL = process.env.DREAMGEN_MODEL || 'lucid-v1-medium';
const DEFAULT_URL = process.env.DREAMGEN_API_URL || 'https://dreamgen.com/api/openai/v1/chat/completions';
const DEFAULT_TEMPERATURE = Number.parseFloat(process.env.DREAMGEN_TEMPERATURE || '0.7');
const DEFAULT_TOP_P = Number.parseFloat(process.env.DREAMGEN_TOP_P || '0.85');
const DEFAULT_MAX_TOKENS = Number.parseInt(process.env.DREAMGEN_MAX_TOKENS || '512', 10);

export async function callDreamGen({ messages, controls = {} }) {
  const apiKey = process.env.DREAMGEN_API_KEY;
  if (!apiKey) {
    throw new Error('DreamGenApiKeyMissing 5001');
  }

  const temperature = clampNumber(
    controls.temperature,
    0.1,
    1.3,
    Number.isNaN(DEFAULT_TEMPERATURE) ? 0.7 : DEFAULT_TEMPERATURE
  );
  const topP = clampNumber(controls.topP, 0.1, 1, Number.isNaN(DEFAULT_TOP_P) ? 0.85 : DEFAULT_TOP_P);

  const body = {
    model: DEFAULT_MODEL,
    messages,
    temperature,
    top_p: topP,
    max_tokens: Number.isNaN(DEFAULT_MAX_TOKENS) ? 512 : DEFAULT_MAX_TOKENS,
    stream: false
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);

  try {
    const response = await fetch(DEFAULT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });

    if (!response.ok) {
      const text = await safeReadText(response);
      const error = buildDreamGenError(response.status, text);
      throw error;
    }

    const data = await response.json();
    const choice = data?.choices?.[0];
    const content = choice?.message?.content ?? choice?.text;

    if (!content) {
      throw new Error('DreamGenEmptyResponse 5005');
    }

    if (Array.isArray(content)) {
      const textParts = content
        .map((part) => {
          if (typeof part === 'string') {
            return part;
          }
          if (part?.type === 'text' && typeof part?.text === 'string') {
            return part.text;
          }
          return '';
        })
        .filter(Boolean);
      return textParts.join(' ').trim();
    }

    if (typeof content === 'string') {
      return content.trim();
    }

    if (typeof content?.value === 'string') {
      return content.value.trim();
    }

    throw new Error('DreamGenMalformedResponse 5006');
  } catch (error) {
    if (error.name === 'AbortError') {
      const timeoutError = new Error('DreamGenRequestTimeout 5007');
      timeoutError.cause = error;
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function buildDreamGenError(status, details) {
  let message = `DreamGenRequestFailed ${status}`;
  if (status === 401) {
    message = 'DreamGenUnauthorized 5008';
  } else if (status === 403) {
    message = 'DreamGenForbidden 5009';
  } else if (status === 404) {
    message = 'DreamGenModelNotFound 5010';
  } else if (status === 429) {
    message = 'DreamGenRateLimited 5011';
  } else if (status >= 500) {
    message = 'DreamGenServerError 5012';
  }

  const error = new Error(message);
  if (details) {
    error.details = details;
  }
  if (status === 404) {
    error.model = DEFAULT_MODEL;
  }
  return error;
}

async function safeReadText(response) {
  try {
    return await response.text();
  } catch {
    return null;
  }
}

function clampNumber(value, min, max, fallback) {
  if (value === null || value === undefined) {
    return fallback;
  }
  const num = Number(value);
  if (!Number.isFinite(num)) {
    return fallback;
  }
  return Math.min(Math.max(num, min), max);
}
