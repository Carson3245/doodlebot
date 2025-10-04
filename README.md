# DoodleBot

Fully featured Discord bot template focused on moderation, quick conversation, and a browser-based control panel.

## Features

- Moderation slash commands (`/ban`, `/kick`) with basic validation.
- Mention-driven conversation flow powered by lightweight local models that keep responding after the initial ping.
- Simple cooldown system to avoid command spam.
- Express dashboard with a REST API and static interface ready to open in Chrome.
- Pure CSS dashboard styling with no bundled image assets, avoiding binary incompatibility warnings.
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
   - Adjust the greeting, tone, speaking style, target response length, guidance notes, and Hugging Face parameters.
   - Submit the form to persist the configuration in `data/personality.json`. The bot picks up the new settings immediately.

### Windows one-click launcher with RAM usage monitor

If you prefer a single command on Windows, double-click `scripts/startAll.bat`. The batch file:

- Installs Node.js LTS automatically if `npm` is not available yet (choosing the correct 32-bit, 64-bit, or ARM build and falling back to a portable bundle if the MSI installer fails).
- Installs the project dependencies (if `node_modules` is missing).
- Downloads the configured Hugging Face model so the text generator can run offline.
- Opens a PowerShell window that refreshes the current RAM usage every second.
- Runs `npm run start:all` so the bot and dashboard boot together.
- Closes the RAM monitor automatically after the services finish.

> **Tip:** Make sure the required environment variables (like `DISCORD_TOKEN`) are configured in your `.env` file before running the launcher. When Windows displays "Arquivos binários não são compatíveis" (or Node exits with 1603/1633/5100), the batch helper now switches to a portable Node.js build automatically and continues with the setup.

| Launcher message | What it means | Fix |
| ---------------- | ------------- | --- |
| `Node.js MSI build is incompatible with this Windows architecture or version. Attempting portable fallback...` | The MSI installer returned error 1633, often shown by Windows as "Arquivos binários não são compatíveis". | Let the script continue—the portable runtime is downloaded and placed on the `PATH` for the current session. |
| `Node.js MSI cannot run on this Windows edition (error 5100). Attempting portable fallback...` | The MSI refused to run on the current Windows build (for example Windows Server Core). | The script automatically installs the portable bundle; if you need a system-wide install, download a compatible Node.js build manually. |
| `Node.js MSI reported a fatal error (1603). Attempting portable fallback...` | The MSI setup failed because of a pending reboot or another installer conflict. | Resolve any installer prerequisites if you want to install Node globally, or rely on the portable bundle prepared by the launcher. |

## Local conversation model

The mention-driven chat flow always uses a Hugging Face transformer configured in the Personality tab. Suggested starter models:

- `Xenova/distilgpt2` (fastest option for CPUs).
- `Xenova/TinyLlama-1.1B-Chat-v1.0` (still lightweight but more conversational).

Use `npm run prepare:model` (included in the Windows launcher automatically) to download the selected model into the local cache so the generator runs offline on future boots.

Tune the tone, speaking style, response length, and guidance fields on the Personality page to steer how the model replies during every mention.

## Error reference

Every conversational failure surfaces as an ASCII-only message that ends with a numeric code. Use the table below to trace the cause and apply the recommended fix.

| Error message | When it appears | How to fix |
| ------------- | --------------- | ---------- |
| `ChatInputEmpty 1001` | The bot was mentioned without any readable text after removing mentions and whitespace. | Make sure to include a message when pinging the bot. Quoted replies that only contain mentions will trigger this error. |
| `HuggingFaceGenerationFailed 2001` | The Hugging Face pipeline threw an exception (missing model, download issue, or runtime error). | Confirm the model ID exists locally, that the machine has enough RAM, and retry after downloading the weights manually with `npm run dev` once the network is available. |
| `EmptyHuggingFaceOutput 2002` | The transformer finished without producing any tokens. | Increase `maxNewTokens` or `temperature` in the Personality tab so the generator has room to respond. |
| `FilteredHuggingFaceOutputEmpty 2003` | The generated text only contained non-ASCII symbols, which are not allowed. | Lower the temperature or switch to a different Hugging Face model that produces plain ASCII text. |
| `TransformersDependencyMissing 2004` | The `@xenova/transformers` package could not be resolved when switching to Hugging Face mode. | Run `npm install` inside the project folder so dependencies are available, or install the package manually with `npm install @xenova/transformers`. |
| `TransformersPipelineUnavailable 2005` | The `@xenova/transformers` package loaded, but it did not expose the expected `pipeline` export. | Reinstall the dependency (`rm -rf node_modules package-lock.json && npm install`) to ensure the install is not corrupted, then restart the bot. |
| `Chat processing error 9001` | The Discord bot caught one of the errors above when preparing a reply. | Check the bot logs for the root error code and apply the matching fix from this table. |

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
