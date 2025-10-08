const statusElement = document.querySelector('#bot-status');
const usernameElement = document.querySelector('#bot-username');
const uptimeElement = document.querySelector('#bot-uptime');
const guildCountElement = document.querySelector('#guild-count');
const guildList = document.querySelector('#guild-list');
const commandsList = document.querySelector('#commands-list');
const sidebar = document.querySelector('.sidebar');
const navToggles = document.querySelectorAll('[data-nav-toggle]');
const navLinks = document.querySelectorAll('.sidebar__link');
const messageForm = document.querySelector('#message-form');
const feedback = document.querySelector('#message-feedback');
const identityForm = document.querySelector('#identity-form');
const messagingForm = document.querySelector('#messaging-form');
const identityFeedback = document.querySelector('#identity-feedback');
const messagingFeedback = document.querySelector('#messaging-feedback');
const settingsNavButtons = document.querySelectorAll('.settings-nav__item');
const settingsSections = document.querySelectorAll('.settings-section');
const brainStatsUsers = document.querySelector('#brain-users');
const brainStatsAverage = document.querySelector('#brain-average');
const brainStatsUpdated = document.querySelector('#brain-updated');
const brainTopTalkers = document.querySelector('#brain-top-talkers');
const brainRecent = document.querySelector('#brain-recent');
const authOverlay = document.querySelector('[data-auth-overlay]');
const authErrorMessage = document.querySelector('[data-auth-error]');
const authSignedIn = document.querySelectorAll('[data-auth-signed-in]');
const authSignedOut = document.querySelectorAll('[data-auth-signed-out]');
const authUsername = document.querySelector('[data-auth-username]');
const authAvatar = document.querySelector('[data-auth-avatar]');
const authLogoutButton = document.querySelector('[data-auth-logout]');
const authLoginButtons = document.querySelectorAll('[data-auth-login]');

highlightActiveNav();
setupNavigationToggles();

let authState = { authenticated: false, oauthEnabled: true };
let authIntervalsStarted = false;
let pendingAuthError = null;

try {
  const locationUrl = new URL(window.location.href);
  const authParam = locationUrl.searchParams.get('auth');
  if (authParam === 'failed') {
    pendingAuthError = 'Discord login failed. Please try again.';
  } else if (authParam && authParam !== 'failed') {
    pendingAuthError = 'Authentication was cancelled.';
  }
  if (authParam !== null) {
    locationUrl.searchParams.delete('auth');
    const newSearch = locationUrl.searchParams.toString();
    const cleaned =
      locationUrl.pathname + (newSearch ? `?${newSearch}` : '') + (locationUrl.hash ?? '');
    window.history.replaceState({}, '', cleaned);
  }
} catch (error) {
  console.warn('Could not parse current URL for auth params:', error);
}

authLogoutButton?.addEventListener('click', async () => {
  try {
    await fetch('/auth/logout', { method: 'POST' });
  } catch (error) {
    console.error('Failed to log out via API:', error);
  } finally {
    window.location.href = '/';
  }
});

bootstrap();

async function bootstrap() {
  const status = await loadAuthStatus();
  if (!status.authenticated) {
    return;
  }
  startDataFlows();
}

async function loadAuthStatus() {
  try {
    const response = await fetch('/auth/status');
    if (!response.ok) {
      throw new Error(`Status ${response.status}`);
    }
    const data = await response.json();
    authState = {
      authenticated: Boolean(data.authenticated),
      oauthEnabled: data.oauthEnabled !== false,
      user: data.user ?? null
    };
    applyAuthState(authState);
    return authState;
  } catch (error) {
    console.error('Failed to load auth status', error);
    authState = { authenticated: false, oauthEnabled: false, user: null, error: true };
    applyAuthState(authState, {
      error: 'Unable to reach the dashboard authentication service. Check if the bot is running.'
    });
    return authState;
  }
}

