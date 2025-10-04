import { generateWithHuggingFace } from './engines.js';

const HISTORY_LIMIT = 6;

export async function createChatReply({
  message,
  personality,
  history = [],
  authorName,
  botName,
  guildName
}) {
  const trimmed = message.trim();
  if (!trimmed) {
    throw new Error('ChatInputEmpty 1001');
  }

  const normalized = trimmed.toLowerCase();
  const keywordResponse = detectKeywordResponse(normalized, personality);
  if (keywordResponse) {
    return applyTone(keywordResponse, personality);
  }

  const mode = personality?.ai?.mode ?? 'rules';

  if (mode === 'huggingface') {
    const prompt = buildPrompt({
      personality,
      history,
      authorName,
      botName,
      guildName,
      latestMessage: trimmed
    });

    try {
      const raw = await generateWithHuggingFace(prompt, personality.ai?.huggingface);
      return cleanOutput(raw, personality);
    } catch (error) {
      const message = error?.message || '';
      if (message.includes(' 2004') || message.includes(' 2005')) {
        throw error;
      }
      const wrapped = new Error('HuggingFaceGenerationFailed 2001');
      wrapped.cause = error;
      throw wrapped;
    }
  }

  return generateRuleBasedResponse(personality);
}

function detectKeywordResponse(message, personality) {
  const keywordEntries = Object.entries(personality.conversation.keywordResponses ?? {});
  for (const [keyword, response] of keywordEntries) {
    if (message.includes(keyword)) {
      return response;
    }
  }
  return null;
}

function generateRuleBasedResponse(personality) {
  const acknowledgements = personality.conversation.acknowledgementPhrases ?? [];
  if (acknowledgements.length) {
    const index = Math.floor(Math.random() * acknowledgements.length);
    const acknowledgement = acknowledgements[index];
    const shouldKeepShort = Math.random() < personality.conversation.shortReplyChance;
    if (shouldKeepShort) {
      return applyTone(acknowledgement, personality);
    }
    return applyTone(`${acknowledgement} Tell me more so I can assist you better.`, personality);
  }
  throw new Error('NoAcknowledgementPhrasesConfigured 3001');
}

function buildPrompt({ personality, history, authorName, botName, guildName, latestMessage }) {
  const safeBotName = botName || 'the assistant';
  const safeAuthor = authorName || 'the user';
  const safeGuild = guildName || 'this server';

  const intro = `You are ${safeBotName}, a helpful and lightweight Discord bot assisting members of ${safeGuild}. ` +
    `Keep responses under 80 words, stay in ASCII, and match the tone "${personality.tone}" with the style "${personality.conversation.style}". ` +
    'Do not use emojis or markdown tables. Provide concise, friendly help.';

  const rules = [`Greeting template: ${personality.welcomeMessage}`, `Important keywords: ${(personality.keywords || []).join(', ')}`];
  const keywordInstructions = Object.entries(personality.conversation.keywordResponses || {})
    .map(([key, response]) => `If the user mentions "${key}", you should cover: ${response}`);

  const historyLines = [];
  const trimmedHistory = history.slice(-HISTORY_LIMIT * 2);
  for (const entry of trimmedHistory) {
    if (!entry?.content) continue;
    const speaker = entry.role === 'assistant' ? safeBotName : safeAuthor;
    historyLines.push(`${speaker}: ${entry.content}`);
  }

  historyLines.push(`${safeAuthor}: ${latestMessage}`);
  historyLines.push(`${safeBotName}:`);

  const promptSections = [intro, ...rules, ...keywordInstructions, 'Conversation so far:', ...historyLines];
  return promptSections.filter(Boolean).join('\n');
}

function cleanOutput(output, personality) {
  if (!output) {
    throw new Error('EmptyHuggingFaceOutput 2002');
  }

  const asciiOnly = output.replace(/[^\x20-\x7E\n]/g, '').trim();
  if (!asciiOnly) {
    throw new Error('FilteredHuggingFaceOutputEmpty 2003');
  }

  return asciiOnly.split('\n').map((line) => line.trim()).filter(Boolean).join(' ');
}

function applyTone(message, personality) {
  const style = personality.conversation.style;
  const tone = personality.tone;

  if (style === 'informative') {
    return `${message} Here is what I understand so far: you are looking for details or guidance.`;
  }
  if (style === 'playful') {
    return `${message} Let us turn this into something fun to solve together.`;
  }
  if (style === 'concise') {
    return `${message}`;
  }
  if (tone === 'professional') {
    return `${message} Please provide any additional information you consider relevant.`;
  }
  if (tone === 'serious') {
    return `${message} I am focused on helping you resolve this.`;
  }
  if (tone === 'playful') {
    return `${message} Let us keep this lively.`;
  }
  return `${message} I am here for you.`;
}
