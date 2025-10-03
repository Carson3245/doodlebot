# DoodleBot

Fully featured Discord bot template focused on moderation, quick conversation, and a browser-based control panel.

## Features

- ✅ Moderation slash commands (`/ban`, `/kick`) with basic validation.
- 💬 `/chat` command for quick friendly replies.
- 🛡️ Simple cooldown system to avoid command spam.
- 🌐 Express dashboard with a REST API and static interface ready to open in Chrome.
- ⚙️ Modular structure to add new commands and routes with ease.

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

3. Start the bot and the dashboard:

   ```bash
   npm run dev
   ```

   The dashboard is available at `http://localhost:3000` by default. Open it in Chrome to view the status, list commands, and send test messages.

## Folder structure

```
src/
├── bot/                # Discord client helpers
├── commands/           # Slash commands grouped by category
├── dashboard/          # Express server + dashboard assets
└── index.js            # Entry point
```

## Suggested next steps

- Add authentication to the dashboard (OAuth2, JWT, or another solution).
- Store moderation logs in a database.
- Expand the conversation module by integrating an AI API if you want richer responses.
- Automate deployment to a service such as Railway, Render, or Fly.io.

## License

Released under the MIT license. Feel free to use and adapt it.
