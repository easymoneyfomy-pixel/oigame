const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 8080;
const TICK_RATE = 60;
const FIELD_SIZE = 2000;

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
  INFECT_MIN_INTERVAL: 100
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
  maxPayload: 512,
  perMessageDeflate: false
});

const players = new Map();
const spatialGrid = new Map();
const GRID_CELL_SIZE = GAME.PLAYER_RADIUS * 6;

let nextId = 1;
let eventSeq = 0;

function getGridKey(x, y) {
  const gx = Math.floor(x / GRID_CELL_SIZE);
  const gy = Math.floor(y / GRID_CELL_SIZE);
  return `${gx},${gy}`;
}

function updateSpatialGrid() {
  spatialGrid.clear();
  for (const player of players.values()) {
    const key = getGridKey(player.x, player.y);
    if (!spatialGrid.has(key)) {
      spatialGrid.set(key, []);
    }
    spatialGrid.get(key).push(player);
  }
}

function getNearbyPlayers(x, y, radius) {
  const gx = Math.floor(x / GRID_CELL_SIZE);
  const gy = Math.floor(y / GRID_CELL_SIZE);
  const result = [];
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      const key = `${gx + dx},${gy + dy}`;
      const cell = spatialGrid.get(key);
      if (cell) {
        for (const p of cell) {
          const dist = Math.hypot(p.x - x, p.y - y);
          if (dist <= radius) result.push(p);
        }
      }
    }
  }
  return result;
}

function distance(p1, p2) {
  return Math.hypot(p1.x - p2.x, p1.y - p2.y);
}

function randomPosition() {
  return {
    x: Math.random() * (FIELD_SIZE - GAME.PLAYER_RADIUS * 2) + GAME.PLAYER_RADIUS,
    y: Math.random() * (FIELD_SIZE - GAME.PLAYER_RADIUS * 2) + GAME.PLAYER_RADIUS
  };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function sanitizeNumber(value, min, max, defaultValue = 0) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return defaultValue;
  return clamp(value, min, max);
}

