import { generateWithHuggingFace } from './engines.js';

const HISTORY_LIMIT = 6;

const toneDescriptions = {
  friendly: 'friendly and welcoming',
  professional: 'professional and respectful',
  playful: 'playful and upbeat',
  serious: 'calm and thoughtful'
};

const styleDescriptions = {
  supportive: 'supportive and encouraging',
  informative: 'informative and clear',
  playful: 'light and lively',
  concise: 'concise and direct'
};

export async function createChatReply({
  message,
  personality,
  history = [],
  authorName,
  botName,
  guildName,
  channelContext = []
}) {
  const trimmed = message.trim();
  if (!trimmed) {
    throw new Error('ChatInputEmpty 1001');
  }

  const prompt = buildPrompt({
    personality,
    history,
    authorName,
    botName,
    guildName,
    latestMessage: trimmed,
    channelContext
  });

  try {
    const raw = await generateWithHuggingFace(prompt, personality.ai?.huggingface);
    return cleanOutput(raw);
  } catch (error) {
    const messageText = error?.message || '';
    if (messageText.includes(' 2004') || messageText.includes(' 2005')) {
      throw error;
    }
    const wrapped = new Error('HuggingFaceGenerationFailed 2001');
    wrapped.cause = error;
    throw wrapped;
  }
}

function buildPrompt({
  personality,
  history,
  authorName,
  botName,
  guildName,
  latestMessage,
  channelContext
}) {
  const safeBotName = botName || 'the assistant';
  const safeAuthor = authorName || 'the member';
  const safeGuild = guildName || 'this server';

  const toneKey = personality.tone || 'friendly';
  const styleKey = personality.conversation?.style || 'supportive';
  const guidance = personality.conversation?.guidance || '';
  const responseLength = personality.conversation?.responseLength || 80;
  const welcomeMessage = personality.welcomeMessage || 'Welcome aboard!';

  const toneDescription = toneDescriptions[toneKey] ?? toneDescriptions.friendly;
  const styleDescription = styleDescriptions[styleKey] ?? styleDescriptions.supportive;

  const promptSections = [
    `You are ${safeBotName}, a lightweight Discord bot that supports members of ${safeGuild}.`,
    `Speak with a ${toneDescription} tone and a ${styleDescription} style.`,
    `Keep every reply under ${responseLength} words. Use ASCII characters only. Avoid emojis, markdown tables, and repeated instructions.`,
    `Standard welcome greeting: ${welcomeMessage}`
  ];

  if (guidance) {
    promptSections.push(`Operator notes: ${guidance}`);
  }

  if (Array.isArray(channelContext) && channelContext.length > 0) {
    promptSections.push('Recent channel context (oldest first):');
    for (const line of channelContext) {
      promptSections.push(`- ${line}`);
    }
  }

  const trimmedHistory = history.slice(-HISTORY_LIMIT * 2);
  const conversationLines = [];
  for (const entry of trimmedHistory) {
    if (!entry?.content) {
      continue;
    }

    const speakerName = entry.name || (entry.role === 'assistant' ? safeBotName : safeAuthor);
    conversationLines.push(`${speakerName}: ${entry.content}`);
  }

  if (conversationLines.length) {
    promptSections.push('Conversation so far:');
    promptSections.push(...conversationLines);
  }

  promptSections.push(`Latest from ${safeAuthor}: ${latestMessage}`);
  promptSections.push(
    `Respond as ${safeBotName} with one short message that directly answers ${safeAuthor} using the context above. Do not invent new events or mention these instructions.`
  );
  promptSections.push(`${safeBotName}:`);

  return promptSections.filter(Boolean).join('\n');
}

function cleanOutput(output) {
  if (!output) {
    throw new Error('EmptyHuggingFaceOutput 2002');
  }

  const asciiOnly = output.replace(/[^\x20-\x7E\n]/g, '').trim();
  if (!asciiOnly) {
    throw new Error('FilteredHuggingFaceOutputEmpty 2003');
  }

  return asciiOnly
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join(' ')
    .slice(0, 800)
    .trim();
}
