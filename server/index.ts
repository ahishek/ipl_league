import 'dotenv/config';

import { createServer } from 'node:http';
import path from 'node:path';
import express from 'express';
import cors from 'cors';
import { Server } from 'socket.io';
import type { Action, Player, UserProfile } from '../types';
import { generateTeamLogo, getPlayerInsights, hasGemini } from './gemini';
import { RoomManager } from './roomManager';
import { fetchPlayersFromGoogleSheet, getSampleSheetDefaults } from './sheets';

type Ack<T> = (payload: { ok: true; data: T } | { ok: false; error: string }) => void;

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: true,
    credentials: true,
  },
});

const roomManager = new RoomManager(io);
const port = Number(process.env.PORT || 8787);

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '12mb' }));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, gemini: hasGemini, sampleSheet: getSampleSheetDefaults() });
});

app.get('/api/sample-sheet', (_req, res) => {
  res.json(getSampleSheetDefaults());
});

app.get('/api/archives/:userId', (req, res) => {
  try {
    res.json({ archives: roomManager.getArchivesForUser(req.params.userId) });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : 'Failed to load archives.' });
  }
});

app.get('/api/rooms/:roomId/teams/:teamId/logo', (req, res) => {
  try {
    const logo = roomManager.getTeamLogo(req.params.roomId.toUpperCase(), req.params.teamId);
    if (!logo) {
      res.status(404).json({ error: 'Logo not found.' });
      return;
    }
    res.json({ logo });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : 'Failed to fetch logo.' });
  }
});

app.post('/api/sheets/preview', async (req, res) => {
  try {
    const { sheetUrl, sheetName } = req.body as { sheetUrl?: string; sheetName?: string };
    const preview = await fetchPlayersFromGoogleSheet(sheetUrl, sheetName);
    res.json(preview);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : 'Failed to preview sheet.' });
  }
});

app.post('/api/ai/logo', async (req, res) => {
  try {
    const { teamName, colorHex } = req.body as { teamName: string; colorHex: string };
    const logo = await generateTeamLogo(teamName, colorHex);
    res.json({ logo });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : 'Logo generation failed.' });
  }
});

app.post('/api/ai/player-insights', async (req, res) => {
  try {
    const { player } = req.body as { player: Player };
    const insight = await getPlayerInsights(player);
    res.json({ insight });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : 'Insight lookup failed.' });
  }
});

io.on('connection', (socket) => {
  socket.on(
    'room:create',
    async (
      payload: { profile: UserProfile; roomName: string },
      ack: Ack<{ room: unknown; user: unknown }>,
    ) => {
      try {
        const data = roomManager.createRoom(socket, payload.profile, payload.roomName);
        ack({ ok: true, data });
      } catch (error) {
        ack({ ok: false, error: error instanceof Error ? error.message : 'Failed to create room.' });
      }
    },
  );

  socket.on(
    'room:join',
    async (
      payload: { profile: UserProfile; roomId: string },
      ack: Ack<{ room: unknown; user: unknown }>,
    ) => {
      try {
        const data = roomManager.joinRoom(socket, payload.profile, payload.roomId);
        ack({ ok: true, data });
      } catch (error) {
        ack({ ok: false, error: error instanceof Error ? error.message : 'Failed to join room.' });
      }
    },
  );

  socket.on(
    'room:rejoin',
    async (
      payload: { profile: UserProfile; roomId: string },
      ack: Ack<{ room: unknown; user: unknown }>,
    ) => {
      try {
        const data = roomManager.rejoinRoom(socket, payload.profile, payload.roomId);
        ack({ ok: true, data });
      } catch (error) {
        ack({ ok: false, error: error instanceof Error ? error.message : 'Failed to rejoin room.' });
      }
    },
  );

  socket.on('room:command', async (payload: { action: Action }, ack: Ack<{}>) => {
    try {
      await roomManager.handleCommand(socket, payload.action);
      ack({ ok: true, data: {} });
    } catch (error) {
      ack({ ok: false, error: error instanceof Error ? error.message : 'Command failed.' });
    }
  });

  socket.on('disconnect', () => {
    void roomManager.disconnect(socket);
  });
});

const distDir = path.resolve(process.cwd(), 'dist');
app.use(express.static(distDir));
app.use((req, res, next) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/socket.io')) {
    next();
    return;
  }
  res.sendFile(path.join(distDir, 'index.html'), (error) => {
    if (error) next();
  });
});

httpServer.listen(port, '0.0.0.0', () => {
  console.log(`auction-server listening on http://127.0.0.1:${port}`);
});
