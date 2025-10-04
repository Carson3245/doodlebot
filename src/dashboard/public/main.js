const statusElement = document.querySelector('#bot-status');
const usernameElement = document.querySelector('#bot-username');
const uptimeElement = document.querySelector('#bot-uptime');
const guildList = document.querySelector('#guild-list');
const commandsList = document.querySelector('#commands-list');
const menuToggle = document.querySelector('.menu-toggle');
const menuPanel = document.querySelector('#main-menu');
const messageForm = document.querySelector('#message-form');
const feedback = document.querySelector('#message-feedback');
const personalityForm = document.querySelector('#personality-form');
const personalityFeedback = document.querySelector('#personality-feedback');
const aiModeSelect = personalityForm?.querySelector('#ai-mode');
const huggingfaceSettings = personalityForm?.querySelector('#huggingface-settings');

if (menuToggle && menuPanel) {
  menuPanel.hidden = true;
  menuToggle.setAttribute('aria-expanded', 'false');

  menuToggle.addEventListener('click', () => {
    const open = menuToggle.getAttribute('aria-expanded') === 'true';
    menuToggle.setAttribute('aria-expanded', String(!open));
    menuPanel.hidden = open;
  });

  document.addEventListener('click', (event) => {
    if (
      menuPanel.hidden ||
      event.target === menuPanel ||
      menuPanel.contains(event.target) ||
      event.target === menuToggle ||
      menuToggle.contains(event.target)
    ) {
      return;
    }

    menuToggle.setAttribute('aria-expanded', 'false');
    menuPanel.hidden = true;
  });

  menuPanel.querySelectorAll('.menu-item').forEach((link) => {
    link.addEventListener('click', () => {
      menuToggle.setAttribute('aria-expanded', 'false');
      menuPanel.hidden = true;
    });
  });
}

function updateAIVisibility(mode) {
  if (huggingfaceSettings) {
    huggingfaceSettings.hidden = mode !== 'huggingface';
  }
}

if (aiModeSelect) {
  updateAIVisibility(aiModeSelect.value);
  aiModeSelect.addEventListener('change', (event) => {
    updateAIVisibility(event.target.value);
  });
}

async function fetchStatus() {
  if (!statusElement || !usernameElement || !uptimeElement || !guildList) return;

  try {
    const response = await fetch('/api/status');
    const data = await response.json();

    statusElement.textContent = data.status === 'online' ? 'Online' : 'Offline';
    usernameElement.textContent = data.username ?? 'N/A';
    uptimeElement.textContent = formatDuration(data.uptime ?? 0);

    guildList.innerHTML = '';
    data.guilds?.forEach((guild) => {
      const item = document.createElement('li');
      item.textContent = `${guild.name} (${guild.id})`;
      guildList.appendChild(item);
    });
  } catch (error) {
    console.error(error);
    statusElement.textContent = 'Failed to load status';
  }
}

async function fetchCommands() {
  if (!commandsList) return;

  try {
    const response = await fetch('/api/commands');
    const data = await response.json();

    commandsList.innerHTML = '';
    data.forEach((command) => {
      const item = document.createElement('li');
      item.innerHTML = `<strong>/${command.name}</strong><br /><small>${command.description}</small><br /><small>Default cooldown: ${command.cooldown}s</small>`;
      commandsList.appendChild(item);
    });

    if (commandsList.children.length === 0) {
      const empty = document.createElement('li');
      empty.textContent = 'No commands registered yet.';
      empty.className = 'placeholder';
      commandsList.appendChild(empty);
    }
  } catch (error) {
    console.error(error);
    commandsList.innerHTML = '<li class="placeholder">Could not load commands.</li>';
  }
}

messageForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const formData = new FormData(messageForm);
  const payload = Object.fromEntries(formData.entries());

  if (feedback) {
    feedback.textContent = 'Sending message...';
    feedback.style.color = '';
  }

  try {
    const response = await fetch('/api/send-message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const error = await response.json();
      if (feedback) {
        feedback.textContent = `Error: ${error.error ?? 'unable to send.'}`;
        feedback.style.color = '#ff6b6b';
      }
      return;
    }

    if (feedback) {
      feedback.textContent = 'Message sent successfully!';
      feedback.style.color = '#63e6be';
    }
    messageForm.reset();
  } catch (error) {
    console.error(error);
    if (feedback) {
      feedback.textContent = 'Could not reach the server.';
      feedback.style.color = '#ff6b6b';
    }
  }
});

