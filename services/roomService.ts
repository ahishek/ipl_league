
import Peer, { DataConnection } from 'peerjs';
import { Room, Team, Player, AuctionConfig, GameState, UserState, Action, LogEntry, Pot, UserProfile, AuctionArchive } from '../types';
import { INITIAL_CONFIG, MOCK_PLAYERS } from '../constants';

const APP_PREFIX = 'ipl-auction-v5-';
const HISTORY_KEY = 'ipl_auction_archive';
const USER_KEY = 'ipl_user_profile';

const generateCode = () => Math.random().toString(36).substring(2, 8).toUpperCase();

const shuffleByPot = (players: Player[]): Player[] => {
    const potOrder: Pot[] = ['A', 'B', 'C', 'Uncategorized'];
    const groups: Record<string, Player[]> = {};
    potOrder.forEach(p => groups[p] = []);
    players.forEach(p => {
        const potKey = potOrder.includes(p.pot) ? p.pot : 'Uncategorized';
        groups[potKey].push(p);
    });
    return potOrder.flatMap(p => {
        const arr = groups[p];
        for (let i = arr.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [arr[i], arr[j]] = [arr[j], arr[i]];
        }
        return arr;
    });
};

const PEER_CONFIG = {
    debug: 1,
    config: {
        iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            { urls: 'stun:stun2.l.google.com:19302' },
        ]
    }
};

class RoomService {
    peer: Peer | null = null;
    connections: DataConnection[] = [];
    hostConn: DataConnection | null = null;
    currentRoom: Room | null = null;
    currentUser: UserState | null = null;
    isHost: boolean = false;
    stateSubscribers: ((room: Room) => void)[] = [];

    constructor() {
        if (typeof window !== 'undefined') {
            window.addEventListener('beforeunload', () => {
                this.peer?.destroy();
            });
        }
    }

    getUserProfile(): UserProfile | null {
        const data = localStorage.getItem(USER_KEY);
        return data ? JSON.parse(data) : null;
    }

