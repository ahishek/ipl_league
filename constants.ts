import { Player, Team, AuctionConfig } from './types';

export const INITIAL_CONFIG: AuctionConfig = {
  totalBudget: 1500,
  maxPlayers: 15,
  bidTimerSeconds: 30,
  minBidIncrement: 20, // 20 Lakhs/Units standard increment
};

export const TEAM_COLORS = [
  'bg-blue-600',
  'bg-yellow-500',
  'bg-red-600',
  'bg-purple-600',
  'bg-pink-600',
  'bg-orange-500',
  'bg-teal-600',
  'bg-indigo-600',
  'bg-cyan-600',
  'bg-rose-600'
];

export const MOCK_PLAYERS: Player[] = [
  { 
    id: '1', name: 'Virat Kohli', position: 'Batter', pot: 'A', basePrice: 200, status: 'PENDING', 
    country: 'IND', stats: 'IPL Goat', iplTeam: 'RCB',
    imageUrl: 'https://documents.iplt20.com/ipl/IPLHeadshot2024/2.png'
  },
  { 
    id: '2', name: 'Rohit Sharma', position: 'Batter', pot: 'A', basePrice: 200, status: 'PENDING', 
    country: 'IND', stats: 'Hitman', iplTeam: 'MI',
    imageUrl: 'https://documents.iplt20.com/ipl/IPLHeadshot2024/6.png'
  },
  { 
    id: '3', name: 'Jasprit Bumrah', position: 'Bowler', pot: 'A', basePrice: 200, status: 'PENDING', 
    country: 'IND', stats: 'Yorker King', iplTeam: 'MI',
    imageUrl: 'https://documents.iplt20.com/ipl/IPLHeadshot2024/9.png'
  },
  { 
    id: '4', name: 'Travis Head', position: 'Batter', pot: 'A', basePrice: 200, status: 'PENDING', 
    country: 'AUS', stats: 'Explosive Opener', iplTeam: 'SRH',
    imageUrl: 'https://documents.iplt20.com/ipl/IPLHeadshot2024/225.png'
  },
  { 
    id: '5', name: 'Rashid Khan', position: 'Bowler', pot: 'A', basePrice: 200, status: 'PENDING', 
    country: 'AFG', stats: 'Spin Wizard', iplTeam: 'GT',
    imageUrl: 'https://documents.iplt20.com/ipl/IPLHeadshot2024/218.png'
  },
  { 
    id: '6', name: 'Ben Stokes', position: 'All Rounder', pot: 'B', basePrice: 150, status: 'PENDING', 
    country: 'ENG', stats: 'Clutch Player', iplTeam: 'CSK' 
  },
  { 
    id: '7', name: 'Hardik Pandya', position: 'All Rounder', pot: 'B', basePrice: 150, status: 'PENDING', 
    country: 'IND', stats: 'Pace & Power', iplTeam: 'MI',
    imageUrl: 'https://documents.iplt20.com/ipl/IPLHeadshot2024/54.png'
  },
  { 
    id: '9', name: 'KL Rahul', position: 'Wicket Keeper', pot: 'B', basePrice: 150, status: 'PENDING', 
    country: 'IND', stats: 'Classy Bat', iplTeam: 'LSG',
    imageUrl: 'https://documents.iplt20.com/ipl/IPLHeadshot2024/19.png'
  },
  { 
    id: '11', name: 'Rinku Singh', position: 'Batter', pot: 'C', basePrice: 50, status: 'PENDING', 
    country: 'IND', stats: 'Finisher', iplTeam: 'KKR',
    imageUrl: 'https://documents.iplt20.com/ipl/IPLHeadshot2024/152.png'
  },
  { 
    id: '13', name: 'Matheesha Pathirana', position: 'Bowler', pot: 'C', basePrice: 50, status: 'PENDING', 
    country: 'SL', stats: 'Baby Malinga', iplTeam: 'CSK',
    imageUrl: 'https://documents.iplt20.com/ipl/IPLHeadshot2024/1014.png'
  },
];

export const INITIAL_TEAMS: Team[] = [
  { id: 't1', name: 'Royal Challengers', ownerName: 'United Spirits', budget: 1500, roster: [], color: 'bg-red-600' },
  { id: 't2', name: 'Chennai Kings', ownerName: 'India Cements', budget: 1500, roster: [], color: 'bg-yellow-500' },
  { id: 't3', name: 'Mumbai Indians', ownerName: 'Reliance', budget: 1500, roster: [], color: 'bg-blue-600' },
  { id: 't4', name: 'Kolkata Riders', ownerName: 'Red Chillies', budget: 1500, roster: [], color: 'bg-purple-600' },
  { id: 't5', name: 'Sunrisers', ownerName: 'Sun Group', budget: 1500, roster: [], color: 'bg-orange-500' },
  { id: 't6', name: 'Rajasthan Royals', ownerName: 'Manoj Badale', budget: 1500, roster: [], color: 'bg-pink-600' },
  { id: 't7', name: 'Lucknow Giants', ownerName: 'RPSG Group', budget: 1500, roster: [], color: 'bg-teal-600' },
];
