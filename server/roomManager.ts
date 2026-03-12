import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import type { Server, Socket } from 'socket.io';
import { INITIAL_CONFIG, MOCK_PLAYERS, TEAM_COLORS } from '../constants';
import { evaluateBidCapacity, getPendingPlayers } from '../auctionInsights';
import type {
  Action,
  AuctionArchive,
  AuctionConfig,
  LogEntry,
  Player,
  Pot,
  Room,
  Team,
  UserProfile,
  UserState,
} from '../types';
import {
  generateAuctionCommentary,
  generateUnsoldCommentary,
} from './gemini';

type RoomRecord = {
  room: Room;
  logoAssets: Map<string, string>;
  advanceAt: number | null;
  history: RoomCheckpoint[];
};

type RoomCheckpoint = {
  room: Room;
  advanceAt: number | null;
  label: string;
};

const DATA_DIR = path.resolve(process.cwd(), 'data');
const ARCHIVE_PATH = path.join(DATA_DIR, 'archives.json');
const ROOM_CODE_LENGTH = 6;
const MAX_LOGS = 80;
const MAX_HISTORY = 25;
const AUTO_ADVANCE_DELAY_MS = 3500;

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));

const sanitizeColor = (value?: string) => {
  if (value && /^#([0-9a-f]{6}|[0-9a-f]{3})$/i.test(value)) return value;
  return TEAM_COLORS[Math.floor(Math.random() * TEAM_COLORS.length)];
};

const generateRoomCode = () => Math.random().toString(36).slice(2, 2 + ROOM_CODE_LENGTH).toUpperCase();

const shuffleByPot = (players: Player[]) => {
  const order: Pot[] = ['A', 'B', 'C', 'D', 'Uncategorized'];
  const grouped = new Map<Pot, Player[]>();
  order.forEach((pot) => grouped.set(pot, []));

  for (const player of players) {
    const pot = order.includes(player.pot) ? player.pot : 'Uncategorized';
    grouped.get(pot)!.push(player);
  }

  return order.flatMap((pot) => {
    const list = grouped.get(pot)!;
    for (let index = list.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(Math.random() * (index + 1));
      [list[index], list[swapIndex]] = [list[swapIndex], list[index]];
    }
    return list;
  });
};

const resetPlayer = (player: Player): Player => ({
  ...player,
  soldPrice: undefined,
  soldToTeamId: undefined,
  status: 'PENDING',
});

const freshLog = (message: string, type: LogEntry['type']): LogEntry => ({
  id: crypto.randomUUID(),
  message,
  type,
  timestamp: Date.now(),
});

export class RoomManager {
  private archives: AuctionArchive[] = [];
  private rooms = new Map<string, RoomRecord>();

  constructor(private io: Server) {
    this.bootstrap().catch((error) => {
      console.error('room-manager-bootstrap-failed', error);
    });
    setInterval(() => {
      this.tick();
    }, 1000);
  }

  private async bootstrap() {
    await mkdir(DATA_DIR, { recursive: true });
    try {
      const raw = await readFile(ARCHIVE_PATH, 'utf8');
      this.archives = JSON.parse(raw);
    } catch {
      this.archives = [];
    }
  }

  private async saveArchives() {
    await mkdir(DATA_DIR, { recursive: true });
    await writeFile(ARCHIVE_PATH, JSON.stringify(this.archives, null, 2));
  }

  private touch(record: RoomRecord) {
    record.room.updatedAt = Date.now();
    record.room.revision += 1;
  }

  private syncLastHostAction(record: RoomRecord) {
    record.room.gameState.lastHostAction = record.history.at(-1)?.label || null;
  }

  private rememberCheckpoint(record: RoomRecord, label: string) {
    record.history.push({
      room: clone(record.room),
      advanceAt: record.advanceAt,
      label,
    });
    if (record.history.length > MAX_HISTORY) {
      record.history.shift();
    }
    this.syncLastHostAction(record);
  }

  private pushLog(record: RoomRecord, message: string, type: LogEntry['type']) {
    record.room.gameState.logs = [freshLog(message, type), ...record.room.gameState.logs].slice(0, MAX_LOGS);
  }

  private getSocketProfile(socket: Socket): UserProfile {
    const profile = socket.data.profile as UserProfile | undefined;
    if (!profile) {
      throw new Error('Unauthenticated session.');
    }
    return profile;
  }

  private ensureRoom(roomId: string) {
    const record = this.rooms.get(roomId);
    if (!record) throw new Error('Room not found.');
    return record;
  }

  private emitRoom(roomId: string) {
    const record = this.ensureRoom(roomId);
    this.io.to(roomId).emit('room:update', clone(record.room));
  }

  private async archiveRoom(record: RoomRecord) {
    const archive: AuctionArchive = {
      roomId: record.room.id,
      roomName: record.room.name,
      completedAt: Date.now(),
      hostId: record.room.hostId,
      memberIds: record.room.members.map((member) => member.userId),
      teams: clone(record.room.teams),
      players: clone(record.room.players),
      config: clone(record.room.config),
      logs: clone(record.room.gameState.logs),
    };

    this.archives = [archive, ...this.archives.filter((entry) => entry.roomId !== archive.roomId)];
    await this.saveArchives();
  }

  private upsertMember(record: RoomRecord, profile: UserProfile, isAdmin: boolean, connected: boolean) {
    const existing = record.room.members.find((member) => member.userId === profile.id);
    if (existing) {
      existing.connected = connected;
      existing.name = profile.name;
      existing.isAdmin = existing.isAdmin || isAdmin;
      return;
    }

    record.room.members.push({
      userId: profile.id,
      name: profile.name,
      isAdmin,
      joinedAt: Date.now(),
      connected,
    });
  }

  private storeLogo(record: RoomRecord, teamId: string, logoDataUrl?: string) {
    if (!logoDataUrl || !logoDataUrl.startsWith('data:')) return undefined;
    record.logoAssets.set(teamId, logoDataUrl);
    return teamId;
  }

  private makeInitialRoom(profile: UserProfile, roomName: string): Room {
    const now = Date.now();
    return {
      id: '',
      revision: 1,
      hostId: profile.id,
      name: roomName.trim(),
      createdAt: now,
      updatedAt: now,
      status: 'LOBBY',
      config: clone(INITIAL_CONFIG),
      teams: [],
      players: shuffleByPot(MOCK_PLAYERS.map(resetPlayer)),
      gameState: {
        currentPot: 'A',
        currentPlayerId: null,
        currentBid: null,
        timer: 0,
        logs: [],
        aiCommentary: '',
        isPaused: true,
        lastHostAction: null,
      },
      members: [],
    };
  }

  private startNextPlayer(record: RoomRecord) {
    const nextPlayer = record.room.players.find((player) => player.status === 'PENDING');
    if (!nextPlayer) {
      return this.completeRoom(record);
    }

    record.room.players = record.room.players.map((player) =>
      player.id === nextPlayer.id ? { ...player, status: 'ON_AUCTION' } : player,
    );
    record.room.gameState.currentPlayerId = nextPlayer.id;
    record.room.gameState.currentPot = nextPlayer.pot;
    record.room.gameState.currentBid = null;
    record.room.gameState.timer = record.room.config.bidTimerSeconds;
    record.room.gameState.isPaused = false;
    record.room.gameState.aiCommentary = '';
    record.advanceAt = null;
    this.pushLog(record, `On Block: ${nextPlayer.name}`, 'SYSTEM');
    this.touch(record);
    return clone(record.room);
  }

  private async completeRoom(record: RoomRecord) {
    if (record.room.status === 'COMPLETED') return clone(record.room);
    record.room.status = 'COMPLETED';
    record.room.gameState.isPaused = true;
    record.room.gameState.timer = 0;
    record.advanceAt = null;
    this.pushLog(record, 'Auction Finalized', 'SYSTEM');
    this.touch(record);
    await this.archiveRoom(record);
    return clone(record.room);
  }

  private async queueCommentary(
    roomId: string,
    kind: 'SOLD' | 'UNSOLD',
    player: Player,
    team?: Team,
    soldPrice?: number,
  ) {
    try {
      const record = this.rooms.get(roomId);
      if (!record) return;

      const message =
        kind === 'SOLD' && team && soldPrice
          ? await generateAuctionCommentary(player, team, soldPrice, record.room.teams)
          : await generateUnsoldCommentary(player);

      if (!message) return;

      const latest = this.rooms.get(roomId);
      if (!latest || latest.room.status === 'COMPLETED') return;

      latest.room.gameState.aiCommentary = message;
      this.pushLog(latest, message, 'AI');
      this.touch(latest);
      this.emitRoom(roomId);
    } catch (error) {
      console.error('queue-commentary-failed', error);
    }
  }

  createRoom(socket: Socket, profile: UserProfile, roomName: string) {
    if (!roomName.trim()) throw new Error('Room name is required.');

    let code = generateRoomCode();
    while (this.rooms.has(code)) code = generateRoomCode();

    const room = this.makeInitialRoom(profile, roomName);
    room.id = code;

    const record: RoomRecord = {
      room,
      logoAssets: new Map<string, string>(),
      advanceAt: null,
      history: [],
    };

    this.upsertMember(record, profile, true, true);
    this.rooms.set(code, record);

    socket.data.profile = profile;
    socket.data.roomId = code;
    socket.join(code);

    return {
      room: clone(record.room),
      user: { id: profile.id, name: profile.name, isAdmin: true, roomId: code } satisfies UserState,
    };
  }

  joinRoom(socket: Socket, profile: UserProfile, roomId: string) {
    const code = roomId.trim().toUpperCase();
    const record = this.ensureRoom(code);

    socket.data.profile = profile;
    socket.data.roomId = code;
    socket.join(code);

    this.upsertMember(record, profile, record.room.hostId === profile.id, true);
    this.touch(record);
    this.emitRoom(code);

    return {
      room: clone(record.room),
      user: {
        id: profile.id,
        name: profile.name,
        isAdmin: record.room.hostId === profile.id,
        roomId: code,
      } satisfies UserState,
    };
  }

  rejoinRoom(socket: Socket, profile: UserProfile, roomId: string) {
    return this.joinRoom(socket, profile, roomId);
  }

  async disconnect(socket: Socket) {
    const roomId = socket.data.roomId as string | undefined;
    const profile = socket.data.profile as UserProfile | undefined;
    if (!roomId || !profile) return;

    const record = this.rooms.get(roomId);
    if (!record) return;

    const stillConnected = Array.from(this.io.sockets.adapter.rooms.get(roomId) || []).some((socketId) => {
      if (socketId === socket.id) return false;
      const memberSocket = this.io.sockets.sockets.get(socketId);
      return memberSocket?.data.profile?.id === profile.id;
    });

    const member = record.room.members.find((entry) => entry.userId === profile.id);
    if (member) member.connected = stillConnected;

    this.touch(record);
    this.emitRoom(roomId);
  }

  getArchivesForUser(userId: string) {
    return this.archives.filter(
      (archive) =>
        archive.hostId === userId ||
        archive.memberIds.includes(userId) ||
        archive.teams.some((team) => team.controlledByUserId === userId),
    );
  }

  getTeamLogo(roomId: string, teamId: string) {
    const record = this.ensureRoom(roomId);
    return record.logoAssets.get(teamId) || '';
  }

  private ensureAdmin(record: RoomRecord, profile: UserProfile) {
    if (record.room.hostId !== profile.id) {
      throw new Error('Only the host can perform this action.');
    }
  }

  private ensureTeamOwner(record: RoomRecord, profile: UserProfile, teamId: string) {
    const team = record.room.teams.find((entry) => entry.id === teamId);
    if (!team) throw new Error('Team not found.');
    if (team.controlledByUserId !== profile.id && record.room.hostId !== profile.id) {
      throw new Error('You do not control this team.');
    }
    return team;
  }

  private sanitizeConfigUpdate(room: Room, update: Partial<AuctionConfig>) {
    const next = clone(room.config);

    if (typeof update.totalBudget === 'number' && Number.isFinite(update.totalBudget)) {
      next.totalBudget = Math.max(100, Math.round(update.totalBudget));
    }
    if (typeof update.maxPlayers === 'number' && Number.isFinite(update.maxPlayers)) {
      next.maxPlayers = Math.max(5, Math.round(update.maxPlayers));
    }
    if (typeof update.bidTimerSeconds === 'number' && Number.isFinite(update.bidTimerSeconds)) {
      next.bidTimerSeconds = Math.max(5, Math.round(update.bidTimerSeconds));
    }
    if (typeof update.minBidIncrement === 'number' && Number.isFinite(update.minBidIncrement)) {
      next.minBidIncrement = Math.max(1, Math.round(update.minBidIncrement));
    }
    if (typeof update.scheduledStartTime === 'number' && Number.isFinite(update.scheduledStartTime)) {
      next.scheduledStartTime = update.scheduledStartTime;
    }
    if (update.scheduledStartTime === undefined) {
      next.scheduledStartTime = undefined;
    }
    if (update.roleMinimums) {
      next.roleMinimums = {
        Batter: Math.max(0, Math.round(update.roleMinimums.Batter ?? next.roleMinimums.Batter)),
        Bowler: Math.max(0, Math.round(update.roleMinimums.Bowler ?? next.roleMinimums.Bowler)),
        'All Rounder': Math.max(
          0,
          Math.round(update.roleMinimums['All Rounder'] ?? next.roleMinimums['All Rounder']),
        ),
        'Wicket Keeper': Math.max(
          0,
          Math.round(update.roleMinimums['Wicket Keeper'] ?? next.roleMinimums['Wicket Keeper']),
        ),
      };
    }

    return next;
  }

  async handleCommand(socket: Socket, action: Action) {
    const roomId = socket.data.roomId as string | undefined;
    const profile = this.getSocketProfile(socket);
    if (!roomId) throw new Error('Join a room first.');

    const record = this.ensureRoom(roomId);

    switch (action.type) {
      case 'ADD_TEAM': {
        if (record.room.status !== 'LOBBY') throw new Error('Teams can only be created in the lobby.');
        if (record.room.teams.some((team) => team.controlledByUserId === profile.id)) {
          throw new Error('This user already controls a team in the room.');
        }

        const teamId = `team_${crypto.randomUUID().slice(0, 8)}`;
        const team: Team = {
          id: teamId,
          name: action.payload.team.name.trim().slice(0, 30) || `${profile.name} XI`,
          ownerName: profile.name,
          budget: record.room.config.totalBudget,
          roster: [],
          color: sanitizeColor(action.payload.team.color),
          controlledByUserId: profile.id,
          logoAssetId: this.storeLogo(record, teamId, action.payload.logoDataUrl),
        };
        record.room.teams.push(team);
        this.pushLog(record, `${team.name} entered the room`, 'SYSTEM');
        this.touch(record);
        this.emitRoom(roomId);
        return;
      }
      case 'UPDATE_TEAM': {
        if (record.room.status !== 'LOBBY') throw new Error('Teams can only be edited in the lobby.');
        const team = this.ensureTeamOwner(record, profile, action.payload.teamId);
        team.name = action.payload.updates.name?.trim().slice(0, 30) || team.name;
        team.color = sanitizeColor(action.payload.updates.color) || team.color;
        if (action.payload.logoDataUrl) {
          team.logoAssetId = this.storeLogo(record, team.id, action.payload.logoDataUrl);
        }
        this.touch(record);
        this.emitRoom(roomId);
        return;
      }
      case 'REMOVE_TEAM': {
        this.ensureAdmin(record, profile);
        if (record.room.status !== 'LOBBY') throw new Error('Teams can only be removed in the lobby.');
        record.room.teams = record.room.teams.filter((team) => team.id !== action.payload.teamId);
        this.touch(record);
        this.emitRoom(roomId);
        return;
      }
      case 'UPDATE_CONFIG': {
        this.ensureAdmin(record, profile);
        if (record.room.status !== 'LOBBY') throw new Error('Room settings are locked once the auction starts.');
        record.room.config = this.sanitizeConfigUpdate(record.room, action.payload);
        record.room.teams = record.room.teams.map((team) => ({
          ...team,
          budget: team.roster.reduce((remaining, player) => remaining - (player.soldPrice || 0), record.room.config.totalBudget),
        }));
        this.touch(record);
        this.emitRoom(roomId);
        return;
      }
      case 'IMPORT_PLAYERS': {
        this.ensureAdmin(record, profile);
        if (record.room.status !== 'LOBBY') throw new Error('Import players before the auction starts.');
        record.room.players = shuffleByPot(action.payload.map(resetPlayer));
        record.room.gameState.currentPlayerId = null;
        record.room.gameState.currentBid = null;
        record.room.gameState.timer = 0;
        record.room.gameState.isPaused = true;
        this.pushLog(record, `Imported ${record.room.players.length} players into the auction pool`, 'SYSTEM');
        this.touch(record);
        this.emitRoom(roomId);
        return;
      }
      case 'START_GAME': {
        this.ensureAdmin(record, profile);
        if (!record.room.teams.length) throw new Error('Add at least one team before starting the auction.');
        if (!record.room.players.length) throw new Error('Import players before starting the auction.');
        this.rememberCheckpoint(record, 'Started auction');
        record.room.status = 'ACTIVE';
        record.room.gameState.aiCommentary = '';
        record.room.gameState.isPaused = false;
        this.pushLog(record, 'Auction Hall is Live', 'SYSTEM');
        this.touch(record);
        this.startNextPlayer(record);
        this.emitRoom(roomId);
        return;
      }
      case 'END_GAME': {
        this.ensureAdmin(record, profile);
        await this.completeRoom(record);
        this.emitRoom(roomId);
        return;
      }
      case 'BID': {
        if (record.room.status !== 'ACTIVE') throw new Error('Auction is not active.');
        if (record.room.gameState.isPaused) throw new Error('Bidding is paused.');
        const team = this.ensureTeamOwner(record, profile, action.payload.teamId);
        const currentPlayer = record.room.players.find((player) => player.id === record.room.gameState.currentPlayerId);
        if (!currentPlayer) throw new Error('No player is currently on the block.');
        if (team.roster.length >= record.room.config.maxPlayers) throw new Error('Squad limit reached.');

        const currentAmount = record.room.gameState.currentBid?.amount || 0;
        const minimumAllowed = currentAmount
          ? currentAmount + record.room.config.minBidIncrement
          : currentPlayer.basePrice;

        if (action.payload.amount < minimumAllowed) {
          throw new Error(`Minimum valid bid is ${minimumAllowed}L.`);
        }
        if (team.budget < action.payload.amount) {
          throw new Error('Insufficient budget.');
        }
        const availablePlayersAfterWin = getPendingPlayers(record.room.players).filter(
          (player) => player.id !== currentPlayer.id,
        );
        const bidEvaluation = evaluateBidCapacity(
          record.room.config,
          team,
          currentPlayer,
          Math.round(action.payload.amount),
          availablePlayersAfterWin,
        );
        if (!bidEvaluation.canBid) {
          throw new Error(bidEvaluation.reason || 'This bid would leave the squad impossible to complete.');
        }

        this.rememberCheckpoint(record, `Bid ${Math.round(action.payload.amount)}L on ${currentPlayer.name}`);
        record.room.gameState.currentBid = {
          teamId: team.id,
          amount: Math.round(action.payload.amount),
          timestamp: Date.now(),
        };
        record.room.gameState.timer = record.room.config.bidTimerSeconds;
        this.pushLog(record, `${team.name} bid ${Math.round(action.payload.amount)} L`, 'BID');
        this.touch(record);
        this.emitRoom(roomId);
        return;
      }
      case 'SOLD':
      case 'UNSOLD': {
        this.ensureAdmin(record, profile);
        if (record.room.status !== 'ACTIVE') throw new Error('Auction is not active.');
        const currentPlayerId = record.room.gameState.currentPlayerId;
        if (!currentPlayerId) throw new Error('No active player to settle.');

        const playerIndex = record.room.players.findIndex((player) => player.id === currentPlayerId);
        if (playerIndex === -1) throw new Error('Current player not found.');

        const player = record.room.players[playerIndex];
        let winningTeam: Team | undefined;

        if (action.type === 'SOLD') {
          const currentBid = record.room.gameState.currentBid;
          if (!currentBid) throw new Error('Cannot sell a player without a valid bid.');
          winningTeam = record.room.teams.find((team) => team.id === currentBid.teamId);
          if (!winningTeam) throw new Error('Winning team not found.');
          this.rememberCheckpoint(record, `Sold ${player.name}`);
          winningTeam.budget -= currentBid.amount;
          const soldPlayer = {
            ...player,
            soldPrice: currentBid.amount,
            soldToTeamId: winningTeam.id,
            status: 'SOLD' as const,
          };
          winningTeam.roster = [...winningTeam.roster, soldPlayer];
          record.room.players[playerIndex] = soldPlayer;
          this.pushLog(record, `SOLD: ${player.name} to ${winningTeam.name}`, 'SOLD');
          void this.queueCommentary(roomId, 'SOLD', soldPlayer, winningTeam, currentBid.amount);
        } else {
          this.rememberCheckpoint(record, `Marked ${player.name} unsold`);
          record.room.players[playerIndex] = { ...player, status: 'UNSOLD' };
          this.pushLog(record, `UNSOLD: ${player.name}`, 'UNSOLD');
          void this.queueCommentary(roomId, 'UNSOLD', player);
        }

        record.room.gameState.currentBid = null;
        record.room.gameState.isPaused = true;
        record.room.gameState.timer = 0;
        record.advanceAt = Date.now() + AUTO_ADVANCE_DELAY_MS;
        this.touch(record);
        this.emitRoom(roomId);
        return;
      }
      case 'UNDO_LAST_ACTION': {
        this.ensureAdmin(record, profile);
        const checkpoint = record.history.pop();
        if (!checkpoint) throw new Error('No host action to undo.');
        record.room = clone(checkpoint.room);
        record.advanceAt = checkpoint.advanceAt;
        this.syncLastHostAction(record);
        this.pushLog(record, `Host undo: ${checkpoint.label}`, 'WARNING');
        this.touch(record);
        this.emitRoom(roomId);
        return;
      }
      case 'NEXT_PLAYER': {
        this.ensureAdmin(record, profile);
        if (record.room.gameState.currentPlayerId && record.room.gameState.currentBid) {
          throw new Error('Settle the current player before moving to the next one.');
        }
        const currentPlayerId = record.room.gameState.currentPlayerId;
        if (currentPlayerId) {
          const currentPlayerIndex = record.room.players.findIndex((player) => player.id === currentPlayerId);
          if (currentPlayerIndex !== -1 && record.room.players[currentPlayerIndex].status === 'ON_AUCTION') {
            this.rememberCheckpoint(record, `Skipped ${record.room.players[currentPlayerIndex].name}`);
            record.room.players[currentPlayerIndex] = {
              ...record.room.players[currentPlayerIndex],
              status: 'UNSOLD',
            };
            this.pushLog(record, `Skipped: ${record.room.players[currentPlayerIndex].name}`, 'WARNING');
          }
        }
        record.advanceAt = null;
        this.startNextPlayer(record);
        this.emitRoom(roomId);
        return;
      }
      case 'TOGGLE_PAUSE': {
        this.ensureAdmin(record, profile);
        if (record.room.status !== 'ACTIVE') throw new Error('Auction is not active.');
        this.rememberCheckpoint(record, record.room.gameState.isPaused ? 'Resumed room' : 'Paused room');
        record.room.gameState.isPaused = !record.room.gameState.isPaused;
        if (!record.room.gameState.isPaused && record.room.gameState.timer === 0) {
          record.room.gameState.timer = record.room.config.bidTimerSeconds;
        }
        this.touch(record);
        this.emitRoom(roomId);
        return;
      }
      case 'ADD_LOG': {
        this.ensureAdmin(record, profile);
        this.pushLog(record, action.payload.message, action.payload.type);
        this.touch(record);
        this.emitRoom(roomId);
        return;
      }
      default:
        throw new Error('Unsupported command.');
    }
  }

  private async tick() {
    for (const [roomId, record] of this.rooms.entries()) {
      let changed = false;

      if (
        record.room.status === 'LOBBY' &&
        record.room.config.scheduledStartTime &&
        Date.now() >= record.room.config.scheduledStartTime &&
        record.room.teams.length &&
        record.room.players.length
      ) {
        record.room.status = 'ACTIVE';
        record.room.gameState.isPaused = false;
        record.room.config.scheduledStartTime = undefined;
        this.pushLog(record, 'Scheduled auction start triggered', 'SYSTEM');
        this.startNextPlayer(record);
        changed = true;
      }

      if (record.advanceAt && Date.now() >= record.advanceAt) {
        record.advanceAt = null;
        await this.startNextPlayer(record);
        changed = true;
      }

      if (record.room.status === 'ACTIVE' && !record.room.gameState.isPaused && record.room.gameState.timer > 0) {
        record.room.gameState.timer -= 1;
        changed = true;
        if (record.room.gameState.timer <= 0) {
          record.room.gameState.timer = 0;
          record.room.gameState.isPaused = true;
          this.pushLog(record, 'Bid window closed. Awaiting the hammer.', 'WARNING');
        }
      }

      if (changed) {
        this.touch(record);
        this.emitRoom(roomId);
      }
    }
  }
}
