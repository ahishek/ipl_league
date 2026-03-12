export type Position = 'Batter' | 'Bowler' | 'All Rounder' | 'Wicket Keeper';
export type Pot = 'A' | 'B' | 'C' | 'D' | 'Uncategorized';
export type PlayerStatus = 'PENDING' | 'ON_AUCTION' | 'SOLD' | 'UNSOLD';

export interface PlayerStats {
  matches: number;
  runs: number;
  batAvg: number;
  batStrikeRate: number;
  wickets: number;
  bowlStrikeRate: number;
  economy: number;
  bowlAvg: number;
  historicalAuctionPrice: number;
}

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
  imageUrl?: string;
  iplTeam?: string;
  stats?: PlayerStats;
  sourceUrl?: string;
}

export interface Team {
  id: string;
  name: string;
  ownerName: string;
  budget: number;
  roster: Player[];
  color: string;
  logoAssetId?: string;
  logoUrl?: string;
  controlledByUserId?: string;
  avatarUrl?: string;
}

export interface MemberState {
  userId: string;
  name: string;
  isAdmin: boolean;
  joinedAt: number;
  connected: boolean;
}

export interface UserProfile {
  id: string;
  name: string;
  createdAt: number;
  avatarSeed: string;
}

export interface AuctionArchive {
  roomId: string;
  roomName: string;
  completedAt: number;
  hostId: string;
  memberIds: string[];
  teams: Team[];
  players: Player[];
  config: AuctionConfig;
  logs?: LogEntry[];
}

export interface RoleRequirements {
  Batter: number;
  Bowler: number;
  'All Rounder': number;
  'Wicket Keeper': number;
}

export interface AuctionConfig {
  totalBudget: number;
  maxPlayers: number;
  bidTimerSeconds: number;
  minBidIncrement: number;
  scheduledStartTime?: number;
  roleMinimums: RoleRequirements;
}

export interface Bid {
  teamId: string;
  amount: number;
  timestamp: number;
}

export interface LogEntry {
  id: string;
  message: string;
  type: 'BID' | 'SOLD' | 'UNSOLD' | 'SYSTEM' | 'AI' | 'WARNING';
  timestamp: number;
}

export interface UserState {
  id: string;
  name: string;
  isAdmin: boolean;
  teamId?: string;
  roomId?: string;
}

export interface GameState {
  currentPot: Pot;
  currentPlayerId: string | null;
  currentBid: Bid | null;
  timer: number;
  logs: LogEntry[];
  aiCommentary: string;
  isPaused: boolean;
  lastHostAction: string | null;
}

export interface Room {
  id: string;
  revision: number;
  hostId: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  status: 'LOBBY' | 'ACTIVE' | 'COMPLETED';
  config: AuctionConfig;
  teams: Team[];
  players: Player[];
  gameState: GameState;
  members: MemberState[];
}

export type RoomCommand =
  | { type: 'ADD_TEAM'; payload: { team: Team; logoDataUrl?: string } }
  | { type: 'UPDATE_CONFIG'; payload: Partial<AuctionConfig> }
  | { type: 'UPDATE_TEAM'; payload: { teamId: string; updates: Partial<Team>; logoDataUrl?: string } }
  | { type: 'REMOVE_TEAM'; payload: { teamId: string } }
  | { type: 'START_GAME'; payload: {} }
  | { type: 'END_GAME'; payload: {} }
  | { type: 'BID'; payload: { teamId: string; amount: number } }
  | { type: 'SOLD'; payload: {} }
  | { type: 'UNSOLD'; payload: {} }
  | { type: 'UNDO_LAST_ACTION'; payload: {} }
  | { type: 'NEXT_PLAYER'; payload: {} }
  | { type: 'TOGGLE_PAUSE'; payload: {} }
  | { type: 'IMPORT_PLAYERS'; payload: Player[] }
  | { type: 'ADD_LOG'; payload: { message: string; type: LogEntry['type'] } };

export type Action = RoomCommand;