function applyAuthState(state, options = {}) {
  const authenticated = Boolean(state?.authenticated);
  const oauthEnabled = state?.oauthEnabled !== false;

  authSignedIn.forEach((element) => {
    element.hidden = !authenticated;
  });

  authSignedOut.forEach((element) => {
    element.hidden = authenticated || !oauthEnabled;
  });

  authLoginButtons.forEach((element) => {
    if (!element) {
      return;
    }
    if (oauthEnabled) {
      element.removeAttribute('aria-disabled');
      if (!element.getAttribute('href')) {
        element.setAttribute('href', '/auth/login');
      }
    } else {
      element.removeAttribute('href');
      element.setAttribute('aria-disabled', 'true');
    }
  });

  if (authOverlay) {
    authOverlay.hidden = authenticated;
  }

  if (authenticated) {
    document.body.classList.remove('auth-locked');
  } else {
    document.body.classList.add('auth-locked');
  }

  if (authenticated && state?.user) {
    const displayName =
      state.user.displayName ||
      state.user.globalName ||
      (state.user.discriminator && state.user.discriminator !== '0'
        ? `${state.user.username}#${state.user.discriminator}`
        : state.user.username) ||
      'User';
    if (authUsername) {
      authUsername.textContent = displayName;
    }
    updateAvatar(authAvatar, state.user);
  } else {
    if (authUsername) {
      authUsername.textContent = 'Not signed in';
    }
    updateAvatar(authAvatar, null);
  }

  let errorMessage = options.error ?? null;
  if (!authenticated) {
    if (!oauthEnabled) {
      errorMessage =
        'Discord OAuth2 is not configured. Set DASHBOARD_CLIENT_SECRET and DASHBOARD_REDIRECT_URI.';
    } else if (pendingAuthError) {
      errorMessage = pendingAuthError;
      pendingAuthError = null;
    }
  }

  if (authErrorMessage) {
    if (errorMessage) {
      authErrorMessage.textContent = errorMessage;
      authErrorMessage.hidden = false;
    } else {
      authErrorMessage.textContent = '';
      authErrorMessage.hidden = true;
    }
  }
}

function startDataFlows() {
  if (authIntervalsStarted) {
    return;
  }
  authIntervalsStarted = true;

  if (statusElement || guildCountElement) {
    fetchStatus();
    setInterval(fetchStatus, 15000);
  }

  if (commandsList) {
    fetchCommands();
  }

  if (identityForm || messagingForm) {
    loadStyleSettings();
  }

  if (brainStatsUsers) {
    loadBrainSummary();
    setInterval(loadBrainSummary, 30000);
  }
}

function updateAvatar(element, user) {
  if (!element) {
    return;
  }
  if (!user) {
    element.style.backgroundImage = '';
    element.textContent = '--';
    return;
  }

  if (user.avatar) {
    const format = user.avatar.startsWith('a_') ? 'gif' : 'png';
    const avatarUrl = `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.${format}?size=64`;
    element.style.backgroundImage = `url('${avatarUrl}')`;
    element.textContent = '';
  } else {
    element.style.backgroundImage = '';
    const base = user.globalName || user.username || 'User';
    element.textContent = base
      .split(' ')
      .map((part) => part.charAt(0))
      .join('')
      .slice(0, 2)
      .toUpperCase();
  }
}

async function fetchStatus() {
  if (!authState.authenticated) {
    return;
  }

  if (!statusElement || !usernameElement || !uptimeElement) {
    return;
  }

  try {
    const response = await fetch('/api/status');
    if (response.status === 401) {
      await loadAuthStatus();
      return;
    }
    if (!response.ok) {
      throw new Error(`Failed to fetch status: ${response.status}`);
    }
    const data = await response.json();

    statusElement.textContent = data.status === 'online' ? 'Online' : 'Offline';
    usernameElement.textContent = data.username ?? 'N/A';
    uptimeElement.textContent = formatDuration(data.uptime ?? 0);

    if (guildCountElement) {
      guildCountElement.textContent = String(data.guilds?.length ?? 0);
    }

    if (guildList) {
      guildList.innerHTML = '';
      data.guilds?.forEach((guild) => {
        const item = document.createElement('li');
        item.textContent = `${guild.name} (${guild.id})`;
        guildList.appendChild(item);
      });
    }
  } catch (error) {
    console.error('Failed to load bot status', error);
    statusElement.textContent = 'Offline';
    if (guildCountElement) {
      guildCountElement.textContent = '0';
    }
    if (guildList && guildList.children.length === 0) {
      const li = document.createElement('li');
      li.className = 'placeholder';
      li.textContent = 'Unavailable.';
      guildList.appendChild(li);
    }
  }
}

