const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 8080;
const TICK_RATE = 60;
const FIELD_SIZE = 2000;
const MATCH_DURATION = 180000;
const VIEW_RADIUS = 250;
const FOG_ALPHA = 0.97;

const GAME = {
  PLAYER_RADIUS: 14,
  PARASITE_RADIUS: 7,
  PLAYER_SPEED: 3.5,
  INFECT_DURATION: 5000,
  INFECT_COOLDOWN: 1500,
  INFECT_RANGE: 50,
  MIN_EXIT_DISTANCE: 60,
  STUN_DURATION: 250,
  MAX_PARASITES_PER_HOST: 4,
  RAGE_THRESHOLD: 15000,
  RAGE_DURATION: 2000,
  RAGE_SPEED_MULTIPLIER: 1.6,
  KNOCKBACK_FORCE: 8,
  MAX_MOVE_PER_TICK: 8,
  MOVE_MESSAGE_MIN_INTERVAL: 25,
  MOVE_BURST_LIMIT: 8,
  POWERUP_COUNT: 6,
  POWERUP_DURATION: 8000,
  OBSTACLES: [
    { x: 300, y: 300, w: 200, h: 200, type: 'building' },
    { x: 1500, y: 300, w: 200, h: 200, type: 'building' },
    { x: 300, y: 1500, w: 200, h: 200, type: 'building' },
    { x: 1500, y: 1500, w: 200, h: 200, type: 'building' },
    { x: 900, y: 900, w: 200, h: 200, type: 'building' },
    { x: 150, y: 850, w: 120, h: 300, type: 'wall' },
    { x: 1730, y: 850, w: 120, h: 300, type: 'wall' },
    { x: 850, y: 150, w: 300, h: 120, type: 'wall' },
    { x: 850, y: 1730, w: 300, h: 120, type: 'wall' },
    { x: 600, y: 600, w: 100, h: 100, type: 'tree' },
    { x: 1300, y: 600, w: 100, h: 100, type: 'tree' },
    { x: 600, y: 1300, w: 100, h: 100, type: 'tree' },
    { x: 1300, y: 1300, w: 100, h: 100, type: 'tree' }
  ],
  POWERUP_TYPES: [
    { id: 'speed', name: 'Speed', icon: '⚡', color: '#00bfff', desc: '1.8x скорость на 8 сек' },
    { id: 'shield', name: 'Shield', icon: '🛡️', color: '#da70d6', desc: 'Защита от заражений' },
    { id: 'invisibility', name: 'Ghost', icon: '👻', color: '#ffffff', desc: 'Невидимость 8 сек' },
    { id: 'double', name: '2x Score', icon: '💰', color: '#ffd700', desc: 'Двойные очки' }
  ],
  ZONES: [
    { x: 0, y: 0, w: 400, h: 400, name: 'Spawn Zone', safe: true },
    { x: 1600, y: 0, w: 400, h: 400, name: 'North Base', safe: true },
    { x: 0, y: 1600, w: 400, h: 400, name: 'South Base', safe: true },
    { x: 1600, y: 1600, w: 400, h: 400, name: 'East Base', safe: true },
    { x: 800, y: 800, w: 400, h: 400, name: 'Battle Zone', safe: false }
  ]
};

const clientPath = path.join(__dirname, '..', 'client', 'index.html');
const accountsPath = path.join(__dirname, 'accounts.json');

let accounts = {};
try {
  if (fs.existsSync(accountsPath)) {
    accounts = JSON.parse(fs.readFileSync(accountsPath, 'utf8'));
  }
} catch (e) { accounts = {}; }

function saveAccounts() {
  try { fs.writeFileSync(accountsPath, JSON.stringify(accounts, null, 2)); } catch (e) {}
}

function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

