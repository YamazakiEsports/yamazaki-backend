const express = require('express');
const session = require('express-session');
const { createServer } = require('http');
const { Server } = require('socket.io');
const axios = require('axios');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: (o, cb) => cb(null, true), credentials: true } });

const DISCORD_CLIENT_ID     = process.env.DISCORD_CLIENT_ID     || '1487640781811355648';
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
const ADMIN_PASSWORD        = process.env.ADMIN_PASSWORD        || 'YamazakiAdmin2025';
// Single URL — backend serves frontend on same port
const BASE_URL = process.env.BASE_URL;const REDIRECT_URI = `${BASE_URL}/auth/callback`;
const FRONTEND_URL          = BASE_URL;
const MAX_TEAMS             = 50;
const MAX_TEAMS_RELOAD      = 20;

// ── Zones per mode ─────────────────────────────────────────────────────────────
// BR zones loaded from file; Reload zones hardcoded
const zonesReload = [{"id":"z1775689188041","name":"Zone 1","maxTeams":2,"points":[{"px":15.027,"py":2.891},{"px":33.789,"py":3.022},{"px":33.698,"py":23.522},{"px":14.572,"py":23.785}]},{"id":"z1775689223768","name":"Zone 2","maxTeams":2,"points":[{"px":51.639,"py":36.399},{"px":61.02,"py":36.531},{"px":60.565,"py":16.426},{"px":51.73,"py":16.163}]},{"id":"z1775689252959","name":"Zone 3","maxTeams":2,"points":[{"px":70.947,"py":59.658},{"px":89.891,"py":59.658},{"px":89.526,"py":38.108},{"px":70.401,"py":37.845}]},{"id":"z1775689292063","name":"Zone 4","maxTeams":2,"points":[{"px":38.069,"py":69.383},{"px":50.911,"py":69.645},{"px":50.638,"py":57.03},{"px":38.16,"py":56.899}]},{"id":"z1775689330895","name":"Zone 5","maxTeams":2,"points":[{"px":39.527,"py":79.106},{"px":62.205,"py":78.449},{"px":62.66,"py":91.59},{"px":39.527,"py":92.116}]},{"id":"z1775689348038","name":"Zone 6","maxTeams":2,"points":[{"px":19.034,"py":69.909},{"px":27.959,"py":69.909},{"px":28.324,"py":88.174},{"px":18.852,"py":88.306}]},{"id":"z1775689387029","name":"Zone 7","maxTeams":1,"points":[{"px":10.747,"py":25.231},{"px":18.124,"py":25.231},{"px":18.306,"py":33.509},{"px":10.656,"py":33.773}]},{"id":"z1775689414316","name":"Zone 8","maxTeams":1,"points":[{"px":11.112,"py":42.575},{"px":26.412,"py":42.444},{"px":26.412,"py":51.38},{"px":11.02,"py":51.643}]},{"id":"z1775689550962","name":"Zone 9","maxTeams":1,"points":[{"px":29.599,"py":76.478},{"px":35.61,"py":76.478},{"px":34.973,"py":52.431},{"px":27.231,"py":52.431},{"px":27.14,"py":61.629},{"px":26.867,"py":68.725},{"px":29.508,"py":68.857}]},{"id":"z1775689582793","name":"Zone 10","maxTeams":1,"points":[{"px":65.664,"py":74.901},{"px":75.956,"py":74.244},{"px":76.229,"py":87.385},{"px":66.028,"py":88.042}]},{"id":"z1775689609169","name":"Zone 11","maxTeams":1,"points":[{"px":38.707,"py":55.191},{"px":49.909,"py":55.059},{"px":49.818,"py":43.89},{"px":38.525,"py":44.021}]},{"id":"z1775689672856","name":"Zone 12","maxTeams":1,"points":[{"px":52.914,"py":48.883},{"px":52.732,"py":67.017},{"px":55.373,"py":66.885},{"px":55.191,"py":74.244},{"px":65.301,"py":73.981},{"px":65.209,"py":63.6},{"px":70.492,"py":63.601},{"px":69.945,"py":48.883}]},{"id":"z1775689719255","name":"Zone 13","maxTeams":1,"points":[{"px":38.343,"py":36.136},{"px":46.63,"py":36.53},{"px":46.63,"py":16.162},{"px":38.616,"py":16.294}]},{"id":"z1775689768534","name":"Zone 14","maxTeams":1,"points":[{"px":37.887,"py":44.809},{"px":27.231,"py":45.072},{"px":27.596,"py":28.515},{"px":35.155,"py":28.515},{"px":34.973,"py":37.714},{"px":37.887,"py":37.582}]}];

