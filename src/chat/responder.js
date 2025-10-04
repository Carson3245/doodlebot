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

function buildPrompt({ personality, history, authorName, botName, guildName, latestMessage }) {
  const safeBotName = botName || 'the assistant';
  const safeAuthor = authorName || 'the user';
  const safeGuild = guildName || 'this server';

  const tone = personality.tone || 'friendly';
  const style = personality.conversation?.style || 'supportive';
  const guidance = personality.conversation?.guidance || '';
  const responseLength = personality.conversation?.responseLength || 80;
  const welcomeMessage = personality.welcomeMessage || 'Welcome aboard!';

  const intro = `You are ${safeBotName}, a lightweight Discord bot that supports members of ${safeGuild}.`;
  const behaviour = `Respond to ${safeAuthor} in a ${tone} tone with a ${style} style. Stay within ${responseLength} words, keep ASCII-only text, and avoid emojis or markdown tables.`;

  const reminders = [`Greeting template: ${welcomeMessage}`];
  if (guidance) {
    reminders.push(`Follow these operator notes: ${guidance}`);
  }

  const historyLines = [];
  const trimmedHistory = history.slice(-HISTORY_LIMIT * 2);
  for (const entry of trimmedHistory) {
    if (!entry?.content) continue;
    const speaker = entry.role === 'assistant' ? safeBotName : safeAuthor;
    historyLines.push(`${speaker}: ${entry.content}`);
  }

  historyLines.push(`${safeAuthor}: ${latestMessage}`);
  historyLines.push(`${safeBotName}:`);

  const promptSections = [intro, behaviour, ...reminders, 'Conversation so far:', ...historyLines];
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
