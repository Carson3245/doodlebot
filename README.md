# DoodleBot

Fully featured Discord bot template focused on moderation, quick conversation, and a browser-based control panel.

## Features

- Moderation slash commands (`/ban`, `/kick`) with basic validation.
- Mention-driven conversation flow that keeps responding after the initial ping.
- Simple cooldown system to avoid command spam.
- Express dashboard with a REST API and static interface ready to open in Chrome.
- Modular structure to add new commands and routes with ease.

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
   | `CONVERSATION_TIMEOUT_MS` | Time in milliseconds before an ongoing conversation expires (default `120000`) |

3. Start the bot and the dashboard:

   ```bash
   npm run dev
   ```

   The dashboard is available at `http://localhost:3000` by default.

4. Launch every service and automatically open the dashboard in your default browser:

   ```bash
   npm run start:all
   ```

   The helper script waits until the dashboard announces its URL and then opens it for you. If automatic launching fails (for example, in headless environments), the URL is still printed so you can open it manually.

### Windows one-click launcher with RAM usage monitor

If you prefer a single command on Windows, double-click `scripts/startAll.bat`. The batch file:

- Installs Node.js LTS automatically if `npm` is not available yet (falls back to a portable Node.js bundle if the MSI installer fails).
- Installs the project dependencies (if `node_modules` is missing).
- Opens a PowerShell window that refreshes the current RAM usage every second.
- Runs `npm run start:all` so the bot and dashboard boot together.
- Closes the RAM monitor automatically after the services finish.

> **Tip:** Make sure the required environment variables (like `DISCORD_TOKEN`) are configured in your `.env` file before running the launcher.

## Folder structure

```
src/
|- bot/                # Discord client helpers
|- commands/           # Slash commands grouped by category
|- dashboard/          # Express server + dashboard assets
|- index.js            # Entry point
```

## Suggested next steps

- Add authentication to the dashboard (OAuth2, JWT, or another solution).
- Store moderation logs in a database.
- Expand the conversation module by integrating an AI API if you want richer responses.
- Automate deployment to a service such as Railway, Render, or Fly.io.

## License

Released under the MIT license. Feel free to use and adapt it.
