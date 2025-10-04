# DoodleBot

Fully featured Discord bot template focused on moderation, quick conversation, and a browser-based control panel.

## Features

- Moderation slash commands (`/ban`, `/kick`) with basic validation.
- Mention-driven conversation flow powered by lightweight local models that keep responding after the initial ping.
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

5. Configure the bot personality from the dashboard:

   - Open the **Personality** tab.
   - Adjust the greeting, tone, keywords, conversation style, short reply probability, acknowledgement phrases, and keyword specific responses.
   - Pick a model provider for the AI replies: keep the default rule-based mode, run a CPU-friendly Hugging Face model (e.g. `Xenova/distilgpt2`), or connect to a local Ollama server (e.g. `tinyllama`).
   - Submit the form to persist the configuration in `data/personality.json`. The bot picks up the new settings immediately.

### Windows one-click launcher with RAM usage monitor

If you prefer a single command on Windows, double-click `scripts/startAll.bat`. The batch file:

- Installs Node.js LTS automatically if `npm` is not available yet (falls back to a portable Node.js bundle if the MSI installer fails).
- Installs the project dependencies (if `node_modules` is missing).
- Opens a PowerShell window that refreshes the current RAM usage every second.
- Runs `npm run start:all` so the bot and dashboard boot together.
- Closes the RAM monitor automatically after the services finish.

> **Tip:** Make sure the required environment variables (like `DISCORD_TOKEN`) are configured in your `.env` file before running the launcher.

## Local conversation models

The mention-driven chat flow can operate in three modes, all configured from the Personality tab of the dashboard:

1. **Keyword rules only** – the default behavior that keeps responses light and deterministic.
2. **Hugging Face** – loads a compact text-generation model locally through [`@xenova/transformers`](https://www.npmjs.com/package/@xenova/transformers). Suggested starters:
   - `Xenova/distilgpt2` (fastest option for CPUs).
   - `Xenova/TinyLlama-1.1B-Chat-v1.0` (still lightweight but more conversational).

   The first run downloads the weights to the `~/.cache/transformers` folder. Subsequent responses stay fully offline.

3. **Ollama** – sends prompts to a running [Ollama](https://ollama.com/) instance (defaults to `http://127.0.0.1:11434/api/generate`). Install Ollama, pull a lightweight model such as `tinyllama`, and set the server URL/model name in the dashboard.

All modes respect the keyword rules defined earlier in the form, and the bot continues a conversation automatically until the timeout expires or the user switches to another thread.

## Folder structure

```
src/
|- bot/                # Discord client helpers
|- commands/           # Slash commands grouped by category
|- config/             # Lightweight configuration stores (personality, etc.)
|- dashboard/          # Express server + dashboard assets
|- index.js            # Entry point
```

## Suggested next steps

- Add authentication to the dashboard (OAuth2, JWT, or another solution).
- Store moderation logs in a database.
- Extend the conversation module with additional rules or plug it into an external AI API if you need richer responses.
- Automate deployment to a service such as Railway, Render, or Fly.io.

## License

Released under the MIT license. Feel free to use and adapt it.