const server = http.createServer((req, res) => {
  if (req.url === '/' || req.url === '/index.html') {
    fs.readFile(clientPath, (err, data) => {
      if (err) { res.writeHead(500); res.end('Error'); return; }
      res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(data);
    });
  } else if (req.url === '/api/register' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { username, password } = JSON.parse(body);
        if (!username || !password) { res.writeHead(400); res.end(JSON.stringify({ error: 'Fill all fields' })); return; }
        if (username.length < 3 || username.length > 20) { res.writeHead(400); res.end(JSON.stringify({ error: 'Username 3-20 chars' })); return; }
        if (password.length < 4) { res.writeHead(400); res.end(JSON.stringify({ error: 'Password 4+ chars' })); return; }
        if (accounts[username]) { res.writeHead(409); res.end(JSON.stringify({ error: 'Username exists' })); return; }
        accounts[username] = { password: hashPassword(password), created: Date.now(), gamesPlayed: 0, totalScore: 0, wins: 0 };
        saveAccounts();
        res.writeHead(200); res.end(JSON.stringify({ success: true }));
      } catch (e) { res.writeHead(400); res.end(JSON.stringify({ error: 'Invalid request' })); }
    });
  } else if (req.url === '/api/login' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { username, password } = JSON.parse(body);
        if (!accounts[username] || accounts[username].password !== hashPassword(password)) {
          res.writeHead(401); res.end(JSON.stringify({ error: 'Invalid credentials' })); return;
        }
        res.writeHead(200); res.end(JSON.stringify({ success: true, stats: { gamesPlayed: accounts[username].gamesPlayed, totalScore: accounts[username].totalScore, wins: accounts[username].wins } }));
      } catch (e) { res.writeHead(400); res.end(JSON.stringify({ error: 'Invalid request' })); }
    });
  } else { res.writeHead(426); res.end('Upgrade Required'); }
});

const wss = new WebSocket.Server({ server, maxPayload: 512, perMessageDeflate: false });

const players = new Map();
const powerups = [];
const spatialGrid = new Map();
const GRID_CELL_SIZE = GAME.PLAYER_RADIUS * 6;

let nextId = 1;
let eventSeq = 0;
let matchStartTime = Date.now();
let matchId = 1;

function getGridKey(x, y) {
  return `${Math.floor(x / GRID_CELL_SIZE)},${Math.floor(y / GRID_CELL_SIZE)}`;
}

function updateSpatialGrid() {
  spatialGrid.clear();
  for (const player of players.values()) {
    const key = getGridKey(player.x, player.y);
    if (!spatialGrid.has(key)) spatialGrid.set(key, []);
    spatialGrid.get(key).push(player);
  }
}

function distance(p1, p2) { return Math.hypot(p1.x - p2.x, p1.y - p2.y); }

function randomPosition() {
  const safeZones = GAME.ZONES.filter(z => z.safe);
  const zone = safeZones[Math.floor(Math.random() * safeZones.length)];
  return { x: zone.x + Math.random() * (zone.w - 40) + 20, y: zone.y + Math.random() * (zone.h - 40) + 20 };
}

function checkObstacleCollision(x, y, radius) {
  for (const obs of GAME.OBSTACLES) {
    const closestX = Math.max(obs.x, Math.min(x, obs.x + obs.w));
    const closestY = Math.max(obs.y, Math.min(y, obs.y + obs.h));
    if (Math.hypot(x - closestX, y - closestY) < radius) return true;
  }
  return false;
}

function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }

function sanitizeNumber(value, min, max, def = 0) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return def;
  return clamp(value, min, max);
}

function spawnPowerup() {
  if (powerups.length >= GAME.POWERUP_COUNT) return;
  let pos, valid = false, attempts = 0;
  while (!valid && attempts < 30) {
    pos = { x: Math.random() * (FIELD_SIZE - 40) + 20, y: Math.random() * (FIELD_SIZE - 40) + 20, type: GAME.POWERUP_TYPES[Math.floor(Math.random() * GAME.POWERUP_TYPES.length)].id };
    valid = !checkObstacleCollision(pos.x, pos.y, 15); attempts++;
  }
  if (valid) powerups.push(pos);
}

function checkPowerupCollision(player) {
  for (let i = powerups.length - 1; i >= 0; i--) {
    const p = powerups[i];
    if (distance(player, p) < GAME.PLAYER_RADIUS + 12) {
      applyPowerup(player, p.type);
      broadcastEvent({ type: 'powerupCollect', x: p.x, y: p.y, type: p.type, playerId: player.id });
      powerups.splice(i, 1);
      setTimeout(spawnPowerup, 5000);
    }
  }
}

function applyPowerup(player, type) {
  const now = Date.now();
  if (type === 'speed') player.speedBoostUntil = now + GAME.POWERUP_DURATION;
  else if (type === 'shield') player.shieldUntil = now + GAME.POWERUP_DURATION;
  else if (type === 'invisibility') player.invisibleUntil = now + GAME.POWERUP_DURATION;
  else if (type === 'double') player.doublePointsUntil = now + GAME.POWERUP_DURATION;
}