async function fetchCommands() {
  if (!authState.authenticated) {
    return;
  }

  if (!commandsList) {
    return;
  }

  try {
    const response = await fetch('/api/commands');
    if (response.status === 401) {
      await loadAuthStatus();
      return;
    }
    if (!response.ok) {
      throw new Error(`Failed to fetch commands: ${response.status}`);
    }
    const data = await response.json();

    commandsList.innerHTML = '';
    data.forEach((command) => {
      const item = document.createElement('li');
      const title = document.createElement('strong');
      title.textContent = `/${command.name}`;

      const description = document.createElement('span');
      description.className = 'list-subtext';
      description.textContent = command.description || 'No description provided.';

      const cooldown = document.createElement('span');
      cooldown.className = 'list-meta';
      cooldown.textContent = `Default cooldown: ${command.cooldown ?? 0}s`;

      item.append(title, description, cooldown);
      commandsList.appendChild(item);
    });

    if (commandsList.children.length === 0) {
      const empty = document.createElement('li');
      empty.className = 'placeholder';
      empty.textContent = 'No commands registered yet.';
      commandsList.appendChild(empty);
    }
  } catch (error) {
    console.error('Failed to load commands', error);
    commandsList.innerHTML = '<li class="placeholder">Could not load commands.</li>';
  }
}

messageForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!authState.authenticated) {
    if (feedback) {
      feedback.textContent = 'Log in to send messages.';
      feedback.style.color = '#ff6b6b';
    }
    return;
  }

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

    if (response.status === 401) {
      await loadAuthStatus();
      if (feedback) {
        feedback.textContent = 'Your session expired. Please log in again.';
        feedback.style.color = '#ff6b6b';
      }
      return;
    }

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
    console.error('Failed to send message', error);
    if (feedback) {
      feedback.textContent = 'Could not reach the server.';
      feedback.style.color = '#ff6b6b';
    }
  }
});

settingsNavButtons.forEach((button) => {
  button.addEventListener('click', () => {
    const section = button.dataset.section;
    settingsNavButtons.forEach((btn) => btn.setAttribute('aria-selected', String(btn === button)));
    settingsSections.forEach((element) => {
      element.classList.toggle('hidden', element.dataset.section !== section);
    });
  });
});

identityForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!authState.authenticated) {
    if (identityFeedback) {
      identityFeedback.textContent = 'Log in to update the persona.';
      identityFeedback.style.color = '#ff6b6b';
    }
    return;
  }

  const formData = new FormData(identityForm);

  const payload = {
    identity: {
      pronouns: formData.get('pronouns'),
      bio: formData.get('bio')
    },
    voice: {
      tone: formData.get('tone'),
      pace: formData.get('pace'),
      signaturePhrases: serializeSignaturePhrases(formData.get('signaturePhrases') ?? ''),
      emojiFlavor: formData.get('emojiFlavor')
    }
  };

  if (identityFeedback) {
    identityFeedback.textContent = 'Saving...';
    identityFeedback.style.color = '';
  }

  try {
    const response = await fetch('/api/style', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (response.status === 401) {
      await loadAuthStatus();
      if (identityFeedback) {
        identityFeedback.textContent = 'Your session expired. Please log in again.';
        identityFeedback.style.color = '#ff6b6b';
      }
      return;
    }

    if (!response.ok) {
      throw new Error('Request failed');
    }

    if (identityFeedback) {
      identityFeedback.textContent = 'Identity updated!';
      identityFeedback.style.color = '#63e6be';
    }
  } catch (error) {
    console.error('Failed to save identity', error);
    if (identityFeedback) {
      identityFeedback.textContent = 'Could not save identity.';
      identityFeedback.style.color = '#ff6b6b';
    }
  }
});

messagingForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!authState.authenticated) {
    if (messagingFeedback) {
      messagingFeedback.textContent = 'Log in to update messaging style.';
      messagingFeedback.style.color = '#ff6b6b';
    }
    return;
  }

  const formData = new FormData(messagingForm);

  const payload = {
    response: {
      usesNickname: formData.get('usesNickname') === 'on',
      addsSignOff: formData.get('addsSignOff') === 'on',
      signOffText: formData.get('signOffText')
    },
    creativity: {
      temperature: formData.get('temperature'),
      topP: formData.get('topP')
    }
  };

  if (messagingFeedback) {
    messagingFeedback.textContent = 'Saving...';
    messagingFeedback.style.color = '';
  }

  try {
    const response = await fetch('/api/style', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (response.status === 401) {
      await loadAuthStatus();
      if (messagingFeedback) {
        messagingFeedback.textContent = 'Your session expired. Please log in again.';
        messagingFeedback.style.color = '#ff6b6b';
      }
      return;
    }

    if (!response.ok) {
      throw new Error('Request failed');
    }

    if (messagingFeedback) {
      messagingFeedback.textContent = 'Messaging preferences updated!';
      messagingFeedback.style.color = '#63e6be';
    }
  } catch (error) {
    console.error('Failed to save messaging style', error);
    if (messagingFeedback) {
      messagingFeedback.textContent = 'Could not save messaging style.';
      messagingFeedback.style.color = '#ff6b6b';
    }
  }
});

async function loadStyleSettings() {
  if (!authState.authenticated) {
    return;
  }

  try {
    const response = await fetch('/api/style');
    if (response.status === 401) {
      await loadAuthStatus();
      return;
    }
    if (!response.ok) {
      throw new Error('Failed to load style configuration');
    }

    const style = await response.json();
    const {
      identity = {},
      voice = {},
      response: replyStyle = {},
      creativity = {}
    } = style;

    if (identityForm) {
      identityForm.querySelector('#style-name').value = identity.name ?? 'Doodley';
      identityForm.querySelector('#style-pronouns').value = identity.pronouns ?? '';
      identityForm.querySelector('#style-bio').value = identity.bio ?? '';
      identityForm.querySelector('#style-tone').value = voice.tone ?? '';
      identityForm.querySelector('#style-pace').value = voice.pace ?? '';
      identityForm.querySelector('#style-phrases').value = Array.isArray(voice.signaturePhrases)
        ? voice.signaturePhrases.join(', ')
        : '';
      identityForm.querySelector('#style-emoji').value = voice.emojiFlavor ?? '';
    }

    if (messagingForm) {
      messagingForm.querySelector('#style-nickname').checked = Boolean(replyStyle.usesNickname);
      messagingForm.querySelector('#style-signoff').checked = Boolean(replyStyle.addsSignOff);
      messagingForm.querySelector('#style-signoff-text').value = replyStyle.signOffText ?? '';

      const tempField = messagingForm.querySelector('#style-temperature');
      const topPField = messagingForm.querySelector('#style-topp');
      if (tempField) {
        tempField.value = creativity.temperature ?? '';
      }
      if (topPField) {
        topPField.value = creativity.topP ?? '';
      }
    }
  } catch (error) {
    console.error('Failed to load style settings', error);
    if (identityFeedback) {
      identityFeedback.textContent = 'Could not load settings.';
      identityFeedback.style.color = '#ff6b6b';
    }
  }
}

