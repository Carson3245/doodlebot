import { readdir } from 'node:fs/promises';
import path from 'node:path';
import url from 'node:url';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

export async function loadCommands(commandsPath = path.join(__dirname, '..', 'commands')) {
  const commands = [];

  async function traverse(dir) {
    const entries = await readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        await traverse(fullPath);
        continue;
      }

      if (!entry.name.endsWith('.js')) {
        continue;
      }

      const commandModule = await import(url.pathToFileURL(fullPath));
      if (!commandModule?.data || typeof commandModule.execute !== 'function') {
        console.warn(`Comando ignorado: ${entry.name} não exporta data/execute.`);
        continue;
      }

      commands.push({
        data: commandModule.data,
        execute: commandModule.execute,
        cooldown: commandModule.cooldown ?? 3
      });
    }
  }

  await traverse(commandsPath);
  return commands;
}
