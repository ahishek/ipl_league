
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { 
  Play, Pause, SkipForward, Settings, Gavel, Users, Activity, Trophy, User, Plus, Trash2,
  CheckCircle, XCircle, Download, Copy, LogOut, Crown, ArrowRight, Share2, RefreshCw, 
  Loader2, AlertCircle, Clock, DollarSign, Search, Sparkles, List, Bell, Star, Palette, 
  FileText, Save, Calendar, Image as ImageIcon, Zap, History, ChevronRight, Briefcase, Filter, StopCircle,
  UserCheck, UserMinus, TrendingUp
} from 'lucide-react';
import { Player, Team, Room, UserState, AuctionConfig, Pot, PlayerStatus, Position, UserProfile, AuctionArchive } from './types';
import { TEAM_COLORS } from './constants';
import { generateAuctionCommentary, generateUnsoldCommentary, getPlayerInsights, generateTeamLogo } from './services/geminiService';
import { roomService } from './services/roomService';

// --- Helper Functions ---

const parseCSVData = (text: string) => {
  try {
    const rows = text.trim().split(/\r?\n/);
    const headers = rows[0].toLowerCase().split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/).map(h => h.trim().replace(/^"|"$/g, ''));
    const nameIdx = headers.findIndex(h => h.includes('name'));
    const roleIdx = headers.findIndex(h => h.includes('role') || h.includes('position'));
    const potIdx = headers.findIndex(h => h.includes('pot') || h.includes('category') || h.includes('group'));
    const imgIdx = headers.findIndex(h => h.includes('image') || h.includes('url') || h.includes('photo'));
    const teamIdx = headers.findIndex(h => h.includes('team') || h.includes('ipl'));
    const priceIdx = headers.findIndex(h => h.includes('price') || h.includes('base') || h.includes('value'));

    const newPlayers: Player[] = [];
    const startIndex = (nameIdx !== -1) ? 1 : 0;
    for(let i=startIndex; i<rows.length; i++) {
       let cols = rows[i].split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/).map(c => c.trim().replace(/^"|"$/g, ''));
       if (cols.length < 3) continue;
       const name = nameIdx !== -1 ? cols[nameIdx] : cols[0];
       const roleRaw = roleIdx !== -1 ? cols[roleIdx] : cols[1];
       const potRaw = potIdx !== -1 ? cols[potIdx] : cols[2];
       const imageUrl = imgIdx !== -1 ? cols[imgIdx] : cols[3];
       const iplTeam = teamIdx !== -1 ? cols[teamIdx] : cols[4];
       const basePriceStr = priceIdx !== -1 ? cols[priceIdx] : cols[5];

       let position: Position = 'Batter';
       if (roleRaw?.toUpperCase().includes('WK')) position = 'Wicket Keeper';
       else if (roleRaw?.toUpperCase().includes('AR') || roleRaw?.toUpperCase().includes('ALL')) position = 'All Rounder';
       else if (roleRaw?.toUpperCase().includes('BOWL')) position = 'Bowler';

       let basePrice = 20;
       if (basePriceStr) {
           const cleaned = basePriceStr.replace(/[^0-9.]/g, '');
           const val = parseFloat(cleaned);
           if (!isNaN(val)) {
               if (basePriceStr.toLowerCase().includes('cr')) basePrice = val * 100;
               else basePrice = val;
           }
       }

       newPlayers.push({
          id: `sheet-${Date.now()}-${i}`,
          name: name || 'Unknown Player', 
          position, 
          pot: (potRaw as Pot) || 'Uncategorized', 
          imageUrl, 
          iplTeam,
          basePrice: Math.round(basePrice),
          status: 'PENDING', 
          country: 'TBD'
       });
    }
    return newPlayers;
  } catch (e) { 
      console.error("Parse Error:", e);
      return []; 
  }
};

interface BackgroundWrapperProps {
  children: React.ReactNode;
}

const BackgroundWrapper: React.FC<BackgroundWrapperProps> = ({ children }) => (
    <div className="min-h-screen bg-[#050505] text-white selection:bg-yellow-500/30 overflow-x-hidden relative font-sans">
        <div className="fixed top-[-10%] left-[-10%] w-[50%] h-[50%] bg-blue-600/10 rounded-full blur-[120px] pointer-events-none z-0"></div>
        <div className="fixed bottom-[-10%] right-[-10%] w-[50%] h-[50%] bg-purple-600/10 rounded-full blur-[120px] pointer-events-none z-0"></div>
        <div className="relative z-10 w-full h-full">{children}</div>
    </div>
);

const GlassCard: React.FC<{children?: React.ReactNode; className?: string; onClick?: React.MouseEventHandler<HTMLDivElement>}> = ({ children, className = "", onClick }) => (
    <div onClick={onClick} className={`bg-white/5 backdrop-blur-xl border border-white/10 rounded-3xl shadow-xl transition-all duration-300 ${className}`}>{children}</div>
);

