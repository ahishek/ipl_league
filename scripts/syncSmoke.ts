import { io, type Socket } from 'socket.io-client';
import type { Action, Player, Room, UserProfile, UserState } from '../types';
import { MOCK_PLAYERS } from '../constants';

const SERVER_URL = process.env.SERVER_URL || 'http://127.0.0.1:8787';

type Ack<T> = { ok: true; data: T } | { ok: false; error: string };

const profile = (name: string): UserProfile => ({
  id: `${name.toLowerCase().replace(/\s+/g, '-')}-${Math.random().toString(36).slice(2, 6)}`,
  name,
  createdAt: Date.now(),
  avatarSeed: Math.random().toString(36).slice(2, 8),
});

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const emitWithAck = async <T>(socket: Socket, event: string, payload: unknown) =>
  new Promise<T>((resolve, reject) => {
    socket.emit(event, payload, (response: Ack<T>) => {
      if ('error' in response) {
        reject(new Error(response.error));
        return;
      }
      resolve(response.data);
    });
  });

const connectClient = async (name: string) => {
  const socket = io(SERVER_URL, {
    transports: ['websocket'],
    forceNew: true,
    reconnection: false,
  });

  await new Promise<void>((resolve, reject) => {
    socket.once('connect', () => resolve());
    socket.once('connect_error', reject);
  });

  return { socket, profile: profile(name) };
};

const latestRoom = (socket: Socket) =>
  new Promise<Room>((resolve) => {
    socket.once('room:update', (room: Room) => resolve(room));
  });

const waitForRoom = (socket: Socket, predicate: (room: Room) => boolean, timeoutMs = 5000) =>
  new Promise<Room>((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.off('room:update', handleUpdate);
      reject(new Error('Timed out waiting for expected room state.'));
    }, timeoutMs);

    const handleUpdate = (room: Room) => {
      if (!predicate(room)) return;
      clearTimeout(timeout);
      socket.off('room:update', handleUpdate);
      resolve(room);
    };

    socket.on('room:update', handleUpdate);
  });

const run = async () => {
  const host = await connectClient('Host Maestro');
  const bidderOne = await connectClient('Bidder One');
  const bidderTwo = await connectClient('Bidder Two');

  const created = await emitWithAck<{ room: Room; user: UserState }>(host.socket, 'room:create', {
    profile: host.profile,
    roomName: 'Smoke Room',
  });

  const roomCode = created.room.id;

  await emitWithAck<{ room: Room; user: UserState }>(bidderOne.socket, 'room:join', {
    profile: bidderOne.profile,
    roomId: roomCode,
  });
  await emitWithAck<{ room: Room; user: UserState }>(bidderTwo.socket, 'room:join', {
    profile: bidderTwo.profile,
    roomId: roomCode,
  });

  await emitWithAck(host.socket, 'room:command', {
    action: {
      type: 'UPDATE_CONFIG',
      payload: {
        totalBudget: 1500,
        maxPlayers: 5,
        minBidIncrement: 10,
        bidTimerSeconds: 8,
        roleMinimums: {
          Batter: 1,
          Bowler: 1,
          'All Rounder': 0,
          'Wicket Keeper': 0,
        },
      },
    } satisfies Action,
  });

  await emitWithAck(host.socket, 'room:command', {
    action: { type: 'IMPORT_PLAYERS', payload: MOCK_PLAYERS.slice(0, 6).map((player: Player) => ({ ...player })) satisfies Action['payload'] },
  });

  await emitWithAck(bidderOne.socket, 'room:command', {
    action: {
      type: 'ADD_TEAM',
      payload: { team: { id: 'ignore', name: 'Oceanic Kings', ownerName: '', budget: 0, roster: [], color: '#2563eb' } },
    } satisfies Action,
  });

  await emitWithAck(bidderTwo.socket, 'room:command', {
    action: {
      type: 'ADD_TEAM',
      payload: { team: { id: 'ignore', name: 'Golden Yorkers', ownerName: '', budget: 0, roster: [], color: '#d4a44e' } },
    } satisfies Action,
  });

  await emitWithAck(host.socket, 'room:command', { action: { type: 'START_GAME', payload: {} } satisfies Action });
  const firstLiveRoom = await waitForRoom(
    bidderOne.socket,
    (room) => room.status === 'ACTIVE' && Boolean(room.gameState.currentPlayerId),
  );

  const bidderOneTeam = firstLiveRoom.teams.find((team) => team.controlledByUserId === bidderOne.profile.id);
  if (!bidderOneTeam) {
    throw new Error('Bidder One team missing after room sync.');
  }

  const currentPlayer = firstLiveRoom.players.find((player) => player.id === firstLiveRoom.gameState.currentPlayerId);
  if (!currentPlayer) throw new Error('No active player after auction start.');

  await emitWithAck(bidderOne.socket, 'room:command', {
    action: {
      type: 'BID',
      payload: { teamId: bidderOneTeam.id, amount: currentPlayer.basePrice },
    } satisfies Action,
  });
  await waitForRoom(
    host.socket,
    (room) =>
      room.gameState.currentBid?.teamId === bidderOneTeam.id &&
      room.gameState.currentBid?.amount === currentPlayer.basePrice,
  );

  await emitWithAck(host.socket, 'room:command', { action: { type: 'SOLD', payload: {} } satisfies Action });
  await waitForRoom(
    host.socket,
    (room) => room.players.some((player) => player.id === currentPlayer.id && player.status === 'SOLD'),
  );

  await emitWithAck(host.socket, 'room:command', { action: { type: 'UNDO_LAST_ACTION', payload: {} } satisfies Action });
  const undoneRoom = await waitForRoom(
    host.socket,
    (room) =>
      room.gameState.currentPlayerId === currentPlayer.id &&
      room.players.some((player) => player.id === currentPlayer.id && player.status === 'ON_AUCTION') &&
      room.gameState.currentBid?.teamId === bidderOneTeam.id,
  );

  if (!undoneRoom.gameState.lastHostAction) {
    throw new Error('Expected host undo metadata to remain available after rollback.');
  }

  await emitWithAck(host.socket, 'room:command', { action: { type: 'SOLD', payload: {} } satisfies Action });
  await wait(3800);

  const [hostState, bidderOneState, bidderTwoState] = await Promise.all([
    latestRoom(host.socket),
    latestRoom(bidderOne.socket),
    latestRoom(bidderTwo.socket),
  ]);

  const revisions = new Set([hostState.revision, bidderOneState.revision, bidderTwoState.revision]);
  if (revisions.size !== 1) {
    throw new Error(`Room revisions diverged across clients: ${Array.from(revisions).join(', ')}`);
  }

  const syncedBudget = bidderOneState.teams.find((team) => team.id === bidderOneTeam.id)?.budget;
  if (syncedBudget !== 1500 - currentPlayer.basePrice) {
    throw new Error(`Budget mismatch after sale. Expected ${1500 - currentPlayer.basePrice}, got ${syncedBudget}`);
  }

  console.log(`sync smoke passed for room ${roomCode} at revision ${hostState.revision}`);

  host.socket.disconnect();
  bidderOne.socket.disconnect();
  bidderTwo.socket.disconnect();
};

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
