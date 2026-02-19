const WebSocket = require('ws');
const http = require('http');

const PORT = process.env.PORT || 8080;
const TICK_RATE = 30;
const PLAYER_RADIUS = 10;
const PLAYER_SPEED = 3;
const INFECT_DURATION = 5000;
const FIELD_SIZE = 2000;

const server = http.createServer((req, res) => {
  res.writeHead(426, { 'Content-Type': 'text/plain' });
  res.end('Upgrade Required');
});

const wss = new WebSocket.Server({ 
  server,
  maxPayload: 1024,
  perMessageDeflate: false
});

const players = new Map();
const spatialGrid = new Map();
const GRID_CELL_SIZE = PLAYER_RADIUS * 4;

let nextId = 1;

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

function getNearbyPlayers(player, range) {
  const nearby = [];
  const gx = Math.floor(player.x / GRID_CELL_SIZE);
  const gy = Math.floor(player.y / GRID_CELL_SIZE);
  
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      const key = `${gx + dx},${gy + dy}`;
      const cell = spatialGrid.get(key);
      if (cell) {
        for (const p of cell) {
          if (p.id !== player.id) {
            const dist = Math.hypot(p.x - player.x, p.y - player.y);
            if (dist <= range) {
              nearby.push({ player: p, distance: dist });
            }
          }
        }
      }
    }
  }
  return nearby;
}

function distance(p1, p2) {
  return Math.hypot(p1.x - p2.x, p1.y - p2.y);
}

function randomPosition() {
  return {
    x: Math.random() * (FIELD_SIZE - PLAYER_RADIUS * 2) + PLAYER_RADIUS,
    y: Math.random() * (FIELD_SIZE - PLAYER_RADIUS * 2) + PLAYER_RADIUS
  };
}

function sanitizeNumber(value, min, max, defaultValue = 0) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return defaultValue;
  }
  return Math.max(min, Math.min(max, value));
}

wss.on('connection', (ws, req) => {
  const id = nextId++;
  const pos = randomPosition();
  
  const player = {
    id,
    x: pos.x,
    y: pos.y,
    radius: PLAYER_RADIUS,
    speed: PLAYER_SPEED,
    hostId: null,
    infectedAt: null,
    ws,
    lastMoveTime: 0,
    moveCount: 0,
    connectTime: Date.now()
  };
  
  players.set(id, player);
  
  const welcomeMsg = {
    type: 'welcome',
    playerId: id
  };
  ws.send(JSON.stringify(welcomeMsg));
  
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
      p.x = hostPlayer.x + Math.cos(angle) * PLAYER_RADIUS * 3;
      p.y = hostPlayer.y + Math.sin(angle) * PLAYER_RADIUS * 3;
      p.x = Math.max(PLAYER_RADIUS, Math.min(FIELD_SIZE - PLAYER_RADIUS, p.x));
      p.y = Math.max(PLAYER_RADIUS, Math.min(FIELD_SIZE - PLAYER_RADIUS, p.y));
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
  
  if (now - player.connectTime < 100) return;
  
  if (now - player.lastMoveTime < 30) {
    player.moveCount++;
    if (player.moveCount > 10) {
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
  
  const len = Math.hypot(dx, dy);
  const moveX = (dx / len) * player.speed;
  const moveY = (dy / len) * player.speed;
  
  player.x += moveX;
  player.y += moveY;
  
  player.x = Math.max(PLAYER_RADIUS, Math.min(FIELD_SIZE - PLAYER_RADIUS, player.x));
  player.y = Math.max(PLAYER_RADIUS, Math.min(FIELD_SIZE - PLAYER_RADIUS, player.y));
  
  for (const p of players.values()) {
    if (p.hostId === player.id) {
      p.x = player.x;
      p.y = player.y;
    }
  }
}

function handleInfect(player, msg, now) {
  if (player.hostId !== null) return;
  
  if (now - player.connectTime < 500) {
    return;
  }
  
  if (!msg.targetId || typeof msg.targetId !== 'number') {
    player.ws.terminate();
    return;
  }
  
  const target = players.get(msg.targetId);
  if (!target || target.id === player.id) return;
  
  if (target.hostId !== null) return;
  
  const dist = distance(player, target);
  const maxInfectRange = PLAYER_RADIUS * 2.5;
  
  if (dist >= maxInfectRange) return;
  
  target.hostId = player.id;
  target.infectedAt = now;
  target.x = player.x;
  target.y = player.y;
}

const gameLoop = setInterval(() => {
  const now = Date.now();
  
  for (const player of players.values()) {
    if (player.hostId !== null && player.infectedAt !== null) {
      if (now - player.infectedAt >= INFECT_DURATION) {
        const host = players.get(player.hostId);
        if (host) {
          const angle = Math.random() * Math.PI * 2;
          player.hostId = null;
          player.infectedAt = null;
          player.x = host.x + Math.cos(angle) * PLAYER_RADIUS * 3;
          player.y = host.y + Math.sin(angle) * PLAYER_RADIUS * 3;
          player.x = Math.max(PLAYER_RADIUS, Math.min(FIELD_SIZE - PLAYER_RADIUS, player.x));
          player.y = Math.max(PLAYER_RADIUS, Math.min(FIELD_SIZE - PLAYER_RADIUS, player.y));
        } else {
          player.hostId = null;
          player.infectedAt = null;
        }
      }
    }
  }
  
  updateSpatialGrid();
  broadcastState();
  
}, 1000 / TICK_RATE);

function broadcastState() {
  const state = {
    type: 'state',
    t: Date.now(),
    p: []
  };
  
  for (const player of players.values()) {
    state.p.push([
      player.id,
      Math.round(player.x * 100) / 100,
      Math.round(player.y * 100) / 100,
      player.radius,
      player.hostId,
      player.infectedAt
    ]);
  }
  
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
