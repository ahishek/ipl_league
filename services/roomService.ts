import Peer, { DataConnection } from 'peerjs';
import { Room, Team, Player, AuctionConfig, GameState, UserState, Action, LogEntry, Pot, UserProfile, AuctionArchive } from '../types';
import { INITIAL_CONFIG, MOCK_PLAYERS } from '../constants';

// Bump version to force clean slate
const APP_PREFIX = 'ipl-auction-v13-';
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
    debug: 1, // Reduced debug noise
    config: {
        iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:global.stun.twilio.com:3478' }
        ],
        sdpSemantics: 'unified-plan'
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
    
    // Heartbeat & Monitoring
    pingIntervalId: any = null;
    monitorIntervalId: any = null;
    lastHostPing: number = Date.now();
    isConnecting: boolean = false;

    constructor() {
        if (typeof window !== 'undefined') {
            window.addEventListener('beforeunload', () => {
                this.cleanup();
            });
        }
    }

    private cleanup() {
        this.stopHeartbeat();
        this.stopMonitor();
        this.peer?.destroy();
        this.peer = null;
        this.connections = [];
        this.hostConn = null;
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
        this.cleanup();
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
                timer: 0,
                logs: [],
                aiCommentary: "",
                isPaused: true
            },
            members: [{ userId, name: hostProfile.name, isAdmin: true }]
        };
        this.currentUser = { id: userId, name: hostProfile.name, isAdmin: true };

        return new Promise((resolve, reject) => {
            this.peer = new Peer(`${APP_PREFIX}${roomId}`, PEER_CONFIG);
            
            this.peer.on('open', () => {
                console.log("HOST: Room Ready", roomId);
                this.startHeartbeat();
                resolve({ room: this.currentRoom!, user: this.currentUser! });
            });
            
            this.peer.on('connection', (conn) => this.handleHostConnection(conn));
            
            this.peer.on('error', (err) => {
                console.error("HOST: Peer Error", err);
                if (err.type === 'unavailable-id') {
                    this.createRoom(hostProfile, roomName).then(resolve).catch(reject);
                } else {
                    reject(err);
                }
            });
        });
    }

    async joinRoom(roomId: string, userProfile: UserProfile): Promise<{ room: Room | null, user: UserState }> {
        this.isHost = false;
        const userId = userProfile.id;
        this.currentUser = { id: userId, name: userProfile.name, isAdmin: false };
        this.currentRoom = null; 
        const cleanRoomId = roomId.trim().toUpperCase();

        if (this.peer) this.peer.destroy();
        this.peer = new Peer(PEER_CONFIG);

        return new Promise((resolve, reject) => {
            const attemptConnection = () => {
                if (!this.peer || this.peer.destroyed) return;
                console.log(`CLIENT: Connecting to ${APP_PREFIX}${cleanRoomId}`);
                
                const conn = this.peer.connect(`${APP_PREFIX}${cleanRoomId}`, {
                    reliable: true,
                    serialization: 'json'
                });

                if (!conn) {
                    reject(new Error("Failed to create connection"));
                    return;
                }

                // Connection Timeout logic
                const timer = setTimeout(() => {
                    if (!this.currentRoom) {
                        conn.close();
                        reject(new Error("Connection timed out"));
                    }
                }, 10000);

                this.setupClientConnection(conn, (data: any) => {
                    clearTimeout(timer);
                    resolve(data);
                    this.startMonitor(cleanRoomId, userProfile);
                });
            };

            this.peer.on('open', attemptConnection);
            this.peer.on('error', (err) => {
                console.error("CLIENT: Peer Error", err);
                reject(err);
            });
        });
    }

    private setupClientConnection(conn: DataConnection, onReady?: (data: any) => void) {
        this.hostConn = conn;
        
        conn.on('open', () => {
            console.log("CLIENT: Channel Open");
            this.hostConn = conn;
            this.lastHostPing = Date.now();
            if (this.currentUser) {
                conn.send({ type: 'JOIN', payload: { userId: this.currentUser.id, name: this.currentUser.name } });
            }
        });

        conn.on('data', (data: any) => {
            this.lastHostPing = Date.now();
            const action = data as Action;
            
            if (action.type === 'SYNC') {
                this.currentRoom = action.payload;
                if (this.currentRoom.status === 'COMPLETED') this.archiveRoom(this.currentRoom);
                this.notifySubscribers();
                if (onReady) {
                    onReady({ room: this.currentRoom, user: this.currentUser! });
                    onReady = undefined; // Ensure only called once
                }
            } else if (action.type === 'PING') {
                // Heartbeat received, lastHostPing updated above
            } else {
                this.handleAction(action);
            }
        });

        conn.on('close', () => {
            console.warn("CLIENT: Connection Closed");
            this.hostConn = null;
        });

        conn.on('error', (err) => console.error("CLIENT: Conn Error", err));
    }

    private handleHostConnection(conn: DataConnection) {
        this.connections.push(conn);
        console.log("HOST: Peer Connected", conn.peer);

        conn.on('data', (data: any) => this.handleAction(data as Action));
        
        conn.on('close', () => {
            this.connections = this.connections.filter(c => c !== conn);
        });
        
        conn.on('open', () => {
            // Immediate SYNC on connect
            if (this.currentRoom) {
                conn.send({ type: 'SYNC', payload: this.currentRoom });
            }
        });
    }

    // --- State Management ---

    private handleAction(action: Action) {
        if (action.type === 'PING') return;

        // Client: Just update state if SYNC (handled in on('data') primarily, but backup here)
        if (!this.isHost) {
            if (action.type === 'SYNC') {
                this.currentRoom = action.payload;
                this.notifySubscribers();
            }
            return;
        }

        // Host Logic
        if (!this.currentRoom) return;
        
        // Deep copy to ensure immutability trigger in React
        let room: Room = JSON.parse(JSON.stringify(this.currentRoom));
        let logs = [...room.gameState.logs];

        // ... Action Reducers ...
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
                room.gameState.currentPlayerId = null;
                room.gameState.currentBid = null;
                room.gameState.isPaused = true;
                logs.unshift({ id: Date.now().toString(), message: "Host updated Player Pool", type: 'SYSTEM', timestamp: new Date() });
                break;
            case 'START_GAME':
                console.log("HOST: Starting Game");
                room.status = 'ACTIVE';
                room.gameState.isPaused = false;
                logs.unshift({ id: Date.now().toString(), message: "Auction Hall is Live", type: 'SYSTEM', timestamp: new Date() });
                break;
            case 'END_GAME':
                room.status = 'COMPLETED';
                room.gameState.isPaused = true;
                logs.unshift({ id: Date.now().toString(), message: "Auction Finalized", type: 'SYSTEM', timestamp: new Date() });
                this.archiveRoom(room);
                break;
            case 'BID':
                const { teamId, amount } = action.payload;
                const team = room.teams.find(t => t.id === teamId);
                const currentAmt = room.gameState.currentBid?.amount || 0;
                const player = room.players.find(p => p.id === room.gameState.currentPlayerId);
                if (team && player && amount > currentAmt && team.budget >= amount) {
                    room.gameState.currentBid = { teamId, amount, timestamp: Date.now() };
                    logs.unshift({ id: Date.now().toString(), message: `${team.name} bid ${amount} L`, type: 'BID', timestamp: new Date() });
                }
                break;
            case 'SOLD':
            case 'UNSOLD':
                if (room.gameState.currentPlayerId) {
                    const pIndex = room.players.findIndex(x => x.id === room.gameState.currentPlayerId);
                    if (pIndex !== -1) {
                        const p = room.players[pIndex];
                        if (action.type === 'SOLD' && room.gameState.currentBid) {
                            const bid = room.gameState.currentBid;
                            const tIndex = room.teams.findIndex(t => t.id === bid.teamId);
                            if (tIndex !== -1) {
                                room.teams[tIndex].budget -= bid.amount;
                                room.teams[tIndex].roster.push({ ...p, status: 'SOLD', soldPrice: bid.amount, soldToTeamId: bid.teamId });
                                room.players[pIndex] = { ...p, status: 'SOLD', soldPrice: bid.amount, soldToTeamId: bid.teamId };
                                logs.unshift({ id: Date.now().toString(), message: `SOLD: ${p.name} to ${room.teams[tIndex].name}`, type: 'SOLD', timestamp: new Date() });
                            }
                        } else {
                            room.players[pIndex] = { ...p, status: 'UNSOLD' };
                            logs.unshift({ id: Date.now().toString(), message: `UNSOLD: ${p.name}`, type: 'UNSOLD', timestamp: new Date() });
                        }
                        if (action.payload.commentary) logs.unshift({ id: (Date.now()+1).toString(), message: action.payload.commentary, type: 'AI', timestamp: new Date() });
                        room.gameState.currentBid = null;
                        room.gameState.isPaused = true;
                    }
                }
                break;
            case 'NEXT_PLAYER':
                const next = room.players.find(p => p.status === 'PENDING');
                if (next) {
                    room.players = room.players.map(p => p.id === next.id ? { ...p, status: 'ON_AUCTION' } : p);
                    room.gameState.currentPlayerId = next.id;
                    room.gameState.currentPot = next.pot;
                    room.gameState.currentBid = null;
                    room.gameState.isPaused = false;
                    room.gameState.aiCommentary = "";
                    logs.unshift({ id: Date.now().toString(), message: `On Block: ${next.name}`, type: 'SYSTEM', timestamp: new Date() });
                } else {
                    room.status = 'COMPLETED';
                    this.archiveRoom(room);
                }
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
        
        // Broadcast Update
        this.broadcast({ type: 'SYNC', payload: room });
        this.notifySubscribers();
    }

    // --- Networking Utilities ---

    dispatch(action: Action) {
        if (this.isHost) {
            this.handleAction(action);
        } else if (this.hostConn && this.hostConn.open) {
            this.hostConn.send(action);
        } else {
            console.warn("CLIENT: Cannot dispatch, no connection");
        }
    }

    private broadcast(action: Action) {
        // Filter out closed connections lazily
        this.connections = this.connections.filter(c => c.open);
        this.connections.forEach(conn => {
            try { conn.send(action); } catch (e) { console.error("Broadcast failed", e); }
        });
    }

    private startHeartbeat() {
        this.stopHeartbeat();
        this.pingIntervalId = setInterval(() => {
            if (this.isHost) this.broadcast({ type: 'PING', payload: {} });
        }, 2000);
    }

    private stopHeartbeat() {
        if (this.pingIntervalId) clearInterval(this.pingIntervalId);
    }

    private startMonitor(roomId: string, user: UserProfile) {
        this.stopMonitor();
        this.monitorIntervalId = setInterval(() => {
            if (this.isHost) return;
            const timeDiff = Date.now() - this.lastHostPing;
            // If no ping for 10 seconds, try to reconnect
            if (timeDiff > 10000 && !this.isConnecting) {
                console.warn("CLIENT: Connection lost. Reconnecting...");
                this.reconnect(roomId, user);
            }
        }, 5000);
    }

    private stopMonitor() {
        if (this.monitorIntervalId) clearInterval(this.monitorIntervalId);
    }

    private async reconnect(roomId: string, user: UserProfile) {
        this.isConnecting = true;
        if (this.hostConn) this.hostConn.close();
        
        try {
            if (!this.peer || this.peer.destroyed) {
                 this.peer = new Peer(PEER_CONFIG);
                 await new Promise<void>(resolve => this.peer!.on('open', () => resolve()));
            }

            const conn = this.peer!.connect(`${APP_PREFIX}${roomId}`, { reliable: true, serialization: 'json' });
            if (conn) {
                this.setupClientConnection(conn);
                // Wait for open
                setTimeout(() => {
                    if (conn.open) {
                        conn.send({ type: 'JOIN', payload: { userId: user.id, name: user.name } });
                        console.log("CLIENT: Reconnected successfully");
                    }
                }, 2000);
            }
        } catch (e) {
            console.error("CLIENT: Reconnect failed", e);
        } finally {
            this.isConnecting = false;
        }
    }

    // --- Subscription & Persistence ---

    private archiveRoom(room: Room) {
        const archive: AuctionArchive[] = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
        if (!archive.find(a => a.roomId === room.id)) {
            archive.unshift({ roomId: room.id, roomName: room.name, completedAt: Date.now(), teams: room.teams });
            localStorage.setItem(HISTORY_KEY, JSON.stringify(archive));
        }
    }

    getArchive(): AuctionArchive[] { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); }

    private notifySubscribers() {
        if (this.currentRoom) {
            this.stateSubscribers.forEach(cb => cb(this.currentRoom!));
        }
    }

    subscribe(callback: (room: Room) => void) {
        this.stateSubscribers.push(callback);
        if (this.currentRoom) callback(this.currentRoom);
        return () => {
            this.stateSubscribers = this.stateSubscribers.filter(cb => cb !== callback);
        };
    }
}

export const roomService = new RoomService();