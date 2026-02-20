/**
 * PUDGE WARS - Server
 * Многопользовательская .io игра
 * Архитектура: Tick-based физика (60 TPS), Авторитетный сервер
 */

const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');

// ==========================================
// КОНФИГУРАЦИЯ
// ==========================================
const PORT = process.env.PORT || 8080;
const TICK_RATE = 60;
const FIELD_SIZE = 2000;

const GAME = {
  PLAYER_RADIUS: 18,
  PLAYER_SPEED: 4,
  PLAYER_HEALTH: 1000,
  HOOK_RANGE: 400,
  HOOK_SPEED: 15,
  HOOK_RADIUS: 6,
  HOOK_COOLDOWN: 3000,
  HOOK_DAMAGE: 300,
  HOOK_PULL_SPEED: 8,
  RESPAWN_TIME: 5000,
  RIVER_Y: 1000,
  RIVER_WIDTH: 150
};

const MATCH_DURATION = 420000;

// ==========================================
// СОСТОЯНИЕ
// ==========================================
const players = new Map();
const hooks = [];
let nextPlayerId = 1;
let matchStartTime = Date.now();

// ==========================================
// ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
// ==========================================
function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function pointInCircle(px, py, cx, cy, radius) {
  return Math.hypot(px - cx, py - cy) < radius;
}

function circleCollision(c1, r1, c2, r2) {
  return Math.hypot(c1.x - c2.x, c1.y - c2.y) < (r1 + r2);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function isInRiver(y, radius) {
  const riverTop = GAME.RIVER_Y - GAME.RIVER_WIDTH / 2;
  const riverBottom = GAME.RIVER_Y + GAME.RIVER_WIDTH / 2;
  return y + radius > riverTop && y - radius < riverBottom;
}

function getSpawnPosition(team) {
  const x = 500 + Math.random() * 1000;
  return team === 'radiant'
    ? { x, y: 200 + Math.random() * 300 }
    : { x, y: 1500 + Math.random() * 300 };
}

// ==========================================
// HTTP СЕРВЕР
// ==========================================
const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  let pathname = url.pathname;

  // Health check для мониторинга
  if (pathname === '/health' || pathname === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      players: players.size,
      uptime: Math.floor((Date.now() - matchStartTime) / 1000)
    }));
    return;
  }

  // Статистика игры (публичный API)
  if (pathname === '/api/stats') {
    const radiantKills = [...players.values()]
      .filter(p => p.team === 'radiant')
      .reduce((sum, p) => sum + (p.kills || 0), 0);
    const direKills = [...players.values()]
      .filter(p => p.team === 'dire')
      .reduce((sum, p) => sum + (p.kills || 0), 0);

    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache'
    });
    res.end(JSON.stringify({
      players: players.size,
      radiant: { players: [...players.values()].filter(p => p.team === 'radiant').length, kills: radiantKills },
      dire: { players: [...players.values()].filter(p => p.team === 'dire').length, kills: direKills },
      matchTime: Math.max(0, MATCH_DURATION - (Date.now() - matchStartTime))
    }));
    return;
  }

  const mimeTypes = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml; charset=utf-8',
    '.json': 'application/json; charset=utf-8'
  };

  if (pathname === '/' || pathname === '/index.html') {
    const clientPath = path.join(__dirname, 'index.html');
    fs.readFile(clientPath, (err, data) => {
      if (err) {
        res.writeHead(500);
        res.end('Error loading game');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(data);
    });
  } else {
    const filePath = path.join(__dirname, pathname);
    const ext = path.extname(filePath).toLowerCase();
    const contentType = mimeTypes[ext] || 'application/octet-stream';

    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end('File not found');
        return;
      }
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(data);
    });
  }
});

// ==========================================
// WEBSOCKET СЕРВЕР
// ==========================================
const wss = new WebSocket.Server({
  server,
  maxPayload: 1024,
  perMessageDeflate: false
});

