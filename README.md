# DoodleBot

Discord bot template focused on moderation tools, a configurable persona, and a browser-based control panel.

## Features

- Moderation slash commands (`/ban`, `/kick`) with basic validation.
- Mention-driven conversation powered by DreamGen's OpenAI-compatible API with a fully configurable persona.
- Lightweight prefix helpers for quick text-based responses.
- Simple cooldown system to avoid command spam.
- Express dashboard with a REST API and static interface ready to open in Chrome.
- Pure CSS dashboard styling with no bundled image assets, avoiding binary incompatibility warnings.
- Doodley Brain: local analytics that capture how members talk so responses can adapt naturally.
- Modular structure to add new commands, prompts, and routes with ease.

## Requirements

- Node.js 18 or newer
- An application registered in the [Discord Developer Portal](https://discord.com/developers/applications)
- Bot token, client ID, and the ID of a server to register commands

## Setup

1. Install the dependencies:

   ```bash
   npm install
   ```

2. Copy the `.env.example` file to `.env` and fill it with your data:

   ```bash
   cp .env.example .env
   ```

   | Variable         | Description                                                               |
   | ---------------- | ------------------------------------------------------------------------- |
   | `DISCORD_TOKEN`  | Bot token generated in the Discord portal                                 |
   | `CLIENT_ID`      | Application ID                                                            |
   | `GUILD_ID`       | Server ID where the commands will be registered (optional in production)  |
| `DASHBOARD_PORT` | Port where the web dashboard will run                                      |
| `BOT_PREFIX`     | Prefix used for text commands (e.g. `!help`)                              |
| `CONVERSATION_TIMEOUT_MS` | How long (ms) the bot keeps a conversation session alive after the last reply |
| `CHAT_PROVIDERS` | Comma-separated provider order (default `dreamgen`)                        |
| `DREAMGEN_API_KEY` | API key created in the DreamGen dashboard                               |
| `DREAMGEN_MODEL` | DreamGen model identifier (default `lucid-v1-medium`)                     |
| `DREAMGEN_API_URL` | DreamGen chat-completions endpoint (default `https://dreamgen.com/api/openai/v1/chat/completions`) |

3. Start the bot and the dashboard:

   ```bash
   npm run dev
   ```

   The dashboard is available at `http://localhost:3000` by default.

4. Create your DreamGen API key and add it to `.env`. Confirm that the key has access to the model specified in `DREAMGEN_MODEL`.

5. Launch every service and automatically open the dashboard in your default browser:

   ```bash
   npm run start:all
   ```

   The helper script waits until the dashboard announces its URL and then opens it for you. If automatic launching fails (for example, in headless environments), the URL is still printed so you can open it manually.

### Windows one-click launcher with RAM usage monitor

If you prefer a single command on Windows, double-click `scripts/startAll.bat`. The batch file:

- Installs Node.js LTS automatically if `npm` is not available yet (choosing the correct 32-bit, 64-bit, or ARM build and falling back to a portable bundle if the MSI installer fails).
- Fetches the latest commits from `origin` (when Git is available and the working tree has no local changes) so you start from the newest template revision.
- Installs the project dependencies (if `node_modules` is missing).
- Opens a PowerShell window that refreshes the current RAM usage every second.
- Runs `npm run start:all` so the bot and dashboard boot together.
- Closes the RAM monitor automatically after the services finish.

> **Tip:** Make sure the required environment variables (like `DISCORD_TOKEN`) are configured in your `.env` file before running the launcher. When Windows displays "Arquivos binários não são compatíveis" (or Node exits with 1603/1633/5100), the batch helper now switches to a portable Node.js build automatically and continues with the setup.

| Launcher message | What it means | Fix |
| ---------------- | ------------- | --- |
| `Node.js MSI build is incompatible with this Windows architecture or version. Attempting portable fallback...` | The MSI installer returned error 1633, often shown by Windows as "Arquivos binários não são compatíveis". | Let the script continue—the portable runtime is downloaded and placed on the `PATH` for the current session. |
| `Node.js MSI cannot run on this Windows edition (error 5100). Attempting portable fallback...` | The MSI refused to run on the current Windows build (for example Windows Server Core). | The script automatically installs the portable bundle; if you need a system-wide install, download a compatible Node.js build manually. |
| `Node.js MSI reported a fatal error (1603). Attempting portable fallback...` | The MSI setup failed because of a pending reboot or another installer conflict. | Resolve any installer prerequisites if you want to install Node globally, or rely on the portable bundle prepared by the launcher. |

## Folder structure

```
src/
|- bot/                # Discord client helpers
|- commands/           # Slash commands grouped by category
|- dashboard/          # Express server + dashboard assets
|- index.js            # Entry point
scripts/
|- startAll.bat        # Windows launcher with dependency and service helpers
|- startAll.js         # Node-based launcher used by the batch script
```

## Dashboard highlights

- **Settings → Identity & Voice**: lock Doodley's name, pronouns, and persona while choosing tone, pacing, and signature phrases.
- **Settings → Messaging Style**: toggle nicknames, configure a custom sign-off, and fine-tune how replies look.
- **Settings → Brain Insights**: review tracked members, average message length, and the most talkative visitors. Data is stored locally in `data/brain/users.json`.
- **Commands / Logs**: unchanged—still show registered slash commands and placeholders for future log streaming.

## Suggested next steps

- Add authentication to the dashboard (OAuth2, JWT, or another solution).
- Store moderation logs in a database.
- Refine the style store or wire the brain data into live prompt adjustments.
- Replace the quick message form with a safer queue or approval workflow before using it in production.
- Automate deployment to a service such as Railway, Render, or Fly.io.

## License

Released under the MIT license. Feel free to use and adapt it.