wss.on('connection', (ws) => {
  const id = nextId++;
  const pos = randomPosition();
  const now = Date.now();

  const player = {
    id, x: pos.x, y: pos.y, prevX: pos.x, prevY: pos.y,
    radius: GAME.PLAYER_RADIUS, speed: GAME.PLAYER_SPEED,
    hostId: null, infectedAt: null, ws, connectTime: now,
    lastMoveTime: 0, moveCount: 0, lastInfectTime: 0,
    stunUntil: 0, knockbackX: 0, knockbackY: 0, lastStateSent: 0,
    score: 0, infections: 0, deaths: 0, combo: 0, comboTime: 0,
    speedBoostUntil: 0, shieldUntil: 0, invisibleUntil: 0, doublePointsUntil: 0,
    name: `Player_${id}`, username: null, lastPing: now
  };

  players.set(id, player);
  broadcastEvent({ type: 'playerJoin', playerId: id, x: pos.x, y: pos.y });

  ws.send(JSON.stringify({
    type: 'welcome', playerId: id, matchId,
    matchTime: Math.max(0, MATCH_DURATION - (Date.now() - matchStartTime)),
    gameConfig: {
      playerRadius: GAME.PLAYER_RADIUS, parasiteRadius: GAME.PARASITE_RADIUS,
      infectDuration: GAME.INFECT_DURATION, infectCooldown: GAME.INFECT_COOLDOWN,
      maxParasites: GAME.MAX_PARASITES_PER_HOST, matchDuration: MATCH_DURATION,
      obstacles: GAME.OBSTACLES, zones: GAME.ZONES, powerupTypes: GAME.POWERUP_TYPES
    },
    leaderboard: getLeaderboard()
  }));

  ws.on('message', (data) => {
    if (player.ws.readyState !== WebSocket.OPEN) return;
    if (data.length > 512) { player.ws.terminate(); return; }
    try {
      const msg = JSON.parse(data);
      if (msg.type === 'setUsername' && msg.username) {
        player.username = msg.username.substring(0, 20);
        player.name = msg.username.substring(0, 20);
      } else if (msg.type === 'ping') {
        player.lastPing = Date.now();
        ws.send(JSON.stringify({ type: 'pong', t: Date.now() }));
      } else {
        handlePlayerMessage(player, msg);
      }
    } catch (e) { player.ws.terminate(); }
  });

  ws.on('close', () => {
    broadcastEvent({ type: 'playerLeave', playerId: player.id });
    releaseParasites(player);
    players.delete(id);
  });

  ws.on('error', () => { releaseParasites(player); players.delete(id); });
});

function getLeaderboard() {
  return [...players.values()].sort((a, b) => b.score - a.score).slice(0, 10)
    .map(p => ({ id: p.id, name: p.name, score: p.score, infections: p.infections }));
}

function releaseParasites(hostPlayer) {
  for (const p of players.values()) {
    if (p.hostId === hostPlayer.id) {
      const angle = Math.random() * Math.PI * 2;
      const exitDist = GAME.MIN_EXIT_DISTANCE + Math.random() * 20;
      p.hostId = null; p.infectedAt = null;
      p.x = clamp(hostPlayer.x + Math.cos(angle) * exitDist, GAME.PLAYER_RADIUS, FIELD_SIZE - GAME.PLAYER_RADIUS);
      p.y = clamp(hostPlayer.y + Math.sin(angle) * exitDist, GAME.PLAYER_RADIUS, FIELD_SIZE - GAME.PLAYER_RADIUS);
      p.knockbackX = Math.cos(angle) * GAME.KNOCKBACK_FORCE;
      p.knockbackY = Math.sin(angle) * GAME.KNOCKBACK_FORCE;
      broadcastEvent({ type: 'parasiteExit', playerId: p.id, hostId: hostPlayer.id, x: p.x, y: p.y });
    }
  }
}

function handlePlayerMessage(player, msg) {
  const now = Date.now();
  if (msg.type === 'move') handleMove(player, msg, now);
  else if (msg.type === 'infect') handleInfect(player, msg, now);
  else player.ws.terminate();
}