    saveUserProfile(name: string): UserProfile {
        const profile: UserProfile = {
            id: `usr_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
            name,
            createdAt: Date.now(),
            avatarSeed: Math.random().toString(36).substr(2, 8)
        };
        localStorage.setItem(USER_KEY, JSON.stringify(profile));
        return profile;
    }

    async createRoom(hostProfile: UserProfile, roomName: string): Promise<{ room: Room, user: UserState }> {
        const roomId = generateCode();
        const userId = hostProfile.id;
        this.isHost = true;
        
        this.currentRoom = {
            id: roomId,
            hostId: userId,
            name: roomName,
            createdAt: Date.now(),
            status: 'LOBBY',
            config: { ...INITIAL_CONFIG },
            teams: [],
            players: shuffleByPot([...MOCK_PLAYERS]),
            gameState: {
                currentPot: 'A',
                currentPlayerId: null,
                currentBid: null,
                timer: INITIAL_CONFIG.bidTimerSeconds,
                logs: [],
                aiCommentary: "",
                isPaused: true
            },
            members: [{ userId, name: hostProfile.name, isAdmin: true }]
        };
        this.currentUser = { id: userId, name: hostProfile.name, isAdmin: true };

        return new Promise((resolve, reject) => {
            if (this.peer) this.peer.destroy();
            this.peer = new Peer(`${APP_PREFIX}${roomId}`, PEER_CONFIG);
            this.peer.on('open', () => resolve({ room: this.currentRoom!, user: this.currentUser! }));
            this.peer.on('connection', (conn) => this.handleConnection(conn));
            this.peer.on('error', reject);
        });
    }

    async joinRoom(roomId: string, userProfile: UserProfile): Promise<{ room: Room | null, user: UserState }> {
        this.isHost = false;
        const userId = userProfile.id;
        this.currentUser = { id: userId, name: userProfile.name, isAdmin: false };
        this.currentRoom = null; 

        return new Promise((resolve, reject) => {
            if (this.peer) this.peer.destroy();
            this.peer = new Peer(PEER_CONFIG); 
            
            // Handle peer errors (like peer-unavailable)
            this.peer.on('error', (err) => {
                console.error("Peer error:", err);
                reject(err);
            });

            this.peer.on('open', () => {
                const conn = this.peer!.connect(`${APP_PREFIX}${roomId}`);
                conn.on('open', () => {
                    this.hostConn = conn;
                    this.dispatch({ type: 'JOIN', payload: { userId, name: userProfile.name } });
                    conn.on('data', (data: any) => {
                        const action = data as Action;
                        if (action.type === 'SYNC') {
                            this.currentRoom = action.payload;
                            if (this.currentRoom.status === 'COMPLETED') this.archiveRoom(this.currentRoom);
                            this.notifySubscribers();
                            resolve({ room: this.currentRoom, user: this.currentUser! });
                        } else {
                            this.handleAction(action);
                        }
                    });
                });
                conn.on('error', (err) => {
                    console.error("Connection error:", err);
                    reject(err);
                });
                // Connection might hang if peer ID is valid but blocked, so we keep the timeout
                setTimeout(() => reject(new Error("Join Timeout")), 10000);
            });
        });
    }

    private handleConnection(conn: DataConnection) {
        this.connections.push(conn);
        conn.on('data', (data: any) => this.handleAction(data as Action));
        if (this.currentRoom) conn.send({ type: 'SYNC', payload: this.currentRoom });
    }

    private handleAction(action: Action) {
        if (!this.isHost) {
            if (action.type === 'SYNC') {
                this.currentRoom = action.payload;
                if (this.currentRoom.status === 'COMPLETED') this.archiveRoom(this.currentRoom);
                this.notifySubscribers();
            }
            return;
        }

        if (!this.currentRoom) return;
        let room: Room = JSON.parse(JSON.stringify(this.currentRoom));
        let logs = [...room.gameState.logs];

        switch (action.type) {
            case 'JOIN':
                if (!room.members.find(m => m.userId === action.payload.userId)) {
                    room.members.push({ ...action.payload, isAdmin: false });
                }
                break;
            case 'ADD_TEAM':
                room.teams.push(action.payload);
                break;
            case 'UPDATE_TEAM':
                room.teams = room.teams.map(t => t.id === action.payload.teamId ? { ...t, ...action.payload.updates } : t);
                break;
            case 'UPDATE_CONFIG':
                room.config = { ...room.config, ...action.payload };
                break;
            case 'REMOVE_TEAM':
                room.teams = room.teams.filter(t => t.id !== action.payload.teamId);
                break;
            case 'IMPORT_PLAYERS':
                room.players = shuffleByPot(action.payload);
                break;
            case 'START_GAME':
                room.status = 'ACTIVE';
                room.gameState.isPaused = false;
                logs.unshift({ id: Date.now().toString(), message: "Auction Hall is Live", type: 'SYSTEM', timestamp: new Date() });
                break;
            case 'END_GAME':
                room.status = 'COMPLETED';
                room.gameState.isPaused = true;
                room.gameState.timer = 0;
                logs.unshift({ id: Date.now().toString(), message: "Auction Finalized and Ended", type: 'SYSTEM', timestamp: new Date() });
                // Host archives immediately
                this.archiveRoom(room);
                break;
            case 'BID':
                const { teamId, amount } = action.payload;
                const team = room.teams.find(t => t.id === teamId);
                const currentAmt = room.gameState.currentBid?.amount || 0;
                const player = room.players.find(p => p.id === room.gameState.currentPlayerId);
                if (team && player && amount > currentAmt && amount >= player.basePrice && team.budget >= amount) {
                    room.gameState.currentBid = { teamId, amount, timestamp: Date.now() };
                    room.gameState.timer = room.config.bidTimerSeconds;
                    logs.unshift({ id: Date.now().toString(), message: `${team.name} bid ${amount} L`, type: 'BID', timestamp: new Date() });
                }
                break;
            case 'SOLD':
                 if (room.gameState.currentPlayerId && room.gameState.currentBid) {
                     const winningTeamId = room.gameState.currentBid.teamId;
                     const soldPrice = room.gameState.currentBid.amount;
                     const pIndex = room.players.findIndex(x => x.id === room.gameState.currentPlayerId);
                     const tIndex = room.teams.findIndex(t => t.id === winningTeamId);
                     if (pIndex !== -1 && tIndex !== -1) {
                         const soldP = { ...room.players[pIndex], status: 'SOLD' as const, soldPrice, soldToTeamId: winningTeamId };
                         room.players[pIndex] = soldP;
                         room.teams[tIndex] = { ...room.teams[tIndex], budget: room.teams[tIndex].budget - soldPrice, roster: [...room.teams[tIndex].roster, soldP] };
                         if (action.payload.commentary) logs.unshift({ id: Date.now().toString(), message: action.payload.commentary, type: 'AI', timestamp: new Date() });
                         logs.unshift({ id: (Date.now()+1).toString(), message: `SOLD: ${soldP.name} to ${room.teams[tIndex].name}`, type: 'SOLD', timestamp: new Date() });
                         room.gameState.currentBid = null;
                         room.gameState.isPaused = true;
                     }
                 }
                 break;
            case 'UNSOLD':
                 if (room.gameState.currentPlayerId) {
                     const pIndex = room.players.findIndex(x => x.id === room.gameState.currentPlayerId);
                     if (pIndex !== -1) {
                         room.players[pIndex] = { ...room.players[pIndex], status: 'UNSOLD' };
                         if (action.payload.commentary) logs.unshift({ id: Date.now().toString(), message: action.payload.commentary, type: 'AI', timestamp: new Date() });
                         logs.unshift({ id: (Date.now()+1).toString(), message: `UNSOLD: ${room.players[pIndex].name}`, type: 'UNSOLD', timestamp: new Date() });
                         room.gameState.currentBid = null;
                         room.gameState.isPaused = true;
                     }
                 }
                 break;
            case 'NEXT_PLAYER':
                let next = room.players.find(p => p.status === 'PENDING');
                if (next) {
                    room.players = room.players.map(p => p.id === next?.id ? { ...p, status: 'ON_AUCTION' } : p);
                    room.gameState.currentPlayerId = next.id;
                    room.gameState.currentPot = next.pot;
                    room.gameState.currentBid = null;
                    room.gameState.timer = room.config.bidTimerSeconds;
                    room.gameState.isPaused = false;
                    room.gameState.aiCommentary = "";
                    logs.unshift({ id: Date.now().toString(), message: `On Block: ${next.name}`, type: 'SYSTEM', timestamp: new Date() });
                } else {
                    room.status = 'COMPLETED';
                    this.archiveRoom(room);
                }
                break;
            case 'UPDATE_TIMER':
                room.gameState.timer = action.payload.timer;
                break;
            case 'TOGGLE_PAUSE':
                room.gameState.isPaused = !room.gameState.isPaused;
                break;
            case 'ADD_LOG':
                logs.unshift({ id: Date.now().toString(), message: action.payload.message, type: action.payload.type, timestamp: new Date() });
                break;
        }

        room.gameState.logs = logs.slice(0, 50);
        this.currentRoom = room;
        this.broadcast({ type: 'SYNC', payload: room });
        this.notifySubscribers();
    }

    private archiveRoom(room: Room) {
        if (!this.currentUser) return;
        const myTeam = room.teams.find(t => t.controlledByUserId === this.currentUser!.id);
        if (!myTeam) return;

        const archive: AuctionArchive[] = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
        if (!archive.find(a => a.roomId === room.id)) {
            archive.unshift({ roomId: room.id, roomName: room.name, completedAt: Date.now(), myTeam: myTeam });
            localStorage.setItem(HISTORY_KEY, JSON.stringify(archive));
        }
    }

    getArchive(): AuctionArchive[] { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); }

    dispatch(action: Action) {
        if (this.isHost) this.handleAction(action);
        else if (this.hostConn?.open) this.hostConn.send(action);
    }

    private broadcast(action: Action) { this.connections.forEach(conn => conn.open && conn.send(action)); }

    private notifySubscribers() { if (this.currentRoom) this.stateSubscribers.forEach(cb => cb(this.currentRoom!)); }

    subscribe(callback: (room: Room) => void) {
        this.stateSubscribers.push(callback);
        if (this.currentRoom) callback(this.currentRoom);
        return () => {
            this.stateSubscribers = this.stateSubscribers.filter(cb => cb !== callback);
        };
    }
}

export const roomService = new RoomService();
