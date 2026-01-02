import React, { useState, useEffect, useRef, useMemo } from 'react';
import { 
  Play, Pause, SkipForward, Settings, Gavel, Users, Activity, Trophy, User, Plus,
  CheckCircle, XCircle, Download, Copy, LogOut, ArrowRight, Loader2, AlertCircle, 
  Clock, Search, Sparkles, List, Star, Palette, FileText, Calendar, 
  Image as ImageIcon, Zap, History, Filter, StopCircle, UserCheck, UserMinus, 
  TrendingUp, ChevronLeft, RefreshCcw, Edit3, AlertTriangle, Coins, Eye
} from 'lucide-react';
import { Player, Team, Room, UserState, Pot, Position, UserProfile, AuctionArchive } from './types';
import { TEAM_COLORS } from './constants';
import { generateAuctionCommentary, generateUnsoldCommentary, getPlayerInsights, generateTeamLogo } from './services/geminiService';
import { roomService } from './services/roomService';

// --- Helper Components ---

interface BackgroundWrapperProps {
  children: React.ReactNode;
}

const BackgroundWrapper: React.FC<BackgroundWrapperProps> = ({ children }) => (
    <div className="h-screen bg-[#050505] text-white selection:bg-yellow-500/30 overflow-hidden relative font-sans flex flex-col">
        <div className="fixed top-[-10%] left-[-10%] w-[50%] h-[50%] bg-blue-600/10 rounded-full blur-[120px] pointer-events-none z-0"></div>
        <div className="fixed bottom-[-10%] right-[-10%] w-[50%] h-[50%] bg-purple-600/10 rounded-full blur-[120px] pointer-events-none z-0"></div>
        <div className="relative z-10 w-full h-full flex flex-col flex-1 overflow-hidden">{children}</div>
    </div>
);

const GlassCard: React.FC<{children?: React.ReactNode; className?: string; onClick?: React.MouseEventHandler<HTMLDivElement>}> = ({ children, className = "", onClick }) => (
    <div onClick={onClick} className={`bg-white/5 backdrop-blur-xl border border-white/10 rounded-3xl shadow-xl transition-all duration-300 ${className}`}>{children}</div>
);

/**
 * Enhanced CSV Parser with Robust Mapping and Normalization
 */
const parseCSVData = (csv: string): Player[] => {
  const lines = csv.split('\n').map(l => l.trim()).filter(l => l);
  if (lines.length < 2) return [];

  const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/"/g, ''));
  
  // Identify column indices for better accuracy
  let nameIdx = -1, posIdx = -1, potIdx = -1, priceIdx = -1, imgIdx = -1, teamIdx = -1, countryIdx = -1;

  headers.forEach((h, i) => {
      if (h === 'player' || h.includes('name')) nameIdx = i;
      else if (h === 'role' || h.includes('pos') || h === 'type') posIdx = i;
      else if (h === 'pool' || h === 'pot' || h.includes('set') || h === 'category') potIdx = i;
      else if (h === 'base price' || h === 'base_price' || h === 'reserve price' || h === 'price') priceIdx = i;
      else if (h === 'image' || h === 'photo' || h.includes('url') || h === 'img') imgIdx = i;
      else if (h === 'team' || h === 'ipl team' || h.includes('franchise')) teamIdx = i;
      else if (h === 'country' || h === 'nation') countryIdx = i;
  });

  // Fallback for Price if strict match failed
  if (priceIdx === -1) {
     headers.forEach((h, i) => { if (h.includes('price') || h.includes('amount') || h.includes('value') || h.includes('cost')) priceIdx = i; });
  }

  return lines.slice(1).map((line, idx) => {
    // Robust split handling commas inside quotes
    const rawCols = line.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/);
    const cols = rawCols.map(c => c.trim().replace(/^"|"$/g, '').trim());

    // Helper to safely get value at index
    const getVal = (i: number) => (i >= 0 && i < cols.length ? cols[i] : "");

    const p: any = { 
      id: `imp-${Date.now()}-${idx}`, 
      status: 'PENDING',
      name: getVal(nameIdx) || 'Unknown Player',
      position: 'Batter' as Position,
      pot: 'Uncategorized' as Pot,
      basePrice: 0,
      imageUrl: getVal(imgIdx),
      iplTeam: getVal(teamIdx),
      country: getVal(countryIdx)
    };

    // Role Normalization
    const rawRole = getVal(posIdx).toLowerCase();
    if (rawRole.includes('bat')) p.position = 'Batter';
    else if (rawRole.includes('bowl')) p.position = 'Bowler';
    else if (rawRole.includes('ar') || rawRole.includes('all') || rawRole.includes('round')) p.position = 'All Rounder';
    else if (rawRole.includes('wk') || rawRole.includes('keep')) p.position = 'Wicket Keeper';

    // Pot Normalization
    const rawPot = getVal(potIdx).toUpperCase();
    if (rawPot === 'A' || rawPot.includes('POOL A') || rawPot.includes('SET 1')) p.pot = 'A';
    else if (rawPot === 'B' || rawPot.includes('POOL B') || rawPot.includes('SET 2')) p.pot = 'B';
    else if (rawPot === 'C' || rawPot.includes('POOL C') || rawPot.includes('SET 3')) p.pot = 'C';
    else if (rawPot === 'D' || rawPot.includes('POOL D') || rawPot.includes('SET 4')) p.pot = 'D';
    else if (['A', 'B', 'C', 'D'].includes(rawPot.replace(/[^A-D]/g, ''))) p.pot = rawPot.replace(/[^A-D]/g, '') as Pot;
    
    // Price Parsing
    const rawPrice = getVal(priceIdx);
    if (rawPrice) {
        const lowerVal = rawPrice.toLowerCase();
        let multiplier = 1;
        
        // Handle "2 Cr" or "50 Lakh" cases
        if (lowerVal.includes('cr') || lowerVal.includes('crore')) multiplier = 100;
        else if (lowerVal.includes('lakh') || lowerVal.includes('lac')) multiplier = 1;
        
        // Remove commas and non-numeric chars (except dot)
        const cleanVal = rawPrice.replace(/,/g, '').trim();
        const numMatch = cleanVal.match(/[0-9.]+/);
        
        if (numMatch) {
            const num = parseFloat(numMatch[0]);
            p.basePrice = Math.round(num * multiplier);
        }
    }

    return p as Player;
  }).filter(p => p.name && p.name !== 'Unknown Player');
};

