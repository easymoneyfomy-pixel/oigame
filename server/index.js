const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 8080;
const TICK_RATE = 60;
const PLAYER_RADIUS = 12;
const BASE_SPEED = 4;
const MAX_SPEED = 7;
const ACCELERATION = 0.3;
const FRICTION = 0.92;
const INFECT_DURATION = 5000;
const FIELD_SIZE = 2500;

const ZONE_TYPES = {
  NORMAL: 'normal',
  SAFE: 'safe',
  DANGER: 'danger',
  SPEED: 'speed'
};

const clientPath = path.join(__dirname, '..', 'client', 'index.html');

const server = http.createServer((req, res) => {
  if (req.url === '/' || req.url === '/index.html') {
    fs.readFile(clientPath, (err, data) => {
      if (err) {
        res.writeHead(500);
        res.end('Error loading client');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(data);
    });
  } else {
    res.writeHead(426, { 'Content-Type': 'text/plain' });
    res.end('Upgrade Required');
  }
});

const wss = new WebSocket.Server({ 
  server,
  maxPayload: 1024,
  perMessageDeflate: false
});

const players = new Map();
const zones = [];
let nextId = 1;
let eventSeq = 0;
let gameTime = 0;
let globalEvent = null;
let globalEventTimer = 0;

function generateZones() {
  zones.length = 0;
  
  // Safe zones (corners)
  zones.push({ type: ZONE_TYPES.SAFE, x: 100, y: 100, w: 400, h: 400 });
  zones.push({ type: ZONE_TYPES.SAFE, x: FIELD_SIZE - 500, y: FIELD_SIZE - 500, w: 400, h: 400 });
  
  // Danger zones (center cross)
  zones.push({ type: ZONE_TYPES.DANGER, x: FIELD_SIZE/2 - 150, y: 200, w: 300, h: FIELD_SIZE - 400 });
  zones.push({ type: ZONE_TYPES.DANGER, x: 200, y: FIELD_SIZE/2 - 150, w: FIELD_SIZE - 400, h: 300 });
  
  // Speed zones (diagonal)
  zones.push({ type: ZONE_TYPES.SPEED, x: 300, y: 300, w: 500, h: 200 });
  zones.push({ type: ZONE_TYPES.SPEED, x: FIELD_SIZE - 800, y: FIELD_SIZE - 500, w: 500, h: 200 });
}

function getZoneAt(x, y) {
  for (const zone of zones) {
    if (x >= zone.x && x <= zone.x + zone.w &&
        y >= zone.y && y <= zone.y + zone.h) {
      return zone;
    }
  }
  return { type: ZONE_TYPES.NORMAL };
}

function randomPosition() {
  const safeZone = zones.filter(z => z.type === ZONE_TYPES.SAFE)[0];
  return {
    x: safeZone.x + Math.random() * safeZone.w,
    y: safeZone.y + Math.random() * safeZone.h
  };
}

function distance(p1, p2) {
  return Math.hypot(p1.x - p2.x, p1.y - p2.y);
}

function sanitizeNumber(value, min, max, defaultValue = 0) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return defaultValue;
  return Math.max(min, Math.min(max, value));
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

function broadcastState() {
  const state = {
    type: 'state',
    t: Date.now(),
    gt: gameTime,
    ge: globalEvent,
    p: []
  };
  for (const player of players.values()) {
    state.p.push([
      player.id,
      Math.round(player.x * 100) / 100,
      Math.round(player.y * 100) / 100,
      player.vx,
      player.vy,
      player.radius,
      player.hostId,
      player.infectedAt,
      player.heat,
      player.combo,
      player.stunned
    ]);
  }
  const data = JSON.stringify(state);
  for (const player of players.values()) {
    if (player.ws.readyState === WebSocket.OPEN) player.ws.send(data);
  }
}

wss.on('connection', (ws, req) => {
  const id = nextId++;
  const pos = randomPosition();
  
  const player = {
    id,
    x: pos.x,
    y: pos.y,
    vx: 0,
    vy: 0,
    radius: PLAYER_RADIUS,
    speed: BASE_SPEED,
    hostId: null,
    infectedAt: null,
    heat: 0,
    combo: 0,
    comboTimer: 0,
    stunned: 0,
    ws,
    lastMoveTime: 0,
    moveCount: 0,
    connectTime: Date.now(),
    totalInfections: 0,
    infectionsReceived: 0
  };
  
  players.set(id, player);
  
  broadcastEvent({
    type: 'playerJoin',
    playerId: id,
    x: pos.x,
    y: pos.y
  });
  
  ws.send(JSON.stringify({ type: 'welcome', playerId: id }));
  ws.send(JSON.stringify({ type: 'zones', zones }));
  
  ws.on('message', (data) => {
    if (player.ws.readyState !== WebSocket.OPEN) return;
    try {
      const msg = JSON.parse(data);
      handlePlayerMessage(player, msg);
    } catch (e) {
      ws.terminate();
    }
  });
  
  ws.on('close', () => {
    broadcastEvent({ type: 'playerLeave', playerId: player.id });
    releaseParasites(player);
    players.delete(id);
  });
  
  ws.on('error', () => {
    releaseParasites(player);
    players.delete(id);
  });
});

function releaseParasites(hostPlayer) {
  for (const p of players.values()) {
    if (p.hostId === hostPlayer.id) {
      p.hostId = null;
      p.infectedAt = null;
      const angle = Math.random() * Math.PI * 2;
      p.x = hostPlayer.x + Math.cos(angle) * PLAYER_RADIUS * 4;
      p.y = hostPlayer.y + Math.sin(angle) * PLAYER_RADIUS * 4;
      p.x = Math.max(PLAYER_RADIUS, Math.min(FIELD_SIZE - PLAYER_RADIUS, p.x));
      p.y = Math.max(PLAYER_RADIUS, Math.min(FIELD_SIZE - PLAYER_RADIUS, p.y));
      
      broadcastEvent({
        type: 'parasiteExit',
        playerId: p.id,
        hostId: hostPlayer.id,
        x: p.x,
        y: p.y
      });
    }
  }
}

function handlePlayerMessage(player, msg) {
  const now = Date.now();
  
  if (msg.type === 'move') {
    handleMove(player, msg, now);
  } else if (msg.type === 'infect') {
    handleInfect(player, msg, now);
  } else {
    player.ws.terminate();
  }
}

function handleMove(player, msg, now) {
  // Anti-cheat: rate limiting with soft punishment
  if (now - player.lastMoveTime < 16) {
    player.moveCount++;
    if (player.moveCount > 20) {
      player.stunned = Math.min(player.stunned + 10, 60);
      return;
    }
  } else {
    player.moveCount = 0;
    player.lastMoveTime = now;
  }
  
  if (player.stunned > 0) return;
  if (player.hostId !== null) return;
  
  const dx = sanitizeNumber(msg.dx, -1, 1, 0);
  const dy = sanitizeNumber(msg.dy, -1, 1, 0);
  
  const zone = getZoneAt(player.x, player.y);
  let currentSpeed = player.speed;
  
  if (zone.type === ZONE_TYPES.SPEED) currentSpeed *= 1.5;
  if (zone.type === ZONE_TYPES.DANGER) currentSpeed *= 1.3;
  if (player.heat > 70) currentSpeed *= 0.7;
  if (player.combo > 2) currentSpeed *= 1.2;
  
  if (dx !== 0 || dy !== 0) {
    const len = Math.hypot(dx, dy);
    const targetVx = (dx / len) * currentSpeed;
    const targetVy = (dy / len) * currentSpeed;
    
    player.vx += (targetVx - player.vx) * ACCELERATION;
    player.vy += (targetVy - player.vy) * ACCELERATION;
    
    // Heat generation
    const zone = getZoneAt(player.x, player.y);
    let heatGen = 0.3;
    if (zone.type === ZONE_TYPES.DANGER) heatGen = 0.6;
    if (player.combo > 2) heatGen = 0.5;
    
    player.heat = Math.min(player.heat + heatGen, 100);
  }
  
  // Apply velocity with friction
  player.x += player.vx;
  player.y += player.vy;
  player.vx *= FRICTION;
  player.vy *= FRICTION;
  
  // Boundaries
  player.x = Math.max(PLAYER_RADIUS, Math.min(FIELD_SIZE - PLAYER_RADIUS, player.x));
  player.y = Math.max(PLAYER_RADIUS, Math.min(FIELD_SIZE - PLAYER_RADIUS, player.y));
  
  // Heat decay
  player.heat = Math.max(0, player.heat - 0.15);
  
  // Combo decay
  if (player.comboTimer > 0) {
    player.comboTimer -= 1000 / TICK_RATE;
    if (player.comboTimer <= 0) {
      player.combo = 0;
    }
  }
  
  // Stun decay
  if (player.stunned > 0) player.stunned--;
  
  // Move parasites with host
  for (const p of players.values()) {
    if (p.hostId === player.id) {
      p.x = player.x;
      p.y = player.y;
    }
  }
}

function handleInfect(player, msg, now) {
  if (player.hostId !== null) return;
  if (player.stunned > 0) return;
  
  // Cooldown check
  if (now - player.connectTime < 1000) return;
  if (now - player.lastInfectTime < 500) return;
  
  if (!msg.targetId || typeof msg.targetId !== 'number') {
    player.ws.terminate();
    return;
  }
  
  const target = players.get(msg.targetId);
  if (!target || target.id === player.id) return;
  if (target.hostId !== null) return;
  if (target.stunned > 0) return;
  
  const zone = getZoneAt(player.x, player.y);
  if (zone.type === ZONE_TYPES.SAFE) return;
  
  const dist = distance(player, target);
  const maxInfectRange = PLAYER_RADIUS * 3;
  
  if (dist >= maxInfectRange) return;
  
  // Server validates and executes infection
  target.hostId = player.id;
  target.infectedAt = now;
  target.x = player.x;
  target.y = player.y;
  target.infectionsReceived++;
  
  player.totalInfections++;
  player.combo++;
  player.comboTimer = 8000;
  player.lastInfectTime = now;
  
  // Heat penalty for infection
  player.heat = Math.min(player.heat + 15, 100);
  
  // Screen shake event for all nearby players
  broadcastEvent({
    type: 'infect',
    infector: player.id,
    target: target.id,
    x: player.x,
    y: player.y,
    combo: player.combo
  });
  
  // Combo announcement
  if (player.combo >= 3) {
    broadcastEvent({
      type: 'combo',
      playerId: player.id,
      combo: player.combo,
      x: player.x,
      y: player.y
    });
  }
}

function updateGlobalEvent() {
  globalEventTimer--;
  
  if (globalEventTimer <= 0) {
    globalEvent = null;
    
    // Start new global event
    if (Math.random() < 0.4) {
      const events = ['heatwave', 'darkness', 'speedfrenzy'];
      globalEvent = events[Math.floor(Math.random() * events.length)];
      globalEventTimer = 30 * TICK_RATE;
      
      broadcastEvent({
        type: 'globalEvent',
        event: globalEvent,
        duration: globalEventTimer
      });
    }
  }
  
  // Apply global effects
  if (globalEvent === 'heatwave') {
    for (const p of players.values()) {
      if (p.hostId === null) p.heat = Math.min(p.heat + 0.1, 100);
    }
  }
}

const gameLoop = setInterval(() => {
  gameTime++;
  
  for (const player of players.values()) {
    if (player.hostId !== null && player.infectedAt !== null) {
      if (Date.now() - player.infectedAt >= INFECT_DURATION) {
        const host = players.get(player.hostId);
        if (host) {
          const angle = Math.random() * Math.PI * 2;
          player.hostId = null;
          player.infectedAt = null;
          player.x = host.x + Math.cos(angle) * PLAYER_RADIUS * 4;
          player.y = host.y + Math.sin(angle) * PLAYER_RADIUS * 4;
          player.x = Math.max(PLAYER_RADIUS, Math.min(FIELD_SIZE - PLAYER_RADIUS, player.x));
          player.y = Math.max(PLAYER_RADIUS, Math.min(FIELD_SIZE - PLAYER_RADIUS, player.y));
          player.stunned = 20;
          
          broadcastEvent({
            type: 'parasiteExit',
            playerId: player.id,
            hostId: host.id,
            x: player.x,
            y: player.y
          });
        } else {
          player.hostId = null;
          player.infectedAt = null;
        }
      }
    }
  }
  
  updateGlobalEvent();
  broadcastState();
}, 1000 / TICK_RATE);

// Regenerate zones every 2 minutes
setInterval(() => {
  generateZones();
  broadcastEvent({ type: 'zonesRegenerated', zones });
}, 120000);

server.listen(PORT, '0.0.0.0', () => {
  generateZones();
  console.log(`[SERVER] Parasite Arena running on port ${PORT}`);
  console.log(`[SERVER] Field: ${FIELD_SIZE}x${FIELD_SIZE}`);
  console.log(`[SERVER] Tick: ${TICK_RATE} Hz`);
  console.log(`[SERVER] Zones: ${zones.length}`);
});

process.on('SIGINT', () => {
  console.log('\n[SERVER] Shutting down...');
  clearInterval(gameLoop);
  server.close(() => {
    wss.close(() => {
      console.log('[SERVER] Closed');
      process.exit(0);
    });
  });
});
