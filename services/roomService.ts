import { io, type Socket } from 'socket.io-client';
import type { Action, AuctionArchive, Room, UserProfile, UserState } from '../types';
import { getServerOrigin } from './serverOrigin';

const USER_KEY = 'ipl_user_profile';
const ARCHIVE_KEY = 'ipl_auction_archive';

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));

type Ack<T> = { ok: true; data: T } | { ok: false; error: string };

class RoomService {
  socket: Socket | null = null;
  currentRoom: Room | null = null;
  currentUser: UserState | null = null;
  currentProfile: UserProfile | null = null;
  activeRoomId: string | null = null;
  stateSubscribers: Array<(room: Room) => void> = [];
  statusSubscribers: Array<(status: string) => void> = [];
  connectionStatus = 'idle';
  logoCache = new Map<string, string>();

  private setStatus(status: string) {
    this.connectionStatus = status;
    this.statusSubscribers.forEach((callback) => callback(status));
  }

  private mergeRoom(room: Room) {
    const merged = clone(room);
    merged.teams = merged.teams.map((team) => ({
      ...team,
      logoUrl: team.logoAssetId ? this.logoCache.get(`${room.id}:${team.logoAssetId}`) : undefined,
    }));
    return merged;
  }

  private async fetchMissingLogos(room: Room) {
    const missing = room.teams.filter((team) => team.logoAssetId && !this.logoCache.has(`${room.id}:${team.logoAssetId}`));
    await Promise.all(
      missing.map(async (team) => {
        const response = await fetch(`${getServerOrigin()}/api/rooms/${room.id}/teams/${team.id}/logo`);
        if (!response.ok) return;
        const data = (await response.json()) as { logo: string };
        if (!data.logo) return;
        this.logoCache.set(`${room.id}:${team.logoAssetId}`, data.logo);
      }),
    );
    this.currentRoom = this.mergeRoom(room);
    this.notifySubscribers();
  }

  private ensureSocket(profile: UserProfile) {
    this.currentProfile = profile;
    if (this.socket) return this.socket;

    this.socket = io(getServerOrigin(), {
      transports: ['websocket'],
      withCredentials: true,
      autoConnect: true,
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
    });

    this.socket.on('connect', () => {
      this.setStatus('connected');
      if (this.currentProfile && this.activeRoomId && this.currentUser) {
        void this.emitWithAck<{ room: Room; user: UserState }>('room:rejoin', {
          profile: this.currentProfile,
          roomId: this.activeRoomId,
        }).catch(() => undefined);
      }
    });

    this.socket.on('disconnect', () => {
      this.setStatus('disconnected');
    });

    this.socket.on('connect_error', () => {
      this.setStatus('reconnecting');
    });

    this.socket.on('room:update', (room: Room) => {
      this.currentRoom = this.mergeRoom(room);
      this.notifySubscribers();
      void this.fetchMissingLogos(room);
      if (this.currentProfile) {
        void this.refreshArchive(this.currentProfile.id);
      }
    });

    return this.socket;
  }

  private async emitWithAck<T>(event: string, payload: unknown): Promise<T> {
    if (!this.socket) throw new Error('Socket not connected.');
    return new Promise<T>((resolve, reject) => {
      this.socket!.emit(event, payload, (response: Ack<T>) => {
        if (response.ok) {
          resolve(response.data);
          return;
        }
        reject(new Error('error' in response ? response.error : 'Request failed.'));
      });
    });
  }

  getUserProfile(): UserProfile | null {
    const data = localStorage.getItem(USER_KEY);
    return data ? JSON.parse(data) : null;
  }

  saveUserProfile(name: string): UserProfile {
    const profile: UserProfile = {
      id: `usr_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      name,
      createdAt: Date.now(),
      avatarSeed: Math.random().toString(36).slice(2, 10),
    };
    localStorage.setItem(USER_KEY, JSON.stringify(profile));
    this.currentProfile = profile;
    return profile;
  }

  async refreshArchive(userId: string) {
    const response = await fetch(`${getServerOrigin()}/api/archives/${userId}`);
    if (!response.ok) return this.getArchive();
    const data = (await response.json()) as { archives: AuctionArchive[] };
    localStorage.setItem(ARCHIVE_KEY, JSON.stringify(data.archives));
    return data.archives;
  }

  getArchive(): AuctionArchive[] {
    return JSON.parse(localStorage.getItem(ARCHIVE_KEY) || '[]');
  }

  async createRoom(profile: UserProfile, roomName: string): Promise<{ room: Room; user: UserState }> {
    this.ensureSocket(profile);
    const data = await this.emitWithAck<{ room: Room; user: UserState }>('room:create', { profile, roomName });
    this.currentUser = data.user;
    this.activeRoomId = data.room.id;
    this.currentRoom = this.mergeRoom(data.room);
    this.notifySubscribers();
    await this.refreshArchive(profile.id);
    return { room: this.currentRoom, user: data.user };
  }

  async joinRoom(roomId: string, profile: UserProfile): Promise<{ room: Room; user: UserState }> {
    this.ensureSocket(profile);
    const data = await this.emitWithAck<{ room: Room; user: UserState }>('room:join', {
      profile,
      roomId,
    });
    this.currentUser = data.user;
    this.activeRoomId = data.room.id;
    this.currentRoom = this.mergeRoom(data.room);
    this.notifySubscribers();
    await this.fetchMissingLogos(data.room);
    await this.refreshArchive(profile.id);
    return { room: this.currentRoom!, user: data.user };
  }

  async dispatch(action: Action) {
    if (!this.currentProfile) throw new Error('Login required.');
    const socket = this.ensureSocket(this.currentProfile);
    if (!socket.connected) this.setStatus('reconnecting');
    await this.emitWithAck('room:command', { action });
  }

  cleanup() {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
    this.currentRoom = null;
    this.currentUser = null;
    this.activeRoomId = null;
    this.logoCache.clear();
    this.setStatus('idle');
  }

  subscribe(callback: (room: Room) => void) {
    this.stateSubscribers.push(callback);
    if (this.currentRoom) callback(this.currentRoom);
    return () => {
      this.stateSubscribers = this.stateSubscribers.filter((entry) => entry !== callback);
    };
  }

  subscribeStatus(callback: (status: string) => void) {
    this.statusSubscribers.push(callback);
    callback(this.connectionStatus);
    return () => {
      this.statusSubscribers = this.statusSubscribers.filter((entry) => entry !== callback);
    };
  }

  private notifySubscribers() {
    if (!this.currentRoom) return;
    this.stateSubscribers.forEach((callback) => callback(this.currentRoom!));
  }
}

export const roomService = new RoomService();
