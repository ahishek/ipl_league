
import Peer, { DataConnection } from 'peerjs';
import { Room, Team, Player, AuctionConfig, GameState, UserState, Action, LogEntry, Pot, UserProfile, AuctionArchive } from '../types';
import { INITIAL_CONFIG, MOCK_PLAYERS } from '../constants';

// Bump version to 'v17-stable' to force fresh IDs
const APP_PREFIX = 'ipl-auction-v17-stable-';
const HISTORY_KEY = 'ipl_auction_archive';
const USER_KEY = 'ipl_user_profile';
const ASSET_MARKER = '___HOST_ASSET___';

const generateCode = () => Math.random().toString(36).substring(2, 8).toUpperCase();

// --- DIAGNOSTIC HELPERS ---
const getByteSize = (obj: any) => {
    try {
        return new Blob([JSON.stringify(obj)]).size;
    } catch (e) {
        return 0;
    }
};

const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

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

// --- UPDATED NETWORK CONFIG ---
// Targeting Ports 443/80/53 to bypass UAE/Strict Firewalls
const PEER_CONFIG = {
    debug: 2, 
    pingInterval: 5000, 
    config: {
        iceServers: [
            // Standard Google
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            { urls: 'stun:stun3.l.google.com:19302' },
            { urls: 'stun:stun4.l.google.com:19302' },      
            // Port 443 (HTTPS) - Critical for Firewalls
            { urls: 'stun:stun.nextcloud.com:443' },
            { urls: 'stun:stun.piratenbrandenburg.de:443' },
            // Port 80 (HTTP)
            { urls: 'stun:stun.vodafone.ro:80' },
            // Standard Fallbacks
            { urls: 'stun:global.stun.twilio.com:3478' },
            { urls: 'stun:stun.services.mozilla.com' }
        ],
        sdpSemantics: 'unified-plan',
        iceCandidatePoolSize: 10
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
    
    clientLogoCache: Map<string, string> = new Map();

    pingIntervalId: any = null;
    monitorIntervalId: any = null;
    signalingKeepAliveId: any = null; 
    lastHostPing: number = 0;
    
    activeRoomId: string | null = null;
    isReconnecting: boolean = false;

    constructor() {
        if (typeof window !== 'undefined') {
            window.addEventListener('beforeunload', () => {
                this.cleanup();
            });
        }
    }

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

    // --- DIAGNOSTICS: Deep Connection Monitoring ---
    private attachIceMonitor(conn: DataConnection, role: 'HOST' | 'CLIENT') {
        // Access raw RTCPeerConnection (hidden in PeerJS types usually)
        const pc = (conn as any).peerConnection;
        
        if (!pc) {
            this.warn(`${role}_DIAG`, 'No PeerConnection found attached to DataConnection.');
            return;
        }

        let candidatesGathered = 0;

        // Monitor ICE Candidate Gathering
        // This tells us if STUN/TURN servers are actually reachable
        pc.addEventListener('icecandidate', (event: any) => {
            if (event.candidate) {
                candidatesGathered++;
                this.log(`${role}_ICE`, `Candidate gathered: ${event.candidate.type} (${event.candidate.protocol})`);
            } else {
                this.log(`${role}_ICE`, `Gathering Complete. Total Candidates: ${candidatesGathered}`);
                if (candidatesGathered === 0) {
                    this.error(`${role}_ICE`, 'CRITICAL: No ICE candidates gathered. Firewall likely blocking STUN traffic.');
                }
            }
        });

        // Monitor Connection State Changes
        pc.addEventListener('iceconnectionstatechange', () => {
            this.log(`${role}_ICE`, `ICE State Change: ${pc.iceConnectionState}`);
            if (pc.iceConnectionState === 'failed') {
                 this.error(`${role}_ICE`, 'ICE Connection FAILED. Peer cannot be reached directly.');
            }
        });
    }

    // --- INSTRUMENTATION: Payload Analytics ---
    private analyzePayload(tag: string, payload: any) {
        const size = getByteSize(payload);
        const sizeStr = formatBytes(size);
        
        if (payload.teams) {
            const teamSizes = payload.teams.map((t: Team) => ({
                id: t.id,
                name: t.name,
                logoSize: t.logoUrl ? formatBytes(t.logoUrl.length) : '0 B',
                isAssetMarker: t.logoUrl === ASSET_MARKER
            }));
            this.log('RCA_PAYLOAD', `${tag} Total: ${sizeStr}`, { teamStats: teamSizes });
        } else {
            this.log('RCA_PAYLOAD', `${tag} Size: ${sizeStr}`);
        }
    }

    private cleanup() {
        this.log('SYSTEM', 'Cleaning up resources...');
        this.stopHeartbeat();
        this.stopMonitor();
        this.stopSignalingKeepAlive(); 
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

    private sanitizeRoomForSync(room: Room): Room {
        const originalSize = getByteSize(room);
        const safeRoom: Room = JSON.parse(JSON.stringify(room));
        
        let strippedCount = 0;
        safeRoom.teams = safeRoom.teams.map(t => {
            if (t.logoUrl && t.logoUrl.length > 500) { 
                strippedCount++;
                return { ...t, logoUrl: ASSET_MARKER };
            }
            return t;
        });

        safeRoom.players = safeRoom.players.map(p => {
             if (p.imageUrl && p.imageUrl.startsWith('data:') && p.imageUrl.length > 1000) {
                 return { ...p, imageUrl: undefined }; 
             }
             return p;
        });

        const newSize = getByteSize(safeRoom);
        this.log('RCA_SANITIZATION', `Reduced Room Size: ${formatBytes(originalSize)} -> ${formatBytes(newSize)}. Stripped ${strippedCount} Logos.`);
        return safeRoom;
    }

    private reconstructRoomFromCache(room: Room): { room: Room, missingAssets: string[] } {
        const missingAssets: string[] = [];
        const reconstructedRoom: Room = { ...room };
        
        reconstructedRoom.teams = reconstructedRoom.teams.map(t => {
            if (t.logoUrl === ASSET_MARKER) {
                const cached = this.clientLogoCache.get(t.id);
                if (cached) {
                    return { ...t, logoUrl: cached };
                } else {
                    missingAssets.push(t.id);
                    return { ...t, logoUrl: undefined };
                }
            }
            return t;
        });

        return { room: reconstructedRoom, missingAssets };
    }

    // --- Host Logic ---

    async createRoom(hostProfile: UserProfile, roomName: string): Promise<{ room: Room, user: UserState }> {
        this.cleanup();
        const roomId = generateCode();
        const userId = hostProfile.id;
        this.isHost = true;
        
        const fullHostId = `${APP_PREFIX}${roomId}`;
        this.log('HOST_DIAG', `Initializing Host. Calculated ID: ${fullHostId}`);
        
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
            try {
                this.peer = new Peer(fullHostId, PEER_CONFIG);
            } catch (e) {
                this.error('HOST', 'Failed to initialize PeerJS', e);
                reject(e);
                return;
            }
            
            this.peer.on('open', (id) => {
                this.log('HOST', `Peer Open. ID: ${id}`);
                this.startHeartbeat(); 
                this.startSignalingKeepAlive(); 
                resolve({ room: this.currentRoom!, user: this.currentUser! });
            });
            
            this.peer.on('connection', (conn) => this.handleHostConnection(conn));
            
            this.peer.on('error', (err) => {
                this.error('HOST', `Peer Error: ${err.type}`, err);
                if (err.type === 'unavailable-id') {
                    this.warn('HOST', 'ID Taken, retrying...');
                    this.createRoom(hostProfile, roomName).then(resolve).catch(reject);
                } else {
                    reject(err);
                }
            });

            this.peer.on('disconnected', () => {
                this.warn('HOST', 'Disconnected from signaling server.');
                this.peer?.reconnect();
            });
        });
    }

    private handleHostConnection(conn: DataConnection) {
        this.log('HOST', `Incoming connection from ${conn.peer}`);
        this.attachIceMonitor(conn, 'HOST'); // Attach monitoring immediately
        
        conn.on('open', () => {
            this.log('RCA_CONN', `Host Connected to ${conn.peer}. Serialization Mode: [${conn.serialization}]`);
            this.connections.push(conn);
        });

        conn.on('data', (data: any) => {
            const action = data as Action;

            if (action.type === 'REQUEST_SYNC') {
                this.log('HOST', `Received REQUEST_SYNC from ${conn.peer}`);
                if (this.currentRoom) {
                    const safePayload = this.sanitizeRoomForSync(this.currentRoom);
                    this.analyzePayload(`Sending SYNC to ${conn.peer}`, safePayload);
                    conn.send({ type: 'SYNC', payload: safePayload });
                }
                return;
            }

            if (action.type === 'GET_LOGO') {
                const team = this.currentRoom?.teams.find(t => t.id === action.payload.teamId);
                if (team && team.logoUrl && team.logoUrl !== ASSET_MARKER) {
                    this.log('HOST', `Sending LOGO asset for ${team.name} (${formatBytes(team.logoUrl.length)})`);
                    conn.send({ 
                        type: 'LOGO_RESPONSE', 
                        payload: { teamId: team.id, logoUrl: team.logoUrl } 
                    });
                }
                return;
            }

            this.handleAction(action);
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

    // Enhanced Join Logic with Retry Mechanism
    async joinRoom(roomId: string, userProfile: UserProfile): Promise<{ room: Room | null, user: UserState }> {
        this.isHost = false;
        const userId = userProfile.id;
        this.currentUser = { id: userId, name: userProfile.name, isAdmin: false };
        this.currentRoom = null; 
        this.activeRoomId = roomId.trim().toUpperCase();
        
        const targetHostId = `${APP_PREFIX}${this.activeRoomId}`;
        this.log('CLIENT_DIAG', `Initializing Client. Target Host ID: ${targetHostId}`);

        const tryConnect = async (attempt: number): Promise<{ room: Room | null, user: UserState }> => {
            if (this.peer) this.peer.destroy();
            this.peer = new Peer(PEER_CONFIG);

            return new Promise((resolve, reject) => {
                let connectionTimeout: any;

                const failAndRetry = async (err: any) => {
                    clearTimeout(connectionTimeout);
                    if (attempt < 3 && (err.type === 'peer-unavailable' || err.message?.includes('Could not connect'))) {
                        this.warn('CLIENT', `Join attempt ${attempt} failed: ${err.type}. Retrying in 2s...`);
                        await new Promise(r => setTimeout(r, 2000));
                        resolve(tryConnect(attempt + 1));
                    } else {
                        reject(err);
                    }
                };

                this.peer!.on('open', (id) => {
                    this.log('CLIENT', `Peer Open. Attempt ${attempt}. Connecting to Host...`);
                    this.connectToHost(this.activeRoomId!, userProfile)
                        .then((data) => {
                            clearTimeout(connectionTimeout);
                            this.startMonitor(this.activeRoomId!, userProfile);
                            resolve(data);
                        })
                        .catch(failAndRetry);
                });

                this.peer!.on('error', (err) => {
                    this.error('CLIENT', `Peer Error: ${err.type}`, err);
                    failAndRetry(err);
                });

                // Safety timeout for the entire handshake
                connectionTimeout = setTimeout(() => {
                    failAndRetry({ type: 'timeout', message: 'Handshake timeout' });
                }, 15000);
            });
        };

        return tryConnect(1);
    }

    private connectToHost(roomId: string, user: UserProfile): Promise<{ room: Room | null, user: UserState }> {
        return new Promise((resolve, reject) => {
            if (!this.peer || this.peer.destroyed) {
                reject(new Error("Peer destroyed"));
                return;
            }

            const hostPeerId = `${APP_PREFIX}${roomId}`;
            this.log('CLIENT_DIAG', `Connecting to Host Peer ID: ${hostPeerId}`);
            
            // EXPLICITLY SETTING SERIALIZATION TO BINARY
            const conn = this.peer.connect(hostPeerId, {
                reliable: true,
                serialization: 'binary' 
            });

            if (!conn) {
                reject(new Error("Failed to create connection object"));
                return;
            }
            
            this.attachIceMonitor(conn, 'CLIENT');

            const timeout = setTimeout(() => {
                if (!conn.open) {
                    conn.close();
                    reject(new Error("Connection timed out - Host unreachable"));
                }
            }, 8000);

            let retryCount = 0;
            const retryInterval = setInterval(() => {
                if (conn.open && !this.currentRoom && retryCount < 5) {
                    this.log('CLIENT', `Retrying REQUEST_SYNC (${retryCount + 1}/5)...`);
                    conn.send({ type: 'REQUEST_SYNC' });
                    retryCount++;
                } else if (this.currentRoom || retryCount >= 5) {
                    clearInterval(retryInterval);
                }
            }, 2000);

            this.setupClientConnection(conn, (data) => {
                clearTimeout(timeout);
                clearInterval(retryInterval);
                resolve(data);
            });
        });
    }

    private setupClientConnection(conn: DataConnection, onReady?: (data: any) => void) {
        this.hostConn = conn;
        
        conn.on('open', () => {
            this.log('RCA_CONN', `Client connected to Host. Serialization Mode: [${conn.serialization}]`);
            this.lastHostPing = Date.now();
            conn.send({ type: 'REQUEST_SYNC' });
            
            if (this.currentUser) {
                conn.send({ type: 'JOIN', payload: { userId: this.currentUser.id, name: this.currentUser.name } });
            }
        });

        conn.on('data', (data: any) => {
            this.lastHostPing = Date.now();
            const action = data as Action;
            
            if (action.type === 'SYNC') {
                if (!this.currentRoom) {
                    this.analyzePayload('Received Initial SYNC', action.payload);
                }
                
                const { room, missingAssets } = this.reconstructRoomFromCache(action.payload);
                this.currentRoom = room;

                if (missingAssets.length > 0) {
                    this.log('CLIENT', `Detected ${missingAssets.length} missing logos. Fetching individually...`);
                    missingAssets.forEach(teamId => {
                        conn.send({ type: 'GET_LOGO', payload: { teamId } });
                    });
                }

                if (this.currentRoom.status === 'COMPLETED') this.archiveRoom(this.currentRoom);
                this.notifySubscribers();
                
                if (onReady) {
                    onReady({ room: this.currentRoom, user: this.currentUser! });
                    onReady = undefined; 
                }
            } else if (action.type === 'LOGO_RESPONSE') {
                this.log('CLIENT', `Received Logo Asset for ${action.payload.teamId} (${formatBytes(action.payload.logoUrl.length)})`);
                this.clientLogoCache.set(action.payload.teamId, action.payload.logoUrl);
                
                if (this.currentRoom) {
                    const { room } = this.reconstructRoomFromCache(this.currentRoom);
                    this.currentRoom = room;
                    this.notifySubscribers();
                }
            } else if (action.type === 'PING') {
                // Heartbeat
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

    private handleAction(action: Action) {
        if (action.type === 'PING' || action.type === 'GET_LOGO' || action.type === 'LOGO_RESPONSE') return;

        if (!this.isHost) {
            if (action.type === 'SYNC') {
                const { room } = this.reconstructRoomFromCache(action.payload);
                this.currentRoom = room;
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
                    this.broadcast({ type: 'SYNC', payload: room });
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
                if (team && amount > currentAmt && team.budget >= amount) {
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
        
        this.broadcast({ type: 'SYNC', payload: room });
        this.notifySubscribers();
    }

    dispatch(action: Action) {
        if (this.isHost) {
            this.handleAction(action);
        } else if (this.hostConn && this.hostConn.open) {
            this.hostConn.send(action);
        }
    }

    private broadcast(action: Action) {
        this.connections = this.connections.filter(c => c.open);
        this.connections.forEach(conn => {
            try { 
                if (action.type === 'SYNC') {
                    const safePayload = this.sanitizeRoomForSync(action.payload);
                    conn.send({ ...action, payload: safePayload });
                } else {
                    conn.send(action); 
                }
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

    private startMonitor(roomId: string, user: UserProfile) {
        this.stopMonitor();
        this.monitorIntervalId = setInterval(() => {
            if (this.isHost) return;
            const timeDiff = Date.now() - this.lastHostPing;
            if (timeDiff > 10000 && !this.isReconnecting) {
                this.warn('MONITOR', `Connection lost. Triggering Reconnect.`);
                this.handleReconnect(roomId, user);
            }
        }, 2000);
    }

    private stopMonitor() {
        if (this.monitorIntervalId) clearInterval(this.monitorIntervalId);
    }

    private startSignalingKeepAlive() {
        this.stopSignalingKeepAlive();
        this.log('HOST', 'Starting Signaling Keep-Alive Monitor');
        this.signalingKeepAliveId = setInterval(() => {
            if (this.peer && !this.peer.destroyed) {
                // DEEP SOCKET INSPECTION
                const internalSocket = (this.peer as any).socket;
                const wsState = internalSocket?._socket?.readyState; // 1 = OPEN

                if (this.peer.disconnected || (wsState !== undefined && wsState !== 1)) {
                    this.warn('SYSTEM', `Host disconnected from signaling (WS State: ${wsState}). Forcing Reconnect...`);
                    this.peer.reconnect();
                }
            }
        }, 3000); // Check more frequently (3s)
    }

    private stopSignalingKeepAlive() {
        if (this.signalingKeepAliveId) clearInterval(this.signalingKeepAliveId);
    }

    private async handleReconnect(roomId: string, user: UserProfile) {
        if (this.isReconnecting) return;
        this.isReconnecting = true;

        if (this.hostConn) {
             try { this.hostConn.close(); } catch(e){}
             this.hostConn = null;
        }

        try {
            if (!this.peer || this.peer.destroyed || this.peer.disconnected) {
                if (this.peer) this.peer.destroy();
                this.peer = new Peer(PEER_CONFIG);
                await new Promise<void>(resolve => this.peer!.on('open', () => resolve()));
            }

            const conn = this.peer!.connect(`${APP_PREFIX}${roomId}`, { 
                reliable: true,
                serialization: 'binary' 
            });
            
            if (conn) {
                this.setupClientConnection(conn);
            }
        } catch (e) {
            this.error('RECONNECT', 'Reconnection failed', e);
        } finally {
            setTimeout(() => { this.isReconnecting = false; }, 5000);
        }
    }

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
