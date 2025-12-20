
import React, { useState, useEffect } from 'react';
import { 
  Play, Pause, SkipForward, Settings, Gavel, Users, Activity, Trophy, User, Plus, Trash2,
  FileSpreadsheet, CheckCircle, XCircle, Download, Link as LinkIcon, 
  Copy, LogOut, Crown, ArrowRight, Share2, RefreshCw, Loader2, AlertCircle, Eye, StopCircle, Clock, DollarSign, Search, Sparkles
} from 'lucide-react';
import { Player, Team, Room, UserState, AuctionConfig, Pot, PlayerStatus } from './types';
import { TEAM_COLORS } from './constants';
import { generateAuctionCommentary, generateUnsoldCommentary, getPlayerInsights } from './services/geminiService';
import { roomService } from './services/roomService';

// --- Rendering Helpers (Moved Outside Component) ---

interface BackgroundWrapperProps {
  children: React.ReactNode;
}

const BackgroundWrapper: React.FC<BackgroundWrapperProps> = ({ children }) => (
    <div className="min-h-screen bg-[#050505] text-white selection:bg-yellow-500/30 overflow-x-hidden relative font-sans">
        {/* Global Ambient Gradients */}
        <div className="fixed top-[-10%] left-[-10%] w-[50%] h-[50%] bg-blue-600/10 rounded-full blur-[120px] pointer-events-none z-0"></div>
        <div className="fixed bottom-[-10%] right-[-10%] w-[50%] h-[50%] bg-purple-600/10 rounded-full blur-[120px] pointer-events-none z-0"></div>
        <div className="relative z-10 w-full h-full">
          {children}
        </div>
    </div>
);

interface GlassCardProps {
  children?: React.ReactNode;
  className?: string;
  onClick?: React.MouseEventHandler<HTMLDivElement>;
}

const GlassCard: React.FC<GlassCardProps> = ({ children, className = "", onClick }) => (
    <div onClick={onClick} className={`bg-white/5 backdrop-blur-xl border border-white/10 rounded-3xl shadow-xl transition-all duration-300 ${className}`}>
        {children}
    </div>
);

