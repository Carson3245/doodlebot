const statusElement = document.querySelector('#bot-status');
const usernameElement = document.querySelector('#bot-username');
const uptimeElement = document.querySelector('#bot-uptime');
const guildList = document.querySelector('#guild-list');
const commandsList = document.querySelector('#commands-list');
const messageForm = document.querySelector('#message-form');
const feedback = document.querySelector('#message-feedback');

async function fetchStatus() {
  try {
    const response = await fetch('/api/status');
    const data = await response.json();

    statusElement.textContent = data.status === 'online' ? 'Online ✅' : 'Offline ❌';
    usernameElement.textContent = data.username ?? '—';
    uptimeElement.textContent = formatDuration(data.uptime ?? 0);

    guildList.innerHTML = '';
    data.guilds?.forEach((guild) => {
      const item = document.createElement('li');
      item.textContent = `${guild.name} (${guild.id})`;
      guildList.appendChild(item);
    });
  } catch (error) {
    console.error(error);
    statusElement.textContent = 'Erro ao carregar status';
  }
}

async function fetchCommands() {
  try {
    const response = await fetch('/api/commands');
    const data = await response.json();

    commandsList.innerHTML = '';
    data.forEach((command) => {
      const item = document.createElement('li');
      item.innerHTML = `<strong>/${command.name}</strong><br /><small>${command.description}</small><br /><small>Cooldown padrão: ${command.cooldown}s</small>`;
      commandsList.appendChild(item);
    });
  } catch (error) {
    console.error(error);
    commandsList.innerHTML = '<li>Não foi possível carregar os comandos.</li>';
  }
}

messageForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const formData = new FormData(messageForm);
  const payload = Object.fromEntries(formData.entries());

  feedback.textContent = 'Enviando mensagem...';

  try {
    const response = await fetch('/api/send-message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const error = await response.json();
      feedback.textContent = `Erro: ${error.error ?? 'não foi possível enviar.'}`;
      feedback.style.color = '#ff6b6b';
      return;
    }

    feedback.textContent = 'Mensagem enviada com sucesso!';
    feedback.style.color = '#63e6be';
    messageForm.reset();
  } catch (error) {
    console.error(error);
    feedback.textContent = 'Não foi possível comunicar com o servidor.';
    feedback.style.color = '#ff6b6b';
  }
});

function formatDuration(ms) {
  if (!ms) return '—';

  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return `${hours.toString().padStart(2, '0')}:${minutes
    .toString()
    .padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

fetchStatus();
fetchCommands();
setInterval(fetchStatus, 15000);