// ── Persistence ────────────────────────────────────────────────────────────────
const DATA = path.join(__dirname, 'data');
if (!fs.existsSync(DATA)) fs.mkdirSync(DATA);
const rj = (f, fb) => { try { const p = path.join(DATA,f); if(fs.existsSync(p)) return JSON.parse(fs.readFileSync(p,'utf8')); } catch(e){} return fb; };
const wj = (f, d) => { try { fs.writeFileSync(path.join(DATA,f), JSON.stringify(d,null,2)); } catch(e){} };

// ── State ──────────────────────────────────────────────────────────────────────
let zones    = rj('zones.json', []);
let sessions = rj('sessions.json', []);
let liveTeams      = rj('liveTeams.json', {});
let liveZoneClaims = rj('liveZoneClaims.json', {});
let liveConnected  = rj('liveConnected.json', {}); // players logged in but no zone yet

// On startup, if there's no live session, wipe any stale live data
if (!sessions.find(s => s.status === 'live')) {
  liveTeams = {};
  liveZoneClaims = {};
  liveConnected = {};
}
const ADMIN_TOKENS_FILE = path.join(DATA, 'admin_tokens.json');
const ALL_TOKENS_FILE   = path.join(DATA, 'all_tokens.json');
const tokenStore = {};

// Load persisted tokens on startup
try {
  // Load all user tokens first
  if (fs.existsSync(ALL_TOKENS_FILE)) {
    const saved = JSON.parse(fs.readFileSync(ALL_TOKENS_FILE, 'utf8'));
    Object.assign(tokenStore, saved);
    console.log(`Loaded ${Object.keys(saved).length} token(s) from disk`);
  }
  // Then overlay admin tokens (legacy file support)
  if (fs.existsSync(ADMIN_TOKENS_FILE)) {
    const saved = JSON.parse(fs.readFileSync(ADMIN_TOKENS_FILE, 'utf8'));
    Object.assign(tokenStore, saved);
  }
} catch(e) { console.log('Could not load tokens:', e.message); }

function saveAdminTokens() {
  try {
    // Save all tokens so Discord users survive restarts too
    fs.writeFileSync(ALL_TOKENS_FILE, JSON.stringify(tokenStore));
    // Also save admin-only subset to legacy file
    const admins = {};
    for (const [k,v] of Object.entries(tokenStore)) { if (v.isAdmin) admins[k] = v; }
    fs.writeFileSync(ADMIN_TOKENS_FILE, JSON.stringify(admins));
  } catch(e) {}
}

const gen = (n=48) => { const c='abcdefghijklmnopqrstuvwxyz0123456789'; let t=''; for(let i=0;i<n;i++) t+=c[Math.floor(Math.random()*c.length)]; return t; };
const getUser = req => { const t=req.headers['x-auth-token']||req.body?.token; return t?tokenStore[t]:null; };
const getLive = () => sessions.find(s=>s.status==='live')||null;

function getActiveZones() { const live=getLive(); return (live?.mapMode==='reload') ? zonesReload : zones; }
function getMaxTeams()    { const live=getLive(); return (live?.mapMode==='reload') ? MAX_TEAMS_RELOAD : MAX_TEAMS; }

function broadcastState() {
  wj('liveTeams.json', liveTeams);
  wj('liveZoneClaims.json', liveZoneClaims);
  wj('liveConnected.json', liveConnected);
  io.emit('state_update', { teams:liveTeams, zoneClaims:liveZoneClaims, connected:liveConnected, zones:getActiveZones(), maxTeams:getMaxTeams(), activeSession:getLive(), sessions });
}

app.use(cors({ origin:(o,cb)=>cb(null,true), credentials:true }));
app.use(express.json({ limit:'5mb' }));
app.use(session({ secret: process.env.SESSION_SECRET||'yze-v2', resave:false, saveUninitialized:false, cookie:{secure:false,maxAge:86400000} }));

// Serve frontend static files on same port
app.use(express.static(path.join(__dirname, '.')));

// ── Auth ───────────────────────────────────────────────────────────────────────
app.get('/auth/discord', (req,res) => {
  const state = req.query.state||'';
  res.redirect(`https://discord.com/api/oauth2/authorize?${new URLSearchParams({ client_id:DISCORD_CLIENT_ID, redirect_uri:REDIRECT_URI, response_type:'code', scope:'identify', state })}`);
});

