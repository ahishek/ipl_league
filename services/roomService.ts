
import Peer, { DataConnection } from 'peerjs';
import { Room, Team, Player, AuctionConfig, GameState, UserState, Action, LogEntry } from '../types';
import { INITIAL_CONFIG, MOCK_PLAYERS } from '../constants';

const APP_PREFIX = 'ipl-auction-v2-';
const HISTORY_KEY = 'ipl_auction_history';

// Helper to generate a short 6-char code
const generateCode = () => {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
};

class RoomService {
    peer: Peer | null = null;
    connections: DataConnection[] = [];
    hostConn: DataConnection | null = null;
    
    // The "True" state of the room
    currentRoom: Room | null = null;
    currentUser: UserState | null = null;
    isHost: boolean = false;
    
    stateSubscribers: ((room: Room) => void)[] = [];

    constructor() {
        // Cleanup on close
        if (typeof window !== 'undefined') {
            window.addEventListener('beforeunload', () => {
                this.peer?.destroy();
            });
        }
    }

    // --- Init Methods ---

    async createRoom(hostName: string, roomName: string): Promise<{ room: Room, user: UserState }> {
        const roomId = generateCode();
        const userId = `host_${Date.now()}`;
        this.isHost = true;
        
        // Initial State
        this.currentRoom = {
            id: roomId,
            hostId: userId,
            name: roomName,
            createdAt: Date.now(),
            status: 'LOBBY',
            config: { ...INITIAL_CONFIG },
            teams: [],
            players: [...MOCK_PLAYERS],
            gameState: {
                currentPot: 'A',
                currentPlayerId: null,
                currentBid: null,
                timer: INITIAL_CONFIG.bidTimerSeconds,
                logs: [],
                aiCommentary: "",
                isPaused: true
            },
            members: [{ userId, name: hostName, isAdmin: true }]
        };
        this.currentUser = { id: userId, name: hostName, isAdmin: true };

        // Save to History
        this.saveHistory(roomId, roomName, 'HOST');

        // Init Peer
        return new Promise((resolve, reject) => {
            if (this.peer) this.peer.destroy();
            this.peer = new Peer(`${APP_PREFIX}${roomId}`, { debug: 1 });
            
            this.peer.on('open', (id) => {
                console.log('Host Peer Open:', id);
                resolve({ room: this.currentRoom!, user: this.currentUser! });
            });

            this.peer.on('connection', (conn) => {
                this.handleConnection(conn);
            });

            this.peer.on('error', (err) => {
                console.error('Peer Error:', err);
                if (err.type === 'unavailable-id') {
                    alert("Room Code Collision! Please try again."); 
                }
                reject(err);
            });
        });
    }

    async joinRoom(roomId: string, userName: string): Promise<{ room: Room | null, user: UserState }> {
        this.isHost = false;
        const userId = `user_${Date.now()}`;
        this.currentUser = { id: userId, name: userName, isAdmin: false };
        this.currentRoom = null; 

        // Retry logic wrapper
        let attempts = 0;
        const maxAttempts = 3;

        const tryConnect = async (): Promise<{ room: Room | null, user: UserState }> => {
            return new Promise((resolve, reject) => {
                if (this.peer) this.peer.destroy();
                console.log(`[JoinRoom] Initializing Peer for attempt ${attempts + 1}`);
                this.peer = new Peer(); 
                
                let connected = false;

                this.peer.on('open', () => {
                    const targetId = `${APP_PREFIX}${roomId}`;
                    console.log(`[JoinRoom] Peer Open. Connecting to Host: ${targetId}`);
                    const conn = this.peer!.connect(targetId);
                    
                    conn.on('open', () => {
                        console.log(`[JoinRoom] Connection Established`);
                        connected = true;
                        this.hostConn = conn;
                        
                        // Send Join Request
                        this.dispatch({ type: 'JOIN', payload: { userId, name: userName } });

                        // Wait for first Sync
                        conn.on('data', (data: any) => {
                            const action = data as Action;
                            if (action.type === 'SYNC') {
                                this.currentRoom = action.payload;
                                this.notifySubscribers();
                                this.saveHistory(roomId, action.payload.name, 'PLAYER');
                                resolve({ room: this.currentRoom, user: this.currentUser! });
                            } else {
                                this.handleAction(action);
                            }
                        });
                        
                        conn.on('close', () => {
                            alert("Disconnected from Host. The auction room has been closed.");
                            window.location.reload();
                        });
                    });

                    conn.on('error', (err) => {
                        console.error("[JoinRoom] Conn Error", err);
                        if (!connected) reject(err);
                    });

                    // Specific timeout for this attempt
                    setTimeout(() => {
                        if (!connected) {
                            // Close this peer instance to cleanup
                            if (conn) conn.close();
                            reject(new Error("Connection timed out waiting for host response"));
                        }
                    }, 5000); 
                });

                this.peer.on('error', (err) => {
                     reject(err);
                });
            });
        };

        // Execution loop
        while (attempts < maxAttempts) {
            try {
                return await tryConnect();
            } catch (err: any) {
                console.warn(`Connection attempt ${attempts + 1} failed:`, err);
                attempts++;
                if (attempts >= maxAttempts) {
                     let msg = "Host not found. Is the host online and on the auction page?";
                     if (err?.type === 'peer-unavailable') msg = "Invalid Room Code or Room Closed.";
                     throw new Error(msg);
                }
                // Wait 1s before retry
                await new Promise(r => setTimeout(r, 1000));
            }
        }
        throw new Error("Failed to connect after multiple attempts");
    }