export default function App() {
  // --- View State ---
  const [view, setView] = useState<'HOME' | 'LOBBY' | 'GAME' | 'COMPLETED'>('HOME');
  const [isLoading, setIsLoading] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState("");
  
  // --- Room & User State ---
  const [currentUser, setCurrentUser] = useState<UserState | null>(null);
  const [room, setRoom] = useState<Room | null>(null);
  
  // --- Local Inputs ---
  const [hostRoomName, setHostRoomName] = useState("");
  const [joinRoomCode, setJoinRoomCode] = useState("");
  
  const [newTeamName, setNewTeamName] = useState("");
  const [newTeamOwner, setNewTeamOwner] = useState("");
  
  const [isInviteFlow, setIsInviteFlow] = useState(false);
  
  // --- Modals State ---
  const [showSettings, setShowSettings] = useState(false);
  const [activeSettingsTab, setActiveSettingsTab] = useState<'config' | 'teams' | 'import'>('config');
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
  const [showEndConfirmation, setShowEndConfirmation] = useState(false);

  // --- Import State ---
  const [sheetUrl, setSheetUrl] = useState("");
  const [sheetName, setSheetName] = useState("Copy of All Players Data");
  const [isFetchingSheet, setIsFetchingSheet] = useState(false);
  const [fetchedPreview, setFetchedPreview] = useState<Player[]>([]);

  // --- Game Interactions ---
  const [playerInsights, setPlayerInsights] = useState("");
  const [isInsightsLoading, setIsInsightsLoading] = useState(false);
  const [isProcessingAction, setIsProcessingAction] = useState(false);

  const isHost = currentUser?.isAdmin || false;
  const myTeam = room?.teams.find(t => t.controlledByUserId === currentUser?.id);
  
  // Safe URL generation
  const shareUrl = (typeof window !== 'undefined' && room?.id) 
    ? `${window.location.origin}${window.location.pathname}?room=${room.id}` 
    : '';

  // --- Init ---
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('room');
    if (code && code !== 'undefined' && code !== 'null') {
      setJoinRoomCode(code);
      setIsInviteFlow(true);
    }

    // Prompt before leave
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
       if (room) {
           e.preventDefault();
           e.returnValue = '';
       }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [room]);

  // --- Subscriptions ---
  useEffect(() => {
    if (currentUser) {
       const unsub = roomService.subscribe((updated) => {
           setRoom(updated);
           // Auto-navigate to game/completed
           if (updated.status === 'ACTIVE' && view === 'LOBBY') {
               setView('GAME');
           }
           if (updated.status === 'COMPLETED' && view !== 'COMPLETED') {
               setView('COMPLETED');
           }
           // Reset processing state on player change
           if (updated.gameState.currentPlayerId !== room?.gameState.currentPlayerId) {
               setPlayerInsights("");
               setIsProcessingAction(false);
           }
       });
       return unsub;
    }
  }, [currentUser, view, room?.gameState.currentPlayerId]);

  // --- STABLE TIMER LOGIC ---
  useEffect(() => {
    if (!isHost) return;

    const interval = setInterval(() => {
        // Access the TRUE current state from roomService to avoid React Dependency Loop/Jitter
        const r = roomService.currentRoom;
        
        if (r && r.status === 'ACTIVE' && !r.gameState.isPaused && r.gameState.timer > 0 && r.gameState.currentPlayerId) {
             roomService.dispatch({ 
                 type: 'UPDATE_TIMER', 
                 payload: { timer: r.gameState.timer - 1 } 
             });
        } 
        // Auto-resolve when timer hits 0 (Host Side)
        else if (r && r.status === 'ACTIVE' && r.gameState.timer === 0 && r.gameState.currentPlayerId && !r.gameState.isPaused) {
             // We use a small timeout to prevent double-firing in edge cases
             if (r.gameState.currentBid) {
                 // Trigger Sold logic if we haven't already paused
                 handleSold(true);
             } else {
                 handleUnsold(true);
             }
        }
    }, 1000);

    return () => clearInterval(interval);
  }, [isHost]); // Only run setup once for the host

  // --- Handlers ---

  const handleCreateRoom = async () => {
    if (!hostRoomName) return alert("Please enter a room name.");
    
    // Auto-generate Host Name
    const effectiveHostName = "Auction Host";

    setIsLoading(true);
    setLoadingMsg("Creating Secure Room...");
    try {
        const { room, user } = await roomService.createRoom(effectiveHostName, hostRoomName);
        setCurrentUser(user);
        setRoom(room);
        setView('LOBBY');
    } catch (e) {
        console.error(e);
        alert("Failed to create room. PeerJS server might be busy or blocked.");
    } finally { setIsLoading(false); }
  };

  const handleJoinRoom = async () => {
    if (!joinRoomCode) return alert("Please enter the room code.");
    
    // Auto-generate Guest Name
    const effectiveJoinName = `Guest ${Math.floor(Math.random() * 1000)}`;

    setIsLoading(true);
    setLoadingMsg("Connecting to Host...");
    try {
        const { room, user } = await roomService.joinRoom(joinRoomCode.trim(), effectiveJoinName);
        if (!room) throw new Error("No room data received.");
        setCurrentUser(user);
        setRoom(room);
        // Direct Entry logic
        if (room.status === 'ACTIVE') setView('GAME');
        else if (room.status === 'COMPLETED') setView('COMPLETED');
        else setView('LOBBY');
    } catch (e: any) {
        console.error(e);
        alert(`Connection Failed: ${e.message}`);
    } finally { setIsLoading(false); }
  };

  const clearInvite = () => {
      setIsInviteFlow(false);
      setJoinRoomCode("");
      const url = new URL(window.location.href);
      url.searchParams.delete('room');
      window.history.pushState({}, '', url);
  };

  const handleEndGame = () => {
    roomService.dispatch({ type: 'END_GAME', payload: {} });
    setShowEndConfirmation(false);
  };

  // --- Logic Dispatchers ---

  const handleCreateTeam = () => {
    if (!room || !currentUser) return;
    if (room.teams.find(t => t.controlledByUserId === currentUser.id)) return alert("Already have a team");
    
    const newTeam: Team = {
        id: `team_${Date.now()}_${Math.random().toString(36).substr(2,4)}`,
        name: newTeamName,
        ownerName: newTeamOwner,
        budget: room.config.totalBudget,
        roster: [],
        color: TEAM_COLORS[room.teams.length % TEAM_COLORS.length],
        controlledByUserId: currentUser.id
    };
    roomService.dispatch({ type: 'ADD_TEAM', payload: newTeam });
  };

  const handleStartGame = () => {
      roomService.dispatch({ type: 'START_GAME', payload: {} });
      setTimeout(() => bringNextPlayer(), 1000);
  };

  const placeBid = (teamId: string, amount: number) => {
      roomService.dispatch({ type: 'BID', payload: { teamId, amount } });
  };

  const togglePause = () => {
      roomService.dispatch({ type: 'TOGGLE_PAUSE', payload: {} });
  };

  // --- Complex Host Logic ---

  const bringNextPlayer = () => {
      // Must use current room state from service for consistency during intervals
      const r = roomService.currentRoom;
      if (!r || !isHost) return;
      
      let next = r.players.find(p => p.pot === r.gameState.currentPot && p.status === 'PENDING');
      let newPot = r.gameState.currentPot;
      let logs = [...r.gameState.logs];

      if (!next) {
         const pots: Pot[] = ['A', 'B', 'C', 'D'];
         const idx = pots.indexOf(r.gameState.currentPot);
         if (idx < pots.length - 1) {
             newPot = pots[idx + 1];
             next = r.players.find(p => p.pot === newPot && p.status === 'PENDING');
             if (next) logs.unshift({ id: Date.now().toString(), message: `Moving to Pot ${newPot}`, type: 'SYSTEM', timestamp: new Date() });
         }
      }

      // We reconstruct the whole object to ensure React updates
      const updatedRoom: Room = {
          ...r,
          players: next ? r.players.map(p => p.id === next?.id ? { ...p, status: 'ON_AUCTION' } : p) : r.players,
          gameState: {
              ...r.gameState,
              currentPot: newPot,
              currentPlayerId: next ? next.id : null,
              currentBid: null,
              timer: r.config.bidTimerSeconds,
              aiCommentary: "",
              logs: next ? [{ id: Date.now().toString(), message: `On Auction: ${next.name}`, type: 'SYSTEM', timestamp: new Date() }, ...logs] : logs,
              isPaused: !next
          }
      };
      
      roomService.broadcastSync(updatedRoom);
  };

  const handleSold = async (auto = false) => {
     if (isProcessingAction && !auto) return;
     if (!auto) setIsProcessingAction(true);

     // Use Service State
     const r = roomService.currentRoom;
     if (!r || !r.gameState.currentPlayerId || !r.gameState.currentBid) return;
     if (r.gameState.isPaused && auto) return; // Prevent double firing

     const pid = r.gameState.currentPlayerId;
     const player = r.players.find(p => p.id === pid);
     const team = r.teams.find(t => t.id === r.gameState.currentBid?.teamId);
     
     if(player && team) {
         // Pause immediately to prevent race conditions while AI thinks
         roomService.dispatch({ type: 'TOGGLE_PAUSE', payload: {} }); 
         
         const commentary = await generateAuctionCommentary(player, team, r.gameState.currentBid.amount, r.teams);
         roomService.dispatch({ type: 'SOLD', payload: { commentary } });
         setTimeout(() => bringNextPlayer(), 4000);
     }
  };

  const handleUnsold = async (auto = false) => {
      if (isProcessingAction && !auto) return;
      if (!auto) setIsProcessingAction(true);

      const r = roomService.currentRoom;
      if (!r || !r.gameState.currentPlayerId) return;
      if (r.gameState.isPaused && auto) return;

      const player = r.players.find(p => p.id === r.gameState.currentPlayerId);
      if (player) {
          roomService.dispatch({ type: 'TOGGLE_PAUSE', payload: {} }); 
          
          const commentary = await generateUnsoldCommentary(player);
          roomService.dispatch({ type: 'UNSOLD', payload: { commentary } });
          setTimeout(() => bringNextPlayer(), 3000);
      }
  };

  // --- Insight Fetcher ---
  const handleGetInsights = async () => {
    if (!room?.gameState.currentPlayerId) return;
    setIsInsightsLoading(true);
    const p = room.players.find(x => x.id === room?.gameState.currentPlayerId);
    if (p) {
        const text = await getPlayerInsights(p);
        setPlayerInsights(text);
    }
    setIsInsightsLoading(false);
  }

  // --- Helper: Parsing for Import ---
  const parseCSVData = (text: string) => {
    try {
      const rows = text.trim().split(/\r?\n/);
      const startIndex = rows[0].toLowerCase().includes("name") ? 1 : 0;
      const newPlayers: Player[] = [];
      for(let i=startIndex; i<rows.length; i++) {
         let cols = rows[i].split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/).map(c => c.trim().replace(/^"|"$/g, ''));
         if (cols.length < 5) continue;
         const [name, roleRaw, potRaw, imageUrl, iplTeam, basePriceStr] = cols;
         let position: 'Batter'|'Bowler'|'All Rounder'|'Wicket Keeper' = 'Batter';
         if (roleRaw?.toUpperCase().includes('WK')) position = 'Wicket Keeper';
         else if (roleRaw?.toUpperCase().includes('AR')) position = 'All Rounder';
         else if (roleRaw?.toUpperCase().includes('BOWL')) position = 'Bowler';

         newPlayers.push({
            id: `sheet-${Date.now()}-${i}`,
            name, position, pot: (potRaw as Pot) || 'Uncategorized', imageUrl, iplTeam,
            basePrice: parseInt(basePriceStr?.replace(/[^0-9.]/g, '') || "20"),
            status: 'PENDING', country: 'TBD'
         });
      }
      return newPlayers;
    } catch (e) { return []; }
  };

  const handleFetchFromSheet = async () => {
      if (!sheetUrl) return alert("Enter URL");
      setIsFetchingSheet(true);
      const matches = sheetUrl.match(/\/d\/([a-zA-Z0-9-_]+)/);
      const sheetId = matches ? matches[1] : null;
      if (!sheetId) { setIsFetchingSheet(false); return alert("Invalid URL"); }
      
      try {
          const url = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(sheetName)}`;
          const res = await fetch(url);
          if (!res.ok) throw new Error("Failed");
          const text = await res.text();
          const p = parseCSVData(text);
          if (p.length > 0) setFetchedPreview(p);
          else alert("No players found");
      } catch (e) { alert("Fetch failed. Check URL/Permissions."); }
      finally { setIsFetchingSheet(false); }
  };

  const confirmImport = () => {
      roomService.dispatch({ type: 'IMPORT_PLAYERS', payload: fetchedPreview });
      setFetchedPreview([]);
      setShowSettings(false);
      alert("Imported!");
  };

  // --- Views ---

  if (view === 'HOME') {
    return (
      <BackgroundWrapper>
      <div className="min-h-screen flex items-center justify-center p-4">
         <div className="max-w-6xl w-full grid grid-cols-1 md:grid-cols-2 gap-16 relative">
            {/* Left Side: Branding */}
            <div className="flex flex-col justify-center space-y-10">
                <div>
                  <div className="flex items-center gap-3 mb-6">
                     <div className="w-16 h-16 bg-gradient-to-br from-yellow-400 to-yellow-600 rounded-2xl flex items-center justify-center shadow-lg shadow-yellow-500/20">
                        <Trophy size={32} className="text-white" strokeWidth={3} />
                     </div>
                     <span className="text-sm font-bold tracking-widest text-blue-400 uppercase border border-blue-500/30 px-4 py-1.5 rounded-full bg-blue-500/10">Official Simulator</span>
                  </div>
                  <h1 className="text-7xl font-display font-bold text-transparent bg-clip-text bg-gradient-to-r from-white to-gray-400 mb-6 tracking-tight leading-none">
                    IPL <br/> <span className="text-white">AUCTION</span>
                  </h1>
                  <p className="text-gray-400 text-xl max-w-lg font-light leading-relaxed">
                    Experience the thrill of the hammer. The most advanced real-time P2P auction simulator for cricket enthusiasts.
                  </p>
                </div>
                
                <div className="space-y-6 max-w-md">
                   {isLoading ? (
                       <GlassCard className="p-12 flex flex-col items-center justify-center min-h-[300px]">
                           <Loader2 size={48} className="animate-spin text-yellow-500 mb-6"/>
                           <p className="text-xl font-medium animate-pulse">{loadingMsg}</p>
                       </GlassCard>
                   ) : (
                       <>
                       {/* Create Room Flow */}
                       {!isInviteFlow && (
                         <GlassCard className="p-8 hover:bg-white/10 group cursor-default">
                            <h2 className="text-xl font-semibold text-white mb-6 flex items-center gap-3">
                               <div className="p-2 bg-green-500/20 rounded-lg text-green-400 group-hover:bg-green-500 group-hover:text-white transition-colors"><Plus size={20}/></div>
                               Host Auction
                            </h2>
                            <div className="space-y-4">
                                <div>
                                    <label className="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-2 ml-1">Room Name</label>
                                    <input 
                                      type="text" 
                                      placeholder="e.g. Sunday League" 
                                      className="w-full bg-black/40 border border-white/10 rounded-xl p-4 text-white focus:outline-none focus:border-green-500/50 focus:ring-1 focus:ring-green-500/50 transition-all placeholder:text-gray-600" 
                                      value={hostRoomName} 
                                      onChange={e => setHostRoomName(e.target.value)} 
                                    />
                                </div>
                                <button onClick={handleCreateRoom} className="w-full bg-gradient-to-r from-green-600 to-green-500 hover:from-green-500 hover:to-green-400 text-white font-semibold py-4 rounded-xl transition-all shadow-lg shadow-green-900/20 active:scale-[0.98]">
                                  Create Room
                                </button>
                            </div>
                         </GlassCard>
                       )}

                       {/* Join Room Flow */}
                       <GlassCard className={`p-8 hover:bg-white/10 group cursor-default ${!isInviteFlow ? 'mt-4' : ''}`}>
                          <h2 className="text-xl font-semibold text-white mb-6 flex items-center gap-3">
                             <div className="p-2 bg-blue-500/20 rounded-lg text-blue-400 group-hover:bg-blue-500 group-hover:text-white transition-colors"><ArrowRight size={20}/></div>
                             {isInviteFlow ? 'Join Invited Room' : 'Join Room'}
                          </h2>
                          <div className="space-y-4">
                              <div>
                                  <label className="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-2 ml-1">Room Code</label>
                                  <input 
                                    type="text" 
                                    placeholder="e.g. X7K9P2" 
                                    className="w-full bg-black/40 border border-white/10 rounded-xl p-4 text-white font-mono uppercase tracking-widest focus:outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/50 transition-all placeholder:text-gray-600" 
                                    maxLength={6} 
                                    value={joinRoomCode} 
                                    onChange={e => setJoinRoomCode(e.target.value.toUpperCase())} 
                                    disabled={isInviteFlow}
                                  />
                              </div>
                              <button onClick={handleJoinRoom} className="w-full bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-500 hover:to-blue-400 text-white font-semibold py-4 rounded-xl transition-all shadow-lg shadow-blue-900/20 active:scale-[0.98]">
                                Join Room
                              </button>
                              {isInviteFlow && <button onClick={clearInvite} className="w-full text-gray-500 text-sm hover:text-white underline mt-2">Cancel Invite</button>}
                          </div>
                       </GlassCard>
                       </>
                   )}
                </div>
            </div>
            
            {/* Right Side: Recent Rooms */}
            {!isInviteFlow && (
              <div className="hidden md:flex flex-col justify-center">
                  <GlassCard className="p-8 h-[650px] overflow-hidden relative shadow-2xl bg-black/20">
                     <h3 className="text-gray-500 font-medium text-xs tracking-[0.2em] uppercase mb-8 border-b border-white/5 pb-4">Recent Sessions</h3>
                     
                     <div className="space-y-3 overflow-y-auto h-[550px] pr-2 custom-scrollbar">
                        {roomService.getHistory().length === 0 ? (
                            <div className="flex flex-col items-center justify-center h-full text-gray-600 opacity-50">
                                <Activity size={48} className="mb-4 text-white/20"/>
                                <p>No recent activity</p>
                            </div>
                        ) : (
                            roomService.getHistory().map((h: any) => (
                                <div key={h.id} className="group flex justify-between items-center bg-white/5 p-5 rounded-2xl border border-white/5 hover:bg-white/10 hover:border-white/20 cursor-pointer transition-all" onClick={() => { setJoinRoomCode(h.id); }}>
                                    <div className="flex items-center gap-4">
                                        <div className="w-12 h-12 rounded-full bg-gradient-to-br from-gray-700 to-gray-800 flex items-center justify-center text-gray-400 font-bold group-hover:text-white transition-colors shadow-inner">
                                            {h.name[0]}
                                        </div>
                                        <div>
                                            <p className="font-semibold text-white group-hover:text-blue-400 transition-colors text-lg">{h.name}</p>
                                            <p className="text-xs text-gray-500">{new Date(h.createdAt).toLocaleDateString()}</p>
                                        </div>
                                    </div>
                                    <div className="bg-black/30 px-3 py-1 rounded-lg text-gray-400 font-mono text-sm group-hover:bg-blue-500/20 group-hover:text-blue-300 transition-colors">
                                        {h.id}
                                    </div>
                                </div>
                            ))
                        )}
                     </div>
                  </GlassCard>
              </div>
            )}
         </div>
      </div>
      </BackgroundWrapper>
    );
  }

  // --- COMPLETED VIEW ---
  if (view === 'COMPLETED' && room) {
     const sortedTeams = [...room.teams].sort((a,b) => b.roster.reduce((sum,p) => sum + (p.soldPrice||0), 0) - a.roster.reduce((sum,p) => sum + (p.soldPrice||0), 0));
     return (
        <BackgroundWrapper>
        <div className="min-h-screen p-8 flex flex-col items-center">
            <h1 className="text-5xl font-display font-bold text-transparent bg-clip-text bg-gradient-to-r from-yellow-400 to-yellow-600 mb-12 drop-shadow-lg">Auction Summary</h1>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 w-full max-w-7xl">
                {sortedTeams.map((team, idx) => {
                   const spent = team.roster.reduce((sum, p) => sum + (p.soldPrice||0), 0);
                   return (
                       <GlassCard key={team.id} className="p-6 relative overflow-hidden group hover:border-white/20">
                           {idx === 0 && <div className="absolute top-0 right-0 bg-yellow-500 text-black text-xs font-bold px-3 py-1 rounded-bl-xl shadow-lg">WINNER</div>}
                           <div className="flex items-center gap-4 mb-6">
                               <div className={`w-14 h-14 rounded-2xl ${team.color} shadow-lg flex items-center justify-center text-xl font-bold`}>{team.name[0]}</div>
                               <div>
                                  <h2 className="text-2xl font-bold leading-tight">{team.name}</h2>
                                  <p className="text-sm text-gray-400">{team.ownerName}</p>
                               </div>
                           </div>
                           <div className="flex justify-between mb-3 text-sm text-gray-400 bg-black/20 p-3 rounded-xl">
                               <span className="font-medium">Spent</span>
                               <span className="font-mono text-white">{spent} / {room.config.totalBudget}</span>
                           </div>
                           <div className="flex justify-between mb-6 text-sm text-gray-400 bg-black/20 p-3 rounded-xl">
                               <span className="font-medium">Squad Size</span>
                               <span className="font-mono text-white">{team.roster.length}</span>
                           </div>
                           <div className="space-y-2 h-64 overflow-y-auto pr-2 custom-scrollbar">
                               {team.roster.map(p => (
                                   <div key={p.id} className="flex justify-between items-center text-sm bg-white/5 p-3 rounded-xl border border-white/5">
                                       <span className="font-medium">{p.name}</span>
                                       <span className="font-mono font-bold text-yellow-500">{p.soldPrice} L</span>
                                   </div>
                               ))}
                           </div>
                       </GlassCard>
                   );
                })}
            </div>
            <button onClick={() => window.location.reload()} className="mt-12 bg-white text-black px-8 py-4 rounded-full font-bold hover:bg-gray-200 transition-all shadow-xl hover:shadow-2xl hover:-translate-y-1">Back to Home</button>
        </div>
        </BackgroundWrapper>
     );
  }

  // --- LOBBY & GAME VIEW (Shared) ---
  const gameView = view === 'GAME';

  return (
    <BackgroundWrapper>
    <div className={`min-h-screen text-white flex flex-col ${gameView ? 'md:flex-row' : 'items-center p-4'}`}>
      
      {/* LOBBY VIEW CONTAINER */}
      {!gameView && (
        <div className="max-w-6xl w-full animate-fade-in py-12">
             {/* Header */}
             <GlassCard className="flex justify-between items-center mb-8 p-8">
                <div>
                   <h2 className="text-4xl font-display font-bold text-white tracking-tight">{room?.name}</h2>
                   <div className="flex items-center gap-4 mt-4">
                      <span className="bg-yellow-500/20 text-yellow-500 border border-yellow-500/50 px-3 py-1 rounded-full font-bold text-xs uppercase tracking-wider">Lobby</span>
                      <div className="flex items-center gap-3 bg-black/30 px-4 py-1.5 rounded-full border border-white/10 cursor-pointer hover:bg-black/50 transition-colors" onClick={() => { navigator.clipboard.writeText(room?.id || ""); alert("Copied!"); }}>
                         <span className="text-gray-400 text-xs font-bold uppercase">Code</span>
                         <span className="font-mono text-lg font-bold text-blue-400">{room?.id}</span>
                         <Copy size={14} className="text-gray-500"/>
                      </div>
                      <div className="flex items-center gap-3 bg-blue-500/10 px-4 py-1.5 rounded-full border border-blue-500/20 cursor-pointer hover:bg-blue-500/20 transition-colors" onClick={() => { navigator.clipboard.writeText(shareUrl); alert("Copied!"); }}>
                         <Share2 size={14} className="text-blue-400"/>
                         <span className="text-xs font-bold text-blue-200">Share Link</span>
                      </div>
                   </div>
                </div>
                <div className="flex items-center gap-4">
                   {isHost ? (
                      <button onClick={handleStartGame} className="bg-gradient-to-r from-green-600 to-green-500 hover:from-green-500 hover:to-green-400 text-white px-8 py-4 rounded-xl font-bold shadow-lg shadow-green-900/40 animate-pulse transition-all transform hover:scale-105">START AUCTION</button>
                   ) : (
                      <div className="text-right bg-black/20 px-6 py-3 rounded-xl border border-white/5"><p className="text-gray-400 text-sm">Waiting for host...</p><p className="text-xs text-gray-500 font-mono mt-1">{currentUser?.name}</p></div>
                   )}
                   <button onClick={() => window.location.reload()} className="p-4 bg-white/5 rounded-xl hover:bg-white/10 text-gray-400 border border-white/10 transition-colors"><LogOut size={20}/></button>
                </div>
             </GlassCard>
             
             {isHost && (
                <div className="mb-8 bg-yellow-500/10 border border-yellow-500/20 p-4 rounded-xl flex items-center gap-4 shadow-lg backdrop-blur-sm">
                    <AlertCircle className="text-yellow-500 flex-shrink-0" />
                    <p className="text-sm text-yellow-200">
                        <strong>Important:</strong> Do not close or refresh this tab. You are the host server. 
                        If you leave, the room will close for everyone.
                    </p>
                </div>
             )}

             <div className="grid grid-cols-1 md:grid-cols-12 gap-8">
                <div className="md:col-span-4 space-y-8">
                    <GlassCard className="p-8">
                        <h3 className="text-lg font-bold mb-6 flex items-center gap-3 text-gray-200"><User size={20} className="text-blue-500"/> My Team</h3>
                        {!myTeam ? (
                           <div className="space-y-4">
                              <input type="text" className="w-full bg-black/40 border border-white/10 rounded-xl p-4 text-white focus:outline-none focus:border-blue-500/50 transition-all placeholder:text-gray-600" value={newTeamName} onChange={e => setNewTeamName(e.target.value)} placeholder="Team Name" />
                              <input type="text" className="w-full bg-black/40 border border-white/10 rounded-xl p-4 text-white focus:outline-none focus:border-blue-500/50 transition-all placeholder:text-gray-600" value={newTeamOwner} onChange={e => setNewTeamOwner(e.target.value)} placeholder="Owner Name" />
                              <button onClick={handleCreateTeam} className="w-full bg-blue-600 hover:bg-blue-500 text-white py-4 rounded-xl font-bold shadow-lg shadow-blue-900/20">Register Team</button>
                           </div>
                        ) : (
                           <div className="text-center py-8 bg-black/20 rounded-2xl border border-white/5 cursor-pointer hover:bg-black/30 transition-all group" onClick={() => setSelectedTeamId(myTeam.id)}>
                              <div className={`w-20 h-20 rounded-2xl ${myTeam.color} mx-auto flex items-center justify-center text-3xl font-bold mb-4 shadow-lg group-hover:scale-110 transition-transform duration-300`}>{myTeam.name[0]}</div>
                              <h4 className="text-xl font-bold text-white">{myTeam.name}</h4>
                              <p className="text-gray-500 text-sm mt-1">{myTeam.ownerName}</p>
                              <span className="text-xs text-blue-400 mt-4 block font-medium uppercase tracking-wider">Click to view details</span>
                           </div>
                        )}
                    </GlassCard>
                    {isHost && (
                        <GlassCard className="p-8">
                           <h3 className="text-lg font-bold mb-6 flex items-center gap-3 text-gray-200"><Settings size={20} className="text-gray-400"/> Configuration</h3>
                           <button onClick={() => setShowSettings(true)} className="w-full bg-white/5 hover:bg-white/10 text-white py-4 rounded-xl border border-white/10 flex items-center justify-center gap-2 transition-all font-medium">Manage Settings</button>
                        </GlassCard>
                    )}
                </div>
                <div className="md:col-span-8">
                    <GlassCard className="p-8 h-full">
                        <div className="flex justify-between items-center mb-6">
                            <h3 className="text-lg font-bold flex items-center gap-3 text-gray-200"><Users size={20} className="text-purple-500"/> Participating Teams ({room?.teams.length})</h3>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            {room?.teams.map(team => (
                            <div key={team.id} className="bg-white/5 p-4 rounded-2xl border border-white/5 flex items-center gap-4 cursor-pointer hover:bg-white/10 hover:border-white/20 transition-all group" onClick={() => setSelectedTeamId(team.id)}>
                                <div className={`w-12 h-12 rounded-xl ${team.color} flex items-center justify-center font-bold text-lg shadow-md group-hover:scale-105 transition-transform`}>{team.name[0]}</div>
                                <div><p className="font-bold text-white group-hover:text-blue-400 transition-colors">{team.name}</p><p className="text-xs text-gray-500">{team.ownerName}</p></div>
                                {team.controlledByUserId === room.hostId && <Crown size={16} className="text-yellow-500 ml-auto drop-shadow-md"/>}
                            </div>
                            ))}
                        </div>
                        <div className="mt-8 border-t border-white/10 pt-6">
                            <h4 className="text-xs font-bold text-gray-500 uppercase mb-4 tracking-wider">Connected Members</h4>
                            <div className="flex flex-wrap gap-2">
                                {room?.members.map(m => (
                                    <span key={m.userId} className="text-xs bg-black/40 text-gray-300 px-3 py-1.5 rounded-full border border-white/10 flex items-center gap-2">
                                        <div className="w-1.5 h-1.5 rounded-full bg-green-500"></div> {m.name}
                                    </span>
                                ))}
                            </div>
                        </div>
                    </GlassCard>
                </div>
             </div>
        </div>
      )}

      {/* GAME VIEW */}
      {gameView && (
          <>
          {/* Sidebar */}
          <div className="w-full md:w-80 bg-black/40 backdrop-blur-xl border-r border-white/10 flex flex-col h-[50vh] md:h-screen z-20 shadow-2xl">
            <div className="p-6 border-b border-white/10 bg-white/5">
              <h1 className="text-2xl font-display font-bold text-transparent bg-clip-text bg-gradient-to-r from-yellow-400 to-yellow-600 tracking-wider">IPL AUCTION</h1>
              <div className="flex items-center gap-2 mt-2 text-xs font-bold tracking-widest uppercase">
                <span className={`w-2 h-2 rounded-full ${room?.gameState.isPaused ? 'bg-red-500 animate-pulse' : 'bg-green-500 animate-pulse'}`}></span>
                <span className={room?.gameState.isPaused ? 'text-red-400' : 'text-green-400'}>{room?.gameState.isPaused ? 'PAUSED' : 'LIVE'}</span>
              </div>
            </div>
            
            {isHost && (
                <div className="p-6 grid grid-cols-2 gap-3 border-b border-white/5">
                    <button onClick={togglePause} className="bg-yellow-500 hover:bg-yellow-400 text-black p-3 rounded-xl flex items-center justify-center gap-2 col-span-2 font-bold transition-colors shadow-lg">
                        {room?.gameState.isPaused ? <><Play size={18} fill="currentColor"/> RESUME</> : <><Pause size={18} fill="currentColor"/> PAUSE</>}
                    </button>
                    <button onClick={() => bringNextPlayer()} className="col-span-2 bg-white/10 hover:bg-white/20 text-white p-3 rounded-xl flex items-center justify-center gap-2 text-sm font-medium border border-white/10 transition-all"><SkipForward size={16} /> Force Next</button>
                    <button onClick={() => setShowEndConfirmation(true)} className="col-span-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 p-3 rounded-xl flex items-center justify-center gap-2 text-sm mt-2 border border-red-500/20 transition-all"><StopCircle size={16} /> End Auction</button>
                </div>
            )}
            
            <div className="flex-1 overflow-y-auto p-4 space-y-3 flex flex-col-reverse custom-scrollbar">
                {room?.gameState.logs.map(log => (
                    <div key={log.id} className="text-sm border-l-2 border-white/10 pl-3 py-1 animate-fade-in">
                        <p className={`font-medium ${
                            log.type==='BID'?'text-blue-300':
                            log.type==='SOLD'?'text-green-400':
                            log.type==='UNSOLD'?'text-red-400':
                            log.type==='AI' ? 'text-purple-300 italic':
                            'text-gray-400'
                        }`}>
                            {log.message}
                        </p>
                        <span className="text-[10px] text-gray-600">{new Date(log.timestamp).toLocaleTimeString()}</span>
                    </div>
                ))}
            </div>
          </div>

          {/* Main Stage */}
          <div className="flex-1 flex flex-col h-screen overflow-hidden relative">
             <div className="shrink-0 h-24 bg-black/20 backdrop-blur-md border-b border-white/10 flex items-center justify-between px-8 z-10">
                <div className="flex items-center gap-12 w-full">
                   {/* Header Stats */}
                   <div className="flex flex-col">
                       <span className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Current Pot</span>
                       <div className="flex items-baseline gap-2">
                           <span className="font-bold text-3xl text-yellow-500 font-display">POT {room?.gameState.currentPot}</span>
                           <span className="text-xs text-gray-400 font-medium">({room?.players.filter(p => p.pot === room.gameState.currentPot && p.status === 'PENDING').length} Remaining)</span>
                       </div>
                   </div>
                   
                   <div className="hidden md:flex gap-8 border-l border-white/10 pl-8">
                       <div className="flex flex-col">
                           <span className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Sold Today</span>
                           <span className="text-xl font-bold text-white">{room?.players.filter(p => p.status === 'SOLD').length}</span>
                       </div>
                       <div className="flex flex-col">
                           <span className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Highest Bid</span>
                           {(() => {
                               const highest = [...(room?.players||[])].filter(p => p.status === 'SOLD').sort((a,b) => (b.soldPrice||0) - (a.soldPrice||0))[0];
                               return highest ? (
                                   <div className="flex flex-col">
                                       <span className="text-sm font-bold text-white">{highest.name}</span>
                                       <span className="text-xs text-green-400 font-mono">{highest.soldPrice} L</span>
                                   </div>
                               ) : <span className="text-sm text-gray-600 italic">None yet</span>;
                           })()}
                       </div>
                   </div>

                   {room?.gameState.aiCommentary && (
                       <div className="hidden xl:flex ml-auto items-center gap-3 bg-purple-500/10 border border-purple-500/20 px-6 py-2 rounded-full max-w-md">
                           <Activity size={16} className="text-purple-400 flex-shrink-0"/>
                           <p className="text-sm italic text-purple-200 truncate">"{room.gameState.aiCommentary}"</p>
                       </div>
                   )}
                </div>
             </div>
             
             {/* Center Stage - Scrollable Area */}
             <div className="flex-1 overflow-y-auto overflow-x-hidden relative w-full scrollbar-hide">
                 <div className="min-h-full flex flex-col items-center justify-center p-4 md:p-8 pb-32"> {/* Added pb-32 for extra scroll space */}
                    <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-blue-500/5 rounded-full blur-3xl pointer-events-none"></div>

                    {room?.gameState.currentPlayerId ? (
                         <div className="w-full max-w-7xl grid grid-cols-1 md:grid-cols-12 gap-6 z-10">
                            
                            {/* Player Card */}
                            <div className="md:col-span-5 relative flex flex-col">
                                <GlassCard className="flex flex-col overflow-hidden border-white/20 relative group h-full min-h-[500px]">
                                    <div className="absolute top-4 left-4 z-20 flex gap-2">
                                        <span className="bg-blue-600/90 backdrop-blur-md text-white text-xs px-3 py-1 rounded-md uppercase font-bold tracking-wider shadow-lg">{room.players.find(p => p.id === room.gameState.currentPlayerId)?.position}</span>
                                        <span className="bg-white/10 backdrop-blur-md text-gray-200 text-xs px-3 py-1 rounded-md uppercase font-bold tracking-wider border border-white/10">{room.players.find(p => p.id === room.gameState.currentPlayerId)?.country}</span>
                                    </div>
                                    
                                    <div className="flex-1 relative bg-gradient-to-b from-gray-800 to-black overflow-hidden">
                                        {room.players.find(p => p.id === room.gameState.currentPlayerId)?.imageUrl ? 
                                            <img src={room.players.find(p => p.id === room.gameState.currentPlayerId)?.imageUrl} className="h-full w-full object-cover object-top mix-blend-normal hover:scale-105 transition-transform duration-700"/> : 
                                            <div className="h-full flex items-center justify-center text-white/10"><User size={150}/></div>
                                        }
                                        <div className="absolute inset-0 bg-gradient-to-t from-black via-black/20 to-transparent"></div>
                                        
                                        {/* Player Info Overlay */}
                                        <div className="absolute bottom-0 w-full p-8 z-20">
                                            <h2 className="text-5xl font-display font-bold text-white leading-none drop-shadow-2xl mb-2">{room.players.find(p => p.id === room.gameState.currentPlayerId)?.name}</h2>
                                            <div className="flex items-center gap-3">
                                                <p className="text-gray-300 font-medium text-lg">{room.players.find(p => p.id === room.gameState.currentPlayerId)?.iplTeam || "Uncapped"}</p>
                                                <div className="h-1 w-1 bg-gray-500 rounded-full"></div>
                                                <span className="text-blue-400 font-bold tracking-widest text-sm uppercase">{room.players.find(p => p.id === room.gameState.currentPlayerId)?.stats}</span>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Stats / Form Search Bar */}
                                    <div className="bg-black/40 backdrop-blur-md border-t border-white/10 p-4">
                                        {playerInsights ? (
                                            <div className="text-sm text-gray-300 bg-blue-900/20 p-3 rounded-xl border border-blue-500/20 animate-fade-in">
                                                <div className="flex items-center gap-2 mb-1 text-blue-400 text-xs font-bold uppercase"><Sparkles size={12}/> Recent Form</div>
                                                {playerInsights}
                                            </div>
                                        ) : (
                                            <button 
                                                onClick={handleGetInsights} 
                                                disabled={isInsightsLoading}
                                                className="w-full flex items-center justify-center gap-2 text-xs font-bold uppercase tracking-widest text-gray-300 hover:text-white bg-white/5 hover:bg-white/10 p-4 rounded-xl transition-all border border-white/10 hover:border-white/20 group"
                                            >
                                                {isInsightsLoading ? <Loader2 size={16} className="animate-spin text-blue-400"/> : <Search size={16} className="text-blue-400 group-hover:scale-110 transition-transform"/>}
                                                Search for recent form
                                            </button>
                                        )}
                                    </div>

                                    <div className="p-5 bg-white/5 border-t border-white/10 flex justify-between items-center">
                                        <div className="flex flex-col">
                                            <span className="text-[10px] uppercase text-gray-500 font-bold tracking-widest">Base Price</span>
                                            <span className="text-3xl font-display font-bold text-white">{room.players.find(p => p.id === room.gameState.currentPlayerId)?.basePrice} <span className="text-lg text-gray-500">L</span></span>
                                        </div>
                                        <div className="text-right">
                                            <span className="text-[10px] text-gray-500 block uppercase font-bold tracking-widest">Role</span>
                                            <span className="text-lg text-white font-medium">{room.players.find(p => p.id === room.gameState.currentPlayerId)?.position}</span>
                                        </div>
                                    </div>
                                </GlassCard>
                            </div>

                            {/* Bidding Control Center */}
                            <div className="md:col-span-7 flex flex-col gap-6 h-full min-h-[500px]">
                                <GlassCard className="flex-1 flex flex-col items-center justify-center p-8 relative border-white/20 bg-gradient-to-br from-white/5 to-transparent">
                                    <div className="relative mb-8 text-center">
                                       <div className="absolute inset-0 bg-red-500/10 blur-3xl rounded-full transform scale-150"></div>
                                       <span className={`relative text-[120px] leading-none font-display font-bold drop-shadow-2xl ${room.gameState.timer <= 5 ? 'text-red-500 animate-pulse' : 'text-white'}`}>{room.gameState.timer}<span className="text-4xl text-gray-500 ml-2">s</span></span>
                                    </div>
                                    
                                    <div className="w-full max-w-md bg-black/60 backdrop-blur-xl rounded-2xl p-8 border border-white/10 shadow-2xl relative overflow-hidden">
                                        <p className="text-gray-500 text-xs uppercase font-bold tracking-[0.3em] mb-6 text-center">Current Highest Bid</p>
                                        
                                        {room.gameState.currentBid ? (
                                            <div className="bg-gradient-to-b from-green-500 to-green-600 rounded-xl p-6 text-center shadow-lg transform transition-all animate-fade-in relative overflow-hidden">
                                                <div className="absolute inset-0 bg-white/10 mix-blend-overlay"></div>
                                                <div className="relative z-10">
                                                    <div className="text-6xl font-display font-bold text-white mb-1">{room.gameState.currentBid.amount}</div>
                                                    <div className="text-xs text-green-100 font-bold tracking-widest mb-4">LAKHS</div>
                                                    <div className="inline-flex items-center gap-2 bg-black/20 px-4 py-1.5 rounded-full backdrop-blur-sm">
                                                        <div className={`w-2 h-2 rounded-full ${room.teams.find(t => t.id === room.gameState.currentBid?.teamId)?.color}`}></div>
                                                        <span className="text-sm font-bold text-white">{room.teams.find(t => t.id === room.gameState.currentBid?.teamId)?.name}</span>
                                                    </div>
                                                </div>
                                            </div>
                                        ) : (
                                            <div className="bg-white/5 rounded-xl p-6 text-center border border-white/5 min-h-[160px] flex items-center justify-center flex-col">
                                                <span className="text-gray-600 italic mb-2">Waiting for opening bid...</span>
                                                <div className="h-1 w-12 bg-gray-700 rounded-full"></div>
                                            </div>
                                        )}
                                    </div>

                                    {/* HOST CONTROLS */}
                                    {isHost && (
                                        <div className="absolute bottom-6 right-6 flex flex-col gap-2">
                                             <div className="flex gap-3">
                                                <button 
                                                    onClick={() => handleUnsold(false)} 
                                                    disabled={isProcessingAction}
                                                    className={`
                                                        group relative px-6 py-3 rounded-xl border border-red-500/30 font-bold text-sm transition-all overflow-hidden
                                                        ${isProcessingAction ? 'opacity-50 cursor-not-allowed bg-red-900/20' : 'bg-red-500/10 hover:bg-red-500/20 text-red-400 hover:text-red-300 hover:border-red-500/50 hover:shadow-[0_0_20px_rgba(239,68,68,0.3)]'}
                                                    `}
                                                >
                                                    <span className="relative z-10 flex items-center gap-2">
                                                        <XCircle size={16}/> Mark Unsold
                                                    </span>
                                                </button>

                                                {room.gameState.currentBid && (
                                                    <button 
                                                        onClick={() => handleSold(false)}
                                                        disabled={isProcessingAction} 
                                                        className={`
                                                            group relative px-8 py-3 rounded-xl border border-green-500/30 font-bold text-sm transition-all overflow-hidden
                                                            ${isProcessingAction ? 'opacity-50 cursor-not-allowed bg-green-900/20' : 'bg-green-500/10 hover:bg-green-500/20 text-green-400 hover:text-green-300 hover:border-green-500/50 hover:shadow-[0_0_20px_rgba(34,197,94,0.3)]'}
                                                        `}
                                                    >
                                                        <span className="relative z-10 flex items-center gap-2">
                                                            <Gavel size={16}/> Mark Sold
                                                        </span>
                                                    </button>
                                                )}
                                             </div>
                                             {isProcessingAction && <span className="text-[10px] text-gray-500 text-center animate-pulse">Processing...</span>}
                                        </div>
                                    )}
                                </GlassCard>
                            </div>
                         </div>
                    ) : (
                        <div className="text-center opacity-40 flex flex-col items-center">
                            <div className="w-24 h-24 bg-white/5 rounded-full flex items-center justify-center mb-6 border border-white/10">
                              <Gavel size={48} className="text-white"/>
                            </div>
                            <h2 className="text-3xl font-bold text-white tracking-tight">Waiting for next player...</h2>
                            <p className="text-gray-400 mt-2">The host will bring the next player to the auction floor.</p>
                        </div>
                    )}
                 </div>
             </div>

             {/* Bottom Team Strip */}
             <div className="shrink-0 z-30 bg-black/80 backdrop-blur-xl border-t border-white/10 p-4 md:p-6 overflow-x-auto">
                <div className="flex gap-6 min-w-max pb-2">
                    {room?.teams.map(team => {
                        const isWinning = room.gameState.currentBid?.teamId === team.id;
                        const isMyTeam = team.controlledByUserId === currentUser?.id;
                        const currentAmount = room.gameState.currentBid?.amount || 0;
                        const base = room.players.find(p => p.id === room.gameState.currentPlayerId)?.basePrice || 0;
                        
                        // Bidding Increments
                        const minInc = 10;
                        const stdInc = room.config.minBidIncrement;
                        const baseBid = currentAmount > 0 ? currentAmount : base;
                        const bid10 = baseBid + minInc;
                        const bidStd = baseBid + stdInc;

                        return (
                            <div key={team.id} 
                                 className={`w-80 bg-white/5 rounded-2xl p-4 border transition-all duration-300 relative cursor-pointer group ${isWinning ? 'border-green-500 bg-green-500/10 shadow-[0_0_30px_rgba(34,197,94,0.1)]' : isMyTeam ? 'border-blue-500/50 bg-blue-500/5' : 'border-white/5 hover:bg-white/10 hover:border-white/20'}`}
                                 onClick={() => setSelectedTeamId(team.id)}
                            >
                                <div className="flex justify-between items-start mb-3">
                                    <div className="flex items-center gap-3">
                                        <div className={`w-8 h-8 rounded-lg ${team.color} shadow-lg flex items-center justify-center text-xs font-bold`}>{team.name[0]}</div>
                                        <div className="flex flex-col">
                                            <span className="text-xs font-bold text-white leading-none mb-1 max-w-[120px] truncate">{team.name}</span>
                                            <span className="text-[10px] text-gray-500 uppercase tracking-wider">{team.ownerName}</span>
                                        </div>
                                    </div>
                                    <span className="text-[10px] bg-black/40 px-2 py-1 rounded text-gray-400 border border-white/5">{team.roster.length}/{room.config.maxPlayers}</span>
                                </div>
                                
                                <div className="flex justify-between items-center bg-black/30 p-2.5 rounded-xl mb-3 border border-white/5">
                                    <span className="text-[10px] uppercase text-gray-500 font-bold">Purse</span>
                                    <span className="font-mono font-bold text-yellow-500">{team.budget} L</span>
                                </div>

                                {isWinning ? <div className="w-full bg-green-500 text-black text-center py-2 rounded-xl text-xs font-bold shadow-lg animate-pulse">CURRENTLY LEADING</div> : 
                                 (!room.gameState.currentPlayerId || room.gameState.isPaused) ? <div className="w-full bg-white/5 text-gray-500 text-center py-2 rounded-xl text-xs font-medium border border-white/5">Waiting</div> :
                                 (isHost || isMyTeam) ? (
                                    <div className="flex gap-2" onClick={e => e.stopPropagation()}>
                                        <button onClick={() => placeBid(team.id, bid10)} className="flex-1 bg-white/10 hover:bg-blue-600 hover:text-white text-gray-300 py-2 rounded-xl text-xs font-bold transition-all border border-white/10">+{minInc}L</button>
                                        <button onClick={() => placeBid(team.id, bidStd)} className="flex-1 bg-blue-600 hover:bg-blue-500 text-white py-2 rounded-xl text-xs font-bold transition-all shadow-lg shadow-blue-900/30">+{stdInc}L</button>
                                    </div>
                                 ) :
                                 <div className="w-full bg-white/5 text-center py-2 rounded-xl text-xs text-gray-500">Spectating</div>
                                }
                            </div>
                        );
                    })}
                </div>
             </div>
          </div>
          </>
      )}

      {/* DETAILED TEAM MODAL */}
      {selectedTeamId && room && (
          <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4 backdrop-blur-md animate-fade-in">
             <GlassCard className="w-full max-w-3xl border-white/10 max-h-[85vh] flex flex-col bg-[#0a0a0a]/90">
                 {(() => {
                     const t = room.teams.find(x => x.id === selectedTeamId);
                     if (!t) return null;
                     const spent = t.roster.reduce((sum, p) => sum + (p.soldPrice||0), 0);
                     return (
                         <>
                             <div className="p-8 border-b border-white/10 flex justify-between items-center">
                                 <div className="flex items-center gap-6">
                                     <div className={`w-16 h-16 rounded-2xl ${t.color} flex items-center justify-center font-bold text-3xl shadow-lg`}>{t.name[0]}</div>
                                     <div>
                                         <h2 className="text-3xl font-bold text-white tracking-tight">{t.name}</h2>
                                         <p className="text-gray-400 text-sm mt-1">{t.ownerName}</p>
                                     </div>
                                 </div>
                                 <button onClick={() => setSelectedTeamId(null)} className="p-2 hover:bg-white/10 rounded-full transition-colors"><XCircle className="text-gray-400 hover:text-white" size={28}/></button>
                             </div>
                             <div className="p-8 grid grid-cols-3 gap-6 border-b border-white/10 bg-white/5">
                                 <div className="text-center p-4 bg-black/20 rounded-2xl border border-white/5">
                                     <p className="text-gray-500 text-xs uppercase font-bold tracking-widest mb-1">Budget Left</p>
                                     <p className="text-2xl font-display font-bold text-green-400">{t.budget}</p>
                                 </div>
                                 <div className="text-center p-4 bg-black/20 rounded-2xl border border-white/5">
                                     <p className="text-gray-500 text-xs uppercase font-bold tracking-widest mb-1">Spent</p>
                                     <p className="text-2xl font-display font-bold text-red-400">{spent}</p>
                                 </div>
                                 <div className="text-center p-4 bg-black/20 rounded-2xl border border-white/5">
                                     <p className="text-gray-500 text-xs uppercase font-bold tracking-widest mb-1">Squad</p>
                                     <p className="text-2xl font-display font-bold text-blue-400">{t.roster.length} / {room.config.maxPlayers}</p>
                                 </div>
                             </div>
                             <div className="p-8 overflow-y-auto flex-1 custom-scrollbar">
                                 <h3 className="font-bold mb-6 text-gray-400 text-xs uppercase tracking-[0.2em]">Squad List</h3>
                                 {t.roster.length === 0 ? <div className="text-center py-12 text-gray-600 italic">No players purchased yet.</div> : (
                                     <div className="space-y-3">
                                         {t.roster.map(p => (
                                             <div key={p.id} className="flex justify-between items-center bg-white/5 p-4 rounded-2xl border border-white/5 hover:border-white/10 transition-colors group">
                                                 <div className="flex items-center gap-4">
                                                     <div className="w-10 h-10 bg-gray-800 rounded-full overflow-hidden border border-white/10">
                                                        {p.imageUrl ? <img src={p.imageUrl} className="w-full h-full object-cover"/> : <User className="p-2 text-gray-400"/>}
                                                     </div>
                                                     <div>
                                                         <p className="font-bold text-white text-lg">{p.name}</p>
                                                         <p className="text-[10px] text-gray-400 uppercase font-bold tracking-wider">{p.position}</p>
                                                     </div>
                                                 </div>
                                                 <span className="font-mono font-bold text-yellow-500 text-lg">{p.soldPrice} L</span>
                                             </div>
                                         ))}
                                     </div>
                                 )}
                             </div>
                         </>
                     );
                 })()}
             </GlassCard>
          </div>
      )}

      {/* END GAME CONFIRMATION MODAL */}
      {showEndConfirmation && (
          <div className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4 backdrop-blur-md">
              <GlassCard className="max-w-md w-full p-8 border-red-500/30 text-center bg-[#0a0a0a]">
                  <div className="w-20 h-20 bg-red-500/10 rounded-full flex items-center justify-center mx-auto mb-6">
                    <AlertCircle className="w-10 h-10 text-red-500"/>
                  </div>
                  <h2 className="text-3xl font-bold text-white mb-4">End Auction?</h2>
                  <p className="text-gray-400 mb-8 leading-relaxed">Are you sure you want to stop the auction? This action cannot be undone and will show the final results to all participants.</p>
                  <div className="flex gap-4">
                      <button onClick={() => setShowEndConfirmation(false)} className="flex-1 bg-white/10 hover:bg-white/20 text-white py-4 rounded-xl font-bold transition-all border border-white/10">Cancel</button>
                      <button onClick={handleEndGame} className="flex-1 bg-red-600 hover:bg-red-500 text-white py-4 rounded-xl font-bold transition-all shadow-lg shadow-red-900/40">Yes, End It</button>
                  </div>
              </GlassCard>
          </div>
      )}

      {/* SETTINGS MODAL */}
      {showSettings && (
         <div className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4 backdrop-blur-md">
             <GlassCard className="w-full max-w-4xl border-white/10 flex flex-col max-h-[90vh] bg-[#0a0a0a]">
                 <div className="p-8 border-b border-white/10 flex justify-between items-center"><h2 className="text-2xl font-bold">Configuration</h2><button onClick={() => setShowSettings(false)} className="text-gray-400 hover:text-white"><XCircle size={28}/></button></div>
                 <div className="flex border-b border-white/10 px-8 bg-white/5">
                     <button onClick={() => setActiveSettingsTab('config')} className={`px-6 py-4 text-sm font-bold border-b-2 transition-colors ${activeSettingsTab==='config'?'border-blue-500 text-blue-400':'border-transparent text-gray-400 hover:text-white'}`}>General</button>
                     <button onClick={() => setActiveSettingsTab('teams')} className={`px-6 py-4 text-sm font-bold border-b-2 transition-colors ${activeSettingsTab==='teams'?'border-blue-500 text-blue-400':'border-transparent text-gray-400 hover:text-white'}`}>Teams</button>
                     <button onClick={() => setActiveSettingsTab('import')} className={`px-6 py-4 text-sm font-bold border-b-2 transition-colors ${activeSettingsTab==='import'?'border-blue-500 text-blue-400':'border-transparent text-gray-400 hover:text-white'}`}>Import Data</button>
                 </div>
                 <div className="p-8 overflow-y-auto flex-1 custom-scrollbar">
                     {activeSettingsTab === 'config' && (
                         <div className="grid grid-cols-2 gap-8">
                            <div className="bg-white/5 p-6 rounded-2xl border border-white/5">
                                <label className="text-xs text-gray-500 font-bold uppercase tracking-wider flex items-center gap-2 mb-3"><DollarSign size={14}/> Team Budget (Lakhs)</label>
                                <input type="number" value={room?.config.totalBudget} onChange={e => roomService.dispatch({type:'UPDATE_CONFIG', payload: {totalBudget: parseInt(e.target.value)}})} className="w-full bg-black/40 p-4 rounded-xl border border-white/10 text-white focus:outline-none focus:border-blue-500/50 text-xl font-mono"/>
                            </div>
                            <div className="bg-white/5 p-6 rounded-2xl border border-white/5">
                                <label className="text-xs text-gray-500 font-bold uppercase tracking-wider flex items-center gap-2 mb-3"><Clock size={14}/> Bid Timer (Seconds)</label>
                                <input type="number" value={room?.config.bidTimerSeconds} onChange={e => roomService.dispatch({type:'UPDATE_CONFIG', payload: {bidTimerSeconds: parseInt(e.target.value)}})} className="w-full bg-black/40 p-4 rounded-xl border border-white/10 text-white focus:outline-none focus:border-blue-500/50 text-xl font-mono"/>
                            </div>
                         </div>
                     )}
                     {activeSettingsTab === 'teams' && (
                         <div className="space-y-3">
                             {room?.teams.map(t => (
                                 <div key={t.id} className="flex justify-between bg-white/5 p-4 rounded-xl items-center border border-white/5">
                                     <div className="flex items-center gap-4">
                                         <div className={`w-8 h-8 rounded-full ${t.color}`}></div>
                                         <span className="font-bold">{t.name}</span>
                                     </div>
                                     <button onClick={() => roomService.dispatch({type:'REMOVE_TEAM', payload:{teamId: t.id}})} className="text-red-400 hover:bg-red-500/20 p-2 rounded-lg transition-colors"><Trash2 size={18}/></button>
                                 </div>
                             ))}
                             {room?.teams.length === 0 && <p className="text-gray-500 text-center py-8">No teams yet.</p>}
                         </div>
                     )}
                     {activeSettingsTab === 'import' && (
                         <div className="space-y-6">
                             <div>
                                 <label className="text-xs text-gray-500 font-bold uppercase tracking-wider mb-2 block">Google Sheet Link</label>
                                 <input type="text" placeholder="https://docs.google.com/spreadsheets/d/..." value={sheetUrl} onChange={e => setSheetUrl(e.target.value)} className="w-full bg-black/40 p-4 rounded-xl border border-white/10 text-white focus:outline-none focus:border-blue-500/50"/>
                             </div>
                             <button onClick={handleFetchFromSheet} className="bg-blue-600 hover:bg-blue-500 px-6 py-3 rounded-xl text-sm font-bold flex items-center gap-2 transition-all">{isFetchingSheet ? <RefreshCw size={16} className="animate-spin"/> : <Download size={16}/>} Fetch Data</button>
                             
                             {fetchedPreview.length > 0 && (
                                 <div className="bg-green-500/10 border border-green-500/20 p-6 rounded-2xl">
                                     <div className="flex items-center gap-3 text-green-400 mb-4 font-bold">
                                         <CheckCircle size={20}/>
                                         Found {fetchedPreview.length} players
                                     </div>
                                     <button onClick={confirmImport} className="w-full bg-green-600 hover:bg-green-500 py-4 rounded-xl font-bold text-white transition-all shadow-lg">Confirm Import</button>
                                 </div>
                             )}
                         </div>
                     )}
                 </div>
             </GlassCard>
         </div>
      )}
    </div>
    </BackgroundWrapper>
  );
}