app.get('/auth/callback', async (req,res) => {
  const {code,state} = req.query;
  if(!code) return res.redirect(`${FRONTEND_URL}?error=no_code`);
  try {
    const tr = await axios.post('https://discord.com/api/oauth2/token', new URLSearchParams({ client_id:DISCORD_CLIENT_ID, client_secret:DISCORD_CLIENT_SECRET, grant_type:'authorization_code', code, redirect_uri:REDIRECT_URI }), { headers:{'Content-Type':'application/x-www-form-urlencoded'} });
    const du = await axios.get('https://discord.com/api/users/@me', { headers:{Authorization:`Bearer ${tr.data.access_token}`} });
    const user = { discordId:du.data.id, username:du.data.username, avatar: du.data.avatar ? `https://cdn.discordapp.com/avatars/${du.data.id}/${du.data.avatar}.png` : `https://cdn.discordapp.com/embed/avatars/0.png`, isAdmin:false };
    const tok = gen(32); tokenStore[tok] = user;
    saveAdminTokens(); // persist so token survives server restarts
    if(state && state.length>10) res.redirect(`${FRONTEND_URL}/map.html?token=${tok}&session=${state}`);
    else res.redirect(`${FRONTEND_URL}?token=${tok}`);
  } catch(e) { res.redirect(`${FRONTEND_URL}?error=auth_failed`); }
});

app.get('/auth/me', (req,res) => { const u=getUser(req); res.json({user:u||null}); });
app.post('/auth/logout', (req,res) => { req.session.destroy(); res.json({ok:true}); });
app.post('/auth/admin-login', (req,res) => {
  if(req.body.password!==ADMIN_PASSWORD) return res.status(403).json({error:'Wrong password'});
  const user={discordId:'admin',username:'Admin',avatar:null,isAdmin:true};
  const tok=gen(32); tokenStore[tok]=user; saveAdminTokens();
  res.json({ok:true,token:tok,user});
});

// ── Zones ──────────────────────────────────────────────────────────────────────
app.get('/api/zones', (req,res) => res.json(zones));
app.post('/api/admin/zones', (req,res) => {
  const u=getUser(req); if(!u?.isAdmin) return res.status(403).json({error:'Not admin'});
  if(!Array.isArray(req.body.zones)) return res.status(400).json({error:'zones must be array'});
  zones = req.body.zones; wj('zones.json', zones); broadcastState();
  res.json({ok:true, count:zones.length});
});

// ── Sessions ───────────────────────────────────────────────────────────────────
app.get('/api/sessions', (req,res) => res.json(sessions));

app.post('/api/admin/session/start', (req,res) => {
  const u=getUser(req); if(!u?.isAdmin) return res.status(403).json({error:'Not admin'});
  // Close existing live session with snapshot
  const existing = getLive();
  if(existing) {
    existing.status='complete';
    existing.teams=Object.keys(liveTeams).length;
    existing.snapshot={ teams:{...liveTeams}, zoneClaims:{...liveZoneClaims}, zones:[...zones] };
  }
  liveTeams={}; liveZoneClaims={}; liveConnected={};
  const {title,type,mapMode} = req.body;
  const t = type||'duo';
  const m = (mapMode==='reload') ? 'reload' : 'br';
  const num = sessions.filter(s=>s.type===t).length+1;
  const secret = gen(48);
  const sess = {
    id:'sess_'+Date.now(),
    title: (title&&title.trim()) ? title.trim() : `Yamazaki ${m==='reload'?'Reload':'BR'} ${t==='solo'?'Solo':'Duo'} Session ${num}`,
    type:t, mapMode:m, status:'live', date:Date.now(), teams:0, zones:getActiveZones().length,
    secretToken:secret,
    mapUrl:`${FRONTEND_URL}/map.html?session=${secret}`,
    snapshot:null
  };
  sessions.unshift(sess); wj('sessions.json',sessions); broadcastState();
  res.json({ok:true,session:sess});
});

app.post('/api/admin/session/end', (req,res) => {
  const u=getUser(req); if(!u?.isAdmin) return res.status(403).json({error:'Not admin'});
  const live=getLive(); if(!live) return res.status(400).json({error:'No live session'});
  live.status='complete';
  live.teams=Object.keys(liveTeams).length;
  // Save full snapshot so we can replay it in history
  live.snapshot={ teams:JSON.parse(JSON.stringify(liveTeams)), zoneClaims:JSON.parse(JSON.stringify(liveZoneClaims)), zones:JSON.parse(JSON.stringify(zones)) };
  wj('sessions.json',sessions); broadcastState();
  res.json({ok:true});
});