wss.on('connection', (ws) => {
  const radiantCount = [...players.values()].filter(p => p.team === 'radiant').length;
  const direCount = [...players.values()].filter(p => p.team === 'dire').length;
  const team = radiantCount <= direCount ? 'radiant' : 'dire';
  const pos = getSpawnPosition(team);

  const player = {
    id: nextPlayerId++,
    x: pos.x,
    y: pos.y,
    team,
    health: GAME.PLAYER_HEALTH,
    maxHealth: GAME.PLAYER_HEALTH,
    speed: GAME.PLAYER_SPEED,
    ws,
    hookCooldown: 0,
    hookCooldownTime: GAME.HOOK_COOLDOWN,
    hookRange: GAME.HOOK_RANGE,
    hookSpeed: GAME.HOOK_SPEED,
    hookDamage: GAME.HOOK_DAMAGE,
    isDead: false,
    respawnTime: 0,
    kills: 0,
    deaths: 0,
    angle: 0,
    gold: 600
  };

  players.set(player.id, player);

  ws.send(JSON.stringify({
    type: 'welcome',
    playerId: player.id,
    team: player.team,
    matchTime: Math.max(0, MATCH_DURATION - (Date.now() - matchStartTime)),
    players: [...players.values()].map(p => playerToData(p))
  }));

  console.log(`[JOIN] Player ${player.id} joined ${team}`);

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data);
      if (msg.type === 'setName' && msg.name) {
        player.name = msg.name.substring(0, 20);
      } else {
        handlePlayerMessage(player, msg);
      }
    } catch (e) {
      // Игнорируем неверный формат
    }
  });

  ws.on('close', () => {
    console.log(`[LEAVE] Player ${player.id} disconnected`);
    players.delete(player.id);
  });

  ws.on('error', () => {
    players.delete(player.id);
  });
});

// ==========================================
// СЕРИАЛИЗАЦИЯ
// ==========================================
function playerToData(player) {
  return [
    player.id,
    Math.round(player.x * 100) / 100,
    Math.round(player.y * 100) / 100,
    player.team,
    Math.round(player.health),
    player.maxHealth,
    player.gold || 0,
    player.level || 1,
    player.kills || 0,
    player.deaths || 0,
    player.isDead,
    player.name || `Pudge_${player.id}`
  ];
}

function hookToData(hook) {
  return [
    hook.id,
    hook.x,
    hook.y,
    hook.targetX,
    hook.targetY,
    hook.ownerId
  ];
}

// ==========================================
// ОБРАБОТКА ВВОДА
// ==========================================
function handlePlayerMessage(player, msg) {
  if (player.isDead) return;

  switch (msg.type) {
    case 'move':
      handleMove(player, msg);
      break;
    case 'hook':
      handleHook(player, msg);
      break;
    case 'upgrade':
      handleUpgrade(player, msg);
      break;
  }
}

function handleUpgrade(player, msg) {
  const { upgradeType, value } = msg;
  if (!upgradeType || typeof value !== 'number') return;

  switch (upgradeType) {
    case 'range': player.hookRange = value; break;
    case 'speed': player.hookSpeed = value; break;
    case 'damage': player.hookDamage = value; break;
    case 'cooldown': player.hookCooldownTime = value; break;
  }

  console.log(`[UPGRADE] Player ${player.id} upgraded ${upgradeType} to ${value}`);
}

function handleMove(player, msg) {
  const dx = clamp(msg.dx || 0, -1, 1);
  const dy = clamp(msg.dy || 0, -1, 1);

  const len = Math.hypot(dx, dy);
  if (len > 0) {
    const moveX = (dx / len) * player.speed;
    const moveY = (dy / len) * player.speed;

    let newX = clamp(player.x + moveX, GAME.PLAYER_RADIUS, FIELD_SIZE - GAME.PLAYER_RADIUS);
    let newY = clamp(player.y + moveY, GAME.PLAYER_RADIUS, FIELD_SIZE - GAME.PLAYER_RADIUS);

    if (!isInRiver(newY, GAME.PLAYER_RADIUS)) {
      player.x = newX;
      player.y = newY;
    }
  }
}

function handleHook(player, msg) {
  const now = Date.now();
  const cooldownTime = player.hookCooldownTime || GAME.HOOK_COOLDOWN;

  if (now < player.hookCooldown) return;

  const angle = msg.angle || 0;
  const hookRange = player.hookRange || GAME.HOOK_RANGE;
  const hookSpeed = player.hookSpeed || GAME.HOOK_SPEED;
  const hookDamage = player.hookDamage || GAME.HOOK_DAMAGE;

  const targetX = player.x + Math.cos(angle) * hookRange;
  const targetY = player.y + Math.sin(angle) * hookRange;

  const hook = {
    id: `hook_${player.id}_${now}`,
    x: player.x,
    y: player.y,
    targetX,
    targetY,
    ownerId: player.id,
    owner: player,
    vx: Math.cos(angle) * hookSpeed,
    vy: Math.sin(angle) * hookSpeed,
    traveled: 0,
    state: 'flying',
    targetId: null,
    damage: hookDamage,
    range: hookRange,
    speed: hookSpeed
  };

  hooks.push(hook);
  player.hookCooldown = now + cooldownTime;

  console.log(`[HOOK] Player ${player.id} fired hook (dmg:${hookDamage}, range:${hookRange})`);

  broadcastEvent({ type: 'hookFire', playerId: player.id });
}