function handleMove(player, msg, now) {
  if (player.hostId !== null || now < player.stunUntil || now - player.connectTime < 100) return;
  if (now - player.lastMoveTime < GAME.MOVE_MESSAGE_MIN_INTERVAL) {
    player.moveCount++;
    if (player.moveCount > GAME.MOVE_BURST_LIMIT) { player.ws.terminate(); return; }
  } else { player.moveCount = 1; player.lastMoveTime = now; }

  const dx = sanitizeNumber(msg.dx, -1, 1, 0);
  const dy = sanitizeNumber(msg.dy, -1, 1, 0);
  if (dx === 0 && dy === 0) return;

  const len = Math.hypot(dx, dy) || 1;
  let moveX = (dx / len) * player.speed;
  let moveY = (dy / len) * player.speed;
  if (player.speedBoostUntil > now) { moveX *= 1.8; moveY *= 1.8; }

  player.prevX = player.x; player.prevY = player.y;
  player.x += moveX + player.knockbackX;
  player.y += moveY + player.knockbackY;
  player.knockbackX *= 0.7; player.knockbackY *= 0.7;
  if (Math.abs(player.knockbackX) < 0.1) player.knockbackX = 0;
  if (Math.abs(player.knockbackY) < 0.1) player.knockbackY = 0;

  const moveDist = Math.hypot(player.x - player.prevX, player.y - player.prevY);
  const maxMove = GAME.MAX_MOVE_PER_TICK * (player.speedBoostUntil > now ? 1.8 : 1);
  if (moveDist > maxMove) {
    const ratio = maxMove / moveDist;
    player.x = player.prevX + (player.x - player.prevX) * ratio;
    player.y = player.prevY + (player.y - player.prevY) * ratio;
  }

  if (checkObstacleCollision(player.x, player.y, GAME.PLAYER_RADIUS)) {
    player.x = player.prevX; player.y = player.prevY;
  }
  player.x = clamp(player.x, GAME.PLAYER_RADIUS, FIELD_SIZE - GAME.PLAYER_RADIUS);
  player.y = clamp(player.y, GAME.PLAYER_RADIUS, FIELD_SIZE - GAME.PLAYER_RADIUS);

  checkPowerupCollision(player);
  for (const p of players.values()) {
    if (p.hostId === player.id) { p.x = player.x; p.y = player.y; }
  }
}

function handleInfect(player, msg, now) {
  if (player.hostId !== null || now - player.connectTime < 500 || 
      now - player.lastInfectTime < GAME.INFECT_COOLDOWN || now < player.stunUntil ||
      player.invisibleUntil > now) return;

  if (!msg.targetId || typeof msg.targetId !== 'number') { player.ws.terminate(); return; }

  const target = players.get(msg.targetId);
  if (!target || target.id === player.id || target.hostId !== null || 
      (target.shieldUntil && target.shieldUntil > now)) return;

  const dist = distance(player, target);
  if (dist > GAME.INFECT_RANGE) return;

  const parasiteCount = [...players.values()].filter(p => p.hostId === target.id).length;
  if (parasiteCount >= GAME.MAX_PARASITES_PER_HOST) return;

  player.lastInfectTime = now;
  target.hostId = player.id;
  target.infectedAt = now;
  target.x = player.x; target.y = player.y;
  target.stunUntil = now + GAME.STUN_DURATION;

  const points = (player.doublePointsUntil > now ? 20 : 10) * Math.min(player.combo + 1, 5);
  player.score += points;
  player.infections++;
  player.combo++;
  player.comboTime = now + 5000;

  broadcastEvent({ type: 'infect', infector: player.id, target: target.id, x: player.x, y: player.y, combo: player.combo });
  broadcastLeaderboard();
}

function broadcastLeaderboard() {
  const data = JSON.stringify({ type: 'leaderboard', leaderboard: getLeaderboard() });
  for (const p of players.values()) {
    if (p.ws.readyState === WebSocket.OPEN) p.ws.send(data);
  }
}

function broadcastEvent(event) {
  eventSeq++;
  event.seq = eventSeq;
  event.t = Date.now();
  const data = JSON.stringify({ type: 'event', event });
  for (const p of players.values()) {
    if (p.ws.readyState === WebSocket.OPEN) p.ws.send(data);
  }
}

