import Peer, { DataConnection } from 'peerjs';
import { Room, Team, Player, AuctionConfig, GameState, UserState, Action, LogEntry, Pot, UserProfile, AuctionArchive } from '../types';
import { INITIAL_CONFIG, MOCK_PLAYERS } from '../constants';

// Bump version to 'v14' to ensure we don't conflict with cached/stale sessions from v13
const APP_PREFIX = 'ipl-auction-v14-';
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

// Expanded STUN server list for better NAT penetration
const PEER_CONFIG = {
    debug: 2, // Level 2: Warnings and Errors
    config: {
        iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:global.stun.twilio.com:3478' },
            { urls: 'stun:stun1.l.google.com:19302' },
            { urls: 'stun:stun2.l.google.com:19302' },
            { urls: 'stun:stun3.l.google.com:19302' },
            { urls: 'stun:stun4.l.google.com:19302' }
        ],
        sdpSemantics: 'unified-plan',
        iceCandidatePoolSize: 10,
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
    
    // Connection Health Monitoring
    pingIntervalId: any = null;
    monitorIntervalId: any = null;
    lastHostPing: number = 0;
    
    // Reconnection State
    activeRoomId: string | null = null;
    isReconnecting: boolean = false;

    constructor() {
        if (typeof window !== 'undefined') {
            window.addEventListener('beforeunload', () => {
                this.cleanup();
            });
        }
    }

    // --- Instrumentation / Logging ---
    private log(tag: string, msg: string, data?: any) {
        const time = new Date().toISOString().split('T')[1].substring(0, 8);
        console.log(`%c[${time}][${tag}] ${msg}`, 'color: #0ea5e9; font-weight: bold;', data || '');
    }

    private warn(tag: string, msg: string, data?: any) {
        const time = new Date().toISOString().split('T')[1].substring(0, 8);
        console.warn(`%c[${time}][${tag}] ${msg}`, 'color: #f59e0b; font-weight: bold;', data || '');
    }

    private error(tag: string, msg: string, err?: any) {
        const time = new Date().toISOString().split('T')[1].substring(0, 8);
        console.error(`%c[${time}][${tag}] ${msg}`, 'color: #ef4444; font-weight: bold;', err || '');
    }

    private cleanup() {
        this.log('SYSTEM', 'Cleaning up resources...');
        this.stopHeartbeat();
        this.stopMonitor();
        this.connections.forEach(c => c.close());
        this.connections = [];
        if (this.hostConn) {
            this.hostConn.close();
            this.hostConn = null;
        }
        if (this.peer) {
            this.peer.destroy();
            this.peer = null;
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

    // --- Host Logic ---

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
            this.log('HOST', `Creating room with ID: ${roomId}`);
            
            try {
                this.peer = new Peer(`${APP_PREFIX}${roomId}`, PEER_CONFIG);
            } catch (e) {
                this.error('HOST', 'Failed to initialize PeerJS', e);
                reject(e);
                return;
            }
            
            this.peer.on('open', (id) => {
                this.log('HOST', `Peer Open. ID Registered: ${id}`);
                this.startHeartbeat(); // Start sending pings
                resolve({ room: this.currentRoom!, user: this.currentUser! });
            });
            
            this.peer.on('connection', (conn) => this.handleHostConnection(conn));
            
            this.peer.on('error', (err) => {
                this.error('HOST', `Peer Error: ${err.type}`, err);
                if (err.type === 'unavailable-id') {
                    this.warn('HOST', 'ID Taken, retrying with new ID...');
                    // Retry once with a new ID
                    this.createRoom(hostProfile, roomName).then(resolve).catch(reject);
                } else {
                    reject(err);
                }
            });

            this.peer.on('disconnected', () => {
                this.warn('HOST', 'Disconnected from signaling server. Attempting reconnect...');
                this.peer?.reconnect();
            });
        });
    }

    private handleHostConnection(conn: DataConnection) {
        this.log('HOST', `Incoming connection from ${conn.peer}`);
        
        conn.on('open', () => {
            this.log('HOST', `Connection established with ${conn.peer}`);
            this.connections.push(conn);
            
            // Note: We DO NOT send SYNC immediately anymore. 
            // We wait for the 'REQUEST_SYNC' message from client to prevent race conditions.
        });

        conn.on('data', (data: any) => {
            // Special Handshake Handling
            if (data && data.type === 'REQUEST_SYNC') {
                this.log('HOST', `Received REQUEST_SYNC from ${conn.peer}`);
                if (this.currentRoom) {
                    conn.send({ type: 'SYNC', payload: this.currentRoom });
                }
                return;
            }
            // Standard Action Handling
            this.handleAction(data as Action);
        });
        
        conn.on('close', () => {
            this.log('HOST', `Connection closed: ${conn.peer}`);
            this.connections = this.connections.filter(c => c !== conn);
        });
        
        conn.on('error', (err) => {
             this.error('HOST', `Connection error with ${conn.peer}`, err);
             this.connections = this.connections.filter(c => c !== conn);
        });
    }

    // --- Client Logic ---

    async joinRoom(roomId: string, userProfile: UserProfile): Promise<{ room: Room | null, user: UserState }> {
        this.isHost = false;
        const userId = userProfile.id;
        this.currentUser = { id: userId, name: userProfile.name, isAdmin: false };
        this.currentRoom = null; 
        this.activeRoomId = roomId.trim().toUpperCase();

        if (this.peer) {
            this.log('CLIENT', 'Destroying old peer instance before join');
            this.peer.destroy();
        }
        this.peer = new Peer(PEER_CONFIG);

        return new Promise((resolve, reject) => {
            this.log('CLIENT', `Initializing Peer to join ${this.activeRoomId}`);

            this.peer!.on('open', (id) => {
                this.log('CLIENT', `Peer initialized with ID: ${id}`);
                this.connectToHost(this.activeRoomId!, userProfile)
                    .then((data) => {
                        this.startMonitor(this.activeRoomId!, userProfile);
                        resolve(data);
                    })
                    .catch(reject);
            });

            this.peer!.on('error', (err) => {
                this.error('CLIENT', `Peer Error: ${err.type}`, err);
                reject(err);
            });
        });
    }

    private connectToHost(roomId: string, user: UserProfile): Promise<{ room: Room | null, user: UserState }> {
        return new Promise((resolve, reject) => {
            if (!this.peer || this.peer.destroyed) {
                reject(new Error("Peer destroyed"));
                return;
            }

            const hostPeerId = `${APP_PREFIX}${roomId}`;
            this.log('CLIENT', `Attempting to connect to Host: ${hostPeerId}`);

            const conn = this.peer.connect(hostPeerId, {
                reliable: true,
                serialization: 'json'
            });

            if (!conn) {
                reject(new Error("Failed to create connection object"));
                return;
            }

            // Safety timeout: If connection doesn't open in 10s, fail.
            const timeout = setTimeout(() => {
                if (!conn.open) {
                    this.error('CLIENT', 'Connection timed out (10s)');
                    conn.close();
                    reject(new Error("Connection timed out - Host unreachable"));
                }
            }, 10000);

            this.setupClientConnection(conn, (data) => {
                clearTimeout(timeout);
                resolve(data);
            });
        });
    }

    private setupClientConnection(conn: DataConnection, onReady?: (data: any) => void) {
        this.hostConn = conn;
        
        conn.on('open', () => {
            this.log('CLIENT', 'Data Channel OPEN. Performing Handshake...');
            this.lastHostPing = Date.now();
            
            // 1. Request State immediately
            conn.send({ type: 'REQUEST_SYNC' });
            
            // 2. Identify self
            if (this.currentUser) {
                conn.send({ type: 'JOIN', payload: { userId: this.currentUser.id, name: this.currentUser.name } });
            }
        });

        conn.on('data', (data: any) => {
            this.lastHostPing = Date.now(); // Update heartbeat on ANY data received
            
            const action = data as Action;
            
            if (action.type === 'SYNC') {
                if (!this.currentRoom) {
                    this.log('CLIENT', 'Initial SYNC received');
                }
                this.currentRoom = action.payload;
                if (this.currentRoom.status === 'COMPLETED') this.archiveRoom(this.currentRoom);
                this.notifySubscribers();
                
                // Resolve the Join Promise if this is the first sync
                if (onReady) {
                    onReady({ room: this.currentRoom, user: this.currentUser! });
                    onReady = undefined; 
                }
            } else if (action.type === 'PING') {
                // Heartbeat - handled by lastHostPing update above
                // Optionally log pings at debug level if needed, but creates noise
            } else {
                this.handleAction(action);
            }
        });

        conn.on('close', () => {
            this.warn('CLIENT', 'Connection to Host CLOSED');
            this.hostConn = null;
        });

        conn.on('error', (err) => {
            this.error('CLIENT', 'Connection Error', err);
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
        
        let room: Room = JSON.parse(JSON.stringify(this.currentRoom));
        let logs = [...room.gameState.logs];

        switch (action.type) {
            case 'JOIN':
                this.log('HOST', `User Joined: ${action.payload.name}`);
                if (!room.members.find(m => m.userId === action.payload.userId)) {
                    room.members.push({ ...action.payload, isAdmin: false });
                    this.broadcast({ type: 'SYNC', payload: room }); // Inform everyone of new user
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
                this.log('HOST', 'Starting Game');
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
                    this.log('HOST', `Bid accepted: ${amount}L from ${team.name}`);
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
            this.warn('CLIENT', "Cannot dispatch, no connection");
        }
    }

    private broadcast(action: Action) {
        // Clean up closed connections before sending
        const initialCount = this.connections.length;
        this.connections = this.connections.filter(c => c.open);
        if (this.connections.length < initialCount) {
            this.log('HOST', `Pruned ${initialCount - this.connections.length} closed connections`);
        }

        this.connections.forEach(conn => {
            try { 
                conn.send(action); 
            } catch (e) { 
                this.error('HOST', `Broadcast failed to ${conn.peer}`, e); 
            }
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

    // --- Connectivity Monitoring ---

    private startMonitor(roomId: string, user: UserProfile) {
        this.stopMonitor();
        // Check health every 2 seconds
        this.monitorIntervalId = setInterval(() => {
            if (this.isHost) return;
            
            const timeDiff = Date.now() - this.lastHostPing;
            
            // If connected but no ping for 10 seconds, assume dead
            if (timeDiff > 10000 && !this.isReconnecting) {
                this.warn('MONITOR', `Connection lost (Last ping ${timeDiff}ms ago). Triggering Reconnect.`);
                this.handleReconnect(roomId, user);
            }
        }, 2000);
    }

    private stopMonitor() {
        if (this.monitorIntervalId) clearInterval(this.monitorIntervalId);
    }

    private async handleReconnect(roomId: string, user: UserProfile) {
        if (this.isReconnecting) return;
        this.isReconnecting = true;

        this.log('RECONNECT', 'Attempting to restore connection...');
        
        // Cleanup existing connection object
        if (this.hostConn) {
             try { this.hostConn.close(); } catch(e){}
             this.hostConn = null;
        }

        try {
            // Re-use peer instance if it's still alive, otherwise we need a full re-join
            if (!this.peer || this.peer.destroyed || this.peer.disconnected) {
                this.log('RECONNECT', 'Peer destroyed/disconnected. Recreating Peer...');
                // We cannot easily recreate Peer with same ID if the server thinks it's taken.
                // Best strategy: Destroy old, create new, connect to Host.
                if (this.peer) this.peer.destroy();
                this.peer = new Peer(PEER_CONFIG);
                await new Promise<void>(resolve => this.peer!.on('open', () => resolve()));
            }

            const conn = this.peer!.connect(`${APP_PREFIX}${roomId}`, { 
                reliable: true, 
                serialization: 'json' 
            });
            
            if (conn) {
                this.setupClientConnection(conn);
                // Wait for Open event in setupClientConnection
            }
        } catch (e) {
            this.error('RECONNECT', 'Reconnection failed', e);
        } finally {
            // Reset flag after a delay to allow another attempt if this one fails
            setTimeout(() => { this.isReconnecting = false; }, 5000);
        }
    }

    // --- Persistence ---

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