export default function App() {
  // --- View State ---
  const [view, setView] = useState<'LOGIN' | 'HOME' | 'LOBBY' | 'GAME' | 'COMPLETED' | 'ARCHIVE_DETAIL'>('LOGIN');
  const viewRef = useRef(view);
  const [isLoading, setIsLoading] = useState(false);
  
  // --- User & Profile ---
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loginName, setLoginName] = useState("");
  const [currentUser, setCurrentUser] = useState<UserState | null>(null);
  const [room, setRoom] = useState<Room | null>(null);
  const [archive, setArchive] = useState<AuctionArchive[]>([]);
  const [selectedArchive, setSelectedArchive] = useState<AuctionArchive | null>(null);

  // --- Local Inputs ---
  const [hostRoomName, setHostRoomName] = useState("");
  const [joinRoomCode, setJoinRoomCode] = useState("");
  const [newTeamName, setNewTeamName] = useState("");
  const [newTeamColor, setNewTeamColor] = useState(TEAM_COLORS[0]);
  const [logoOptions, setLogoOptions] = useState<string[]>([]);
  const [selectedLogoUrl, setSelectedLogoUrl] = useState<string | null>(null);
  const [isGeneratingLogos, setIsGeneratingLogos] = useState(false);
  const [isEditingTeam, setIsEditingTeam] = useState(false);
  const [viewTeamRoster, setViewTeamRoster] = useState<Team | null>(null);
  
  // --- Modals & Game State ---
  const [showSettings, setShowSettings] = useState(false);
  const [activeSettingsTab, setActiveSettingsTab] = useState<'config' | 'schedule' | 'teams' | 'import'>('config');
  const [playerInsights, setPlayerInsights] = useState("");
  const [isInsightsLoading, setIsInsightsLoading] = useState(false);
  const [sidebarTab, setSidebarTab] = useState<'LOGS' | 'WATCHLIST'>('LOGS');
  const [watchlist, setWatchlist] = useState<string[]>([]);
  const [lobbyView, setLobbyView] = useState<'TEAMS' | 'PLAYERS'>('TEAMS');
  const [lobbySearch, setLobbySearch] = useState("");
  const [lobbyFilterPot, setLobbyFilterPot] = useState<Pot | 'ALL'>('ALL');
  const [lobbyFilterRole, setLobbyFilterRole] = useState<Position | 'ALL'>('ALL');
  const [privateNotes, setPrivateNotes] = useState<Record<string, string>>({});
  const [editingNotePlayerId, setEditingNotePlayerId] = useState<string | null>(null);
  const [tempNoteValue, setTempNoteValue] = useState("");
  const [isActionLoading, setIsActionLoading] = useState(false);
  const [showEndConfirm, setShowEndConfirm] = useState(false);
  const [showStartConfirm, setShowStartConfirm] = useState(false);
  const [viewPlayerPool, setViewPlayerPool] = useState(false);

  // --- Import Specific State ---
  const [sheetUrl, setSheetUrl] = useState("");
  const [sheetName, setSheetName] = useState("Sheet1");
  const [isFetchingSheet, setIsFetchingSheet] = useState(false);
  const [fetchedPreview, setFetchedPreview] = useState<Player[]>([]);

  const isHost = currentUser?.isAdmin || false;
  const myTeam = room?.teams.find(t => t.controlledByUserId === profile?.id);

  // Computed Stats
  const highestBidPlayer = useMemo(() => {
    if (!room) return null;
    return [...room.players]
      .filter(p => p.status === 'SOLD' && p.soldPrice)
      .sort((a, b) => (b.soldPrice || 0) - (a.soldPrice || 0))[0];
  }, [room?.players]);

  const soldCount = useMemo(() => {
    return room?.players.filter(p => p.status === 'SOLD').length || 0;
  }, [room?.players]);

  // Sync ref
  useEffect(() => { viewRef.current = view; }, [view]);

  // Init Auth
  useEffect(() => {
    const saved = roomService.getUserProfile();
    if (saved) {
      setProfile(saved);
      setArchive(roomService.getArchive());
      setView('HOME');
    } else {
      setView('LOGIN');
    }
    const params = new URLSearchParams(window.location.search);
    const code = params.get('room');
    if (code) setJoinRoomCode(code.toUpperCase());
  }, []);

  // Subscriptions
  useEffect(() => {
    if (currentUser) {
       const unsub = roomService.subscribe((updated) => {
           setRoom(updated);
           const currentView = viewRef.current;
           if (updated.status === 'ACTIVE' && currentView === 'LOBBY') setView('GAME');
           if (updated.status === 'COMPLETED' && currentView !== 'COMPLETED' && currentView !== 'ARCHIVE_DETAIL') {
               setView('COMPLETED');
               setArchive(roomService.getArchive()); 
           }
       });
       return unsub;
    }
  }, [currentUser]);

  // Handlers
  const handleLogin = () => {
    if (!loginName.trim()) return;
    const p = roomService.saveUserProfile(loginName.trim());
    setProfile(p);
    setView('HOME');
  };

  const handleLogout = () => {
    localStorage.removeItem('ipl_user_profile');
    setProfile(null);
    setCurrentUser(null);
    setView('LOGIN');
    if (roomService.peer) {
        roomService.peer.destroy();
        roomService.peer = null;
    }
  };

  const handleCreateRoom = async () => {
    if (!hostRoomName || !profile) return;
    setIsLoading(true);
    try {
        const { room, user } = await roomService.createRoom(profile, hostRoomName);
        setCurrentUser(user);
        setRoom(room);
        setView('LOBBY');
    } catch (e) { alert("Failed to host."); } 
    finally { setIsLoading(false); }
  };

  const handleJoinRoom = async () => {
    if (!joinRoomCode || !profile) return;
    setIsLoading(true);
    try {
        const { room, user } = await roomService.joinRoom(joinRoomCode.trim(), profile);
        if (!room) throw new Error("No data");
        setCurrentUser(user);
        setRoom(room);
        if (room.status === 'ACTIVE') setView('GAME');
        else if (room.status === 'COMPLETED') setView('COMPLETED');
        else setView('LOBBY');
    } catch (e) { alert("Room not found or Host offline."); } 
    finally { setIsLoading(false); }
  };

  const handleCreateOrUpdateTeam = () => {
    if (!room || !profile || !newTeamName || isLoading) return;
    setIsLoading(true);

    if (myTeam && isEditingTeam) {
         roomService.dispatch({ 
             type: 'UPDATE_TEAM', 
             payload: { 
                 teamId: myTeam.id, 
                 updates: { 
                     name: newTeamName, 
                     color: newTeamColor, 
                     logoUrl: selectedLogoUrl || myTeam.logoUrl 
                 } 
             } 
         });
         setIsEditingTeam(false);
    } else {
        const existingTeam = room.teams.find(t => t.controlledByUserId === profile.id);
        if (existingTeam) {
            alert("You already have a registered franchise: " + existingTeam.name);
            setIsLoading(false);
            return;
        }
        const team: Team = {
            id: `team_${Date.now()}`,
            name: newTeamName,
            ownerName: profile.name,
            budget: room.config.totalBudget,
            roster: [],
            color: newTeamColor,
            logoUrl: selectedLogoUrl || undefined,
            controlledByUserId: profile.id
        };
        roomService.dispatch({ type: 'ADD_TEAM', payload: team });
    }
    setTimeout(() => setIsLoading(false), 800);
  };

  const startEditingTeam = () => {
      if (!myTeam) return;
      setNewTeamName(myTeam.name);
      setNewTeamColor(myTeam.color);
      setSelectedLogoUrl(myTeam.logoUrl || null);
      setLogoOptions([]);
      setIsEditingTeam(true);
  };

  const handleGenerateLogos = async () => {
    if (!newTeamName) return alert("Enter team name first");
    setIsGeneratingLogos(true);
    try {
        const logos: string[] = [];
        for (let i = 0; i < 4; i++) {
            const logo = await generateTeamLogo(newTeamName, newTeamColor);
            if (logo) logos.push(logo);
        }
        setLogoOptions(logos);
        if (logos.length > 0) setSelectedLogoUrl(logos[0]);
    } catch (e) { console.error(e); } finally { setIsGeneratingLogos(false); }
  };

  const handleStartGame = () => {
      // Instead of dispatching directly, show confirmation modal
      setShowStartConfirm(true);
  };

  const confirmStartGame = () => {
      roomService.dispatch({ type: 'START_GAME', payload: {} });
      setTimeout(() => roomService.dispatch({ type: 'NEXT_PLAYER', payload: {} }), 500);
      setShowStartConfirm(false);
  }

  const handleEndGame = () => {
      roomService.dispatch({ type: 'END_GAME', payload: {} });
      setShowEndConfirm(false);
  };

  const handleSold = async () => {
     const r = roomService.currentRoom;
     if (!r || !r.gameState.currentPlayerId || !r.gameState.currentBid) return;
     if (isActionLoading) return;
     
     // 1. Optimistic Update: Dispatch SOLD immediately to unblock UI
     setIsActionLoading(true);
     const player = r.players.find(p => p.id === r.gameState.currentPlayerId);
     const team = r.teams.find(t => t.id === r.gameState.currentBid?.teamId);
     const bidAmount = r.gameState.currentBid.amount;
     
     if(player && team) {
         if (!r.gameState.isPaused) roomService.dispatch({ type: 'TOGGLE_PAUSE', payload: {} });
         
         // Dispatch without waiting for AI
         roomService.dispatch({ type: 'SOLD', payload: { commentary: undefined } });

         // 2. Generate Commentary in background
         generateAuctionCommentary(player, team, bidAmount, r.teams).then(commentary => {
             roomService.dispatch({ type: 'ADD_LOG', payload: { message: commentary, type: 'AI' } });
         });

         setTimeout(() => {
            roomService.dispatch({ type: 'NEXT_PLAYER', payload: {} });
            setIsActionLoading(false);
            setPlayerInsights("");
         }, 2500);
     } else {
         setIsActionLoading(false);
     }
  };

  const handleUnsold = async () => {
      const r = roomService.currentRoom;
      if (!r || !r.gameState.currentPlayerId) return;
      if (isActionLoading) return;
      
      // 1. Optimistic Update
      setIsActionLoading(true);
      const player = r.players.find(p => p.id === r.gameState.currentPlayerId);
      
      if (player) {
          if (!r.gameState.isPaused) roomService.dispatch({ type: 'TOGGLE_PAUSE', payload: {} });
          
          // Dispatch without waiting for AI
          roomService.dispatch({ type: 'UNSOLD', payload: { commentary: undefined } });

          // 2. Generate Commentary in background
          generateUnsoldCommentary(player).then(commentary => {
              roomService.dispatch({ type: 'ADD_LOG', payload: { message: commentary, type: 'AI' } });
          });

          setTimeout(() => {
              roomService.dispatch({ type: 'NEXT_PLAYER', payload: {} });
              setIsActionLoading(false);
              setPlayerInsights("");
          }, 2000);
      } else {
          setIsActionLoading(false);
      }
  };

  const handleGetInsights = async () => {
    if (!room?.gameState.currentPlayerId) return;
    setIsInsightsLoading(true);
    const p = room.players.find(x => x.id === room.gameState.currentPlayerId);
    if (p) {
        const text = await getPlayerInsights(p);
        setPlayerInsights(text);
    }
    setIsInsightsLoading(false);
  };

  const placeBid = (teamId: string, amount: number) => {
      roomService.dispatch({ type: 'BID', payload: { teamId, amount } });
  };

  const togglePause = () => {
      roomService.dispatch({ type: 'TOGGLE_PAUSE', payload: {} });
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
        const text = await res.text();
        const p = parseCSVData(text);
        if (p.length > 0) {
            setFetchedPreview(p);
        } else {
            alert("No players found in this sheet. Ensure headers include 'Name', 'Pool', 'Role' and 'Base Price'.");
        }
    } catch (e) { alert("Fetch failed. Ensure the sheet is Public."); }
    finally { setIsFetchingSheet(false); }
  };

  const getFilteredLobbyPlayers = () => {
    if (!room) return [];
    return room.players.filter(p => {
        const matchesSearch = p.name.toLowerCase().includes(lobbySearch.toLowerCase());
        const matchesPot = lobbyFilterPot === 'ALL' || p.pot === lobbyFilterPot;
        const matchesRole = lobbyFilterRole === 'ALL' || p.position === lobbyFilterRole;
        return matchesSearch && matchesPot && matchesRole;
    });
  };

  const toggleWatchlist = (id: string) => {
    setWatchlist(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const savePrivateNote = (playerId: string) => {
    setPrivateNotes(prev => ({ ...prev, [playerId]: tempNoteValue }));
    setEditingNotePlayerId(null);
  };

  // --- VIEWS ---

  if (view === 'LOGIN') {
      return (
          <BackgroundWrapper>
              <div className="flex-1 flex items-center justify-center p-6 overflow-y-auto">
                  <div className="max-w-md w-full animate-fade-in">
                      <div className="text-center mb-12">
                          <div className="w-20 h-20 bg-gradient-to-br from-yellow-400 to-yellow-600 rounded-3xl flex items-center justify-center mx-auto mb-6 shadow-2xl"><Gavel size={40} className="text-black" strokeWidth={2.5}/></div>
                          <h1 className="text-4xl font-display font-bold text-white mb-2">Welcome, Owner</h1>
                          <p className="text-gray-500 font-medium">Identify yourself to join the auction hall.</p>
                      </div>
                      <GlassCard className="p-10 space-y-8">
                          <input type="text" placeholder="Owner Name" className="w-full bg-black/40 border border-white/10 rounded-2xl p-5 text-white focus:outline-none focus:border-yellow-500/50 transition-all text-lg" value={loginName} onChange={e => setLoginName(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleLogin()}/>
                          <button onClick={handleLogin} disabled={!loginName} className="w-full bg-gradient-to-r from-yellow-600 to-yellow-500 hover:from-yellow-500 hover:to-yellow-400 text-black font-bold py-5 rounded-2xl transition-all shadow-xl disabled:opacity-50 active:scale-95">Enter Hall</button>
                      </GlassCard>
                  </div>
              </div>
          </BackgroundWrapper>
      );
  }

  if (view === 'HOME') {
      return (
          <BackgroundWrapper>
              <div className="max-w-7xl mx-auto p-6 lg:p-12 w-full h-full overflow-y-auto">
                  <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 mb-16">
                      <div className="flex items-center gap-6"><div className="w-20 h-20 rounded-3xl bg-blue-600 flex items-center justify-center text-4xl shadow-2xl border-4 border-white/5 overflow-hidden"><Trophy size={48} className="text-yellow-400" fill="currentColor" /></div><div><h1 className="text-4xl font-display font-bold text-white tracking-tight">Dashboard</h1><p className="text-blue-400 font-medium">Welcome, <span className="text-white underline">{profile?.name}</span></p></div></div>
                      <button onClick={handleLogout} className="p-4 bg-white/5 hover:bg-red-500/10 text-gray-400 hover:text-red-400 rounded-2xl border border-white/10 transition-all flex items-center gap-2 font-bold text-sm"><LogOut size={18}/> Sign Out</button>
                  </header>
                  <div className="grid grid-cols-1 lg:grid-cols-12 gap-10">
                      <div className="lg:col-span-4 space-y-8"><h2 className="text-xl font-bold flex items-center gap-3 text-green-500"><Play size={20}/> Operations</h2><GlassCard className="p-8 space-y-4"><h3 className="text-lg font-bold">Host Room</h3><input type="text" placeholder="Season Name..." className="w-full bg-black/40 border border-white/10 rounded-xl p-4 text-sm" value={hostRoomName} onChange={e => setHostRoomName(e.target.value)} /><button onClick={handleCreateRoom} className="w-full bg-blue-600 py-4 rounded-xl font-bold">Launch Hall</button></GlassCard><GlassCard className="p-8 space-y-4"><h3 className="text-lg font-bold">Join Room</h3><input type="text" placeholder="Invite Code..." className="w-full bg-black/40 border border-white/10 rounded-xl p-4 uppercase font-mono tracking-widest text-center" value={joinRoomCode} onChange={e => setJoinRoomCode(e.target.value.toUpperCase())} maxLength={6} /><button onClick={handleJoinRoom} className="w-full bg-green-600 py-4 rounded-xl font-bold">Connect</button></GlassCard></div>
                      <div className="lg:col-span-8 space-y-8"><h2 className="text-xl font-bold flex items-center gap-3 text-yellow-500"><History size={20}/> Auction Archive</h2>{archive.length === 0 ? <GlassCard className="p-20 text-center opacity-40 italic">No historical records yet.</GlassCard> : <div className="grid grid-cols-1 md:grid-cols-2 gap-6">{archive.map((item) => {
                          // Handle backward compatibility or display first team logo/name
                          const displayTeam = item.teams?.[0] || (item as any).myTeam;
                          return (
                          <GlassCard key={item.roomId} className="p-6 group cursor-pointer hover:border-blue-500/50 hover:scale-[1.02]" onClick={() => { setSelectedArchive(item); setView('ARCHIVE_DETAIL'); }}>
                            <div className="flex justify-between items-start mb-6">
                                <div className="w-16 h-16 rounded-2xl bg-black border border-white/10 overflow-hidden flex items-center justify-center p-2 shadow-lg" style={{ borderColor: displayTeam?.color || '#333' }}>
                                    {displayTeam?.logoUrl ? <img src={displayTeam.logoUrl} className="w-full h-full object-contain" /> : <div className="text-white font-bold">{displayTeam?.name?.[0] || "A"}</div>}
                                </div>
                                <div className="text-right"><span className="text-[10px] text-gray-500 font-bold uppercase">{new Date(item.completedAt).toLocaleDateString()}</span><div className="flex items-center gap-2 text-blue-400 mt-1 font-bold text-xs">Full Replay <ChevronLeft className="rotate-180" size={14}/></div></div>
                            </div>
                            <h4 className="text-2xl font-bold mb-1 truncate">{item.roomName}</h4>
                            <p className="text-xs text-gray-500 uppercase tracking-wider">{item.teams?.length || 1} Teams Participating</p>
                          </GlassCard>
                      )})}</div>}</div>
                  </div>
              </div>
          </BackgroundWrapper>
      );
  }

  if (view === 'ARCHIVE_DETAIL' && selectedArchive) {
      // Handle backward compatibility where old archives might only have 'myTeam'
      const teamsToDisplay = selectedArchive.teams || ((selectedArchive as any).myTeam ? [(selectedArchive as any).myTeam] : []);
      
      return (
          <BackgroundWrapper>
            <div className="max-w-7xl mx-auto p-8 lg:p-12 w-full h-full overflow-y-auto">
                <button onClick={() => setView('HOME')} className="mb-10 text-gray-500 hover:text-white flex items-center gap-2 font-bold uppercase text-xs transition-colors"><ChevronLeft size={16}/> Back to Dashboard</button>
                <div className="flex flex-col items-center mb-10 text-center shrink-0">
                    <Trophy size={60} className="text-yellow-500 mb-4" fill="currentColor"/>
                    <h1 className="text-4xl font-display font-bold text-white mb-2 uppercase tracking-tight">{selectedArchive.roomName}</h1>
                    <p className="text-gray-500 text-sm font-medium uppercase tracking-widest">Auction Completed on {new Date(selectedArchive.completedAt).toLocaleDateString()}</p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 w-full">
                    {teamsToDisplay.map(t => {
                         const roleCounts = t.roster.reduce((acc, p) => {
                            acc[p.position] = (acc[p.position] || 0) + 1;
                            return acc;
                        }, {} as Record<string, number>);
                        
                        return (
                            <GlassCard key={t.id} className="p-8 flex flex-col h-full border-white/10 hover:border-blue-500/30">
                                <div className="flex items-center gap-5 mb-6 border-b border-white/5 pb-6">
                                    <div className="w-20 h-20 rounded-2xl bg-black border-4 flex items-center justify-center p-3 shadow-2xl shrink-0" style={{ borderColor: t.color }}>{t.logoUrl ? <img src={t.logoUrl} className="w-full h-full object-contain" /> : <div className="text-2xl font-bold">{t.name[0]}</div>}</div>
                                    <div className="overflow-hidden"><h3 className="text-2xl font-bold text-white truncate">{t.name}</h3><p className="text-gray-500 text-xs font-bold uppercase tracking-widest truncate">{t.ownerName}</p></div>
                                </div>
                                
                                <div className="grid grid-cols-4 gap-2 mb-6">
                                    {['Batter', 'Bowler', 'All Rounder', 'Wicket Keeper'].map(role => (
                                        <div key={role} className="bg-black/40 rounded-lg p-2 text-center border border-white/5">
                                            <div className="text-[9px] text-gray-500 uppercase font-bold tracking-wider mb-1">{role === 'Wicket Keeper' ? 'WK' : role === 'All Rounder' ? 'AR' : role}</div>
                                            <div className="text-lg font-bold text-white leading-none">{roleCounts[role as Position] || 0}</div>
                                        </div>
                                    ))}
                                </div>

                                <div className="flex-1 space-y-3 mb-8 overflow-y-auto custom-scrollbar max-h-[300px] pr-2">
                                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-[0.2em] mb-4">Acquired Squad ({t.roster.length})</p>
                                    {t.roster.length === 0 ? <p className="text-xs italic text-gray-700 py-4">No acquisitions.</p> : (
                                        <div className="space-y-2">
                                            {t.roster.map(p => (
                                                <div key={p.id} className="flex justify-between items-center text-[11px] bg-white/5 p-3 rounded-xl border border-white/5 group hover:bg-white/10 transition-colors">
                                                    <div className="flex flex-col min-w-0 pr-2">
                                                        <span className="font-bold text-white truncate">{p.name}</span>
                                                        <span className="text-[9px] text-gray-500 uppercase tracking-wider">{p.position}</span>
                                                    </div>
                                                    <span className="font-mono text-yellow-500 font-bold whitespace-nowrap">{p.soldPrice} L</span>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                                <div className="mt-auto border-t border-white/10 pt-6 flex justify-between items-end">
                                    <div><span className="text-[9px] text-gray-500 font-bold uppercase block mb-1">Total Spent</span><span className="text-xl font-display font-bold text-red-500">{t.roster.reduce((sum, p) => sum + (p.soldPrice || 0), 0)} L</span></div>
                                    <div className="text-right"><span className="text-[9px] text-gray-500 font-bold uppercase block mb-1">Purse Left</span><span className="text-xl font-display font-bold text-green-500">{t.budget} L</span></div>
                                </div>
                            </GlassCard>
                        );
                    })}
                </div>
            </div>
          </BackgroundWrapper>
      );
  }

  if (view === 'LOBBY' || view === 'GAME' || view === 'COMPLETED') {
    return (
      <BackgroundWrapper>
        {view === 'LOBBY' && (
          <div className="max-w-6xl mx-auto p-12 animate-fade-in w-full h-full overflow-y-auto">
            <GlassCard className="p-10 mb-10 flex flex-col md:flex-row justify-between items-center gap-6">
                <div>
                  <h2 className="text-4xl font-display font-bold text-white mb-2">{room?.name}</h2>
                  <div className="flex items-center gap-3">
                    <span className="bg-yellow-500/20 text-yellow-500 border border-yellow-500/50 px-4 py-1 rounded-full font-bold text-xs uppercase tracking-widest">Lobby</span>
                    {isHost && (<button onClick={() => setShowSettings(true)} className="flex items-center gap-2 text-xs font-bold text-gray-400 hover:text-white transition-colors ml-4"><Settings size={14}/> Room Config</button>)}
                  </div>
                </div>
                <div className="flex items-center gap-6"><div className="bg-black/40 border border-white/10 px-6 py-3 rounded-2xl cursor-pointer hover:bg-black/60 transition-colors" onClick={() => { navigator.clipboard.writeText(room?.id || ""); alert("Code copied!"); }}><span className="text-[10px] text-gray-500 font-bold uppercase block mb-1">Invite Code</span><div className="flex items-center gap-2"><span className="text-2xl font-mono font-bold text-blue-400">{room?.id}</span><Copy size={16} className="text-gray-600"/></div></div>{isHost && (<button onClick={handleStartGame} className="bg-green-600 hover:bg-green-500 px-10 py-5 rounded-2xl font-bold shadow-xl transition-all scale-105 active:scale-95">START AUCTION</button>)}</div>
            </GlassCard>
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-10">
                <div className="lg:col-span-5"><GlassCard className="p-8"><h3 className="text-xl font-bold mb-8 flex items-center gap-3 text-blue-500"><Plus size={24}/> Franchise Setup</h3>
                {!myTeam || isEditingTeam ? (<div className="space-y-8 animate-fade-in">
                    <div className="flex justify-between items-center mb-2">
                        <span className="text-xs font-bold uppercase text-gray-500">{isEditingTeam ? 'Editing Details' : 'New Registration'}</span>
                        {isEditingTeam && <button onClick={() => setIsEditingTeam(false)} className="text-[10px] text-red-400 uppercase font-bold hover:underline">Cancel</button>}
                    </div>
                    <input type="text" placeholder="Franchise Name..." className="w-full bg-black/40 border border-white/10 rounded-2xl p-5 text-lg font-medium" value={newTeamName} onChange={e => setNewTeamName(e.target.value)} /><div className="space-y-4"><label className="text-xs text-gray-400 font-bold uppercase tracking-widest flex items-center gap-2"><Palette size={14}/> Identity Colors</label><div className="flex flex-wrap gap-3 p-4 bg-black/20 rounded-2xl border border-white/5">{TEAM_COLORS.map(c => (<button key={c} onClick={() => setNewTeamColor(c)} className={`w-10 h-10 rounded-full border-4 transition-all ${newTeamColor === c ? 'border-white scale-110 shadow-xl' : 'border-transparent hover:scale-105'}`} style={{ backgroundColor: c }} />))}</div></div><div className="space-y-4 p-6 bg-black/30 rounded-3xl border border-white/10"><div className="flex justify-between items-center mb-4"><label className="text-xs text-gray-400 font-bold uppercase tracking-widest flex items-center gap-2"><ImageIcon size={14}/> AI Branding</label><button onClick={handleGenerateLogos} disabled={isGeneratingLogos || !newTeamName} className="text-[10px] font-bold text-yellow-500 hover:text-yellow-400 flex items-center gap-2 bg-yellow-500/10 px-4 py-2 rounded-full transition-all disabled:opacity-30">{isGeneratingLogos ? <Loader2 size={12} className="animate-spin" /> : <Zap size={12}/>} Generate Logos</button></div>{isGeneratingLogos ? (<div className="flex flex-col items-center justify-center py-10 gap-4"><Loader2 size={32} className="animate-spin text-yellow-500" /><p className="text-xs text-gray-500 animate-pulse font-medium">Drafting visual identity...</p></div>) : logoOptions.length > 0 ? (<div className="grid grid-cols-2 gap-4">{logoOptions.map((logo, idx) => (<div key={idx} onClick={() => setSelectedLogoUrl(logo)} className={`aspect-square rounded-2xl bg-black border-4 transition-all cursor-pointer overflow-hidden p-2 flex items-center justify-center ${selectedLogoUrl === logo ? 'border-yellow-500 shadow-xl scale-105' : 'border-white/5 hover:border-white/20'}`}><img src={logo} className="w-full h-full object-contain" /></div>))}</div>) : (<div className="py-10 text-center border-2 border-dashed border-white/5 rounded-2xl"><p className="text-xs text-gray-600 px-6">Provide a name to generate logo concepts</p></div>)}</div><button onClick={handleCreateOrUpdateTeam} disabled={!newTeamName || isLoading} className="w-full bg-blue-600 hover:bg-blue-500 text-white py-5 rounded-2xl font-bold shadow-xl transition-all disabled:opacity-50">{isEditingTeam ? 'UPDATE FRANCHISE' : 'FINALIZE FRANCHISE'}</button></div>) 
                : (<div className="text-center py-10 group relative">
                    <div className="absolute top-0 right-0">
                       <button onClick={startEditingTeam} className="p-2 text-gray-500 hover:text-white transition-colors bg-white/5 rounded-lg border border-white/5 hover:bg-white/10" title="Edit Franchise"><Edit3 size={16}/></button>
                    </div>
                    <div className="w-40 h-40 rounded-[2.5rem] bg-black border-4 mx-auto mb-6 flex items-center justify-center p-4 shadow-2xl transition-transform hover:scale-105" style={{ borderColor: myTeam.color }}>{myTeam.logoUrl ? <img src={myTeam.logoUrl} className="w-full h-full object-contain" /> : <div className="text-4xl font-bold text-white/10">{myTeam.name[0]}</div>}</div><h4 className="text-3xl font-display font-bold text-white mb-1">{myTeam.name}</h4><p className="text-blue-400 font-medium">Owner: {profile?.name}</p><span className="mt-8 inline-block text-[10px] font-bold text-green-500 bg-green-500/10 px-4 py-2 rounded-full uppercase tracking-widest border border-green-500/20">Franchise Locked</span></div>)}</GlassCard></div>
                <div className="lg:col-span-7 flex flex-col gap-8"><GlassCard className="flex flex-col h-full overflow-hidden"><div className="flex bg-white/5 border-b border-white/10"><button onClick={() => setLobbyView('TEAMS')} className={`flex-1 py-4 text-xs font-bold uppercase tracking-widest flex items-center justify-center gap-2 transition-all ${lobbyView === 'TEAMS' ? 'text-blue-400 border-b-2 border-blue-400 bg-white/5' : 'text-gray-500 hover:text-gray-300'}`}><Users size={16}/> Registered Teams</button><button onClick={() => setLobbyView('PLAYERS')} className={`flex-1 py-4 text-xs font-bold uppercase tracking-widest flex items-center justify-center gap-2 transition-all ${lobbyView === 'PLAYERS' ? 'text-pink-400 border-b-2 border-pink-400 bg-white/5' : 'text-gray-500 hover:text-gray-300'}`}><Search size={16}/> Player Browser</button></div><div className="p-8 flex-1 overflow-y-auto custom-scrollbar min-h-[500px]">{lobbyView === 'TEAMS' ? (<div className="animate-fade-in grid grid-cols-1 sm:grid-cols-2 gap-4">{room?.teams.map(t => (<div key={t.id} className="bg-white/5 p-4 rounded-2xl border border-white/5 flex items-center gap-4 hover:bg-white/10 transition-all group"><div className="w-14 h-14 rounded-xl bg-black border border-white/10 flex items-center justify-center p-2 shadow-lg" style={{ borderColor: t.color }}>{t.logoUrl ? <img src={t.logoUrl} className="w-full h-full object-contain" /> : <div className="text-white font-bold">{t.name[0]}</div>}</div><div><p className="font-bold text-white group-hover:text-blue-400 transition-colors">{t.name}</p><p className="text-xs text-gray-500">{t.ownerName}</p></div></div>))}</div>) : (<div className="animate-fade-in space-y-6">
                  <div className="flex flex-col gap-4">
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                        <div className="relative"><Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500"/><input type="text" placeholder="Search Players..." className="w-full bg-black/40 border border-white/10 rounded-xl py-3 pl-10 pr-4 text-xs focus:outline-none" value={lobbySearch} onChange={e => setLobbySearch(e.target.value)}/></div>
                        <div className="relative"><Filter size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500"/><select className="w-full bg-black/40 border border-white/10 rounded-xl py-3 pl-10 pr-4 text-xs appearance-none focus:outline-none" value={lobbyFilterPot} onChange={e => setLobbyFilterPot(e.target.value as any)}><option value="ALL">All Pots</option><option value="A">Pot A</option><option value="B">Pot B</option><option value="C">Pot C</option><option value="D">Pot D</option></select></div>
                        <div className="relative"><Users size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500"/><select className="w-full bg-black/40 border border-white/10 rounded-xl py-3 pl-10 pr-4 text-xs appearance-none focus:outline-none" value={lobbyFilterRole} onChange={e => setLobbyFilterRole(e.target.value as any)}><option value="ALL">All Roles</option><option value="Batter">Batter</option><option value="Bowler">Bowler</option><option value="All Rounder">All Rounder</option><option value="Wicket Keeper">Wicket Keeper</option></select></div>
                    </div>
                    <button onClick={() => { setLobbySearch(""); setLobbyFilterPot("ALL"); setLobbyFilterRole("ALL"); }} className="flex items-center gap-2 text-[10px] font-bold text-gray-500 hover:text-white transition-all uppercase tracking-widest self-end mr-2"><RefreshCcw size={12}/> Reset Browser</button>
                  </div>
                  <div className="space-y-3">{getFilteredLobbyPlayers().map(p => (<div key={p.id} className="bg-white/5 border border-white/5 rounded-2xl p-4 flex flex-col gap-3 hover:border-white/10 transition-all group"><div className="flex justify-between items-center"><div className="flex items-center gap-4"><div className="w-10 h-10 bg-gray-800 rounded-full border border-white/10 overflow-hidden flex items-center justify-center relative">{p.imageUrl && (<img src={p.imageUrl} className="w-full h-full object-cover absolute inset-0 z-10" loading="lazy" onError={(e) => e.currentTarget.style.display = 'none'} />)}<User className="text-gray-600 relative z-0" size={20}/></div><div><h4 className="font-bold text-white text-sm flex items-center gap-2">{p.name} {p.status !== 'PENDING' && <span className={`text-[8px] px-1.5 py-0.5 rounded ${p.status === 'SOLD' ? 'bg-green-500/20 text-green-500' : 'bg-red-500/20 text-red-500'}`}>{p.status}</span>}</h4><div className="flex items-center gap-2"><span className="text-[9px] text-gray-500 uppercase font-bold tracking-widest">{p.position}</span><span className="text-[9px] text-yellow-500 font-bold">Pot {p.pot || 'N/A'}</span></div></div></div><div className="flex items-center gap-3"><span className="text-xs font-mono font-bold text-white">{p.basePrice || 0} L</span><button onClick={() => toggleWatchlist(p.id)} className={`p-2 rounded-lg transition-all ${watchlist.includes(p.id) ? 'text-pink-500' : 'text-gray-500 hover:text-pink-400'}`}><Star size={16} fill={watchlist.includes(p.id) ? "currentColor" : "none"}/></button><button onClick={() => { setEditingNotePlayerId(p.id); setTempNoteValue(privateNotes[p.id] || ""); }} className={`p-2 rounded-lg transition-all ${privateNotes[p.id] ? 'text-yellow-500' : 'text-gray-500 hover:text-white'}`}><FileText size={16}/></button></div></div>{editingNotePlayerId === p.id && (<div className="bg-black/40 p-3 rounded-xl border border-white/10"><textarea autoFocus value={tempNoteValue} onChange={e => setTempNoteValue(e.target.value)} className="w-full bg-transparent text-xs text-white focus:outline-none min-h-[50px]" placeholder="Add your private notes..." /><div className="flex justify-end gap-3 mt-2"><button onClick={() => setEditingNotePlayerId(null)} className="text-[9px] font-bold text-gray-500 uppercase">Cancel</button><button onClick={() => savePrivateNote(p.id)} className="bg-yellow-600 text-white px-3 py-1 rounded-lg text-[9px] font-bold">Save Note</button></div></div>)}</div>))}</div></div>)}</div></GlassCard></div>
            </div>
          </div>
        )}

        {view === 'GAME' && room && (
            <div className="flex-1 flex h-full overflow-hidden animate-fade-in">
                {/* Widened Sidebar */}
                <div className="w-[440px] bg-black/40 border-r border-white/10 flex flex-col backdrop-blur-3xl z-30 shrink-0 h-full">
                    <div className="p-6 border-b border-white/10 flex justify-between items-center">
                        <div>
                            <h2 className="text-2xl font-display font-bold text-yellow-500 tracking-wider">AUCTION HUB</h2>
                            <div className="flex items-center gap-2 mt-2">
                                <span className={`w-2 h-2 rounded-full ${room.gameState.isPaused ? 'bg-red-500' : 'bg-green-500 animate-pulse'}`}></span>
                                <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">{room.gameState.isPaused ? 'Paused' : 'Active Session'}</span>
                            </div>
                        </div>
                        {isHost && (
                            <div className="flex gap-2">
                                <button onClick={togglePause} className="p-3 bg-white/5 hover:bg-white/10 rounded-xl transition-all">
                                    {room.gameState.isPaused ? <Play size={18} /> : <Pause size={18} />}
                                </button>
                                <button onClick={(e) => { e.stopPropagation(); setShowEndConfirm(true); }} className="p-3 bg-red-600/10 hover:bg-red-600/20 text-red-500 rounded-xl transition-all">
                                    <StopCircle size={18} />
                                </button>
                            </div>
                        )}
                    </div>

                    <div className="flex bg-white/5 border-b border-white/5">
                        <button onClick={() => setSidebarTab('WATCHLIST')} className={`flex-1 py-4 text-[10px] font-bold uppercase tracking-widest flex items-center justify-center gap-2 transition-all ${sidebarTab === 'WATCHLIST' ? 'text-pink-400 border-b-2 border-pink-400 bg-white/5' : 'text-gray-500 hover:text-gray-300'}`}><Star size={12}/> My Watchlist</button>
                        <button onClick={() => setSidebarTab('LOGS')} className={`flex-1 py-4 text-[10px] font-bold uppercase tracking-widest flex items-center justify-center gap-2 transition-all ${sidebarTab === 'LOGS' ? 'text-blue-400 border-b-2 border-blue-400 bg-white/5' : 'text-gray-500 hover:text-gray-300'}`}><List size={12}/> Activity Logs</button>
                    </div>

                    <div className="flex-1 overflow-y-auto p-4 custom-scrollbar min-h-0">
                        {sidebarTab === 'WATCHLIST' ? (
                            <div className="space-y-3">
                                {watchlist.length === 0 ? (
                                    <div className="text-center py-20 opacity-30 text-[10px] uppercase font-bold tracking-widest leading-relaxed">Star players in the Lobby<br/>to track them here privately</div>
                                ) : room.players.filter(p => watchlist.includes(p.id)).map(p => {
                                  const hasNote = !!privateNotes[p.id];
                                  const isCurrentlyOnBlock = room.gameState.currentPlayerId === p.id;
                                  return (
                                    <div key={p.id} className={`p-4 rounded-2xl border transition-all ${isCurrentlyOnBlock ? 'bg-pink-600/20 border-pink-500 ring-2 ring-pink-500/50' : 'bg-white/5 border-white/10'}`}>
                                        <div className="flex justify-between items-center mb-1">
                                          <div>
                                              <p className="text-xs font-bold text-white flex items-center gap-2">
                                                {p.name}
                                                {isCurrentlyOnBlock && <span className="inline-block w-2 h-2 rounded-full bg-green-500 animate-ping" />}
                                              </p>
                                              <p className="text-[9px] text-gray-500 uppercase tracking-wider">{p.position} • {p.basePrice || 0} L Base</p>
                                          </div>
                                          <div className="flex items-center gap-2">
                                              <span className={`text-[8px] font-bold px-1.5 py-0.5 rounded ${p.status === 'SOLD' ? 'bg-green-500/20 text-green-400' : p.status === 'UNSOLD' ? 'bg-red-500/20 text-red-400' : 'bg-blue-500/20 text-blue-400'}`}>{p.status}</span>
                                              <button onClick={() => { setEditingNotePlayerId(p.id); setTempNoteValue(privateNotes[p.id] || ""); }} className={`p-1 rounded-md transition-all ${hasNote ? 'text-yellow-500' : 'text-gray-600 hover:text-gray-400'}`}><FileText size={14}/></button>
                                          </div>
                                        </div>
                                        {editingNotePlayerId === p.id && (
                                            <div className="bg-black/40 p-2 rounded-lg border border-white/10 animate-fade-in mt-2"><textarea autoFocus value={tempNoteValue} onChange={e => setTempNoteValue(e.target.value)} className="w-full bg-transparent text-[10px] text-white focus:outline-none min-h-[40px]" placeholder="Personal notes..." /><div className="flex justify-end gap-2 mt-1"><button onClick={() => setEditingNotePlayerId(null)} className="text-[8px] font-bold text-gray-500 uppercase">Cancel</button><button onClick={() => savePrivateNote(p.id)} className="bg-yellow-600 text-white px-2 py-0.5 rounded text-[8px] font-bold">Save</button></div></div>
                                        )}
                                        {hasNote && editingNotePlayerId !== p.id && <p className="text-[9px] text-yellow-500/60 italic border-t border-white/5 pt-2 mt-2 leading-relaxed">{privateNotes[p.id]}</p>}
                                    </div>
                                  );
                                })}
                            </div>
                        ) : (
                             <div className="space-y-3">
                                 {room.gameState.logs.map(log => {
                                     const isAI = log.type === 'AI';
                                     const isSystem = log.type === 'SYSTEM';
                                     return (
                                     <div key={log.id} className={`p-3 rounded-2xl border transition-colors flex flex-col gap-1 w-full box-border ${isAI ? 'bg-purple-900/20 border-purple-500/30 shadow-[0_0_15px_rgba(168,85,247,0.1)]' : isSystem ? 'bg-white/10 border-white/10' : 'bg-white/5 border-white/5'}`}>
                                         <div className="flex items-start gap-3 w-full">
                                            <div className={`mt-1.5 w-1.5 h-1.5 rounded-full shrink-0 ${
                                                log.type === 'BID' ? 'bg-blue-500' : 
                                                log.type === 'SOLD' ? 'bg-green-500' : 
                                                log.type === 'UNSOLD' ? 'bg-red-500' : 
                                                log.type === 'AI' ? 'bg-purple-400' : 'bg-gray-500'
                                            }`} />
                                            <div className="flex-1">
                                                {isAI && <span className="text-[8px] font-bold text-purple-400 uppercase tracking-wider mb-0.5 block flex items-center gap-1"><Sparkles size={8}/> Commentary</span>}
                                                <p className={`leading-snug break-words w-full ${isAI ? 'text-purple-100 italic font-medium text-xs' : 'text-[11px] text-gray-300'}`}>{log.message}</p>
                                            </div>
                                         </div>
                                         <span className="text-[9px] text-gray-600 pl-4 block">{new Date(log.timestamp).toLocaleTimeString()}</span>
                                     </div>
                                 )})}
                            </div>
                        )}
                    </div>
                </div>

                {/* Main Arena */}
                <div className="flex-1 flex flex-col relative overflow-hidden bg-[#0a0a0a] min-w-0">
                    <div className="h-20 bg-black/40 border-b border-white/10 px-8 flex items-center justify-between z-10 backdrop-blur-md shrink-0">
                        <div className="flex items-center gap-12">
                          <div><span className="text-[10px] text-gray-500 font-bold uppercase block mb-0.5 tracking-widest">Pot {room.gameState.currentPot}</span><span className="text-xl font-display font-bold text-blue-400">{room.players.filter(p => p.status === 'PENDING').length} Remaining</span></div>
                          <div className="flex items-center gap-10 border-l border-white/10 pl-10">
                             <div className="flex items-center gap-3"><Activity size={18} className="text-green-500"/><div className="flex flex-col"><span className="text-[10px] text-gray-500 font-bold uppercase leading-none">Sold</span><span className="text-sm font-bold text-white">{soldCount}</span></div></div>
                             {highestBidPlayer && (
                                <div className="flex items-center gap-3"><TrendingUp size={18} className="text-yellow-500"/><div className="flex flex-col"><span className="text-[10px] text-gray-500 font-bold uppercase leading-none">Record Bid</span><span className="text-sm font-bold text-white truncate max-w-[150px]">{highestBidPlayer.name} ({highestBidPlayer.soldPrice}L)</span></div></div>
                             )}
                          </div>
                        </div>
                        {room.gameState.aiCommentary && <div className="hidden lg:flex bg-purple-500/10 border border-purple-500/20 px-6 py-2 rounded-full max-sm shadow-inner shrink-0"><Sparkles size={16} className="text-purple-400 mr-3 shrink-0 mt-0.5"/><p className="text-[10px] italic text-purple-200 line-clamp-2 leading-relaxed">"{room.gameState.aiCommentary}"</p></div>}
                    </div>

                    <div className="flex-1 p-6 flex items-center justify-center relative overflow-hidden">
                        {room.gameState.currentPlayerId ? (
                            <div className="max-w-4xl w-full grid grid-cols-1 lg:grid-cols-12 gap-8 z-10 h-full max-h-[480px]">
                                <div className="lg:col-span-5 flex flex-col h-full shrink-0">
                                    <GlassCard className="flex-1 flex flex-col overflow-hidden relative border-white/20 shadow-2xl max-h-[440px]">
                                        <div className="w-full h-full bg-gray-900 flex items-center justify-center relative">
                                            <User size={80} className="text-white/10 absolute z-0"/>
                                            {room.players.find(p => p.id === room.gameState.currentPlayerId)?.imageUrl && (
                                                <img 
                                                    src={room.players.find(p => p.id === room.gameState.currentPlayerId)?.imageUrl} 
                                                    className="w-full h-full object-contain bg-gradient-to-b from-gray-800 to-black relative z-10" 
                                                    onError={(e) => e.currentTarget.style.display = 'none'} 
                                                />
                                            )}
                                        </div>
                                        <div className="absolute bottom-0 w-full p-5 bg-gradient-to-t from-black to-transparent pt-12 z-20">
                                            <h2 className="text-2xl font-display font-bold text-white mb-0.5 drop-shadow-xl">{room.players.find(p => p.id === room.gameState.currentPlayerId)?.name}</h2>
                                            <div className="flex items-center gap-2">
                                                <p className="text-xs text-blue-400 font-bold tracking-widest uppercase">{room.players.find(p => p.id === room.gameState.currentPlayerId)?.position}</p>
                                                <span className="text-[9px] bg-yellow-500/20 text-yellow-500 px-2 rounded font-bold uppercase">POT {room.players.find(p => p.id === room.gameState.currentPlayerId)?.pot}</span>
                                            </div>
                                        </div>
                                    </GlassCard>
                                </div>
                                
                                <div className="lg:col-span-7 flex flex-col gap-6 overflow-hidden justify-center">
                                    <GlassCard className="flex-1 flex flex-col items-center justify-center p-6 relative shadow-2xl overflow-hidden max-h-[380px]">
                                        <div className="w-full max-w-sm bg-black/40 rounded-3xl p-5 border border-white/10 shadow-inner">
                                            <p className="text-[8px] text-gray-500 font-bold uppercase tracking-[0.3em] mb-3 text-center">Top Contender</p>
                                            {room.gameState.currentBid ? (
                                                <div className="text-center animate-fade-in">
                                                    <div className="text-4xl font-display font-bold text-white mb-1">{room.gameState.currentBid.amount} <span className="text-lg text-gray-500">L</span></div>
                                                    <div className="inline-block px-4 py-1.5 rounded-full font-bold text-white text-[9px] tracking-widest shadow-lg uppercase" style={{ backgroundColor: room.teams.find(t => t.id === room.gameState.currentBid?.teamId)?.color }}>{room.teams.find(t => t.id === room.gameState.currentBid?.teamId)?.name}</div>
                                                </div>
                                            ) : (
                                                <div className="text-center py-4 border border-dashed border-white/10 rounded-2xl italic text-gray-600 text-xs">Waiting for opening bid... (Base: {room.players.find(p => p.id === room.gameState.currentPlayerId)?.basePrice || 0}L)</div>
                                            )}
                                        </div>

                                        {isHost && (
                                            <div className="mt-6 grid grid-cols-2 gap-3 w-full max-w-sm">
                                                <button onClick={handleSold} disabled={!room.gameState.currentBid || isActionLoading} className="bg-green-600 hover:bg-green-500 text-white py-3.5 rounded-2xl font-bold flex items-center justify-center gap-2 shadow-lg disabled:opacity-30 transition-all active:scale-95 uppercase tracking-widest text-[10px]">
                                                  {isActionLoading ? <Loader2 size={14} className="animate-spin" /> : <UserCheck size={14} />}
                                                  {isActionLoading ? '...' : 'SOLD'}
                                                </button>
                                                <button onClick={handleUnsold} disabled={isActionLoading} className="bg-red-600 hover:bg-red-500 text-white py-3.5 rounded-2xl font-bold flex items-center justify-center gap-2 shadow-lg transition-all active:scale-95 disabled:opacity-30 uppercase tracking-widest text-[10px]">
                                                  {isActionLoading ? <Loader2 size={14} className="animate-spin" /> : <UserMinus size={14} />}
                                                  {isActionLoading ? '...' : 'UNSOLD'}
                                                </button>
                                            </div>
                                        )}
                                    </GlassCard>
                                    {playerInsights ? (
                                        <GlassCard className="p-4 bg-blue-500/10 border-blue-500/20 shadow-lg shrink-0 flex flex-col gap-2 h-auto max-h-[150px]">
                                            <h4 className="text-[8px] font-bold text-blue-400 uppercase tracking-widest flex items-center gap-2 mb-1 shrink-0"><Sparkles size={10}/> Analytics</h4>
                                            <div className="overflow-y-auto custom-scrollbar text-[11px] text-blue-100 leading-relaxed space-y-1">
                                                {playerInsights.split('\n').map((line, i) => <p key={i}>{line}</p>)}
                                            </div>
                                        </GlassCard>
                                    ) : (
                                        <button onClick={handleGetInsights} disabled={isInsightsLoading} className="bg-white/5 hover:bg-white/10 py-2.5 rounded-xl text-[9px] font-bold uppercase tracking-widest text-gray-500 border border-white/5 transition-all shadow-inner shrink-0">
                                            {isInsightsLoading ? <Loader2 size={12} className="animate-spin mx-auto"/> : 'Query Scout Intel'}
                                        </button>
                                    )}
                                </div>
                            </div>
                        ) : (
                            <div className="text-center opacity-20 animate-pulse"><Gavel size={60} className="mx-auto mb-4 text-white"/><h3 className="text-xl font-display font-bold uppercase tracking-widest">Awaiting Player Draw</h3></div>
                        )}
                    </div>

                    <div className="h-44 bg-black/80 border-t border-white/10 backdrop-blur-3xl px-8 flex items-center gap-6 overflow-x-auto flex-nowrap scroll-smooth custom-scrollbar shrink-0">
                        {room.teams.map(t => {
                            const isWinning = room.gameState.currentBid?.teamId === t.id;
                            const isMyTeam = t.controlledByUserId === profile?.id;
                            const currentAmt = room.gameState.currentBid?.amount || 0;
                            const player = room.players.find(p => p.id === room.gameState.currentPlayerId);
                            const baseAmt = player?.basePrice || 0;
                            
                            const nextBid10 = Math.max(baseAmt, currentAmt + 10);
                            const nextBid20 = Math.max(baseAmt + 10, currentAmt + 20);
                            
                            const isSquadFull = t.roster.length >= room.config.maxPlayers;
                            const slotsLeft = room.config.maxPlayers - t.roster.length;
                            // Warning if avg budget per remaining slot is less than 25L (tight budget)
                            const isLowBudget = slotsLeft > 0 && (t.budget < slotsLeft * 25);

                            return (
                                <div key={t.id} onClick={() => setViewTeamRoster(t)} className={`shrink-0 w-72 p-4 rounded-2xl border transition-all duration-300 cursor-pointer ${isWinning ? 'bg-green-500/10 border-green-500 shadow-[0_0_20px_rgba(34,197,94,0.1)]' : 'bg-white/5 border-white/10 hover:border-white/20'} ${isMyTeam ? 'ring-2 ring-blue-500 ring-offset-4 ring-offset-black' : ''} relative`}>
                                    {isMyTeam && isLowBudget && (
                                        <div className="absolute top-2 right-2 text-yellow-500 bg-yellow-500/10 p-1.5 rounded-lg border border-yellow-500/30 animate-pulse" title="Low Budget Warning: You might run out of funds to fill your squad!">
                                            <AlertTriangle size={14} />
                                        </div>
                                    )}
                                    <div className="flex items-center gap-3 mb-4">
                                        <div className="w-10 h-10 rounded-xl bg-black border-2 flex items-center justify-center p-1 shadow-inner overflow-hidden shrink-0" style={{ borderColor: t.color }}>
                                            {t.logoUrl ? <img src={t.logoUrl} className="w-full h-full object-contain" /> : <div className="text-xs font-bold">{t.name[0]}</div>}
                                        </div>
                                        <div className="flex-1 overflow-hidden">
                                            <p className="text-[11px] font-bold text-white truncate uppercase tracking-tight">{t.name}</p>
                                            <div className="flex justify-between items-center">
                                                <span className={`text-[9px] font-mono font-bold ${isLowBudget ? 'text-red-400' : 'text-yellow-500'}`}>{t.budget} L LEFT</span>
                                                <span className={`text-[8px] px-1.5 rounded font-bold uppercase tracking-widest ${isSquadFull ? 'bg-green-500/20 text-green-400' : 'bg-blue-500/20 text-blue-400'}`}>{t.roster.length}/{room.config.maxPlayers} SQUAD</span>
                                            </div>
                                        </div>
                                    </div>
                                    {isMyTeam && room.gameState.currentPlayerId && !room.gameState.isPaused && !isWinning ? (
                                        isSquadFull ? (
                                            <div className="w-full bg-red-500/10 py-2.5 rounded-xl text-[10px] font-bold text-red-500 text-center uppercase tracking-widest border border-red-500/20">Squad Limit Reached</div>
                                        ) : (
                                            <div className="grid grid-cols-2 gap-2 animate-fade-in" onClick={e => e.stopPropagation()}>
                                              <button onClick={() => placeBid(t.id, nextBid10)} disabled={t.budget < nextBid10} className="bg-blue-600 hover:bg-blue-500 py-2 rounded-xl text-[9px] font-bold text-white shadow-xl disabled:opacity-50 active:scale-95 transition-all">+{nextBid10 - currentAmt}L (Bid {nextBid10}L)</button>
                                              <button onClick={() => placeBid(t.id, nextBid20)} disabled={t.budget < nextBid20} className="bg-blue-600 hover:bg-blue-500 py-2 rounded-xl text-[9px] font-bold text-white shadow-xl disabled:opacity-50 active:scale-95 transition-all">+{nextBid20 - currentAmt}L (Bid {nextBid20}L)</button>
                                            </div>
                                        )
                                    ) : isWinning ? (
                                        <div className="w-full bg-green-500 py-2.5 rounded-xl text-[10px] font-bold text-black text-center animate-pulse uppercase tracking-widest shadow-lg">Leading Bid</div>
                                    ) : (
                                        <div className="w-full bg-white/5 py-2.5 rounded-xl text-[10px] font-bold text-gray-600 text-center uppercase tracking-widest border border-white/5">Spectating</div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>
        )}

        {view === 'COMPLETED' && room && (
          <div className="max-w-7xl mx-auto p-12 animate-fade-in w-full h-full overflow-y-auto">
             <div className="flex flex-col items-center mb-12 text-center">
                 <div className="w-20 h-20 bg-yellow-500/10 rounded-full flex items-center justify-center mb-6 border border-yellow-500/20 shadow-[0_0_30px_rgba(234,179,8,0.2)]">
                    <Trophy size={40} className="text-yellow-500" fill="currentColor"/>
                 </div>
                 <h2 className="text-5xl font-display font-bold text-white mb-4">Auction Concluded</h2>
                 <p className="text-gray-400 text-lg max-w-2xl">The hammer has fallen for the final time. All rosters are locked and finances settled.</p>
                 <button onClick={() => setView('HOME')} className="mt-8 bg-blue-600 hover:bg-blue-500 text-white px-8 py-4 rounded-2xl font-bold shadow-xl transition-all flex items-center gap-2 text-sm uppercase tracking-widest">
                    <ArrowRight size={18} /> Return to Dashboard
                 </button>
             </div>
             
             <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 pb-12">
                {room.teams.sort((a,b) => b.roster.length - a.roster.length).map(t => {
                   const roleCounts = t.roster.reduce((acc, p) => {
                      acc[p.position] = (acc[p.position] || 0) + 1;
                      return acc;
                  }, {} as Record<string, number>);

                   return (
                      <GlassCard key={t.id} className="p-6 flex flex-col h-full border-white/10 hover:border-white/20 transition-all">
                          <div className="flex items-center gap-5 mb-6 border-b border-white/5 pb-6">
                              <div className="w-16 h-16 rounded-2xl bg-black border-2 flex items-center justify-center p-2 shadow-lg shrink-0" style={{ borderColor: t.color }}>
                                  {t.logoUrl ? <img src={t.logoUrl} className="w-full h-full object-contain" /> : <div className="text-xl font-bold text-white">{t.name[0]}</div>}
                              </div>
                              <div className="overflow-hidden">
                                  <h3 className="text-xl font-bold text-white truncate">{t.name}</h3>
                                  <p className="text-xs text-gray-500 font-bold uppercase tracking-widest truncate">{t.ownerName}</p>
                              </div>
                          </div>

                          <div className="grid grid-cols-4 gap-2 mb-6">
                              {['Batter', 'Bowler', 'All Rounder', 'Wicket Keeper'].map(role => (
                                  <div key={role} className="bg-black/40 rounded-lg p-2 text-center border border-white/5">
                                      <div className="text-[8px] text-gray-500 uppercase font-bold tracking-wider mb-1">{role === 'Wicket Keeper' ? 'WK' : role === 'All Rounder' ? 'AR' : role}</div>
                                      <div className="text-base font-bold text-white leading-none">{roleCounts[role as any] || 0}</div>
                                  </div>
                              ))}
                          </div>

                          <div className="flex-1 space-y-2 mb-6 max-h-[300px] overflow-y-auto custom-scrollbar pr-1">
                              {t.roster.length === 0 ? <p className="text-xs italic text-gray-700 text-center py-4">No players signed.</p> : (
                                  t.roster.map(p => (
                                      <div key={p.id} className="flex justify-between items-center text-[10px] bg-white/5 p-2.5 rounded-xl border border-white/5">
                                          <div>
                                              <span className="font-bold text-white block">{p.name}</span>
                                              <span className="text-[8px] text-gray-500 uppercase tracking-wider">{p.position}</span>
                                          </div>
                                          <span className="font-mono text-yellow-500 font-bold">{p.soldPrice}L</span>
                                      </div>
                                  ))
                              )}
                          </div>

                          <div className="mt-auto border-t border-white/10 pt-4 flex justify-between items-end">
                              <div><span className="text-[8px] text-gray-500 font-bold uppercase block mb-1">Spent</span><span className="text-lg font-display font-bold text-red-500">{t.roster.reduce((sum, p) => sum + (p.soldPrice || 0), 0)} L</span></div>
                              <div className="text-right"><span className="text-[8px] text-gray-500 font-bold uppercase block mb-1">Balance</span><span className="text-lg font-display font-bold text-green-500">{t.budget} L</span></div>
                          </div>
                      </GlassCard>
                   )
                })}
             </div>
          </div>
        )}

        {viewTeamRoster && (
            <div className="fixed inset-0 z-[100] bg-black/95 backdrop-blur-md flex items-center justify-center p-6" onClick={() => setViewTeamRoster(null)}>
                <GlassCard className="max-w-2xl w-full p-8 max-h-[80vh] flex flex-col bg-[#0a0a0a] border-white/10" onClick={e => e.stopPropagation()}>
                    <div className="flex justify-between items-center mb-6 pb-6 border-b border-white/10">
                         <div className="flex items-center gap-5">
                             <div className="w-16 h-16 rounded-2xl bg-black border-4 flex items-center justify-center p-3 shadow-lg" style={{ borderColor: viewTeamRoster.color }}>
                                 {viewTeamRoster.logoUrl ? <img src={viewTeamRoster.logoUrl} className="w-full h-full object-contain" /> : <div className="text-2xl font-bold">{viewTeamRoster.name[0]}</div>}
                             </div>
                             <div>
                                 <h3 className="text-3xl font-display font-bold text-white">{viewTeamRoster.name}</h3>
                                 <p className="text-xs text-gray-500 font-bold uppercase tracking-widest">{viewTeamRoster.ownerName}</p>
                             </div>
                         </div>
                         <button onClick={() => setViewTeamRoster(null)} className="text-gray-500 hover:text-white"><XCircle size={28}/></button>
                    </div>

                    <div className="grid grid-cols-4 gap-2 mb-4 shrink-0">
                        {['Batter', 'Bowler', 'All Rounder', 'Wicket Keeper'].map(role => (
                            <div key={role} className="bg-black/40 rounded-lg p-2 text-center border border-white/5">
                                <div className="text-[9px] text-gray-500 uppercase font-bold tracking-wider mb-1">{role === 'Wicket Keeper' ? 'WK' : role === 'All Rounder' ? 'AR' : role}</div>
                                <div className="text-lg font-bold text-white leading-none">{viewTeamRoster.roster.filter(p => p.position === role).length}</div>
                            </div>
                        ))}
                    </div>

                    <div className="flex-1 overflow-y-auto custom-scrollbar pr-2">
                        {viewTeamRoster.roster.length === 0 ? (
                            <div className="text-center py-20 text-gray-600 italic">No players purchased yet.</div>
                        ) : (
                            <div className="space-y-2">
                                {viewTeamRoster.roster.map(p => (
                                    <div key={p.id} className="flex justify-between items-center p-4 bg-white/5 rounded-2xl border border-white/5 hover:bg-white/10 transition-colors">
                                        <div className="flex items-center gap-4">
                                            <div className="w-10 h-10 rounded-full overflow-hidden border border-white/10 bg-black/50">
                                                {p.imageUrl ? <img src={p.imageUrl} className="w-full h-full object-cover" /> : <User className="p-2 text-gray-500 w-full h-full"/>}
                                            </div>
                                            <div>
                                                <div className="font-bold text-white text-sm">{p.name}</div>
                                                <div className="text-[10px] text-gray-500 uppercase font-bold tracking-widest">{p.position}</div>
                                            </div>
                                        </div>
                                        <div className="font-mono font-bold text-yellow-500">{p.soldPrice} L</div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                    <div className="pt-6 mt-6 border-t border-white/10 flex justify-between">
                         <div className="text-center px-4"><div className="text-[9px] text-gray-500 font-bold uppercase">Players</div><div className="text-xl font-bold text-white">{viewTeamRoster.roster.length}</div></div>
                         <div className="text-center px-4"><div className="text-[9px] text-gray-500 font-bold uppercase">Spent</div><div className="text-xl font-bold text-red-500">{viewTeamRoster.roster.reduce((sum, p) => sum + (p.soldPrice || 0), 0)} L</div></div>
                         <div className="text-center px-4"><div className="text-[9px] text-gray-500 font-bold uppercase">Remaining</div><div className="text-xl font-bold text-green-500">{viewTeamRoster.budget} L</div></div>
                    </div>
                </GlassCard>
            </div>
        )}

        {showStartConfirm && (
             <div className="fixed inset-0 z-[100] bg-black/95 backdrop-blur-md flex items-center justify-center p-6">
                <GlassCard className="max-w-2xl w-full p-8 flex flex-col bg-[#0a0a0a] border-white/10 shadow-2xl animate-fade-in max-h-[90vh] overflow-y-auto">
                    <div className="flex items-center gap-4 mb-8">
                        <div className="w-12 h-12 bg-green-500/10 rounded-xl flex items-center justify-center border border-green-500/20"><Play size={24} className="text-green-500" fill="currentColor"/></div>
                        <div><h2 className="text-2xl font-bold text-white">Initialize Auction</h2><p className="text-gray-400 text-xs">Verify settings before launching the live session.</p></div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
                         <div className="bg-white/5 p-4 rounded-xl border border-white/5">
                             <h4 className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-3 flex items-center gap-2"><Coins size={14}/> Financials</h4>
                             <div className="space-y-3">
                                 <div>
                                     <label className="text-[10px] text-gray-400 block mb-1">Squad Budget (L)</label>
                                     <input type="number" className="w-full bg-black/50 border border-white/10 rounded-lg p-2 text-sm text-white focus:border-green-500/50 focus:outline-none transition-colors" value={room?.config.totalBudget} onChange={(e) => roomService.dispatch({type:'UPDATE_CONFIG', payload: {totalBudget: parseInt(e.target.value)}})} />
                                 </div>
                                 <div>
                                     <label className="text-[10px] text-gray-400 block mb-1">Min Bid Step (L)</label>
                                     <input type="number" className="w-full bg-black/50 border border-white/10 rounded-lg p-2 text-sm text-white focus:border-green-500/50 focus:outline-none transition-colors" value={room?.config.minBidIncrement} onChange={(e) => roomService.dispatch({type:'UPDATE_CONFIG', payload: {minBidIncrement: parseInt(e.target.value)}})} />
                                 </div>
                             </div>
                         </div>
                         <div className="bg-white/5 p-4 rounded-xl border border-white/5">
                              <h4 className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-3 flex items-center gap-2"><Users size={14}/> Participation</h4>
                              <div className="flex justify-between items-center mb-2">
                                  <span className="text-sm text-gray-300">Registered Teams</span>
                                  <span className="text-xl font-bold text-white">{room?.teams.length}</span>
                              </div>
                              <div className="flex justify-between items-center border-t border-white/5 pt-2">
                                  <span className="text-sm text-gray-300">Player Pool</span>
                                  <div className="flex items-center gap-3">
                                    <span className="text-xl font-bold text-white">{room?.players.length}</span>
                                    <button onClick={() => setViewPlayerPool(true)} className="p-1.5 hover:bg-white/10 rounded-lg text-blue-400 transition-colors" title="View Player List">
                                        <Eye size={16}/>
                                    </button>
                                  </div>
                              </div>
                               <div className="flex justify-between items-center border-t border-white/5 pt-2 mt-2">
                                  <span className="text-sm text-gray-300">Max Squad Size</span>
                                  <input type="number" className="w-16 bg-black/50 border border-white/10 rounded-lg p-1 text-sm text-white text-right focus:outline-none" value={room?.config.maxPlayers} onChange={(e) => roomService.dispatch({type:'UPDATE_CONFIG', payload: {maxPlayers: parseInt(e.target.value)}})} />
                              </div>
                         </div>
                    </div>

                    <div className="mb-8">
                        <h4 className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-3">Franchise Grid</h4>
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                            {room?.teams.map(t => (
                                <div key={t.id} className="bg-white/5 p-3 rounded-xl flex items-center gap-3 border border-white/5 hover:bg-white/10 transition-colors">
                                    <div className="w-8 h-8 rounded-lg bg-black flex items-center justify-center text-xs font-bold shrink-0 shadow-lg" style={{borderColor: t.color, borderWidth: 2}}>
                                        {t.logoUrl ? <img src={t.logoUrl} className="w-full h-full object-contain"/> : t.name[0]}
                                    </div>
                                    <div className="flex flex-col min-w-0">
                                        <span className="text-xs font-bold text-gray-200 truncate">{t.name}</span>
                                        <span className="text-[10px] text-gray-500 truncate font-medium">{t.ownerName}</span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="flex gap-4 mt-auto pt-6 border-t border-white/10">
                        <button onClick={() => setShowStartConfirm(false)} className="flex-1 py-4 rounded-xl font-bold text-gray-400 hover:bg-white/5 transition-all uppercase text-xs tracking-widest">Edit Setup</button>
                        <button onClick={confirmStartGame} className="flex-[2] bg-green-600 hover:bg-green-500 py-4 rounded-xl font-bold text-white shadow-xl transition-all uppercase text-xs tracking-widest flex items-center justify-center gap-2">Confirm & Start Auction <ArrowRight size={14}/></button>
                    </div>

                    {viewPlayerPool && (
                        <div className="fixed inset-0 z-[110] bg-black/90 backdrop-blur-md flex items-center justify-center p-6" onClick={() => setViewPlayerPool(false)}>
                            <GlassCard className="max-w-2xl w-full max-h-[80vh] flex flex-col bg-[#0a0a0a] border-white/10" onClick={e => e.stopPropagation()}>
                                <div className="p-6 border-b border-white/10 flex justify-between items-center">
                                     <h3 className="font-bold text-white text-lg">Player Pool ({room?.players.length})</h3>
                                     <button onClick={() => setViewPlayerPool(false)} className="text-gray-400 hover:text-white"><XCircle size={24}/></button>
                                </div>
                                <div className="flex-1 overflow-y-auto p-0">
                                   <table className="w-full text-left text-xs">
                                      <thead className="bg-white/5 text-gray-400 sticky top-0 backdrop-blur-md">
                                         <tr>
                                            <th className="p-4 font-bold uppercase tracking-wider">Player</th>
                                            <th className="p-4 font-bold uppercase tracking-wider">Role</th>
                                            <th className="p-4 font-bold uppercase tracking-wider">Pot</th>
                                            <th className="p-4 font-bold uppercase tracking-wider text-right">Base Price</th>
                                         </tr>
                                      </thead>
                                      <tbody className="divide-y divide-white/5">
                                         {room?.players.map(p => (
                                            <tr key={p.id} className="hover:bg-white/5 transition-colors">
                                               <td className="p-4 font-bold text-white flex items-center gap-3">
                                                    <div className="w-8 h-8 rounded-full bg-gray-800 overflow-hidden shrink-0">
                                                       {p.imageUrl ? <img src={p.imageUrl} className="w-full h-full object-cover"/> : <User size={16} className="m-auto mt-2 text-gray-500"/>}
                                                    </div>
                                                    {p.name}
                                               </td>
                                               <td className="p-4 text-gray-400">{p.position}</td>
                                               <td className="p-4"><span className="bg-white/10 px-2 py-1 rounded text-[10px] font-bold">{p.pot}</span></td>
                                               <td className="p-4 font-mono text-blue-400 font-bold text-right">{p.basePrice} L</td>
                                            </tr>
                                         ))}
                                      </tbody>
                                   </table>
                                </div>
                            </GlassCard>
                        </div>
                    )}
                </GlassCard>
             </div>
        )}

        {showEndConfirm && (
           <div className="fixed inset-0 z-[100] bg-black/95 backdrop-blur-md flex items-center justify-center p-6">
              <GlassCard className="max-w-md w-full p-10 text-center space-y-8 animate-fade-in border-red-500/30 bg-[#0a0a0a]">
                 <div className="w-20 h-20 bg-red-500/10 rounded-full flex items-center justify-center mx-auto shadow-[0_0_30px_rgba(239,68,68,0.2)]"><AlertCircle size={48} className="text-red-500" /></div>
                 <div>
                    <h3 className="text-2xl font-bold mb-3 text-white">Shutdown Session?</h3>
                    <p className="text-gray-400 text-sm leading-relaxed">This will permanently finalize all squads and disconnect all owners. The room will be archived for review.</p>
                 </div>
                 <div className="flex gap-4">
                    <button onClick={() => setShowEndConfirm(false)} className="flex-1 bg-white/5 py-4 rounded-2xl font-bold hover:bg-white/10 transition-all text-[11px] tracking-widest uppercase">Go Back</button>
                    <button onClick={handleEndGame} className="flex-1 bg-red-600 py-4 rounded-2xl font-bold hover:bg-red-500 transition-all shadow-xl shadow-red-900/40 text-[11px] tracking-widest uppercase">End Now</button>
                 </div>
              </GlassCard>
           </div>
        )}

        {showSettings && (
         <div className="fixed inset-0 z-50 bg-black/95 flex items-center justify-center p-4 backdrop-blur-md"><GlassCard className="w-full max-w-4xl border-white/10 flex flex-col max-h-[90vh] bg-[#0a0a0a] overflow-hidden"><div className="p-8 border-b border-white/10 flex justify-between items-center shrink-0"><h2 className="text-2xl font-bold">Room Management</h2><button onClick={() => setShowSettings(false)} className="text-gray-400 hover:text-white transition-colors"><XCircle size={28}/></button></div><div className="flex border-b border-white/10 px-8 bg-white/5 shrink-0">
           <button onClick={() => setActiveSettingsTab('config')} className={`px-6 py-4 text-sm font-bold border-b-2 transition-colors ${activeSettingsTab==='config'?'border-blue-500 text-blue-400':'border-transparent text-gray-400'}`}>Financials</button>
           <button onClick={() => setActiveSettingsTab('schedule')} className={`px-6 py-4 text-sm font-bold border-b-2 transition-colors ${activeSettingsTab==='schedule'?'border-blue-500 text-blue-400':'border-transparent text-gray-400'}`}>Scheduling</button>
           <button onClick={() => setActiveSettingsTab('import')} className={`px-6 py-4 text-sm font-bold border-b-2 transition-colors ${activeSettingsTab==='import'?'border-blue-500 text-blue-400':'border-transparent text-gray-400'}`}>Import CSV</button>
         </div><div className="p-8 overflow-y-auto flex-1 custom-scrollbar">
           {activeSettingsTab === 'config' && (<div className="grid grid-cols-1 md:grid-cols-2 gap-8">
               <div className="bg-white/5 p-6 rounded-2xl border border-white/5"><label className="text-xs text-gray-500 font-bold uppercase mb-3 block">Total Squad Budget (L)</label><input type="number" value={room?.config.totalBudget} onChange={e => roomService.dispatch({type:'UPDATE_CONFIG', payload: {totalBudget: parseInt(e.target.value)}})} className="w-full bg-black/40 p-4 rounded-xl border border-white/10 text-white focus:outline-none"/></div>
               <div className="bg-white/5 p-6 rounded-2xl border border-white/5"><label className="text-xs text-gray-500 font-bold uppercase mb-3 block">Base Bid Step (L)</label><input type="number" value={room?.config.minBidIncrement} onChange={e => roomService.dispatch({type:'UPDATE_CONFIG', payload: {minBidIncrement: parseInt(e.target.value)}})} className="w-full bg-black/40 p-4 rounded-xl border border-white/10 text-white focus:outline-none"/></div>
           </div>)}
           {activeSettingsTab === 'schedule' && (
             <div className="bg-white/5 p-8 rounded-2xl border border-white/5">
                <h3 className="text-lg font-bold mb-4 flex items-center gap-3 text-white"><Calendar size={20} className="text-yellow-500"/> Countdown Start</h3>
                <div className="space-y-4">
                    <p className="text-xs text-gray-500">Scheduled sessions will synchronize the start timer for all connected users.</p>
                    <input type="datetime-local" className="w-full bg-black/40 border border-white/10 rounded-xl p-4 text-white focus:outline-none" onChange={(e) => { const time = new Date(e.target.value).getTime(); if (time > Date.now()) roomService.dispatch({ type: 'UPDATE_CONFIG', payload: { scheduledStartTime: time } }); }} value={room?.config.scheduledStartTime ? new Date(room.config.scheduledStartTime - (new Date().getTimezoneOffset() * 60000)).toISOString().slice(0, 16) : ""} />
                    {room?.config.scheduledStartTime && <button onClick={() => roomService.dispatch({ type: 'UPDATE_CONFIG', payload: { scheduledStartTime: undefined } })} className="text-red-400 text-xs font-bold uppercase tracking-widest hover:underline">Clear Schedule</button>}
                </div>
            </div>
           )}
           {activeSettingsTab === 'import' && (<div className="space-y-6">
             <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
               <div><label className="text-xs text-gray-500 font-bold uppercase mb-2 block">Google Sheets URL</label><input type="text" placeholder="https://..." value={sheetUrl} onChange={e => setSheetUrl(e.target.value)} className="w-full bg-black/40 p-4 rounded-xl border border-white/10 text-white focus:outline-none"/></div>
               <div><label className="text-xs text-gray-500 font-bold uppercase mb-2 block">Tab Name</label><input type="text" placeholder="Players" value={sheetName} onChange={e => setSheetName(e.target.value)} className="w-full bg-black/40 p-4 rounded-xl border border-white/10 text-white focus:outline-none"/></div>
             </div>
             <button onClick={handleFetchFromSheet} className="bg-blue-600 hover:bg-blue-500 px-8 py-4 rounded-xl text-sm font-bold flex items-center gap-2 transition-all">{isFetchingSheet ? <Loader2 size={16} className="animate-spin"/> : <Download size={16}/>} Fetch & Preview Data</button>
             {fetchedPreview.length > 0 && (<div className="mt-6 bg-white/5 border border-white/10 rounded-2xl overflow-hidden animate-fade-in"><div className="p-4 bg-white/5 border-b border-white/10 flex justify-between items-center"><h3 className="font-bold text-white flex items-center gap-2"><CheckCircle size={18} className="text-green-500"/> Preview Data ({fetchedPreview.length})</h3><button onClick={() => setFetchedPreview([])} className="text-xs text-red-400 hover:text-red-300">Clear</button></div><div className="max-h-[300px] overflow-y-auto"><table className="w-full text-left text-xs text-gray-400"><thead className="bg-white/5 text-gray-200 sticky top-0"><tr><th className="p-3">Name</th><th className="p-3">Role</th><th className="p-3">Pot</th><th className="p-3">Base Price (L)</th></tr></thead><tbody>{fetchedPreview.map((p, i) => (<tr key={i} className="border-b border-white/5 hover:bg-white/5"><td className="p-3 font-medium text-white">{p.name}</td><td className="p-3">{p.position}</td><td className="p-3"><span className="bg-yellow-500/10 text-yellow-500 px-1.5 py-0.5 rounded text-[10px] font-bold">{p.pot}</span></td><td className="p-3 font-mono text-blue-400">{p.basePrice}</td></tr>))}</tbody></table></div><div className="p-4 border-t border-white/10"><button onClick={() => { roomService.dispatch({ type: 'IMPORT_PLAYERS', payload: fetchedPreview }); setFetchedPreview([]); setShowSettings(false); }} className="w-full bg-green-600 hover:bg-green-500 text-white font-bold py-3 rounded-xl transition-all shadow-lg flex items-center justify-center gap-2"><Download size={18}/> Confirm & Import</button></div></div>)}</div>)}</div></GlassCard></div>
        )}
      </BackgroundWrapper>
    );
  }

  return null;
}