wss.on('connection', (ws, req) => {
  const id = nextId++;
  const pos = randomPosition();
  const now = Date.now();

  const player = {
    id,
    x: pos.x,
    y: pos.y,
    prevX: pos.x,
    prevY: pos.y,
    radius: GAME.PLAYER_RADIUS,
    speed: GAME.PLAYER_SPEED,
    hostId: null,
    infectedAt: null,
    ws,
    connectTime: now,
    lastMoveTime: 0,
    moveCount: 0,
    lastInfectTime: 0,
    parasiteExitTime: null,
    rageMode: false,
    rageUntil: 0,
    stunUntil: 0,
    knockbackX: 0,
    knockbackY: 0,
    lastStateSent: 0
  };

  players.set(id, player);

  broadcastEvent({
    type: 'playerJoin',
    playerId: id,
    x: pos.x,
    y: pos.y
  });

  const welcomeMsg = {
    type: 'welcome',
    playerId: id,
    gameConfig: {
      playerRadius: GAME.PLAYER_RADIUS,
      parasiteRadius: GAME.PARASITE_RADIUS,
      infectDuration: GAME.INFECT_DURATION,
      infectCooldown: GAME.INFECT_COOLDOWN,
      maxParasites: GAME.MAX_PARASITES_PER_HOST
    }
  };
  ws.send(JSON.stringify(welcomeMsg));

  ws.on('message', (data) => {
    if (player.ws.readyState !== WebSocket.OPEN) return;
    if (data.length > 512) {
      player.ws.terminate();
      return;
    }

    try {
      const msg = JSON.parse(data);
      handlePlayerMessage(player, msg);
    } catch (e) {
      player.ws.terminate();
    }
  });

  ws.on('close', () => {
    broadcastEvent({
      type: 'playerLeave',
      playerId: player.id
    });
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
      const angle = Math.random() * Math.PI * 2;
      const exitDist = GAME.MIN_EXIT_DISTANCE + Math.random() * 20;
      p.hostId = null;
      p.infectedAt = null;
      p.parasiteExitTime = Date.now();
      p.x = clamp(hostPlayer.x + Math.cos(angle) * exitDist, GAME.PLAYER_RADIUS, FIELD_SIZE - GAME.PLAYER_RADIUS);
      p.y = clamp(hostPlayer.y + Math.sin(angle) * exitDist, GAME.PLAYER_RADIUS, FIELD_SIZE - GAME.PLAYER_RADIUS);
      p.knockbackX = Math.cos(angle) * GAME.KNOCKBACK_FORCE;
      p.knockbackY = Math.sin(angle) * GAME.KNOCKBACK_FORCE;

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
  if (player.hostId !== null) return;
  if (now < player.stunUntil) return;
  if (now - player.connectTime < 100) return;

  if (now - player.lastMoveTime < GAME.MOVE_MESSAGE_MIN_INTERVAL) {
    player.moveCount++;
    if (player.moveCount > GAME.MOVE_BURST_LIMIT) {
      player.ws.terminate();
      return;
    }
  } else {
    player.moveCount = 1;
    player.lastMoveTime = now;
  }

  const dx = sanitizeNumber(msg.dx, -1, 1, 0);
  const dy = sanitizeNumber(msg.dy, -1, 1, 0);

  if (dx === 0 && dy === 0) return;

  const len = Math.hypot(dx, dy) || 1;
  const moveX = (dx / len) * player.speed;
  const moveY = (dy / len) * player.speed;

  player.prevX = player.x;
  player.prevY = player.y;

  player.x += moveX + player.knockbackX;
  player.y += moveY + player.knockbackY;

  player.knockbackX *= 0.7;
  player.knockbackY *= 0.7;
  if (Math.abs(player.knockbackX) < 0.1) player.knockbackX = 0;
  if (Math.abs(player.knockbackY) < 0.1) player.knockbackY = 0;

  const moveDist = Math.hypot(player.x - player.prevX, player.y - player.prevY);
  if (moveDist > GAME.MAX_MOVE_PER_TICK) {
    const ratio = GAME.MAX_MOVE_PER_TICK / moveDist;
    player.x = player.prevX + (player.x - player.prevX) * ratio;
    player.y = player.prevY + (player.y - player.prevY) * ratio;
  }

  player.x = clamp(player.x, GAME.PLAYER_RADIUS, FIELD_SIZE - GAME.PLAYER_RADIUS);
  player.y = clamp(player.y, GAME.PLAYER_RADIUS, FIELD_SIZE - GAME.PLAYER_RADIUS);

  for (const p of players.values()) {
    if (p.hostId === player.id) {
      p.x = player.x;
      p.y = player.y;
    }
  }
}

function handleInfect(player, msg, now) {
  if (player.hostId !== null) return;
  if (now - player.connectTime < 500) return;
  if (now - player.lastInfectTime < GAME.INFECT_COOLDOWN) return;
  if (now < player.stunUntil) return;

  if (!msg.targetId || typeof msg.targetId !== 'number') {
    player.ws.terminate();
    return;
  }

  const target = players.get(msg.targetId);
  if (!target || target.id === player.id) return;
  if (target.hostId !== null) return;

  const dist = distance(player, target);
  if (dist > GAME.INFECT_RANGE) return;

  const parasiteCount = [...players.values()].filter(p => p.hostId === target.id).length;
  if (parasiteCount >= GAME.MAX_PARASITES_PER_HOST) return;

  player.lastInfectTime = now;
  target.hostId = player.id;
  target.infectedAt = now;
  target.x = player.x;
  target.y = player.y;
  target.stunUntil = now + GAME.STUN_DURATION;

  broadcastEvent({
    type: 'infect',
    infector: player.id,
    target: target.id,
    x: player.x,
    y: player.y
  });
}

function broadcastEvent(event) {
  eventSeq++;
  event.seq = eventSeq;
  event.t = Date.now();

  const data = JSON.stringify({ type: 'event', event });

  for (const p of players.values()) {
    if (p.ws.readyState === WebSocket.OPEN) {
      p.ws.send(data);
    }
  }
}

const gameLoop = setInterval(() => {
  const now = Date.now();

  for (const player of players.values()) {
    if (player.hostId !== null && player.infectedAt !== null) {
      if (now - player.infectedAt >= GAME.INFECT_DURATION) {
        const host = players.get(player.hostId);
        if (host) {
          const angle = Math.random() * Math.PI * 2;
          const exitDist = GAME.MIN_EXIT_DISTANCE + Math.random() * 20;
          
          player.hostId = null;
          player.infectedAt = null;
          player.parasiteExitTime = now;
          player.x = clamp(host.x + Math.cos(angle) * exitDist, GAME.PLAYER_RADIUS, FIELD_SIZE - GAME.PLAYER_RADIUS);
          player.y = clamp(host.y + Math.sin(angle) * exitDist, GAME.PLAYER_RADIUS, FIELD_SIZE - GAME.PLAYER_RADIUS);
          player.knockbackX = Math.cos(angle) * GAME.KNOCKBACK_FORCE;
          player.knockbackY = Math.sin(angle) * GAME.KNOCKBACK_FORCE;

          const infectionDuration = now - player.infectedAt;
          if (infectionDuration >= GAME.RAGE_THRESHOLD) {
            player.rageMode = true;
            player.rageUntil = now + GAME.RAGE_DURATION;
          }

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

    if (player.rageMode && now >= player.rageUntil) {
      player.rageMode = false;
    }
  }

  updateSpatialGrid();
  broadcastState(now);

}, 1000 / TICK_RATE);

function broadcastState(now) {
  const state = {
    type: 'state',
    t: now,
    p: []
  };

  for (const player of players.values()) {
    const sendInterval = player.hostId !== null ? 200 : 100;
    if (now - player.lastStateSent < sendInterval) continue;
    player.lastStateSent = now;

    state.p.push([
      player.id,
      Math.round(player.x * 100) / 100,
      Math.round(player.y * 100) / 100,
      player.hostId,
      player.infectedAt,
      player.rageMode ? 1 : 0,
      player.stunUntil > now ? 1 : 0
    ]);
  }

  if (state.p.length === 0) return;

  const data = JSON.stringify(state);

  for (const player of players.values()) {
    if (player.ws.readyState === WebSocket.OPEN) {
      player.ws.send(data);
    }
  }
}

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[SERVER] Parasite Arena running on port ${PORT}`);
  console.log(`[SERVER] Field size: ${FIELD_SIZE}x${FIELD_SIZE}`);
  console.log(`[SERVER] Tick rate: ${TICK_RATE} Hz`);
  console.log(`[SERVER] Client: http://localhost:${PORT}`);
});

server.on('error', (err) => {
  console.error('[SERVER] Server error:', err);
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