// ==========================================
// ФИЗИКА ХУКОВ
// ==========================================
function updateHooks() {
  const now = Date.now();

  for (let i = hooks.length - 1; i >= 0; i--) {
    const hook = hooks[i];
    updateSingleHook(hook, now);

    if (hook.state === 'done') {
      hooks.splice(i, 1);
    }
  }
}

function updateSingleHook(hook, now) {
  const hookSpeed = hook.speed || GAME.HOOK_SPEED;
  const hookRange = hook.range || GAME.HOOK_RANGE;

  if (hook.state === 'flying') {
    hook.x += hook.vx;
    hook.y += hook.vy;
    hook.traveled += hookSpeed;

    if (hook.traveled >= hookRange) {
      hook.state = 'returning';
    }

    checkHookCollision(hook);

  } else if (hook.state === 'returning' || hook.state === 'pulling') {
    const owner = hook.owner;
    if (owner && !owner.isDead) {
      const dx = owner.x - hook.x;
      const dy = owner.y - hook.y;
      const dist = Math.hypot(dx, dy);

      if (dist < 10) {
        hook.state = 'done';
      } else {
        hook.x += (dx / dist) * GAME.HOOK_PULL_SPEED;
        hook.y += (dy / dist) * GAME.HOOK_PULL_SPEED;

        if (hook.state === 'pulling' && hook.targetId !== null) {
          const target = players.get(hook.targetId);
          if (target) {
            target.x = hook.x;
            target.y = hook.y;
          }
        }
      }
    } else {
      hook.state = 'done';
    }
  }
}

function checkHookCollision(hook) {
  for (const [id, player] of players) {
    if (id === hook.ownerId || player.isDead) continue;

    if (pointInCircle(hook.x, hook.y, player.x, player.y, GAME.PLAYER_RADIUS + GAME.HOOK_RADIUS)) {
      if (player.team === hook.owner.team) {
        applyHookPull(hook, player);
      } else {
        applyHookHit(hook, player);
      }
      return;
    }
  }
}

function checkHookToHookCollision() {
  for (let i = 0; i < hooks.length; i++) {
    for (let j = i + 1; j < hooks.length; j++) {
      const h1 = hooks[i];
      const h2 = hooks[j];

      if (h1.state !== 'flying' || h2.state !== 'flying') continue;

      if (circleCollision(h1, GAME.HOOK_RADIUS, h2, GAME.HOOK_RADIUS)) {
        const dx = h2.x - h1.x;
        const dy = h2.y - h1.y;
        const dist = Math.hypot(dx, dy) || 1;
        const bounceFactor = 0.5;

        h1.vx = -h1.vx * bounceFactor;
        h1.vy = -h1.vy * bounceFactor;
        h2.vx = -h2.vx * bounceFactor;
        h2.vy = -h2.vy * bounceFactor;

        h1.x -= (dx / dist) * 5;
        h1.y -= (dy / dist) * 5;
        h2.x += (dx / dist) * 5;
        h2.y += (dy / dist) * 5;

        console.log(`[HOOK COLLISION] Hook ${h1.id} collided with ${h2.id}`);
      }
    }
  }
}

function applyHookHit(hook, target) {
  const owner = hook.owner;
  target.health -= hook.damage;
  hook.state = 'pulling';
  hook.targetId = target.id;

  console.log(`[HIT] Player ${owner.id} hit Player ${target.id} for ${hook.damage} damage`);

  broadcastEvent({
    type: 'hookHit',
    targetId: target.id,
    hitterId: owner.id,
    x: target.x,
    y: target.y
  });

  if (target.health <= 0 && !target.isDead) {
    killPlayer(target, owner);
  }
}

function applyHookPull(hook, ally) {
  const owner = hook.owner;
  hook.state = 'pulling';
  hook.targetId = ally.id;

  console.log(`[SAVE] Player ${owner.id} saved ally ${ally.id}`);

  broadcastEvent({
    type: 'allySaved',
    allyId: ally.id,
    saverId: owner.id
  });
}

