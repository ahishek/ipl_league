
import React, { useState, useEffect } from 'react';
import { 
  Play, Pause, SkipForward, Settings, Gavel, Users, Activity, Trophy, User, Plus, Trash2,
  FileSpreadsheet, CheckCircle, XCircle, Download, Link as LinkIcon, 
  Copy, LogOut, Crown, ArrowRight, Share2, RefreshCw, Loader2, AlertCircle, Eye, StopCircle
} from 'lucide-react';
import { Player, Team, Room, UserState, AuctionConfig, Pot, PlayerStatus } from './types';
import { TEAM_COLORS } from './constants';
import { generateAuctionCommentary, generateUnsoldCommentary } from './services/geminiService';
import { roomService } from './services/roomService';

export default function App() {
  // --- View State ---
  const [view, setView] = useState<'HOME' | 'LOBBY' | 'GAME' | 'COMPLETED'>('HOME');
  const [isLoading, setIsLoading] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState("");
  
  // --- Room & User State ---
  const [currentUser, setCurrentUser] = useState<UserState | null>(null);
  const [room, setRoom] = useState<Room | null>(null);
  
  // --- Local Inputs ---
  const [hostName, setHostName] = useState("");
  const [hostRoomName, setHostRoomName] = useState("");
  
  const [joinName, setJoinName] = useState("");
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
       });
       return unsub;
    }
  }, [currentUser, view]);

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
    if (!hostName || !hostRoomName) return alert("Please fill in your name and room name.");
    setIsLoading(true);
    setLoadingMsg("Creating Secure Room...");
    try {
        const { room, user } = await roomService.createRoom(hostName, hostRoomName);
        setCurrentUser(user);
        setRoom(room);
        setView('LOBBY');
    } catch (e) {
        console.error(e);
        alert("Failed to create room. PeerJS server might be busy or blocked.");
    } finally { setIsLoading(false); }
  };

  const handleJoinRoom = async () => {
    if (!joinName || !joinRoomCode) return alert("Please enter your name and the room code.");
    setIsLoading(true);
    setLoadingMsg("Connecting to Host...");
    try {
        const { room, user } = await roomService.joinRoom(joinRoomCode.trim(), joinName);
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

  // --- Rendering ---

  if (view === 'HOME') {
    return (
      <div className="min-h-screen bg-[#0f172a] flex items-center justify-center p-4">
         <div className="max-w-4xl w-full grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="flex flex-col justify-center space-y-6">
                <div>
                  <h1 className="text-6xl font-display font-bold text-yellow-500 mb-2">IPL AUCTION</h1>
                  <p className="text-gray-400 text-lg">Real-time P2P Auction Simulator. Host must stay online for the room to remain active.</p>
                </div>
                
                <div className="space-y-4">
                   {isLoading ? (
                       <div className="bg-[#1e293b] p-12 rounded-xl border border-gray-700 shadow-xl flex flex-col items-center justify-center text-white">
                           <Loader2 size={48} className="animate-spin text-blue-500 mb-4"/>
                           <p className="text-lg font-bold animate-pulse">{loadingMsg}</p>
                           <p className="text-xs text-gray-500 mt-2">Connecting to Peer Network...</p>
                       </div>
                   ) : (
                       <>
                       {isInviteFlow ? (
                         <div className="bg-[#1e293b] p-8 rounded-xl border-4 border-blue-500/50 shadow-[0_0_30px_rgba(59,130,246,0.5)] relative overflow-hidden animate-pulse">
                            <div className="absolute top-0 right-0 bg-blue-500 text-white text-xs px-3 py-1 font-bold uppercase rounded-bl-lg">Invite</div>
                            <h2 className="text-2xl font-bold text-white mb-4 flex items-center gap-2"><ArrowRight className="text-blue-500"/> Join Auction</h2>
                            <p className="text-sm text-gray-400 mb-4">You have been invited to a private auction room.</p>
                            
                            <label className="text-xs text-gray-500 font-bold uppercase">Room Code</label>
                            <input type="text" className="w-full bg-black/30 border border-gray-600 rounded p-3 mb-3 text-white font-mono uppercase tracking-widest text-lg cursor-not-allowed opacity-70" value={joinRoomCode} disabled />
                            
                            <label className="text-xs text-gray-500 font-bold uppercase">Your Name</label>
                            <input type="text" placeholder="Enter your name" className="w-full bg-gray-900 border border-blue-500/50 rounded p-3 mb-6 text-white" value={joinName} onChange={e => setJoinName(e.target.value)} autoFocus />
                            
                            <button onClick={handleJoinRoom} className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-3 rounded-lg transition-all shadow-lg shadow-blue-900/50">Enter Room</button>
                            
                            <button onClick={clearInvite} className="w-full mt-4 text-xs text-gray-500 hover:text-white underline">Cancel & Go to Main Menu</button>
                         </div>
                       ) : (
                         <>
                           <div className="bg-[#1e293b] p-6 rounded-xl border border-gray-700 shadow-xl">
                              <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2"><Plus className="text-green-500"/> Host Auction</h2>
                              <input type="text" placeholder="Your Name" className="w-full bg-gray-900 border border-gray-600 rounded p-3 mb-3 text-white" value={hostName} onChange={e => setHostName(e.target.value)} />
                              <input type="text" placeholder="Room Name (e.g. Weekend League)" className="w-full bg-gray-900 border border-gray-600 rounded p-3 mb-4 text-white" value={hostRoomName} onChange={e => setHostRoomName(e.target.value)} />
                              <button onClick={handleCreateRoom} className="w-full bg-green-600 hover:bg-green-500 text-white font-bold py-3 rounded-lg transition-all">Create Room</button>
                           </div>
                           
                           <div className="bg-[#1e293b] p-6 rounded-xl border border-gray-700 shadow-xl opacity-90">
                              <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2"><ArrowRight className="text-blue-500"/> Join Room</h2>
                              <input type="text" placeholder="Your Name" className="w-full bg-gray-900 border border-gray-600 rounded p-3 mb-3 text-white" value={joinName} onChange={e => setJoinName(e.target.value)} />
                              <input type="text" placeholder="Room Code" className="w-full bg-gray-900 border border-gray-600 rounded p-3 mb-4 text-white font-mono uppercase tracking-widest" maxLength={6} value={joinRoomCode} onChange={e => setJoinRoomCode(e.target.value.toUpperCase())} />
                              <button onClick={handleJoinRoom} className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-3 rounded-lg transition-all">Join Room</button>
                           </div>
                         </>
                       )}
                       </>
                   )}
                </div>
            </div>
            
            {!isInviteFlow && (
              <div className="bg-black/20 rounded-xl p-6 border border-gray-800">
                 <h3 className="text-gray-400 uppercase font-bold text-xs tracking-wider mb-4">Recent Rooms</h3>
                 <div className="space-y-3">
                    {roomService.getHistory().map((h: any) => (
                       <div key={h.id} className="flex justify-between items-center bg-gray-800/50 p-3 rounded hover:bg-gray-800 cursor-pointer" onClick={() => { setJoinRoomCode(h.id); }}>
                          <div>
                             <p className="font-bold text-white">{h.name}</p>
                             <p className="text-xs text-gray-500">{new Date(h.createdAt).toLocaleDateString()}</p>
                          </div>
                          <span className="font-mono text-yellow-500 text-sm bg-black/40 px-2 py-1 rounded">{h.id}</span>
                       </div>
                    ))}
                    {roomService.getHistory().length === 0 && <p className="text-gray-600 italic text-sm">No recent rooms.</p>}
                 </div>
              </div>
            )}
         </div>
      </div>
    );
  }

  // --- COMPLETED VIEW ---
  if (view === 'COMPLETED' && room) {
     const sortedTeams = [...room.teams].sort((a,b) => b.roster.reduce((sum,p) => sum + (p.soldPrice||0), 0) - a.roster.reduce((sum,p) => sum + (p.soldPrice||0), 0));
     return (
        <div className="min-h-screen bg-[#0f172a] p-8 text-white flex flex-col items-center">
            <h1 className="text-4xl font-display font-bold text-yellow-500 mb-8">Auction Summary</h1>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 w-full max-w-6xl">
                {sortedTeams.map(team => {
                   const spent = team.roster.reduce((sum, p) => sum + (p.soldPrice||0), 0);
                   return (
                       <div key={team.id} className="bg-[#1e293b] border border-gray-700 rounded-xl p-6">
                           <div className="flex items-center gap-3 mb-4">
                               <div className={`w-10 h-10 rounded-full ${team.color}`}></div>
                               <h2 className="text-xl font-bold">{team.name}</h2>
                           </div>
                           <div className="flex justify-between mb-2 text-sm text-gray-400"><span>Spent</span><span>{spent} / {room.config.totalBudget}</span></div>
                           <div className="flex justify-between mb-4 text-sm text-gray-400"><span>Players</span><span>{team.roster.length}</span></div>
                           <div className="space-y-2 h-48 overflow-y-auto pr-2">
                               {team.roster.map(p => (
                                   <div key={p.id} className="flex justify-between text-sm bg-gray-800 p-2 rounded">
                                       <span>{p.name}</span>
                                       <span className="font-bold text-yellow-500">{p.soldPrice}</span>
                                   </div>
                               ))}
                           </div>
                       </div>
                   );
                })}
            </div>
            <button onClick={() => window.location.reload()} className="mt-8 bg-blue-600 px-8 py-3 rounded font-bold">Back to Home</button>
        </div>
     );
  }

  // --- LOBBY & GAME VIEW (Shared) ---
  const gameView = view === 'GAME';

  return (
    <div className={`min-h-screen bg-[#0f172a] text-white flex flex-col ${gameView ? 'md:flex-row' : 'items-center p-4'}`}>
      
      {/* LOBBY VIEW CONTAINER */}
      {!gameView && (
        <div className="max-w-5xl w-full animate-fade-in">
             {/* Header */}
             <div className="flex justify-between items-center mb-8 bg-[#1e293b] p-6 rounded-2xl border border-gray-700">
                <div>
                   <h2 className="text-3xl font-display font-bold text-white">{room?.name}</h2>
                   <div className="flex items-center gap-4 mt-2">
                      <span className="bg-yellow-500 text-black px-2 py-0.5 rounded font-bold text-xs uppercase">Lobby</span>
                      <div className="flex items-center gap-2 bg-black/30 px-3 py-1 rounded border border-gray-600 cursor-pointer hover:bg-black/50" onClick={() => { navigator.clipboard.writeText(room?.id || ""); alert("Copied!"); }}>
                         <span className="text-gray-400 text-sm">Code:</span>
                         <span className="font-mono text-xl font-bold text-blue-400">{room?.id}</span>
                         <Copy size={14} className="text-gray-500"/>
                      </div>
                      <div className="flex items-center gap-2 bg-blue-900/30 px-3 py-1 rounded border border-blue-800 cursor-pointer hover:bg-blue-900/50" onClick={() => { navigator.clipboard.writeText(shareUrl); alert("Copied!"); }}>
                         <Share2 size={14} className="text-blue-400"/>
                         <span className="text-xs text-blue-200">Link</span>
                      </div>
                   </div>
                </div>
                <div className="flex items-center gap-4">
                   {isHost ? (
                      <button onClick={handleStartGame} className="bg-green-600 hover:bg-green-500 text-white px-8 py-3 rounded-lg font-bold shadow-lg shadow-green-900/40 animate-pulse">START AUCTION</button>
                   ) : (
                      <div className="text-right"><p className="text-gray-400 text-sm">Waiting for host...</p><p className="text-xs text-gray-600">{currentUser?.name}</p></div>
                   )}
                   <button onClick={() => window.location.reload()} className="p-3 bg-gray-800 rounded-full hover:bg-gray-700 text-gray-400"><LogOut size={20}/></button>
                </div>
             </div>
             
             {isHost && (
                <div className="mb-6 bg-yellow-900/30 border border-yellow-700 p-4 rounded-lg flex items-center gap-3">
                    <AlertCircle className="text-yellow-500 flex-shrink-0" />
                    <p className="text-sm text-yellow-200">
                        <strong>Important:</strong> Do not close or refresh this tab. You are the host server. 
                        If you leave, the room will close for everyone.
                    </p>
                </div>
             )}

             <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
                <div className="md:col-span-4 space-y-6">
                    <div className="bg-[#1e293b] p-6 rounded-2xl border border-gray-700">
                        <h3 className="text-lg font-bold mb-4 flex items-center gap-2"><User size={18}/> My Team</h3>
                        {!myTeam ? (
                           <div className="space-y-4">
                              <input type="text" className="w-full bg-gray-900 border border-gray-600 rounded p-2 text-white" value={newTeamName} onChange={e => setNewTeamName(e.target.value)} placeholder="Team Name" />
                              <input type="text" className="w-full bg-gray-900 border border-gray-600 rounded p-2 text-white" value={newTeamOwner} onChange={e => setNewTeamOwner(e.target.value)} placeholder="Owner Name" />
                              <button onClick={handleCreateTeam} className="w-full bg-blue-600 hover:bg-blue-500 text-white py-2 rounded font-bold">Register Team</button>
                           </div>
                        ) : (
                           <div className="text-center py-6 bg-black/20 rounded-xl border border-gray-800 cursor-pointer hover:bg-black/30 transition-colors" onClick={() => setSelectedTeamId(myTeam.id)}>
                              <div className={`w-16 h-16 rounded-full ${myTeam.color} mx-auto flex items-center justify-center text-2xl font-bold mb-3`}>{myTeam.name[0]}</div>
                              <h4 className="text-xl font-bold">{myTeam.name}</h4>
                              <p className="text-gray-500 text-sm">{myTeam.ownerName}</p>
                              <span className="text-xs text-blue-400 mt-2 block">Click to view details</span>
                           </div>
                        )}
                    </div>
                    {isHost && (
                        <div className="bg-[#1e293b] p-6 rounded-2xl border border-gray-700">
                           <h3 className="text-lg font-bold mb-4"><Settings size={18}/> Config</h3>
                           <button onClick={() => setShowSettings(true)} className="w-full bg-gray-800 hover:bg-gray-700 text-white py-3 rounded border border-gray-600 flex items-center justify-center gap-2">Configure</button>
                        </div>
                    )}
                </div>
                <div className="md:col-span-8 bg-[#1e293b] p-6 rounded-2xl border border-gray-700">
                    <h3 className="text-lg font-bold mb-4 flex items-center gap-2"><Users size={18}/> Teams ({room?.teams.length})</h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        {room?.teams.map(team => (
                           <div key={team.id} className="bg-gray-800 p-4 rounded-xl border border-gray-700 flex items-center gap-4 cursor-pointer hover:bg-gray-700 transition-colors" onClick={() => setSelectedTeamId(team.id)}>
                              <div className={`w-12 h-12 rounded-full ${team.color} flex items-center justify-center font-bold`}>{team.name[0]}</div>
                              <div><p className="font-bold text-white">{team.name}</p><p className="text-xs text-gray-400">{team.ownerName}</p></div>
                              {team.controlledByUserId === room.hostId && <Crown size={16} className="text-yellow-500 ml-auto"/>}
                           </div>
                        ))}
                    </div>
                    <div className="mt-8 border-t border-gray-700 pt-4"><h4 className="text-xs font-bold text-gray-500 uppercase mb-2">Members</h4><div className="flex flex-wrap gap-2">{room?.members.map(m => (<span key={m.userId} className="text-xs bg-black/40 text-gray-300 px-2 py-1 rounded border border-gray-700">{m.name}</span>))}</div></div>
                </div>
             </div>
        </div>
      )}

      {/* GAME VIEW */}
      {gameView && (
          <>
          {/* Sidebar */}
          <div className="w-full md:w-1/4 lg:w-1/5 bg-[#1e293b] border-r border-gray-700 flex flex-col h-[50vh] md:h-screen">
            <div className="p-4 border-b border-gray-700">
              <h1 className="text-xl font-display font-bold text-yellow-400 tracking-wider">IPL AUCTION</h1>
              <div className="flex items-center gap-2 mt-1 text-xs text-gray-400">
                <span className={`w-2 h-2 rounded-full ${room?.gameState.isPaused ? 'bg-red-500' : 'bg-green-500'}`}></span>
                {room?.gameState.isPaused ? 'PAUSED' : 'LIVE'}
              </div>
            </div>
            {isHost && (
                <div className="p-4 grid grid-cols-2 gap-2">
                    <button onClick={togglePause} className="bg-yellow-600 text-white p-2 rounded flex items-center justify-center gap-2 col-span-2">{room?.gameState.isPaused ? <Play size={16} /> : <Pause size={16} />}</button>
                    <button onClick={() => bringNextPlayer()} className="col-span-2 bg-gray-600 hover:bg-gray-700 text-white p-2 rounded flex items-center justify-center gap-2 text-sm mt-2"><SkipForward size={16} /> Force Next</button>
                    <button onClick={() => setShowEndConfirmation(true)} className="col-span-2 bg-red-800 hover:bg-red-700 text-white p-2 rounded flex items-center justify-center gap-2 text-sm mt-4 border border-red-600"><StopCircle size={16} /> End Auction</button>
                </div>
            )}
            <div className="flex-1 overflow-y-auto p-2 space-y-2 flex flex-col-reverse bg-[#0f172a]/50">
                {room?.gameState.logs.map(log => (
                    <div key={log.id} className="text-sm border-l-2 border-gray-600 pl-2 py-1 animate-fade-in"><p className={`${log.type==='BID'?'text-blue-300':log.type==='SOLD'?'text-green-400':'text-gray-300'}`}>{log.message}</p></div>
                ))}
            </div>
          </div>

          {/* Main Stage */}
          <div className="flex-1 flex flex-col h-[50vh] md:h-screen overflow-hidden relative">
             <div className="h-16 bg-[#1e293b] border-b border-gray-700 flex items-center justify-between px-6 shadow-md z-10">
                <div className="flex gap-8">
                   <div className="text-center"><p className="text-[10px] text-gray-400 uppercase">Pot</p><p className="font-bold text-xl text-yellow-500">{room?.gameState.currentPot}</p></div>
                   {room?.gameState.aiCommentary && <div className="hidden xl:block bg-purple-900/40 px-4 py-2 rounded-full text-sm italic text-purple-200">"{room.gameState.aiCommentary}"</div>}
                </div>
             </div>
             
             <div className="flex-1 bg-gradient-to-b from-[#0f172a] to-[#1e293b] flex flex-col items-center justify-center p-4">
               {room?.gameState.currentPlayerId ? (
                 <div className="w-full max-w-6xl grid grid-cols-1 md:grid-cols-12 gap-6">
                    <div className="md:col-span-5 relative bg-[#1e293b] rounded-2xl overflow-hidden shadow-2xl border border-gray-700">
                        {(() => {
                            const p = room.players.find(x => x.id === room?.gameState.currentPlayerId);
                            if (!p) return null;
                            return (
                                <>
                                <div className="h-80 relative">
                                    {p.imageUrl ? <img src={p.imageUrl} className="h-full w-full object-cover object-top"/> : <div className="h-full flex items-center justify-center"><User size={100}/></div>}
                                    <div className="absolute bottom-0 w-full p-6 bg-gradient-to-t from-black/90 to-transparent">
                                        <span className="bg-blue-600 text-xs px-2 py-0.5 rounded uppercase font-bold">{p.position}</span>
                                        <h2 className="text-4xl font-display font-bold text-white leading-tight">{p.name}</h2>
                                    </div>
                                </div>
                                <div className="p-4 flex justify-between bg-gray-800">
                                    <span className="text-xs uppercase text-gray-400 font-bold">Base</span>
                                    <span className="text-2xl font-display font-bold">{p.basePrice} L</span>
                                </div>
                                </>
                            );
                        })()}
                    </div>
                    <div className="md:col-span-7 bg-[#1e293b]/50 backdrop-blur rounded-2xl border border-gray-700 p-6 flex flex-col items-center justify-center relative">
                        <div className="relative mb-8">
                           <span className={`text-6xl font-display font-bold ${room.gameState.timer <= 5 ? 'text-red-500 animate-ping' : 'text-white'}`}>{room.gameState.timer}s</span>
                        </div>
                        <div className="text-center">
                            <p className="text-gray-400 text-xs uppercase font-bold tracking-widest mb-4">Current Bid</p>
                            <div className="text-7xl font-display font-bold text-green-400">{room.gameState.currentBid?.amount || "0"}</div>
                            <p className="text-xl mt-2 font-bold">{room.teams.find(t => t.id === room.gameState.currentBid?.teamId)?.name || "-"}</p>
                        </div>
                        {isHost && (
                            <div className="absolute bottom-4 right-4 flex gap-2">
                                <button onClick={() => handleUnsold(false)} className="bg-red-900/50 text-red-200 text-xs px-4 py-2 rounded-full border border-red-800">Mark Unsold</button>
                                {room.gameState.currentBid && <button onClick={() => handleSold(false)} className="bg-green-900/50 text-green-200 text-xs px-4 py-2 rounded-full border border-green-800">Mark Sold</button>}
                            </div>
                        )}
                    </div>
                 </div>
               ) : (
                  <div className="text-center opacity-50"><Gavel size={64} className="mx-auto mb-4"/><h2 className="text-2xl font-bold">Waiting for next player...</h2></div>
               )}
             </div>

             <div className="h-auto bg-[#1e293b] border-t border-gray-700 p-4 overflow-x-auto">
                <div className="flex gap-4 min-w-max pb-2">
                    {room?.teams.map(team => {
                        const isWinning = room.gameState.currentBid?.teamId === team.id;
                        const isMyTeam = team.controlledByUserId === currentUser?.id;
                        const currentAmount = room.gameState.currentBid?.amount || 0;
                        const base = room.players.find(p => p.id === room.gameState.currentPlayerId)?.basePrice || 0;
                        
                        // Bidding Increments
                        const minInc = 10;
                        const stdInc = room.config.minBidIncrement; // e.g., 20
                        const baseBid = currentAmount > 0 ? currentAmount : base;
                        const bid10 = baseBid + minInc;
                        const bidStd = baseBid + stdInc;

                        return (
                            <div key={team.id} 
                                 className={`w-72 bg-gray-800 rounded-xl p-3 border-2 relative cursor-pointer hover:bg-gray-700 transition-colors ${isWinning ? 'border-green-500' : isMyTeam ? 'border-blue-500' : 'border-gray-700'}`}
                                 onClick={() => setSelectedTeamId(team.id)}
                            >
                                <div className="flex justify-between items-start mb-2">
                                    <div className="flex items-center gap-2"><div className={`w-3 h-3 rounded-full ${team.color}`}></div><span className="text-xs font-bold text-gray-400">{team.ownerName}</span></div>
                                    <span className="text-xs bg-black/30 px-1.5 rounded text-gray-400">{team.roster.length}/{room.config.maxPlayers}</span>
                                </div>
                                <h4 className="font-bold text-white truncate mb-2">{team.name}</h4>
                                <div className="flex justify-between items-center bg-black/20 p-2 rounded mb-2">
                                    <span className="text-[10px] uppercase text-gray-500">Purse</span>
                                    <span className="font-display text-yellow-500">{team.budget}</span>
                                </div>
                                {isWinning ? <div className="w-full bg-green-600 text-white text-center py-1 rounded text-xs font-bold">Leading</div> : 
                                 (!room.gameState.currentPlayerId || room.gameState.isPaused) ? <div className="w-full bg-gray-700 text-gray-500 text-center py-1 rounded text-xs">Waiting</div> :
                                 (isHost || isMyTeam) ? (
                                    <div className="flex gap-1" onClick={e => e.stopPropagation()}>
                                        <button onClick={() => placeBid(team.id, bid10)} className="flex-1 bg-blue-600 hover:bg-blue-500 text-white py-1 rounded text-xs font-bold border-r border-blue-700">+{minInc}</button>
                                        <button onClick={() => placeBid(team.id, bidStd)} className="flex-1 bg-blue-600 hover:bg-blue-500 text-white py-1 rounded text-xs font-bold">+{stdInc}</button>
                                    </div>
                                 ) :
                                 <div className="w-full bg-gray-800 text-center py-1 rounded text-xs text-gray-600">Spectating</div>
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
          <div className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4 backdrop-blur-sm">
             <div className="bg-[#1e293b] rounded-2xl w-full max-w-2xl border border-gray-700 shadow-2xl flex flex-col max-h-[80vh]">
                 {(() => {
                     const t = room.teams.find(x => x.id === selectedTeamId);
                     if (!t) return null;
                     const spent = t.roster.reduce((sum, p) => sum + (p.soldPrice||0), 0);
                     return (
                         <>
                             <div className="p-6 border-b border-gray-700 flex justify-between items-center">
                                 <div className="flex items-center gap-4">
                                     <div className={`w-12 h-12 rounded-full ${t.color} flex items-center justify-center font-bold text-xl`}>{t.name[0]}</div>
                                     <div>
                                         <h2 className="text-2xl font-bold">{t.name}</h2>
                                         <p className="text-gray-400 text-sm">{t.ownerName}</p>
                                     </div>
                                 </div>
                                 <button onClick={() => setSelectedTeamId(null)}><XCircle className="text-gray-400 hover:text-white"/></button>
                             </div>
                             <div className="p-6 grid grid-cols-3 gap-4 border-b border-gray-700 bg-gray-900/30">
                                 <div className="text-center">
                                     <p className="text-gray-500 text-xs uppercase font-bold">Budget Left</p>
                                     <p className="text-xl font-display font-bold text-green-400">{t.budget}</p>
                                 </div>
                                 <div className="text-center">
                                     <p className="text-gray-500 text-xs uppercase font-bold">Spent</p>
                                     <p className="text-xl font-display font-bold text-red-400">{spent}</p>
                                 </div>
                                 <div className="text-center">
                                     <p className="text-gray-500 text-xs uppercase font-bold">Squad</p>
                                     <p className="text-xl font-display font-bold text-blue-400">{t.roster.length} / {room.config.maxPlayers}</p>
                                 </div>
                             </div>
                             <div className="p-6 overflow-y-auto flex-1">
                                 <h3 className="font-bold mb-4 text-gray-400 text-sm uppercase">Squad List</h3>
                                 {t.roster.length === 0 ? <p className="text-gray-600 italic">No players purchased yet.</p> : (
                                     <div className="space-y-2">
                                         {t.roster.map(p => (
                                             <div key={p.id} className="flex justify-between items-center bg-gray-800 p-3 rounded border border-gray-700">
                                                 <div className="flex items-center gap-3">
                                                     <div className="w-8 h-8 bg-gray-700 rounded-full overflow-hidden">
                                                        {p.imageUrl ? <img src={p.imageUrl} className="w-full h-full object-cover"/> : <User className="p-1"/>}
                                                     </div>
                                                     <div>
                                                         <p className="font-bold text-sm">{p.name}</p>
                                                         <p className="text-[10px] text-gray-400 uppercase">{p.position}</p>
                                                     </div>
                                                 </div>
                                                 <span className="font-mono font-bold text-yellow-500">{p.soldPrice} L</span>
                                             </div>
                                         ))}
                                     </div>
                                 )}
                             </div>
                         </>
                     );
                 })()}
             </div>
          </div>
      )}

      {/* END GAME CONFIRMATION MODAL */}
      {showEndConfirmation && (
          <div className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4 backdrop-blur-sm">
              <div className="bg-[#1e293b] rounded-xl max-w-md w-full p-6 border border-red-500/50 shadow-2xl text-center">
                  <AlertCircle className="w-16 h-16 text-red-500 mx-auto mb-4"/>
                  <h2 className="text-2xl font-bold text-white mb-2">End Auction?</h2>
                  <p className="text-gray-400 mb-6">Are you sure you want to stop the auction? This action cannot be undone and will show the final results.</p>
                  <div className="flex gap-4">
                      <button onClick={() => setShowEndConfirmation(false)} className="flex-1 bg-gray-700 hover:bg-gray-600 text-white py-3 rounded font-bold">Cancel</button>
                      <button onClick={handleEndGame} className="flex-1 bg-red-600 hover:bg-red-500 text-white py-3 rounded font-bold">Yes, End It</button>
                  </div>
              </div>
          </div>
      )}

      {/* SETTINGS MODAL */}
      {showSettings && (
         <div className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4 backdrop-blur-sm">
             <div className="bg-[#1e293b] rounded-2xl w-full max-w-4xl border border-gray-700 shadow-2xl flex flex-col max-h-[90vh]">
                 <div className="p-6 border-b border-gray-700 flex justify-between"><h2 className="text-xl font-bold">Settings</h2><button onClick={() => setShowSettings(false)}><XCircle/></button></div>
                 <div className="flex border-b border-gray-700 px-6 bg-gray-900/30">
                     <button onClick={() => setActiveSettingsTab('config')} className={`px-4 py-3 text-sm font-bold border-b-2 ${activeSettingsTab==='config'?'border-blue-500 text-blue-400':'border-transparent text-gray-400'}`}>Config</button>
                     <button onClick={() => setActiveSettingsTab('teams')} className={`px-4 py-3 text-sm font-bold border-b-2 ${activeSettingsTab==='teams'?'border-blue-500 text-blue-400':'border-transparent text-gray-400'}`}>Teams</button>
                     <button onClick={() => setActiveSettingsTab('import')} className={`px-4 py-3 text-sm font-bold border-b-2 ${activeSettingsTab==='import'?'border-blue-500 text-blue-400':'border-transparent text-gray-400'}`}>Import</button>
                 </div>
                 <div className="p-6 overflow-y-auto flex-1">
                     {activeSettingsTab === 'config' && (
                         <div className="grid grid-cols-2 gap-4">
                            <div className="bg-gray-800 p-3 rounded">
                                <label className="text-xs text-gray-500 font-bold">Budget</label>
                                <input type="number" value={room?.config.totalBudget} onChange={e => roomService.dispatch({type:'UPDATE_CONFIG', payload: {totalBudget: parseInt(e.target.value)}})} className="w-full bg-gray-900 p-2 rounded mt-1 border border-gray-600"/>
                            </div>
                            <div className="bg-gray-800 p-3 rounded">
                                <label className="text-xs text-gray-500 font-bold">Timer</label>
                                <input type="number" value={room?.config.bidTimerSeconds} onChange={e => roomService.dispatch({type:'UPDATE_CONFIG', payload: {bidTimerSeconds: parseInt(e.target.value)}})} className="w-full bg-gray-900 p-2 rounded mt-1 border border-gray-600"/>
                            </div>
                         </div>
                     )}
                     {activeSettingsTab === 'teams' && (
                         <div className="space-y-2">
                             {room?.teams.map(t => (
                                 <div key={t.id} className="flex justify-between bg-gray-800 p-2 rounded items-center">
                                     <span>{t.name}</span>
                                     <button onClick={() => roomService.dispatch({type:'REMOVE_TEAM', payload:{teamId: t.id}})} className="text-red-400"><Trash2 size={16}/></button>
                                 </div>
                             ))}
                         </div>
                     )}
                     {activeSettingsTab === 'import' && (
                         <div className="space-y-4">
                             <input type="text" placeholder="Sheet URL" value={sheetUrl} onChange={e => setSheetUrl(e.target.value)} className="w-full bg-gray-900 p-2 rounded border border-gray-600"/>
                             <button onClick={handleFetchFromSheet} className="bg-blue-600 px-4 py-2 rounded text-sm font-bold flex items-center gap-2">{isFetchingSheet && <RefreshCw size={14} className="animate-spin"/>} Fetch</button>
                             {fetchedPreview.length > 0 && <button onClick={confirmImport} className="w-full bg-green-600 py-2 rounded font-bold">Import {fetchedPreview.length} Players</button>}
                         </div>
                     )}
                 </div>
             </div>
         </div>
      )}
    </div>
  );
}