async function loadBrainSummary() {
  if (!authState.authenticated) {
    return;
  }

  if (
    !brainStatsUsers ||
    !brainStatsAverage ||
    !brainStatsUpdated ||
    !brainTopTalkers ||
    !brainRecent
  ) {
    return;
  }

  brainTopTalkers.innerHTML = '<li>Loading...</li>';
  brainRecent.innerHTML = '<li>Loading...</li>';

  try {
    const response = await fetch('/api/brain');
    if (response.status === 401) {
      await loadAuthStatus();
      return;
    }
    if (!response.ok) {
      throw new Error('Failed to load brain data');
    }
    const data = await response.json();

    brainStatsUsers.textContent = data.totalTrackedUsers ?? 0;
    brainStatsAverage.textContent = data.averageMessageLength ?? 0;
    brainStatsUpdated.textContent = data.updatedAt
      ? new Date(data.updatedAt).toLocaleString()
      : 'Never';

    populatePeopleList(brainTopTalkers, data.topTalkers, 'No talkers yet.');
    populatePeopleList(brainRecent, data.recentVisitors, 'No visitors yet.');
  } catch (error) {
    console.error('Failed to refresh brain summary', error);
    brainStatsUsers.textContent = '0';
    brainStatsAverage.textContent = '0';
    brainStatsUpdated.textContent = 'N/A';
    brainTopTalkers.innerHTML = '<li class="placeholder">Unable to load data.</li>';
    brainRecent.innerHTML = '<li class="placeholder">Unable to load data.</li>';
  }
}

function populatePeopleList(container, list, emptyMessage) {
  if (!container) {
    return;
  }

  container.innerHTML = '';
  if (!Array.isArray(list) || list.length === 0) {
    const li = document.createElement('li');
    li.className = 'placeholder';
    li.textContent = emptyMessage;
    container.appendChild(li);
    return;
  }

  list.forEach((person) => {
    const li = document.createElement('li');
    const name = person.displayName || person.userId;
    const messageCount = person.messageCount ?? 0;
    const averageLength = person.averageLength ?? 0;

    const title = document.createElement('strong');
    title.textContent = name;

    const meta = document.createElement('small');
    meta.textContent = `${messageCount} messages - Avg length ${averageLength}`;

    li.append(title, meta);

    if (person.lastSeenAt) {
      const time = document.createElement('small');
      time.textContent = `Last seen ${new Date(person.lastSeenAt).toLocaleString()}`;
      li.appendChild(time);
    }

    container.appendChild(li);
  });
}

function highlightActiveNav() {
  if (navLinks.length === 0) {
    return;
  }

  const path = window.location.pathname;
  const normalized = path === '/' || path === '' ? 'index.html' : path.replace(/^\//, '');

  navLinks.forEach((link) => {
    const href = link.getAttribute('href');
    if (!href) {
      return;
    }
    const normalizedHref = href === '/' ? 'index.html' : href.replace(/^\//, '');
    if (normalizedHref === normalized) {
      link.setAttribute('aria-current', 'page');
    } else {
      link.removeAttribute('aria-current');
    }
  });
}

function setupNavigationToggles() {
  if (!sidebar || navToggles.length === 0) {
    return;
  }

  navToggles.forEach((button) => {
    button.setAttribute('aria-expanded', 'false');
    button.addEventListener('click', () => {
      const isOpen = sidebar.classList.toggle('sidebar--open');
      navToggles.forEach((toggle) => toggle.setAttribute('aria-expanded', String(isOpen)));
    });
  });

  navLinks.forEach((link) => {
    link.addEventListener('click', () => {
      if (!sidebar.classList.contains('sidebar--open')) {
        return;
      }
      sidebar.classList.remove('sidebar--open');
      navToggles.forEach((toggle) => toggle.setAttribute('aria-expanded', 'false'));
    });
  });

  document.addEventListener('click', (event) => {
    if (!sidebar.classList.contains('sidebar--open')) {
      return;
    }
    const target = event.target instanceof Element ? event.target : null;
    if (!target) {
      return;
    }
    if (sidebar.contains(target) || target.closest('[data-nav-toggle]')) {
      return;
    }
    sidebar.classList.remove('sidebar--open');
    navToggles.forEach((toggle) => toggle.setAttribute('aria-expanded', 'false'));
  });
}

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

function serializeSignaturePhrases(value) {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}
