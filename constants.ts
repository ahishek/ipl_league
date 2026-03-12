
import { Player, Team, AuctionConfig } from './types';

export const INITIAL_CONFIG: AuctionConfig = {
  totalBudget: 1500,
  maxPlayers: 15,
  bidTimerSeconds: 30,
  minBidIncrement: 10,
  roleMinimums: {
    Batter: 4,
    Bowler: 4,
    'All Rounder': 2,
    'Wicket Keeper': 1,
  },
};

export const TEAM_COLORS = [
  '#2563eb', // blue-600
  '#eab308', // yellow-500
  '#dc2626', // red-600
  '#9333ea', // purple-600
  '#db2777', // pink-600
  '#f97316', // orange-500
  '#0d9488', // teal-600
  '#4f46e5', // indigo-600
  '#0891b2', // cyan-600
  '#e11d48'  // rose-600
];

export const MOCK_PLAYERS: Player[] = [
  { 
    id: '1', name: 'Virat Kohli', position: 'Batter', pot: 'A', basePrice: 200, status: 'PENDING', 
    country: 'IND', iplTeam: 'RCB',
    stats: { matches: 15, runs: 741, batAvg: 61.75, batStrikeRate: 154.7, wickets: 0, bowlStrikeRate: 0, economy: 0, bowlAvg: 0, historicalAuctionPrice: 2100 },
    imageUrl: 'https://documents.iplt20.com/ipl/IPLHeadshot2024/2.png'
  },
  { 
    id: '2', name: 'Rohit Sharma', position: 'Batter', pot: 'A', basePrice: 200, status: 'PENDING', 
    country: 'IND', iplTeam: 'MI',
    stats: { matches: 14, runs: 417, batAvg: 32.08, batStrikeRate: 150.0, wickets: 0, bowlStrikeRate: 0, economy: 0, bowlAvg: 0, historicalAuctionPrice: 1600 },
    imageUrl: 'https://documents.iplt20.com/ipl/IPLHeadshot2024/6.png'
  },
  { 
    id: '3', name: 'Jasprit Bumrah', position: 'Bowler', pot: 'A', basePrice: 200, status: 'PENDING', 
    country: 'IND', iplTeam: 'MI',
    stats: { matches: 13, runs: 0, batAvg: 0, batStrikeRate: 0, wickets: 20, bowlStrikeRate: 12.1, economy: 6.48, bowlAvg: 15.8, historicalAuctionPrice: 1200 },
    imageUrl: 'https://documents.iplt20.com/ipl/IPLHeadshot2024/9.png'
  },
  { 
    id: '4', name: 'Travis Head', position: 'Batter', pot: 'A', basePrice: 200, status: 'PENDING', 
    country: 'AUS', iplTeam: 'SRH',
    stats: { matches: 15, runs: 567, batAvg: 40.5, batStrikeRate: 191.5, wickets: 0, bowlStrikeRate: 0, economy: 0, bowlAvg: 0, historicalAuctionPrice: 680 },
    imageUrl: 'https://documents.iplt20.com/ipl/IPLHeadshot2024/225.png'
  },
  { 
    id: '5', name: 'Rashid Khan', position: 'Bowler', pot: 'A', basePrice: 200, status: 'PENDING', 
    country: 'AFG', iplTeam: 'GT',
    stats: { matches: 12, runs: 0, batAvg: 0, batStrikeRate: 0, wickets: 10, bowlStrikeRate: 17.2, economy: 8.4, bowlAvg: 24.1, historicalAuctionPrice: 1500 },
    imageUrl: 'https://documents.iplt20.com/ipl/IPLHeadshot2024/218.png'
  },
  { 
    id: '6', name: 'Ben Stokes', position: 'All Rounder', pot: 'B', basePrice: 150, status: 'PENDING', 
    country: 'ENG', iplTeam: 'CSK',
    stats: { matches: 2, runs: 15, batAvg: 7.5, batStrikeRate: 107.1, wickets: 0, bowlStrikeRate: 0, economy: 0, bowlAvg: 0, historicalAuctionPrice: 1625 },
  },
  { 
    id: '7', name: 'Hardik Pandya', position: 'All Rounder', pot: 'B', basePrice: 150, status: 'PENDING', 
    country: 'IND', iplTeam: 'MI',
    stats: { matches: 14, runs: 216, batAvg: 18.0, batStrikeRate: 143.0, wickets: 11, bowlStrikeRate: 17.6, economy: 10.75, bowlAvg: 31.5, historicalAuctionPrice: 1500 },
    imageUrl: 'https://documents.iplt20.com/ipl/IPLHeadshot2024/54.png'
  },
  { 
    id: '9', name: 'KL Rahul', position: 'Wicket Keeper', pot: 'B', basePrice: 150, status: 'PENDING', 
    country: 'IND', iplTeam: 'LSG',
    stats: { matches: 14, runs: 520, batAvg: 37.1, batStrikeRate: 136.2, wickets: 0, bowlStrikeRate: 0, economy: 0, bowlAvg: 0, historicalAuctionPrice: 1700 },
    imageUrl: 'https://documents.iplt20.com/ipl/IPLHeadshot2024/19.png'
  },
  { 
    id: '11', name: 'Rinku Singh', position: 'Batter', pot: 'C', basePrice: 50, status: 'PENDING', 
    country: 'IND', iplTeam: 'KKR',
    stats: { matches: 15, runs: 302, batAvg: 46.4, batStrikeRate: 148.8, wickets: 0, bowlStrikeRate: 0, economy: 0, bowlAvg: 0, historicalAuctionPrice: 55 },
    imageUrl: 'https://documents.iplt20.com/ipl/IPLHeadshot2024/152.png'
  },
  { 
    id: '13', name: 'Matheesha Pathirana', position: 'Bowler', pot: 'C', basePrice: 50, status: 'PENDING', 
    country: 'SL', iplTeam: 'CSK',
    stats: { matches: 13, runs: 0, batAvg: 0, batStrikeRate: 0, wickets: 13, bowlStrikeRate: 16.5, economy: 7.68, bowlAvg: 21.1, historicalAuctionPrice: 20 },
    imageUrl: 'https://documents.iplt20.com/ipl/IPLHeadshot2024/1014.png'
  },
];

export const INITIAL_TEAMS: Team[] = [
  { id: 't1', name: 'Royal Challengers', ownerName: 'United Spirits', budget: 1500, roster: [], color: '#dc2626' },
  { id: 't2', name: 'Chennai Kings', ownerName: 'India Cements', budget: 1500, roster: [], color: '#eab308' },
  { id: 't3', name: 'Mumbai Indians', ownerName: 'Reliance', budget: 1500, roster: [], color: '#2563eb' },
  { id: 't4', name: 'Kolkata Riders', ownerName: 'Red Chillies', budget: 1500, roster: [], color: '#9333ea' },
  { id: 't5', name: 'Sunrisers', ownerName: 'Sun Group', budget: 1500, roster: [], color: '#f97316' },
  { id: 't6', name: 'Rajasthan Royals', ownerName: 'Manoj Badale', budget: 1500, roster: [], color: '#db2777' },
  { id: 't7', name: 'Lucknow Giants', ownerName: 'RPSG Group', budget: 1500, roster: [], color: '#0d9488' },
];