const gameLoop = setInterval(() => {
  const now = Date.now();
  const matchElapsed = now - matchStartTime;

  if (matchElapsed >= MATCH_DURATION) { endMatch(); return; }

  for (const player of players.values()) {
    if (player.combo > 0 && now > player.comboTime) player.combo = 0;

    if (player.hostId !== null && player.infectedAt !== null && now - player.infectedAt >= GAME.INFECT_DURATION) {
      const host = players.get(player.hostId);
      if (host) {
        const angle = Math.random() * Math.PI * 2;
        const exitDist = GAME.MIN_EXIT_DISTANCE + Math.random() * 20;
        player.hostId = null; player.infectedAt = null;
        player.x = clamp(host.x + Math.cos(angle) * exitDist, GAME.PLAYER_RADIUS, FIELD_SIZE - GAME.PLAYER_RADIUS);
        player.y = clamp(host.y + Math.sin(angle) * exitDist, GAME.PLAYER_RADIUS, FIELD_SIZE - GAME.PLAYER_RADIUS);
        player.knockbackX = Math.cos(angle) * GAME.KNOCKBACK_FORCE;
        player.knockbackY = Math.sin(angle) * GAME.KNOCKBACK_FORCE;
        
        if (now - player.infectedAt >= GAME.RAGE_THRESHOLD) {
          player.rageMode = true;
          player.rageUntil = now + GAME.RAGE_DURATION;
        }
        if (host) { host.deaths++; host.score = Math.max(0, host.score - 5); }
        broadcastEvent({ type: 'parasiteExit', playerId: player.id, hostId: host.id, x: player.x, y: player.y });
      } else {
        player.hostId = null; player.infectedAt = null;
      }
    }
    if (player.rageMode && now >= player.rageUntil) player.rageMode = false;
  }

  if (Math.random() < 0.015) spawnPowerup();
  updateSpatialGrid();
  broadcastState(now);
}, 1000 / TICK_RATE);

function endMatch() {
  const winner = getLeaderboard()[0];
  broadcastEvent({ type: 'matchEnd', winner: winner ? { id: winner.id, name: winner.name, score: winner.score } : null, leaderboard: getLeaderboard() });

  if (winner && winner.username && accounts[winner.username]) {
    accounts[winner.username].wins++;
    saveAccounts();
  }

  matchId++;
  matchStartTime = Date.now();
  for (const player of players.values()) {
    player.score = 0; player.infections = 0; player.deaths = 0; player.combo = 0;
    const pos = randomPosition();
    player.x = pos.x; player.y = pos.y;
    player.hostId = null; player.infectedAt = null;
    if (player.username && accounts[player.username]) {
      accounts[player.username].gamesPlayed++;
      accounts[player.username].totalScore += player.score;
      saveAccounts();
    }
  }
  powerups.length = 0;
  for (let i = 0; i < GAME.POWERUP_COUNT; i++) spawnPowerup();
  setTimeout(() => broadcastEvent({ type: 'matchStart', matchId, matchDuration: MATCH_DURATION }), 3000);
}

function broadcastState(now) {
  const state = {
    type: 'state', t: now,
    matchTime: Math.max(0, MATCH_DURATION - (now - matchStartTime)),
    p: [], powerups: powerups.map(p => [p.x, p.y, p.type])
  };
  for (const player of players.values()) {
    const sendInterval = player.hostId !== null ? 200 : 100;
    if (now - player.lastStateSent < sendInterval) continue;
    player.lastStateSent = now;
    state.p.push([
      player.id, Math.round(player.x * 100) / 100, Math.round(player.y * 100) / 100,
      player.hostId, player.infectedAt, player.rageMode ? 1 : 0, player.stunUntil > now ? 1 : 0,
      player.shieldUntil > now ? 1 : 0, player.invisibleUntil > now ? 1 : 0,
      player.speedBoostUntil > now ? 1 : 0, player.score, player.name
    ]);
  }
  if (state.p.length === 0) return;
  const data = JSON.stringify(state);
  for (const player of players.values()) {
    if (player.ws.readyState === WebSocket.OPEN) player.ws.send(data);
  }
}

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[SERVER] Parasite Arena on port ${PORT}`);
  console.log(`[SERVER] Field: ${FIELD_SIZE}x${FIELD_SIZE}, Ticks: ${TICK_RATE}Hz, Match: ${MATCH_DURATION/1000}s`);
  console.log(`[SERVER] Accounts: ${Object.keys(accounts).length} (saved to: ${accountsPath})`);
  console.log(`[SERVER] http://localhost:${PORT}`);
  for (let i = 0; i < GAME.POWERUP_COUNT; i++) spawnPowerup();
});

server.on('error', (err) => console.error('[SERVER] Error:', err));
process.on('SIGINT', () => {
  console.log('\n[SERVER] Shutting down...');
  clearInterval(gameLoop);
  saveAccounts();
  server.close(() => { wss.close(() => { console.log('[SERVER] Closed'); process.exit(0); }); });
});