app.post('/api/admin/session/delete', (req,res) => {
  const u=getUser(req); if(!u?.isAdmin) return res.status(403).json({error:'Not admin'});
  const {sessionId}=req.body;
  const idx=sessions.findIndex(s=>s.id===sessionId);
  if(idx===-1) return res.status(404).json({error:'Session not found'});
  if(sessions[idx].status==='live') return res.status(400).json({error:'Cannot delete a live session — end it first'});
  sessions.splice(idx,1);
  wj('sessions.json',sessions);
  broadcastState();
  res.json({ok:true});
});

app.get('/api/session/validate', (req,res) => {
  const live=getLive();
  if(!live) return res.json({valid:false,reason:'No active session right now.'});
  if(live.secretToken!==req.query.token) return res.json({valid:false,reason:'This link is invalid or the session has ended.'});
  res.json({valid:true,session:{id:live.id,title:live.title,type:live.type,mapMode:live.mapMode||'br'}});
});

app.get('/api/session/:id/snapshot', (req,res) => {
  const s=sessions.find(x=>x.id===req.params.id);
  if(!s) return res.status(404).json({error:'Not found'});
  res.json({session:s,snapshot:s.snapshot||null});
});

// ── Game state ─────────────────────────────────────────────────────────────────
app.get('/api/state', (req,res) => res.json({ teams:liveTeams, zoneClaims:liveZoneClaims, connected:liveConnected, zones:getActiveZones(), maxTeams:getMaxTeams(), activeSession:getLive(), sessions }));

// ── Check-in (appear in list without claiming a zone) ──────────────────────────
app.post('/api/checkin', (req,res) => {
  const u=getUser(req); if(!u||u.isAdmin) return res.json({ok:true}); // admins don't check in
  const live=getLive(); if(!live) return res.json({ok:true});
  const uid=`user_${u.discordId}`;
  liveConnected[uid]={ uid, discordId:u.discordId, username:u.username, avatar:u.avatar, joinedTs:liveConnected[uid]?.joinedTs||Date.now() };
  broadcastState(); res.json({ok:true});
});

app.post('/api/register', (req,res) => {
  const u=getUser(req); if(!u) return res.status(401).json({error:'Not logged in'});
  const {zoneId,sessionToken}=req.body;
  const live=getLive();
  if(!live) return res.status(400).json({error:'No live session active'});
  if(live.secretToken!==sessionToken) return res.status(403).json({error:'Invalid session link'});
  if(!zoneId) return res.status(400).json({error:'Missing zone'});
  const zone=getActiveZones().find(z=>z.id===zoneId);
  if(!zone) return res.status(404).json({error:'Zone not found'});
  const existing=Object.values(liveTeams).find(t=>t.player1DiscordId===u.discordId);
  if(!existing && Object.keys(liveTeams).length>=MAX_TEAMS) return res.status(400).json({error:`Session full`});
  if(existing){
    const old=existing.zoneId;
    if(old&&old!==zoneId){ liveZoneClaims[old]=(liveZoneClaims[old]||[]).filter(t=>t!==existing.teamId); if(!liveZoneClaims[old].length) delete liveZoneClaims[old]; }
  }
  const cur=(liveZoneClaims[zoneId]||[]).filter(t=>{ const tm=liveTeams[t]; return tm&&tm.player1DiscordId!==u.discordId; });
  if(cur.length>=zone.maxTeams) return res.status(400).json({error:`Zone full`});
  const tid=existing?.teamId||`team_${u.discordId}`;
  liveTeams[tid]={ teamId:tid, teamName:u.username, player1DiscordId:u.discordId, player1Username:u.username, player1Avatar:u.avatar, player2Discord:'', zoneId, ts:existing?.ts||Date.now(), updatedTs:Date.now() };
  liveZoneClaims[zoneId]=[...cur,tid];
  live.teams=Object.keys(liveTeams).length; wj('sessions.json',sessions);
  broadcastState(); res.json({ok:true});
});

app.post('/api/release', (req,res) => {
  const u=getUser(req); if(!u) return res.status(401).json({error:'Not logged in'});
  const tid=`team_${u.discordId}`, team=liveTeams[tid];
  if(team){ liveZoneClaims[team.zoneId]=(liveZoneClaims[team.zoneId]||[]).filter(t=>t!==tid); if(!liveZoneClaims[team.zoneId].length) delete liveZoneClaims[team.zoneId]; delete liveTeams[tid]; }
  broadcastState(); res.json({ok:true});
});