// ==========================================
// БОЕВАЯ СИСТЕМА
// ==========================================
function killPlayer(victim, killer) {
  victim.isDead = true;
  victim.respawnTime = Date.now() + GAME.RESPAWN_TIME;
  victim.deaths = (victim.deaths || 0) + 1;

  if (killer) {
    killer.kills = (killer.kills || 0) + 1;
  }

  console.log(`[KILL] Player ${killer?.id || 'unknown'} killed Player ${victim.id}`);

  broadcastEvent({
    type: 'playerKill',
    victimId: victim.id,
    killerId: killer?.id,
    x: victim.x,
    y: victim.y
  });
}

function checkRespawn() {
  const now = Date.now();

  for (const player of players.values()) {
    if (player.isDead && now >= player.respawnTime) {
      const pos = getSpawnPosition(player.team);
      player.x = pos.x;
      player.y = pos.y;
      player.health = player.maxHealth;
      player.isDead = false;

      console.log(`[RESPAWN] Player ${player.id} respawned`);
    }
  }
}

function endMatch() {
  const radiantKills = [...players.values()]
    .filter(p => p.team === 'radiant')
    .reduce((sum, p) => sum + p.kills, 0);
  const direKills = [...players.values()]
    .filter(p => p.team === 'dire')
    .reduce((sum, p) => sum + p.kills, 0);

  const winner = radiantKills > direKills ? 'radiant' : (direKills > radiantKills ? 'dire' : 'draw');

  console.log(`[MATCH END] Winner: ${winner} (${radiantKills} - ${direKills})`);

  broadcastEvent({ type: 'matchEnd', winner, radiantKills, direKills });

  setTimeout(() => {
    matchStartTime = Date.now();

    for (const player of players.values()) {
      const pos = getSpawnPosition(player.team);
      player.x = pos.x;
      player.y = pos.y;
      player.health = player.maxHealth;
      player.isDead = false;
      player.kills = 0;
      player.deaths = 0;
      player.gold = 600;
    }

    hooks.length = 0;
    broadcastEvent({ type: 'matchStart', matchDuration: MATCH_DURATION });
    console.log('[MATCH] New match started');
  }, 10000);
}

// ==========================================
// СЕТЕВАЯ РАССЫЛКА
// ==========================================
function broadcastEvent(event) {
  const data = JSON.stringify({ type: 'event', event });
  for (const player of players.values()) {
    if (player.ws.readyState === WebSocket.OPEN) {
      player.ws.send(data);
    }
  }
}

function broadcastState() {
  const matchTime = Math.max(0, MATCH_DURATION - (Date.now() - matchStartTime));

  const state = {
    type: 'state',
    matchTime,
    players: [...players.values()].map(p => playerToData(p)),
    hooks: hooks.map(h => hookToData(h)),
    stats: [...players.values()].map(p => [p.id, p.kills, p.deaths])
  };

  const data = JSON.stringify(state);

  for (const player of players.values()) {
    if (player.ws.readyState === WebSocket.OPEN) {
      player.ws.send(data);
    }
  }
}

// ==========================================
// ИГРОВОЙ ЦИКЛ
// ==========================================
const gameLoop = setInterval(() => {
  const matchElapsed = Date.now() - matchStartTime;

  if (matchElapsed >= MATCH_DURATION) {
    endMatch();
    return;
  }

  updateHooks();
  checkHookToHookCollision();
  checkRespawn();
  broadcastState();
}, 1000 / TICK_RATE);

// ==========================================
// ЗАПУСК
// ==========================================
server.listen(PORT, '0.0.0.0', () => {
  console.log('========================================');
  console.log('  🥩 PUDGE WARS SERVER');
  console.log('========================================');
  console.log(`  Port: ${PORT}`);
  console.log(`  Field: ${FIELD_SIZE}x${FIELD_SIZE}`);
  console.log(`  Tick Rate: ${TICK_RATE} TPS`);
  console.log(`  River at Y: ${GAME.RIVER_Y}`);
  console.log('========================================');
  console.log(`  Open: http://localhost:${PORT}`);
  console.log('========================================');
});

server.on('error', (err) => {
  console.error('[ERROR] Server error:', err);
});

process.on('SIGINT', () => {
  console.log('\n[SHUTDOWN] Closing server...');
  clearInterval(gameLoop);

  for (const player of players.values()) {
    player.ws.close();
  }

  server.close(() => {
    wss.close(() => {
      console.log('[SHUTDOWN] Server closed');
      process.exit(0);
    });
  });
});