export default function App() {
  // --- View State ---
  const [view, setView] = useState<'LOGIN' | 'HOME' | 'LOBBY' | 'GAME' | 'COMPLETED' | 'ARCHIVE_DETAIL'>('LOGIN');
  const viewRef = useRef(view);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState("");
  
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

  // Sync ref for state subscribers
  useEffect(() => { viewRef.current = view; }, [view]);

  // --- Watchlist Alert Logic ---
  useEffect(() => {
    if (room?.gameState.currentPlayerId && watchlist.includes(room.gameState.currentPlayerId)) {
      const player = room.players.find(p => p.id === room.gameState.currentPlayerId);
      if (player) {
        const alertMsg = `WATCHLIST ALERT: ${player.name} is now on the block!`;
        if ('Notification' in window && Notification.permission === 'granted') {
          new Notification("Auction Alert", { body: alertMsg, icon: player.imageUrl });
        }
      }
    }
  }, [room?.gameState.currentPlayerId, watchlist]);

  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }, []);

  // --- Init Auth ---
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

  // --- Auction Logic Hooks ---
  const [countdownText, setCountdownText] = useState("");
  useEffect(() => {
    if (!room?.config.scheduledStartTime || room.status !== 'LOBBY') { setCountdownText(""); return; }
    const interval = setInterval(() => {
      const diff = room.config.scheduledStartTime! - Date.now();
      if (diff <= 0) {
        setCountdownText("Starting now...");
        if (isHost && room.status === 'LOBBY') handleStartGame();
        clearInterval(interval);
      } else {
        const h = Math.floor(diff / 3600000);
        const m = Math.floor((diff % 3600000) / 60000);
        const s = Math.floor((diff % 60000) / 1000);
        setCountdownText(`${h}h ${m}m ${s}s`);
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [room?.config.scheduledStartTime, room?.status, isHost]);

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

  useEffect(() => {
    if (!isHost) return;
    const interval = setInterval(() => {
        const r = roomService.currentRoom;
        if (r && r.status === 'ACTIVE' && !r.gameState.isPaused && r.gameState.timer > 0 && r.gameState.currentPlayerId) {
             roomService.dispatch({ type: 'UPDATE_TIMER', payload: { timer: Number(r.gameState.timer) - 1 } });
        } 
        else if (r && r.status === 'ACTIVE' && r.gameState.timer === 0 && r.gameState.currentPlayerId && !r.gameState.isPaused) {
             if (r.gameState.currentBid) handleSold(); else handleUnsold();
        }
    }, 1000);
    return () => clearInterval(interval);
  }, [isHost]);

  // --- Handlers ---

  const handleLogin = () => {
    if (!loginName.trim()) return;
    const p = roomService.saveUserProfile(loginName.trim());
    setProfile(p);
    setView('HOME');
  };

  const handleLogout = () => {
    if (confirm("Are you sure you want to log out? Local data will persist.")) {
        setProfile(null);
        setView('LOGIN');
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

  const handleCreateTeam = () => {
    if (!room || !profile || !newTeamName) return;
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
      roomService.dispatch({ type: 'START_GAME', payload: {} });
      setTimeout(() => roomService.dispatch({ type: 'NEXT_PLAYER', payload: {} }), 1000);
  };

  const handleEndGame = () => {
      roomService.dispatch({ type: 'END_GAME', payload: {} });
      setShowEndConfirm(false);
  };

  const handleSold = async () => {
     const r = roomService.currentRoom;
     if (!r || !r.gameState.currentPlayerId || !r.gameState.currentBid) return;
     if (isActionLoading) return;

     setIsActionLoading(true);
     const player = r.players.find(p => p.id === r.gameState.currentPlayerId);
     const team = r.teams.find(t => t.id === r.gameState.currentBid?.teamId);
     if(player && team) {
         if (!r.gameState.isPaused) roomService.dispatch({ type: 'TOGGLE_PAUSE', payload: {} }); 
         const commentary = await generateAuctionCommentary(player, team, r.gameState.currentBid.amount, r.teams);
         roomService.dispatch({ type: 'SOLD', payload: { commentary } });
         setTimeout(() => {
            roomService.dispatch({ type: 'NEXT_PLAYER', payload: {} });
            setIsActionLoading(false);
         }, 3500);
     } else {
         setIsActionLoading(false);
     }
  };

  const handleUnsold = async () => {
      const r = roomService.currentRoom;
      if (!r || !r.gameState.currentPlayerId) return;
      if (isActionLoading) return;

      setIsActionLoading(true);
      const player = r.players.find(p => p.id === r.gameState.currentPlayerId);
      if (player) {
          if (!r.gameState.isPaused) roomService.dispatch({ type: 'TOGGLE_PAUSE', payload: {} }); 
          const commentary = await generateUnsoldCommentary(player);
          roomService.dispatch({ type: 'UNSOLD', payload: { commentary } });
          setTimeout(() => {
              roomService.dispatch({ type: 'NEXT_PLAYER', payload: {} });
              setIsActionLoading(false);
          }, 2500);
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
        if (p.length > 0) setFetchedPreview(p);
        else alert("No players found in this sheet.");
    } catch (e) { alert("Fetch failed. Ensure sheet is public or link is correct."); }
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
              <div className="min-h-screen flex items-center justify-center p-6">
                  <div className="max-w-md w-full animate-fade-in">
                      <div className="text-center mb-12">
                          <div className="w-20 h-20 bg-gradient-to-br from-yellow-400 to-yellow-600 rounded-3xl flex items-center justify-center mx-auto mb-6 shadow-2xl"><Gavel size={40} className="text-black" strokeWidth={2.5}/></div>
                          <h1 className="text-4xl font-display font-bold text-white mb-2">Welcome, Owner</h1>
                          <p className="text-gray-500 font-medium">Create your franchise profile to begin.</p>
                      </div>
                      <GlassCard className="p-10 space-y-8">
                          <input type="text" placeholder="Owner Name" className="w-full bg-black/40 border border-white/10 rounded-2xl p-5 text-white focus:outline-none focus:border-yellow-500/50 transition-all text-lg" value={loginName} onChange={e => setLoginName(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleLogin()}/>
                          <button onClick={handleLogin} disabled={!loginName} className="w-full bg-gradient-to-r from-yellow-600 to-yellow-500 hover:from-yellow-500 hover:to-yellow-400 text-black font-bold py-5 rounded-2xl transition-all shadow-xl disabled:opacity-50">Enter Auction Hall</button>
                      </GlassCard>
                  </div>
              </div>
          </BackgroundWrapper>
      );
  }

  if (view === 'HOME') {
      return (
          <BackgroundWrapper>
              <div className="max-w-7xl mx-auto p-6 lg:p-12">
                  <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 mb-16">
                      <div className="flex items-center gap-6"><div className="w-20 h-20 rounded-3xl bg-blue-600 flex items-center justify-center text-4xl shadow-2xl border-4 border-white/5 overflow-hidden"><Trophy size={48} className="text-yellow-400" fill="currentColor" /></div><div><h1 className="text-4xl font-display font-bold text-white tracking-tight">Dashboard</h1><p className="text-blue-400 font-medium">Welcome, <span className="text-white underline">{profile?.name}</span></p></div></div>
                      <button onClick={handleLogout} className="p-4 bg-white/5 hover:bg-red-500/10 text-gray-400 hover:text-red-400 rounded-2xl border border-white/10 transition-all flex items-center gap-2 font-bold text-sm"><LogOut size={18}/> Sign Out</button>
                  </header>
                  <div className="grid grid-cols-1 lg:grid-cols-12 gap-10">
                      <div className="lg:col-span-4 space-y-8"><h2 className="text-xl font-bold flex items-center gap-3 text-green-500"><Play size={20}/> Operations</h2><GlassCard className="p-8 space-y-4"><h3 className="text-lg font-bold">Host Room</h3><input type="text" placeholder="Season Name..." className="w-full bg-black/40 border border-white/10 rounded-xl p-4" value={hostRoomName} onChange={e => setHostRoomName(e.target.value)} /><button onClick={handleCreateRoom} className="w-full bg-blue-600 py-4 rounded-xl font-bold">Launch</button></GlassCard><GlassCard className="p-8 space-y-4"><h3 className="text-lg font-bold">Join Room</h3><input type="text" placeholder="Invite Code..." className="w-full bg-black/40 border border-white/10 rounded-xl p-4 uppercase" value={joinRoomCode} onChange={e => setJoinRoomCode(e.target.value.toUpperCase())} maxLength={6} /><button onClick={handleJoinRoom} className="w-full bg-green-600 py-4 rounded-xl font-bold">Connect</button></GlassCard></div>
                      <div className="lg:col-span-8 space-y-8"><h2 className="text-xl font-bold flex items-center gap-3 text-yellow-500"><History size={20}/> Past Sessions</h2>{archive.length === 0 ? <GlassCard className="p-20 text-center opacity-40 italic">No historical records yet.</GlassCard> : <div className="grid grid-cols-1 md:grid-cols-2 gap-6">{archive.map((item) => (<GlassCard key={item.roomId} className="p-6 group cursor-pointer hover:border-blue-500/50 hover:scale-[1.02]" onClick={() => { setSelectedArchive(item); setView('ARCHIVE_DETAIL'); }}><div className="flex justify-between items-start mb-6"><div className="w-16 h-16 rounded-2xl bg-black border border-white/10 overflow-hidden flex items-center justify-center p-2 shadow-lg" style={{ borderColor: item.myTeam.color }}>{item.myTeam.logoUrl ? <img src={item.myTeam.logoUrl} className="w-full h-full object-contain" /> : item.myTeam.name[0]}</div><div className="text-right"><span className="text-[10px] text-gray-500 font-bold uppercase">{new Date(item.completedAt).toLocaleDateString()}</span><div className="flex items-center gap-2 text-blue-400 mt-1 font-bold text-xs">Review <ChevronRight size={14}/></div></div></div><h4 className="text-2xl font-bold mb-1 truncate">{item.myTeam.name}</h4><p className="text-xs text-gray-500 uppercase tracking-wider">{item.roomName}</p></GlassCard>))}</div>}</div>
                  </div>
              </div>
          </BackgroundWrapper>
      );
  }

  if (view === 'ARCHIVE_DETAIL' && selectedArchive) {
      const t = selectedArchive.myTeam;
      return (
          <BackgroundWrapper><div className="max-w-5xl mx-auto p-8 lg:p-16"><button onClick={() => setView('HOME')} className="mb-10 text-gray-500 hover:text-white flex items-center gap-2 font-bold uppercase text-xs transition-colors"><ArrowRight className="rotate-180" size={16}/> Back</button><GlassCard className="p-10 lg:p-16 relative overflow-hidden"><div className="flex flex-col md:flex-row items-center gap-10 mb-12 border-b border-white/5 pb-12"><div className="w-40 h-40 rounded-[2.5rem] bg-black border-4 border-white/10 shadow-2xl flex items-center justify-center p-6" style={{ borderColor: t.color }}>{t.logoUrl ? <img src={t.logoUrl} className="w-full h-full object-contain" /> : <Trophy size={60} className="text-gray-800"/>}</div><div className="text-center md:text-left"><h1 className="text-5xl font-display font-bold text-white mb-2">{t.name}</h1><p className="text-xl text-gray-400 mb-6 font-light">Squad from <span className="text-blue-400">{selectedArchive.roomName}</span></p></div></div><div className="space-y-4">{t.roster.map((p, idx) => (<div key={idx} className="flex items-center justify-between p-5 bg-white/5 rounded-2xl border border-white/5"><div className="flex items-center gap-5"><div className="w-12 h-12 rounded-full overflow-hidden border border-white/10">{p.imageUrl ? <img src={p.imageUrl} className="w-full h-full object-cover" /> : <User className="p-3 text-gray-600"/>}</div><div><p className="font-bold text-lg">{p.name}</p><p className="text-[10px] text-gray-500 uppercase font-bold">{p.position}</p></div></div><div className="text-right"><p className="text-lg font-bold text-yellow-500">{p.soldPrice} L</p></div></div>))}</div></GlassCard></div></BackgroundWrapper>
      );
  }

  if (view === 'LOBBY' || view === 'GAME' || view === 'COMPLETED') {
    return (
      <BackgroundWrapper>
        {view === 'LOBBY' && (
          <div className="max-w-6xl mx-auto p-12 animate-fade-in">
            <GlassCard className="p-10 mb-10 flex flex-col md:flex-row justify-between items-center gap-6">
                <div>
                  <h2 className="text-4xl font-display font-bold text-white mb-2">{room?.name}</h2>
                  <div className="flex items-center gap-3">
                    <span className="bg-yellow-500/20 text-yellow-500 border border-yellow-500/50 px-4 py-1 rounded-full font-bold text-xs uppercase tracking-widest">Lobby</span>
                    {countdownText && <span className="text-xs font-bold text-blue-400 flex items-center gap-2 animate-pulse"><Clock size={14}/> {countdownText}</span>}
                    {isHost && (<button onClick={() => setShowSettings(true)} className="flex items-center gap-2 text-xs font-bold text-gray-400 hover:text-white transition-colors"><Settings size={14}/> Settings</button>)}
                  </div>
                </div>
                <div className="flex items-center gap-6"><div className="bg-black/40 border border-white/10 px-6 py-3 rounded-2xl cursor-pointer hover:bg-black/60 transition-colors" onClick={() => { navigator.clipboard.writeText(room?.id || ""); alert("Code copied!"); }}><span className="text-[10px] text-gray-500 font-bold uppercase block mb-1">Invite Code</span><div className="flex items-center gap-2"><span className="text-2xl font-mono font-bold text-blue-400">{room?.id}</span><Copy size={16} className="text-gray-600"/></div></div>{isHost && (<button onClick={handleStartGame} className="bg-green-600 hover:bg-green-500 px-10 py-5 rounded-2xl font-bold shadow-xl transition-all scale-105 active:scale-95">START AUCTION</button>)}</div>
            </GlassCard>
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-10">
                <div className="lg:col-span-5"><GlassCard className="p-8"><h3 className="text-xl font-bold mb-8 flex items-center gap-3 text-blue-500"><Plus size={24}/> Franchise Registration</h3>{!myTeam ? (<div className="space-y-8"><input type="text" placeholder="Team Name" className="w-full bg-black/40 border border-white/10 rounded-2xl p-5 text-lg font-medium" value={newTeamName} onChange={e => setNewTeamName(e.target.value)} /><div className="space-y-4"><label className="text-xs text-gray-400 font-bold uppercase tracking-widest flex items-center gap-2"><Palette size={14}/> Franchise Colors</label><div className="flex flex-wrap gap-3 p-4 bg-black/20 rounded-2xl border border-white/5">{TEAM_COLORS.map(c => (<button key={c} onClick={() => setNewTeamColor(c)} className={`w-10 h-10 rounded-full border-4 transition-all ${newTeamColor === c ? 'border-white scale-110 shadow-xl' : 'border-transparent hover:scale-105'}`} style={{ backgroundColor: c }} />))}</div></div><div className="space-y-4 p-6 bg-black/30 rounded-3xl border border-white/10"><div className="flex justify-between items-center mb-4"><label className="text-xs text-gray-400 font-bold uppercase tracking-widest flex items-center gap-2"><ImageIcon size={14}/> AI Branding</label><button onClick={handleGenerateLogos} disabled={isGeneratingLogos || !newTeamName} className="text-[10px] font-bold text-yellow-500 hover:text-yellow-400 flex items-center gap-2 bg-yellow-500/10 px-4 py-2 rounded-full transition-all disabled:opacity-30">{isGeneratingLogos ? <Loader2 size={12} className="animate-spin" /> : <Zap size={12}/>} Generate</button></div>{isGeneratingLogos ? (<div className="flex flex-col items-center justify-center py-10 gap-4"><Loader2 size={32} className="animate-spin text-yellow-500" /><p className="text-xs text-gray-500 animate-pulse font-medium">Drafting identity...</p></div>) : logoOptions.length > 0 ? (<div className="grid grid-cols-2 gap-4">{logoOptions.map((logo, idx) => (<div key={idx} onClick={() => setSelectedLogoUrl(logo)} className={`aspect-square rounded-2xl bg-black border-4 transition-all cursor-pointer overflow-hidden p-2 flex items-center justify-center ${selectedLogoUrl === logo ? 'border-yellow-500 shadow-xl scale-105' : 'border-white/5 hover:border-white/20'}`}><img src={logo} className="w-full h-full object-contain" /></div>))}</div>) : (<div className="py-10 text-center border-2 border-dashed border-white/5 rounded-2xl"><p className="text-xs text-gray-600 px-6">Provide a name to generate AI identities</p></div>)}</div><button onClick={handleCreateTeam} disabled={!newTeamName} className="w-full bg-blue-600 hover:bg-blue-500 text-white py-5 rounded-2xl font-bold shadow-xl transition-all disabled:opacity-50">REGISTER TEAM</button></div>) : (<div className="text-center py-10"><div className="w-40 h-40 rounded-[2.5rem] bg-black border-4 mx-auto mb-6 flex items-center justify-center p-4 shadow-2xl" style={{ borderColor: myTeam.color }}>{myTeam.logoUrl ? <img src={myTeam.logoUrl} className="w-full h-full object-contain" /> : <Trophy size={60} className="text-white/10"/>}</div><h4 className="text-3xl font-display font-bold text-white mb-1">{myTeam.name}</h4><p className="text-blue-400 font-medium">{profile?.name}</p><span className="mt-8 inline-block text-[10px] font-bold text-green-500 bg-green-500/10 px-4 py-2 rounded-full uppercase tracking-widest border border-green-500/20">Franchise Active</span></div>)}</GlassCard></div>
                <div className="lg:col-span-7 flex flex-col gap-8"><GlassCard className="flex flex-col h-full overflow-hidden"><div className="flex bg-white/5 border-b border-white/10"><button onClick={() => setLobbyView('TEAMS')} className={`flex-1 py-4 text-xs font-bold uppercase tracking-widest flex items-center justify-center gap-2 transition-all ${lobbyView === 'TEAMS' ? 'text-blue-400 border-b-2 border-blue-400 bg-white/5' : 'text-gray-500 hover:text-gray-300'}`}><Users size={16}/> Teams</button><button onClick={() => setLobbyView('PLAYERS')} className={`flex-1 py-4 text-xs font-bold uppercase tracking-widest flex items-center justify-center gap-2 transition-all ${lobbyView === 'PLAYERS' ? 'text-pink-400 border-b-2 border-pink-400 bg-white/5' : 'text-gray-500 hover:text-gray-300'}`}><Activity size={16}/> Player Browser</button></div><div className="p-8 flex-1 overflow-y-auto custom-scrollbar min-h-[500px]">{lobbyView === 'TEAMS' ? (<div className="animate-fade-in grid grid-cols-1 sm:grid-cols-2 gap-4">{room?.teams.map(t => (<div key={t.id} className="bg-white/5 p-4 rounded-2xl border border-white/5 flex items-center gap-4 hover:bg-white/10 transition-all group"><div className="w-14 h-14 rounded-xl bg-black border border-white/10 flex items-center justify-center p-2 shadow-lg" style={{ borderColor: t.color }}>{t.logoUrl ? <img src={t.logoUrl} className="w-full h-full object-contain" /> : <Gavel size={20}/>}</div><div><p className="font-bold text-white">{t.name}</p><p className="text-xs text-gray-500">{t.ownerName}</p></div></div>))}</div>) : (<div className="animate-fade-in space-y-6"><div className="grid grid-cols-1 sm:grid-cols-3 gap-4"><div className="relative"><Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500"/><input type="text" placeholder="Search..." className="w-full bg-black/40 border border-white/10 rounded-xl py-3 pl-10 pr-4 text-xs focus:outline-none" value={lobbySearch} onChange={e => setLobbySearch(e.target.value)}/></div><div className="relative"><Filter size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500"/><select className="w-full bg-black/40 border border-white/10 rounded-xl py-3 pl-10 pr-4 text-xs appearance-none focus:outline-none" value={lobbyFilterPot} onChange={e => setLobbyFilterPot(e.target.value as any)}><option value="ALL">All Pots</option><option value="A">Pot A</option><option value="B">Pot B</option></select></div></div><div className="space-y-3">{getFilteredLobbyPlayers().map(p => (<div key={p.id} className="bg-white/5 border border-white/5 rounded-2xl p-4 flex flex-col gap-3 hover:border-white/10 transition-all group"><div className="flex justify-between items-center"><div className="flex items-center gap-4"><div className="w-10 h-10 bg-gray-800 rounded-full border border-white/10 overflow-hidden">{p.imageUrl ? <img src={p.imageUrl} className="w-full h-full object-cover"/> : <User className="text-gray-600" size={20}/>}</div><div><h4 className="font-bold text-white text-sm">{p.name}</h4><div className="flex items-center gap-2"><span className="text-[9px] text-gray-500 uppercase font-bold tracking-widest">{p.position}</span><span className="text-[9px] text-yellow-500 font-bold">Pot {p.pot}</span></div></div></div><div className="flex items-center gap-3"><span className="text-xs font-mono font-bold text-white">{p.basePrice} L</span><button onClick={() => toggleWatchlist(p.id)} className={`p-2 rounded-lg transition-all ${watchlist.includes(p.id) ? 'text-pink-500' : 'text-gray-500 hover:text-pink-400'}`}><Star size={16} fill={watchlist.includes(p.id) ? "currentColor" : "none"}/></button><button onClick={() => { setEditingNotePlayerId(p.id); setTempNoteValue(privateNotes[p.id] || ""); }} className={`p-2 rounded-lg transition-all ${privateNotes[p.id] ? 'text-yellow-500' : 'text-gray-500 hover:text-white'}`}><FileText size={16}/></button></div></div>{editingNotePlayerId === p.id && (<div className="bg-black/40 p-3 rounded-xl border border-white/10"><textarea autoFocus value={tempNoteValue} onChange={e => setTempNoteValue(e.target.value)} className="w-full bg-transparent text-xs text-white focus:outline-none min-h-[50px]"/><div className="flex justify-end gap-3 mt-2"><button onClick={() => setEditingNotePlayerId(null)} className="text-[9px] font-bold text-gray-500 uppercase">Cancel</button><button onClick={() => savePrivateNote(p.id)} className="bg-yellow-600 text-white px-3 py-1 rounded-lg text-[9px] font-bold">Save</button></div></div>)}</div>))}</div></div>)}</div></GlassCard></div>
            </div>
          </div>
        )}

        {view === 'GAME' && room && (
            <div className="flex h-screen overflow-hidden animate-fade-in">
                {/* Sidebar */}
                <div className="w-80 bg-black/40 border-r border-white/10 flex flex-col backdrop-blur-3xl z-30">
                    <div className="p-6 border-b border-white/10">
                        <h2 className="text-2xl font-display font-bold text-yellow-500 tracking-wider">AUCTION HUB</h2>
                        <div className="flex items-center gap-2 mt-2">
                            <span className={`w-2 h-2 rounded-full ${room.gameState.isPaused ? 'bg-red-500' : 'bg-green-500 animate-pulse'}`}></span>
                            <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">{room.gameState.isPaused ? 'Paused' : 'Live'}</span>
                        </div>
                    </div>
                    {isHost && (
                        <div className="p-4 flex flex-col gap-3 border-b border-white/5">
                            <div className="grid grid-cols-2 gap-2">
                                <button onClick={togglePause} className="bg-yellow-500 hover:bg-yellow-400 text-black py-4 rounded-2xl font-bold flex items-center justify-center gap-2 transition-all active:scale-95">
                                    {room.gameState.isPaused ? <Play size={20} fill="currentColor"/> : <Pause size={20} fill="currentColor"/>}
                                    {room.gameState.isPaused ? 'RESUME' : 'PAUSE'}
                                </button>
                                <button onClick={() => setShowEndConfirm(true)} className="bg-red-600 hover:bg-red-500 text-white py-4 rounded-2xl font-bold flex items-center justify-center gap-2 transition-all active:scale-95 shadow-xl shadow-red-900/40 border border-red-500/20">
                                    <StopCircle size={20}/> END
                                </button>
                            </div>
                            <button onClick={() => roomService.dispatch({type:'NEXT_PLAYER', payload:{}})} className="bg-white/5 hover:bg-white/10 text-white py-3 rounded-xl flex items-center justify-center gap-2 font-bold text-xs border border-white/5"><SkipForward size={16}/> FORCE NEXT</button>
                        </div>
                    )}
                    <div className="flex bg-white/5 border-b border-white/5">
                        <button onClick={() => setSidebarTab('LOGS')} className={`flex-1 py-3 text-[10px] font-bold uppercase tracking-widest flex items-center justify-center gap-2 transition-all ${sidebarTab === 'LOGS' ? 'text-blue-400 border-b-2 border-blue-400 bg-white/5' : 'text-gray-500 hover:text-gray-300'}`}><List size={12}/> Logs</button>
                        <button onClick={() => setSidebarTab('WATCHLIST')} className={`flex-1 py-3 text-[10px] font-bold uppercase tracking-widest flex items-center justify-center gap-2 transition-all ${sidebarTab === 'WATCHLIST' ? 'text-pink-400 border-b-2 border-pink-400 bg-white/5' : 'text-gray-500 hover:text-gray-300'}`}><Star size={12}/> Watchlist</button>
                    </div>
                    <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
                        {sidebarTab === 'LOGS' ? (
                            <div className="space-y-4">{room.gameState.logs.map(log => (<div key={log.id} className="p-4 bg-white/5 rounded-2xl border-l-4 border-white/10" style={{ borderLeftColor: log.type === 'BID' ? '#3b82f6' : log.type === 'SOLD' ? '#22c55e' : log.type === 'UNSOLD' ? '#ef4444' : undefined }}><p className="text-xs text-gray-300">{log.message}</p><span className="text-[9px] text-gray-600">{new Date(log.timestamp).toLocaleTimeString()}</span></div>))}</div>
                        ) : (
                            <div className="space-y-3">
                                {watchlist.length === 0 ? (
                                    <div className="text-center py-20 opacity-30 text-[10px] uppercase font-bold tracking-widest">No players in watchlist</div>
                                ) : room.players.filter(p => watchlist.includes(p.id)).map(p => {
                                  const hasNote = !!privateNotes[p.id];
                                  return (
                                    <div key={p.id} className={`p-3 bg-pink-500/5 rounded-xl border border-pink-500/20 flex flex-col gap-2 transition-all`}>
                                        <div className="flex justify-between items-center">
                                          <div><p className="text-xs font-bold text-white">{p.name}</p><p className="text-[9px] text-gray-500 uppercase">{p.position}</p></div>
                                          <div className="flex items-center gap-2">
                                              <span className={`text-[8px] font-bold px-2 py-0.5 rounded-full ${p.status === 'SOLD' ? 'bg-green-500/20 text-green-400' : p.status === 'UNSOLD' ? 'bg-red-500/20 text-red-400' : 'bg-blue-500/20 text-blue-400'}`}>{p.status}</span>
                                              <button onClick={() => toggleWatchlist(p.id)} className="text-pink-500"><Star size={14} fill="currentColor"/></button>
                                              <button onClick={() => { setEditingNotePlayerId(p.id); setTempNoteValue(privateNotes[p.id] || ""); }} className={`p-1 rounded-md transition-all ${hasNote ? 'text-yellow-500' : 'text-gray-600 hover:text-gray-400'}`}><FileText size={14}/></button>
                                          </div>
                                        </div>
                                        {editingNotePlayerId === p.id && (
                                            <div className="bg-black/40 p-2 rounded-lg border border-white/10 animate-fade-in"><textarea autoFocus value={tempNoteValue} onChange={e => setTempNoteValue(e.target.value)} className="w-full bg-transparent text-[10px] text-white focus:outline-none min-h-[40px]"/><div className="flex justify-end gap-2 mt-1"><button onClick={() => setEditingNotePlayerId(null)} className="text-[8px] font-bold text-gray-500 uppercase">Cancel</button><button onClick={() => savePrivateNote(p.id)} className="bg-yellow-600 text-white px-2 py-0.5 rounded text-[8px] font-bold">Save</button></div></div>
                                        )}
                                        {hasNote && editingNotePlayerId !== p.id && <p className="text-[9px] text-yellow-500/60 italic border-t border-white/5 pt-1 mt-1">{privateNotes[p.id]}</p>}
                                    </div>
                                  );
                                })}
                            </div>
                        )}
                    </div>
                </div>

                {/* Main Arena */}
                <div className="flex-1 flex flex-col relative">
                    <div className="h-20 bg-black/20 border-b border-white/10 px-8 flex items-center justify-between z-10 backdrop-blur-md">
                        <div className="flex items-center gap-12">
                          <div><span className="text-[10px] text-gray-500 font-bold uppercase block mb-0.5">Pot {room.gameState.currentPot}</span><span className="text-xl font-display font-bold text-blue-400">{room.players.filter(p => p.status === 'PENDING').length} Left</span></div>
                          <div className="flex items-center gap-8 border-l border-white/10 pl-10">
                             <div className="flex items-center gap-3"><Activity size={18} className="text-green-500"/><div className="flex flex-col"><span className="text-[10px] text-gray-500 font-bold uppercase leading-none">Sold Today</span><span className="text-sm font-bold text-white">{soldCount}</span></div></div>
                             {highestBidPlayer && (
                                <div className="flex items-center gap-3"><TrendingUp size={18} className="text-yellow-500"/><div className="flex flex-col"><span className="text-[10px] text-gray-500 font-bold uppercase leading-none">Highest Bid</span><span className="text-sm font-bold text-white truncate max-w-[120px]">{highestBidPlayer.name} ({highestBidPlayer.soldPrice}L)</span></div></div>
                             )}
                          </div>
                        </div>
                        {room.gameState.aiCommentary && <div className="hidden lg:flex bg-purple-500/10 border border-purple-500/20 px-6 py-2 rounded-full max-w-md"><Sparkles size={16} className="text-purple-400 mr-3 shrink-0 mt-1"/><p className="text-[11px] italic text-purple-200 line-clamp-2">"{room.gameState.aiCommentary}"</p></div>}
                    </div>

                    <div className="flex-1 p-8 flex items-center justify-center relative overflow-hidden">
                        {room.gameState.currentPlayerId ? (
                            <div className="max-w-6xl w-full grid grid-cols-1 lg:grid-cols-12 gap-10 z-10">
                                <div className="lg:col-span-5"><GlassCard className="h-[520px] flex flex-col overflow-hidden relative border-white/20">{room.players.find(p => p.id === room.gameState.currentPlayerId)?.imageUrl ? <img src={room.players.find(p => p.id === room.gameState.currentPlayerId)?.imageUrl} className="w-full h-full object-contain bg-gradient-to-b from-gray-800 to-black" /> : <div className="w-full h-full bg-gray-900 flex items-center justify-center text-white/10"><User size={120}/></div>}<div className="absolute bottom-0 w-full p-8 bg-gradient-to-t from-black to-transparent pt-20"><h2 className="text-4xl font-display font-bold text-white mb-1 drop-shadow-xl">{room.players.find(p => p.id === room.gameState.currentPlayerId)?.name}</h2><p className="text-lg text-blue-400 font-medium">{room.players.find(p => p.id === room.gameState.currentPlayerId)?.position}</p></div></GlassCard></div>
                                <div className="lg:col-span-7 flex flex-col gap-6">
                                    <GlassCard className="flex-1 flex flex-col items-center justify-center p-10 relative">
                                        <div className="text-center mb-8"><span className={`text-[120px] font-display font-bold leading-none ${room.gameState.timer <= 5 ? 'text-red-500 animate-pulse' : 'text-white'}`}>{room.gameState.timer}</span></div>
                                        <div className="w-full max-w-sm bg-black/40 rounded-3xl p-8 border border-white/10 shadow-2xl">
                                            <p className="text-[10px] text-gray-500 font-bold uppercase tracking-[0.3em] mb-4 text-center">Current Highest Bid</p>
                                            {room.gameState.currentBid ? (
                                                <div className="text-center animate-fade-in"><div className="text-6xl font-display font-bold text-white mb-2">{room.gameState.currentBid.amount} <span className="text-2xl text-gray-500">L</span></div><div className="inline-block px-6 py-2 rounded-full font-bold text-white text-sm" style={{ backgroundColor: room.teams.find(t => t.id === room.gameState.currentBid?.teamId)?.color }}>{room.teams.find(t => t.id === room.gameState.currentBid?.teamId)?.name}</div></div>
                                            ) : (
                                                <div className="text-center py-6 border-2 border-dashed border-white/5 rounded-2xl italic text-gray-600">Waiting for bids... (Base: {room.players.find(p => p.id === room.gameState.currentPlayerId)?.basePrice}L)</div>
                                            )}
                                        </div>

                                        {isHost && (
                                            <div className="mt-8 grid grid-cols-2 gap-4 w-full max-w-sm">
                                                <button onClick={handleSold} disabled={!room.gameState.currentBid || isActionLoading} className="bg-green-600 hover:bg-green-500 text-white py-4 rounded-2xl font-bold flex items-center justify-center gap-2 shadow-lg disabled:opacity-30 transition-all active:scale-95">
                                                  {isActionLoading ? <Loader2 size={20} className="animate-spin" /> : <UserCheck size={20}/>}
                                                  {isActionLoading ? 'PROCESSING' : 'SELL NOW'}
                                                </button>
                                                <button onClick={handleUnsold} disabled={isActionLoading} className="bg-red-600 hover:bg-red-500 text-white py-4 rounded-2xl font-bold flex items-center justify-center gap-2 shadow-lg transition-all active:scale-95 disabled:opacity-30">
                                                  {isActionLoading ? <Loader2 size={20} className="animate-spin" /> : <UserMinus size={20}/>}
                                                  {isActionLoading ? 'PROCESSING' : 'UNSOLD'}
                                                </button>
                                            </div>
                                        )}
                                    </GlassCard>
                                    <div className="grid grid-cols-1 gap-6">{playerInsights ? <GlassCard className="p-6 bg-blue-500/10 border-blue-500/20"><h4 className="text-xs font-bold text-blue-400 uppercase flex items-center gap-2 mb-2"><Sparkles size={14}/> Scout Summary</h4><p className="text-sm italic text-blue-100">"{playerInsights}"</p></GlassCard> : <button onClick={handleGetInsights} disabled={isInsightsLoading} className="bg-white/5 hover:bg-white/10 py-4 rounded-2xl text-xs font-bold uppercase text-gray-400 border border-white/10 transition-all">{isInsightsLoading ? <Loader2 size={16} className="animate-spin mx-auto"/> : 'Query AI Scout'}</button>}</div>
                                </div>
                            </div>
                        ) : (
                            <div className="text-center opacity-30"><Gavel size={100} className="mx-auto mb-6"/><h3 className="text-3xl font-display font-bold">Waiting for Player</h3></div>
                        )}
                    </div>

                    <div className="h-44 bg-black/80 border-t border-white/10 backdrop-blur-3xl px-8 flex items-center gap-6 overflow-x-auto custom-scrollbar">
                        {room.teams.map(t => {
                            const isWinning = room.gameState.currentBid?.teamId === t.id;
                            const isMyTeam = t.controlledByUserId === profile?.id;
                            const currentAmt = room.gameState.currentBid?.amount || 0;
                            const player = room.players.find(p => p.id === room.gameState.currentPlayerId);
                            const baseAmt = player?.basePrice || 0;
                            
                            // Owner choices: increment by 10 or 20
                            const nextBid10 = Math.max(baseAmt, currentAmt + 10);
                            const nextBid20 = Math.max(baseAmt + 10, currentAmt + 20);
                            
                            return (
                                <div key={t.id} className={`shrink-0 w-72 p-4 rounded-2xl border transition-all ${isWinning ? 'bg-green-500/10 border-green-500' : 'bg-white/5 border-white/5'} ${isMyTeam ? 'ring-2 ring-blue-500 ring-offset-2 ring-offset-black' : ''}`}>
                                    <div className="flex items-center gap-3 mb-3"><div className="w-10 h-10 rounded-lg bg-black border-2 flex items-center justify-center p-1" style={{ borderColor: t.color }}>{t.logoUrl ? <img src={t.logoUrl} className="w-full h-full object-contain" /> : <Gavel size={16}/>}</div><div className="flex-1 overflow-hidden"><p className="text-xs font-bold text-white truncate">{t.name}</p><p className="text-[10px] text-yellow-500 font-mono">{t.budget} L LEFT</p></div></div>
                                    {isMyTeam && room.gameState.currentPlayerId && !room.gameState.isPaused && !isWinning ? (
                                        <div className="grid grid-cols-2 gap-2">
                                          <button onClick={() => placeBid(t.id, nextBid10)} disabled={t.budget < nextBid10} className="bg-blue-600 hover:bg-blue-500 py-2 rounded-xl text-[10px] font-bold text-white shadow-lg disabled:opacity-50">+{nextBid10 - currentAmt} (Bid {nextBid10}L)</button>
                                          <button onClick={() => placeBid(t.id, nextBid20)} disabled={t.budget < nextBid20} className="bg-blue-600 hover:bg-blue-500 py-2 rounded-xl text-[10px] font-bold text-white shadow-lg disabled:opacity-50">+{nextBid20 - currentAmt} (Bid {nextBid20}L)</button>
                                        </div>
                                    ) : isWinning ? <div className="w-full bg-green-500 py-2 rounded-xl text-[10px] font-bold text-black text-center animate-pulse">LEADING</div> : <div className="w-full bg-white/5 py-2 rounded-xl text-[10px] font-bold text-gray-500 text-center">SPECTATING</div>}
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>
        )}

        {view === 'COMPLETED' && (
            <div className="min-h-screen flex flex-col items-center justify-center p-12 animate-fade-in"><Trophy size={100} className="text-yellow-500 mb-8" fill="currentColor"/><h1 className="text-6xl font-display font-bold text-white mb-4">Auction Concluded</h1><p className="text-gray-400 text-xl mb-16 text-center max-w-2xl">The hammer has fallen for the last time. Your squad rosters are now stored in the hall of fame.</p><div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 w-full max-w-6xl mb-16">{room?.teams.map(t => (<GlassCard key={t.id} className="p-8"><div className="flex items-center gap-5 mb-8"><div className="w-20 h-20 rounded-2xl bg-black border-4 flex items-center justify-center p-3 shadow-xl" style={{ borderColor: t.color }}>{t.logoUrl ? <img src={t.logoUrl} className="w-full h-full object-contain" /> : <Trophy size={32}/>}</div><div><h3 className="text-2xl font-bold">{t.name}</h3><p className="text-gray-500 font-medium">{t.ownerName}</p></div></div><div className="flex justify-between mb-2"><span className="text-xs text-gray-500 font-bold uppercase">Players</span><span className="font-bold">{t.roster.length}</span></div><div className="flex justify-between"><span className="text-xs text-gray-500 font-bold uppercase">Final Value</span><span className="font-bold text-yellow-500">{t.roster.reduce((sum, p) => sum + (p.soldPrice || 0), 0)} L</span></div></GlassCard>))}</div><button onClick={() => setView('HOME')} className="bg-white text-black px-12 py-5 rounded-3xl font-bold shadow-2xl hover:bg-gray-200 transition-all flex items-center gap-3"><History size={20}/> RETURN TO DASHBOARD</button></div>
        )}

        {/* End Auction Confirmation Modal */}
        {showEndConfirm && (
           <div className="fixed inset-0 z-[100] bg-black/90 backdrop-blur-md flex items-center justify-center p-6">
              <GlassCard className="max-w-md w-full p-10 text-center space-y-8 animate-fade-in border-red-500/30">
                 <div className="w-20 h-20 bg-red-500/10 rounded-full flex items-center justify-center mx-auto"><AlertCircle size={48} className="text-red-500" /></div>
                 <div>
                    <h3 className="text-2xl font-bold mb-3">Terminate Auction?</h3>
                    <p className="text-gray-400 text-sm">This will permanently finalize all current rosters and close the auction hall for all participants. This action cannot be undone.</p>
                 </div>
                 <div className="flex gap-4">
                    <button onClick={() => setShowEndConfirm(false)} className="flex-1 bg-white/5 py-4 rounded-2xl font-bold hover:bg-white/10 transition-all">Cancel</button>
                    <button onClick={handleEndGame} className="flex-1 bg-red-600 py-4 rounded-2xl font-bold hover:bg-red-500 transition-all shadow-xl shadow-red-900/40">Yes, Finalize</button>
                 </div>
              </GlassCard>
           </div>
        )}

        {showSettings && (
         <div className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4 backdrop-blur-md"><GlassCard className="w-full max-w-4xl border-white/10 flex flex-col max-h-[90vh] bg-[#0a0a0a]"><div className="p-8 border-b border-white/10 flex justify-between items-center"><h2 className="text-2xl font-bold">Auction Management</h2><button onClick={() => setShowSettings(false)} className="text-gray-400 hover:text-white"><XCircle size={28}/></button></div><div className="flex border-b border-white/10 px-8 bg-white/5">
           <button onClick={() => setActiveSettingsTab('config')} className={`px-6 py-4 text-sm font-bold border-b-2 transition-colors ${activeSettingsTab==='config'?'border-blue-500 text-blue-400':'border-transparent text-gray-400'}`}>Financials</button>
           <button onClick={() => setActiveSettingsTab('schedule')} className={`px-6 py-4 text-sm font-bold border-b-2 transition-colors ${activeSettingsTab==='schedule'?'border-blue-500 text-blue-400':'border-transparent text-gray-400'}`}>Scheduling</button>
           <button onClick={() => setActiveSettingsTab('import')} className={`px-6 py-4 text-sm font-bold border-b-2 transition-colors ${activeSettingsTab==='import'?'border-blue-500 text-blue-400':'border-transparent text-gray-400'}`}>Import Data</button>
         </div><div className="p-8 overflow-y-auto flex-1 custom-scrollbar">
           {activeSettingsTab === 'config' && (<div className="grid grid-cols-1 md:grid-cols-2 gap-8"><div className="bg-white/5 p-6 rounded-2xl border border-white/5"><label className="text-xs text-gray-500 font-bold uppercase mb-3 block">Total Franchise Budget (L)</label><input type="number" value={room?.config.totalBudget} onChange={e => roomService.dispatch({type:'UPDATE_CONFIG', payload: {totalBudget: parseInt(e.target.value)}})} className="w-full bg-black/40 p-4 rounded-xl border border-white/10 text-white focus:outline-none"/></div><div className="bg-white/5 p-6 rounded-2xl border border-white/5"><label className="text-xs text-gray-500 font-bold uppercase mb-3 block">Bid Increments (L)</label><input type="number" value={room?.config.minBidIncrement} onChange={e => roomService.dispatch({type:'UPDATE_CONFIG', payload: {minBidIncrement: parseInt(e.target.value)}})} className="w-full bg-black/40 p-4 rounded-xl border border-white/10 text-white focus:outline-none"/></div></div>)}
           {activeSettingsTab === 'schedule' && (
             <div className="bg-white/5 p-8 rounded-2xl border border-white/5">
                <h3 className="text-lg font-bold mb-4 flex items-center gap-3 text-white"><Calendar size={20} className="text-yellow-500"/> Future Start Time</h3>
                <div className="space-y-4">
                    <p className="text-xs text-gray-500">Set a date and time for the auction to automatically go live for all connected participants.</p>
                    <input 
                        type="datetime-local" 
                        className="w-full bg-black/40 border border-white/10 rounded-xl p-4 text-white focus:outline-none focus:border-yellow-500/50"
                        onChange={(e) => {
                            const time = new Date(e.target.value).getTime();
                            if (time > Date.now()) roomService.dispatch({ type: 'UPDATE_CONFIG', payload: { scheduledStartTime: time } });
                        }}
                        value={room?.config.scheduledStartTime ? new Date(room.config.scheduledStartTime - (new Date().getTimezoneOffset() * 60000)).toISOString().slice(0, 16) : ""}
                    />
                    {room?.config.scheduledStartTime && <button onClick={() => roomService.dispatch({ type: 'UPDATE_CONFIG', payload: { scheduledStartTime: undefined } })} className="text-red-400 text-xs font-bold uppercase tracking-widest hover:underline">Cancel Auto-Start</button>}
                </div>
            </div>
           )}
           {activeSettingsTab === 'import' && (<div className="space-y-6">
             <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
               <div><label className="text-xs text-gray-500 font-bold uppercase mb-2 block">Google Sheet URL</label><input type="text" placeholder="https://docs.google.com/spreadsheets/d/..." value={sheetUrl} onChange={e => setSheetUrl(e.target.value)} className="w-full bg-black/40 p-4 rounded-xl border border-white/10 text-white focus:outline-none"/></div>
               <div><label className="text-xs text-gray-500 font-bold uppercase mb-2 block">Sheet Tab Name</label><input type="text" placeholder="e.g. Players" value={sheetName} onChange={e => setSheetName(e.target.value)} className="w-full bg-black/40 p-4 rounded-xl border border-white/10 text-white focus:outline-none"/></div>
             </div>
             <button onClick={handleFetchFromSheet} className="bg-blue-600 hover:bg-blue-500 px-8 py-4 rounded-xl text-sm font-bold flex items-center gap-2 transition-all">{isFetchingSheet ? <Loader2 size={16} className="animate-spin"/> : <Download size={16}/>} Fetch CSV Data</button>{fetchedPreview.length > 0 && (<div className="bg-green-500/10 border border-green-500/20 p-6 rounded-2xl animate-fade-in"><div className="flex items-center gap-3 text-green-400 mb-4 font-bold"><CheckCircle size={20}/> Found {fetchedPreview.length} profiles</div><button onClick={() => { roomService.dispatch({ type: 'IMPORT_PLAYERS', payload: fetchedPreview }); setFetchedPreview([]); setShowSettings(false); }} className="w-full bg-green-600 hover:bg-green-500 py-4 rounded-xl font-bold">Load Into Hall</button></div>)}</div>)}</div></GlassCard></div>
        )}
      </BackgroundWrapper>
    );
  }

  return null;
}