    // --- Core Logic ---

    private handleConnection(conn: DataConnection) {
        this.connections.push(conn);
        
        conn.on('data', (data: any) => {
             this.handleAction(data as Action);
        });

        conn.on('close', () => {
             this.connections = this.connections.filter(c => c !== conn);
        });

        // Send current state immediately
        if (this.currentRoom) {
            conn.send({ type: 'SYNC', payload: this.currentRoom });
        }
    }

    // Central Action Handler (Redux-like reducer)
    private handleAction(action: Action) {
        if (!this.isHost) {
            // Guest receiving data: Just sync the whole room
            if (action.type === 'SYNC') {
                this.currentRoom = action.payload;
                this.notifySubscribers();
            }
            return;
        }

        // --- HOST LOGIC ---
        if (!this.currentRoom) return;

        // CRITICAL FIX: Deep Clone to prevent mutation bugs and ensure React detects changes
        // Using JSON parse/stringify is the safest way to ensure no reference sharing for nested arrays like 'teams'
        let room: Room = JSON.parse(JSON.stringify(this.currentRoom));
        let logs = [...room.gameState.logs];
        let shouldBroadcast = true;

        switch (action.type) {
            case 'JOIN':
                if (!room.members.find(m => m.userId === action.payload.userId)) {
                    room.members.push({ ...action.payload, isAdmin: false });
                }
                break;

            case 'ADD_TEAM':
                room.teams.push(action.payload);
                break;
            
            case 'UPDATE_CONFIG':
                room.config = { ...room.config, ...action.payload };
                break;
                
            case 'UPDATE_TEAM':
                room.teams = room.teams.map(t => t.id === action.payload.teamId ? { ...t, ...action.payload.updates } : t);
                break;

            case 'REMOVE_TEAM':
                room.teams = room.teams.filter(t => t.id !== action.payload.teamId);
                break;
            
            case 'IMPORT_PLAYERS':
                room.players = action.payload;
                break;

            case 'START_GAME':
                room.status = 'ACTIVE';
                room.gameState.isPaused = false;
                break;

            case 'END_GAME':
                room.status = 'COMPLETED';
                room.gameState.isPaused = true;
                logs.unshift({ id: Date.now().toString(), message: "Auction Ended", type: 'SYSTEM', timestamp: new Date() });
                break;

            case 'BID':
                // Validate Bid again on host
                const { teamId, amount } = action.payload;
                const team = room.teams.find(t => t.id === teamId);
                const currentBidAmount = room.gameState.currentBid?.amount || 0;

                if (team && amount > currentBidAmount) {
                    room.gameState.currentBid = { teamId, amount, timestamp: Date.now() };
                    room.gameState.timer = room.config.bidTimerSeconds; // Reset Timer
                    
                    logs.unshift({ 
                        id: Date.now().toString(), 
                        message: `${team.name} bids ${amount} L`, 
                        type: 'BID', 
                        timestamp: new Date() 
                    });
                }
                break;

            case 'SOLD':
                 // Ensure we are reading from the CLONED room object
                 if (room.gameState.currentPlayerId && room.gameState.currentBid) {
                     const pid = room.gameState.currentPlayerId;
                     const winningTeamId = room.gameState.currentBid.teamId;
                     const soldPrice = room.gameState.currentBid.amount;

                     const pIndex = room.players.findIndex(x => x.id === pid);
                     const tIndex = room.teams.findIndex(t => t.id === winningTeamId);
                     
                     if (pIndex !== -1 && tIndex !== -1) {
                         const p = room.players[pIndex];
                         const t = room.teams[tIndex];

                         // Update Player
                         const soldP = { 
                             ...p, 
                             status: 'SOLD' as const, 
                             soldPrice: soldPrice, 
                             soldToTeamId: t.id 
                         };
                         room.players[pIndex] = soldP;

                         // Update Team (Budget and Roster)
                         const updatedTeam = {
                             ...t,
                             budget: t.budget - soldPrice,
                             roster: [...t.roster, soldP]
                         };
                         room.teams[tIndex] = updatedTeam;
                         
                         logs.unshift({ id: Date.now().toString(), message: action.payload.commentary || "Sold!", type: 'AI', timestamp: new Date() });
                         logs.unshift({ id: (Date.now()+1).toString(), message: `SOLD: ${p.name} to ${t.name}`, type: 'SOLD', timestamp: new Date() });
                         
                         room.gameState.isPaused = true;
                     }
                 }
                 break;

            case 'UNSOLD':
                 if (room.gameState.currentPlayerId) {
                     const pid = room.gameState.currentPlayerId;
                     const pIndex = room.players.findIndex(x => x.id === pid);
                     if (pIndex !== -1) {
                         room.players[pIndex] = { ...room.players[pIndex], status: 'UNSOLD' };
                         logs.unshift({ id: Date.now().toString(), message: action.payload.commentary || "Unsold", type: 'AI', timestamp: new Date() });
                         logs.unshift({ id: (Date.now()+1).toString(), message: `UNSOLD: ${room.players[pIndex].name}`, type: 'UNSOLD', timestamp: new Date() });
                         room.gameState.isPaused = true;
                     }
                 }
                 break;

            case 'NEXT_PLAYER':
                // Compat
                break;
            
            case 'UPDATE_TIMER':
                room.gameState.timer = action.payload.timer;
                // Don't clutter logs with timer updates
                break;

            case 'TOGGLE_PAUSE':
                room.gameState.isPaused = !room.gameState.isPaused;
                logs.unshift({ id: Date.now().toString(), message: room.gameState.isPaused ? "Paused" : "Resumed", type: 'SYSTEM', timestamp: new Date() });
                break;
        }

        // Keep logs capped at 50 to prevent memory bloom
        if (logs.length > 50) logs = logs.slice(0, 50);

        room.gameState.logs = logs;
        this.currentRoom = room;
        
        if (shouldBroadcast) {
            this.broadcast({ type: 'SYNC', payload: room });
            this.notifySubscribers();
        }
    }

