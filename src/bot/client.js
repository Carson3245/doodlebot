import { Client, Collection, GatewayIntentBits, Partials } from 'discord.js';

export function createClient() {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.MessageContent
    ],
    partials: [Partials.Channel]
  });

  client.commands = new Collection();
  client.cooldowns = new Collection();

  return client;
}