async function populatePersonalityForm() {
  if (!personalityForm) {
    return;
  }

  try {
    const response = await fetch('/api/personality');
    const data = await response.json();

    const welcomeInput = personalityForm.querySelector('#welcome-message');
    const toneSelect = personalityForm.querySelector('#tone-select');
    const keywordsInput = personalityForm.querySelector('#keywords');
    const styleSelect = personalityForm.querySelector('#conversation-style');
    const shortReplyInput = personalityForm.querySelector('#short-reply');
    const acknowledgementsInput = personalityForm.querySelector('#acknowledgements');
    const keywordResponsesInput = personalityForm.querySelector('#keyword-responses');
    const hfModelIdInput = personalityForm.querySelector('#hf-model-id');
    const hfMaxTokensInput = personalityForm.querySelector('#hf-max-tokens');
    const hfTemperatureInput = personalityForm.querySelector('#hf-temperature');
    const hfTopPInput = personalityForm.querySelector('#hf-top-p');
    const hfRepetitionInput = personalityForm.querySelector('#hf-repetition');

    if (welcomeInput) {
      welcomeInput.value = data.welcomeMessage ?? '';
    }
    if (toneSelect) {
      toneSelect.value = data.tone ?? 'friendly';
    }
    if (keywordsInput) {
      keywordsInput.value = Array.isArray(data.keywords) ? data.keywords.join(', ') : data.keywords ?? '';
    }
    if (styleSelect) {
      styleSelect.value = data.conversation?.style ?? 'supportive';
    }
    if (shortReplyInput) {
      shortReplyInput.value = data.conversation?.shortReplyChance ?? 0.2;
    }
    if (acknowledgementsInput) {
      const phrases = data.conversation?.acknowledgementPhrases ?? [];
      acknowledgementsInput.value = phrases.join('\n');
    }
    if (keywordResponsesInput) {
      const keywordMap = data.conversation?.keywordResponses ?? {};
      const lines = Object.entries(keywordMap).map(([key, value]) => `${key}: ${value}`);
      keywordResponsesInput.value = lines.join('\n');
    }
    if (aiModeSelect) {
      aiModeSelect.value = data.ai?.mode ?? 'rules';
      updateAIVisibility(aiModeSelect.value);
    }
    if (hfModelIdInput) {
      hfModelIdInput.value = data.ai?.huggingface?.modelId ?? '';
    }
    if (hfMaxTokensInput) {
      hfMaxTokensInput.value = data.ai?.huggingface?.maxNewTokens ?? 60;
    }
    if (hfTemperatureInput) {
      hfTemperatureInput.value = data.ai?.huggingface?.temperature ?? 0.7;
    }
    if (hfTopPInput) {
      hfTopPInput.value = data.ai?.huggingface?.topP ?? 0.9;
    }
    if (hfRepetitionInput) {
      hfRepetitionInput.value = data.ai?.huggingface?.repetitionPenalty ?? 1.1;
    }
  } catch (error) {
    console.error('Failed to load personality configuration', error);
    if (personalityFeedback) {
      personalityFeedback.textContent = 'Failed to load the personality configuration.';
      personalityFeedback.style.color = '#ff6b6b';
    }
  }
}

personalityForm?.addEventListener('submit', async (event) => {
  event.preventDefault();

  const welcomeInput = personalityForm.querySelector('#welcome-message');
  const toneSelect = personalityForm.querySelector('#tone-select');
  const keywordsInput = personalityForm.querySelector('#keywords');
  const styleSelect = personalityForm.querySelector('#conversation-style');
  const shortReplyInput = personalityForm.querySelector('#short-reply');
  const acknowledgementsInput = personalityForm.querySelector('#acknowledgements');
  const keywordResponsesInput = personalityForm.querySelector('#keyword-responses');
  const hfModelIdInput = personalityForm.querySelector('#hf-model-id');
  const hfMaxTokensInput = personalityForm.querySelector('#hf-max-tokens');
  const hfTemperatureInput = personalityForm.querySelector('#hf-temperature');
  const hfTopPInput = personalityForm.querySelector('#hf-top-p');
  const hfRepetitionInput = personalityForm.querySelector('#hf-repetition');

  const payload = {
    welcomeMessage: welcomeInput?.value ?? '',
    tone: toneSelect?.value ?? 'friendly',
    keywords: keywordsInput?.value ?? '',
    conversation: {
      style: styleSelect?.value ?? 'supportive',
      shortReplyChance: Number(shortReplyInput?.value ?? 0.2),
      acknowledgementPhrases: acknowledgementsInput?.value ?? '',
      keywordResponses: keywordResponsesInput?.value ?? ''
    },
    ai: {
      mode: aiModeSelect?.value ?? 'rules',
      huggingface: {
        modelId: hfModelIdInput?.value ?? '',
        maxNewTokens: Number(hfMaxTokensInput?.value ?? 60),
        temperature: Number(hfTemperatureInput?.value ?? 0.7),
        topP: Number(hfTopPInput?.value ?? 0.9),
        repetitionPenalty: Number(hfRepetitionInput?.value ?? 1.1)
      }
    }
  };

  if (personalityFeedback) {
    personalityFeedback.textContent = 'Saving personality...';
    personalityFeedback.style.color = '';
  }

  try {
    const response = await fetch('/api/personality', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw new Error('Request failed');
    }

    if (personalityFeedback) {
      personalityFeedback.textContent = 'Personality saved successfully.';
      personalityFeedback.style.color = '#63e6be';
    }
    await populatePersonalityForm();
  } catch (error) {
    console.error('Failed to save personality configuration', error);
    if (personalityFeedback) {
      personalityFeedback.textContent = 'Could not save the personality configuration.';
      personalityFeedback.style.color = '#ff6b6b';
    }
  }
});

function formatDuration(ms) {
  if (!ms) return 'N/A';

  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return `${hours.toString().padStart(2, '0')}:${minutes
    .toString()
    .padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

if (statusElement && usernameElement && uptimeElement && guildList) {
  fetchStatus();
  setInterval(fetchStatus, 15000);
}

if (commandsList) {
  fetchCommands();
}

if (personalityForm) {
  populatePersonalityForm();
}