    // --- Public API for Components ---

    dispatch(action: Action) {
        if (this.isHost) {
            this.handleAction(action);
        } else {
            if (this.hostConn && this.hostConn.open) {
                this.hostConn.send(action);
            } else {
                console.warn("Cannot dispatch, not connected to host");
            }
        }
    }

    broadcastSync(room: Room) {
        if (!this.isHost) return;
        this.currentRoom = room;
        this.broadcast({ type: 'SYNC', payload: room });
        this.notifySubscribers(); 
    }

    private broadcast(action: Action) {
        this.connections.forEach(conn => {
            if (conn.open) conn.send(action);
        });
    }

    subscribe(callback: (room: Room) => void) {
        this.stateSubscribers.push(callback);
        if (this.currentRoom) callback(this.currentRoom);
        return () => {
            this.stateSubscribers = this.stateSubscribers.filter(cb => cb !== callback);
        };
    }

    // --- Helpers ---

    private notifySubscribers() {
        if (this.currentRoom) {
            this.stateSubscribers.forEach(cb => cb(this.currentRoom!));
        }
    }

    private saveHistory(id: string, name: string, role: string) {
        try {
            const history = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
            if (!history.find((h: any) => h.id === id)) {
                history.push({ id, name, createdAt: Date.now(), role });
                localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
            }
        } catch(e) { console.error("History save failed", e); }
    }
    
    getHistory() {
        try {
            return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
        } catch (e) { return []; }
    }
}

export const roomService = new RoomService();
