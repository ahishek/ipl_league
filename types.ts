
export type Position = 'Batter' | 'Bowler' | 'All Rounder' | 'Wicket Keeper';
export type Pot = 'A' | 'B' | 'C' | 'D' | 'Uncategorized';
export type PlayerStatus = 'PENDING' | 'ON_AUCTION' | 'SOLD' | 'UNSOLD';

export interface Player {
  id: string;
  name: string;
  position: Position;
  pot: Pot;
  basePrice: number;
  soldPrice?: number;
  soldToTeamId?: string;
  status: PlayerStatus;
  country?: string;
  stats?: string;
  imageUrl?: string;
  iplTeam?: string;
}

export interface Team {
  id: string;
  name: string;
  ownerName: string;
  budget: number;
  roster: Player[];
  color: string;
  // Metadata for the user controlling this team
  controlledByUserId?: string; 
  avatarUrl?: string; 
}

export interface AuctionConfig {
  totalBudget: number;
  maxPlayers: number;
  bidTimerSeconds: number;
  minBidIncrement: number;
}

export interface Bid {
  teamId: string;
  amount: number;
  timestamp: number;
}

export interface LogEntry {
  id: string;
  message: string;
  type: 'BID' | 'SOLD' | 'UNSOLD' | 'SYSTEM' | 'AI';
  timestamp: Date;
}

// --- Multiplayer Types ---

export interface UserState {
  id: string;
  name: string;
  isAdmin: boolean;
  teamId?: string;
}

export interface GameState {
  currentPot: Pot;
  currentPlayerId: string | null;
  currentBid: Bid | null;
  timer: number;
  logs: LogEntry[];
  aiCommentary: string;
  isPaused: boolean;
}

export interface Room {
  id: string; // The join code (also Peer ID suffix)
  hostId: string;
  name: string;
  createdAt: number;
  status: 'LOBBY' | 'ACTIVE' | 'COMPLETED';
  config: AuctionConfig;
  teams: Team[];
  players: Player[];
  gameState: GameState;
  members: { userId: string; name: string; isAdmin: boolean }[]; // Who is in the room
}

// --- P2P Actions ---
export type Action = 
  | { type: 'SYNC'; payload: Room }
  | { type: 'JOIN'; payload: { userId: string; name: string } }
  | { type: 'ADD_TEAM'; payload: Team }
  | { type: 'UPDATE_CONFIG'; payload: Partial<AuctionConfig> }
  | { type: 'UPDATE_TEAM'; payload: { teamId: string; updates: Partial<Team> } }
  | { type: 'REMOVE_TEAM'; payload: { teamId: string } }
  | { type: 'START_GAME'; payload: {} }
  | { type: 'END_GAME'; payload: {} }
  | { type: 'BID'; payload: { teamId: string; amount: number } }
  | { type: 'SOLD'; payload: { commentary?: string } } // Host decides sold
  | { type: 'UNSOLD'; payload: { commentary?: string } } // Host decides unsold
  | { type: 'NEXT_PLAYER'; payload: {} }
  | { type: 'TOGGLE_PAUSE'; payload: {} }
  | { type: 'UPDATE_TIMER'; payload: { timer: number } } // Frequent updates
  | { type: 'IMPORT_PLAYERS'; payload: Player[] };
