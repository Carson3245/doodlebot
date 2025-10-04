import path from 'node:path';
import url from 'node:url';
import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import { personalityStore } from '../config/personalityStore.js';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

export function createDashboard(client) {
  const app = express();

  app.use(cors());
  app.use(express.json());
  app.use(morgan('dev'));

  app.get('/api/status', (_req, res) => {
    const isReady = client.isReady();
    res.json({
      status: isReady ? 'online' : 'offline',
      username: isReady ? client.user.tag : null,
      uptime: isReady ? client.uptime : 0,
      guilds: isReady ? client.guilds.cache.map((guild) => ({ id: guild.id, name: guild.name })) : []
    });
  });

  app.get('/api/personality', async (_req, res) => {
    const personality = await personalityStore.load();
    res.json(personality);
  });

  app.put('/api/personality', async (req, res) => {
    try {
      const updated = await personalityStore.save(req.body ?? {});
      res.json(updated);
    } catch (error) {
      console.error('Failed to update personality configuration:', error);
      res.status(500).json({ error: 'Could not save the personality configuration.' });
    }
  });

  app.get('/api/commands', (_req, res) => {
    const commands = [...client.commands.values()].map((command) => ({
      name: command.data.name,
      description: command.data.description,
      cooldown: command.cooldown ?? 3
    }));

    res.json(commands);
  });

  app.post('/api/send-message', async (req, res) => {
    const { channelId, message } = req.body;

    if (!channelId || !message) {
      res.status(400).json({ error: 'channelId and message are required.' });
      return;
    }

    try {
      const channel = await client.channels.fetch(channelId);
      if (!channel || !channel.isTextBased()) {
        res.status(400).json({ error: 'Invalid or non-text channel.' });
        return;
      }

      await channel.send(message);
      res.json({ success: true });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Failed to send the message. Check the server logs.' });
    }
  });

  app.use(express.static(path.join(__dirname, 'public')));

  app.get('*', (_req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  });

  return app;
}