app.post('/api/admin/assign', (req,res) => {
  const u=getUser(req); if(!u?.isAdmin) return res.status(403).json({error:'Not admin'});
  const {discordId, zoneId}=req.body;
  const live=getLive(); if(!live) return res.status(400).json({error:'No live session'});
  // Find user info from connected or tokenStore
  const connEntry=Object.values(liveConnected).find(c=>c.discordId===discordId);
  const tokEntry=Object.values(tokenStore).find(t=>t.discordId===discordId&&!t.isAdmin);
  const userInfo=connEntry||tokEntry;
  if(!userInfo) return res.status(404).json({error:'User not found'});
  const zone=getActiveZones().find(z=>z.id===zoneId);
  if(!zone) return res.status(404).json({error:'Zone not found'});
  const tid=`team_${discordId}`;
  const existing=liveTeams[tid];
  if(existing){
    const old=existing.zoneId;
    if(old&&old!==zoneId){ liveZoneClaims[old]=(liveZoneClaims[old]||[]).filter(t=>t!==tid); if(!liveZoneClaims[old].length) delete liveZoneClaims[old]; }
  }
  const cur=(liveZoneClaims[zoneId]||[]).filter(t=>{ const tm=liveTeams[t]; return tm&&tm.player1DiscordId!==discordId; });
  if(cur.length>=zone.maxTeams) return res.status(400).json({error:'Zone full'});
  liveTeams[tid]={ teamId:tid, teamName:userInfo.username, player1DiscordId:discordId, player1Username:userInfo.username, player1Avatar:userInfo.avatar||'https://cdn.discordapp.com/embed/avatars/0.png', player2Discord:'', zoneId, ts:existing?.ts||Date.now(), updatedTs:Date.now() };
  liveZoneClaims[zoneId]=[...cur,tid];
  live.teams=Object.keys(liveTeams).length; wj('sessions.json',sessions);
  broadcastState(); res.json({ok:true});
});

app.post('/api/admin/move', (req,res) => {
  const u=getUser(req); if(!u?.isAdmin) return res.status(403).json({error:'Not admin'});
  const {teamId,toZoneId}=req.body; const team=liveTeams[teamId];
  if(!team) return res.status(404).json({error:'Team not found'});
  const toZone=getActiveZones().find(z=>z.id===toZoneId);
  if(!toZone) return res.status(404).json({error:'Zone not found'});
  const inTo=(liveZoneClaims[toZoneId]||[]).filter(t=>t!==teamId);
  if(inTo.length>=toZone.maxTeams) return res.status(400).json({error:'Zone full'});
  liveZoneClaims[team.zoneId]=(liveZoneClaims[team.zoneId]||[]).filter(t=>t!==teamId);
  if(!liveZoneClaims[team.zoneId].length) delete liveZoneClaims[team.zoneId];
  team.zoneId=toZoneId; liveZoneClaims[toZoneId]=[...inTo,teamId];
  broadcastState(); res.json({ok:true});
});

app.post('/api/admin/remove', (req,res) => {
  const u=getUser(req); if(!u?.isAdmin) return res.status(403).json({error:'Not admin'});
  const {teamId}=req.body; const team=liveTeams[teamId];
  if(team){ liveZoneClaims[team.zoneId]=(liveZoneClaims[team.zoneId]||[]).filter(t=>t!==teamId); if(!liveZoneClaims[team.zoneId].length) delete liveZoneClaims[team.zoneId]; delete liveTeams[teamId]; }
  broadcastState(); res.json({ok:true});
});

app.post('/api/admin/reset', (req,res) => {
  const u=getUser(req); if(!u?.isAdmin) return res.status(403).json({error:'Not admin'});
  liveTeams={}; liveZoneClaims={}; liveConnected={}; broadcastState(); res.json({ok:true});
});

io.on('connection', socket => {
  socket.emit('state_update', { teams:liveTeams, zoneClaims:liveZoneClaims, connected:liveConnected, zones:getActiveZones(), maxTeams:getMaxTeams(), activeSession:getLive(), sessions });
});

const PORT = process.env.PORT||3001;
httpServer.listen(PORT, ()=>console.log(`✅ Yamazaki server on port ${PORT}`));
