/**
 * PUDGE WARS Server v2.0
 * Multiplayer .io Game - Authoritative Server
 * 
 * Architecture: 60 TPS tick-based physics, WebSocket real-time
 */

const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');

// ============================================
// CONFIGURATION
// ============================================
const PORT = process.env.PORT || 8080;
const TICK_RATE = 60;
const FIELD_SIZE = 2000;
const MATCH_DURATION = 420000;

const GAME = {
  PLAYER_RADIUS: 20,
  PLAYER_SPEED: 3.5,
  BASE_HEALTH: 625,
  BASE_MANA: 267,
  BASE_DAMAGE: 52,
  BASE_ARMOR: 1,
  BASE_STR: 25,
  BASE_AGI: 14,
  BASE_INT: 14,
  STR_PER_LEVEL: 3.0,
  AGI_PER_LEVEL: 1.4,
  INT_PER_LEVEL: 1.5,
  HOOK_RANGE: 400,
  HOOK_SPEED: 16,
  HOOK_RADIUS: 8,
  HOOK_COOLDOWN: 4000,
  HOOK_DAMAGE: 80,
  HOOK_MANA_COST: 110,
  ROT_DAMAGE: 30,
  ROT_RADIUS: 200,
  ROT_COOLDOWN: 1500,
  ROT_DURATION: 5000,
  FLESH_HEAP_STR_PER_STACK: 0.9,
  FLESH_HEAP_RANGE: 400,
  HOOK_PULL_SPEED: 10,
  RESPAWN_TIME: 5000,
  GOLD_PER_KILL: 150,
  GOLD_PER_ASSIST: 50,
  RIVER_Y: 1000,
  RIVER_WIDTH: 180
};

// ============================================
// SERVER STATE
// ============================================
const players = new Map();
const hooks = [];
let nextPlayerId = 1;
let matchStartTime = Date.now();

// ============================================
// UTILITY FUNCTIONS
// ============================================
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const pointInCircle = (px, py, cx, cy, r) => Math.hypot(px - cx, py - cy) < r;
const circleCollision = (c1, r1, c2, r2) => Math.hypot(c1.x - c2.x, c1.y - c2.y) < (r1 + r2);
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

function isInRiver(y, radius) {
  const riverTop = GAME.RIVER_Y - GAME.RIVER_WIDTH / 2;
  const riverBottom = GAME.RIVER_Y + GAME.RIVER_WIDTH / 2;
  return y + radius > riverTop && y - radius < riverBottom;
}

function getSpawnPosition(team) {
  const baseX = 500 + Math.random() * 1000;
  return team === 'radiant'
    ? { x: baseX, y: 200 + Math.random() * 300 }
    : { x: baseX, y: 1500 + Math.random() * 300 };
}

function calculatePlayerStats(player) {
  const bonusHealth = (player.level - 1) * 20;
  const bonusMana = (player.level - 1) * 15;
  const strBonus = player.str * 20;
  const agiBonus = player.agi * 0.15;
  const intBonus = player.int * 12;

  player.maxHealth = GAME.BASE_HEALTH + bonusHealth + strBonus;
  player.maxMana = GAME.BASE_MANA + bonusMana + intBonus;
  player.armor = GAME.BASE_ARMOR + agiBonus;
  player.damage = GAME.BASE_DAMAGE + (player.str * 0.5);
  player.maxHealth += player.fleshHeapStacks * GAME.FLESH_HEAP_STR_PER_STACK * 20;
}

// ============================================
// NETWORK SERIALIZATION
// ============================================
function playerToData(p) {
  return [
    p.id, Math.round(p.x * 100) / 100, Math.round(p.y * 100) / 100, p.team,
    Math.round(p.health), p.maxHealth, Math.round(p.mana), p.maxMana,
    p.level, Math.round(p.str), Math.round(p.agi), Math.round(p.int),
    Math.round(p.damage), Math.round(p.armor * 100) / 100,
    p.kills, p.deaths, p.fleshHeapStacks, p.rotActive, p.gold || 0
  ];
}

function hookToData(h) {
  return [
    h.id, Math.round(h.x * 100) / 100, Math.round(h.y * 100) / 100,
    Math.round(h.targetX * 100) / 100, Math.round(h.targetY * 100) / 100, h.ownerId
  ];
}

function broadcastEvent(event) {
  const data = JSON.stringify({ type: 'event', event });
  for (const p of players.values()) {
    if (p.ws.readyState === WebSocket.OPEN) p.ws.send(data);
  }
}

function broadcastState() {
  const matchTime = Math.max(0, MATCH_DURATION - (Date.now() - matchStartTime));
  const state = {
    type: 'state',
    matchTime,
    players: [...players.values()].map(playerToData),
    hooks: hooks.map(hookToData),
    stats: [...players.values()].map(p => [p.id, p.kills, p.deaths])
  };
  const data = JSON.stringify(state);
  for (const p of players.values()) {
    if (p.ws.readyState === WebSocket.OPEN) p.ws.send(data);
  }
}

// ============================================
// PLAYER MANAGEMENT
// ============================================
function createPlayer(ws, team) {
  const pos = getSpawnPosition(team);
  const player = {
    id: nextPlayerId++,
    x: pos.x, y: pos.y, team,
    health: GAME.BASE_HEALTH, maxHealth: GAME.BASE_HEALTH,
    mana: GAME.BASE_MANA, maxMana: GAME.BASE_MANA,
    speed: GAME.PLAYER_SPEED, ws,
    hookCooldown: 0, rotCooldown: 0, rotActive: false, rotEndTime: 0,
    isDead: false, respawnTime: 0,
    kills: 0, deaths: 0, angle: 0,
    gold: 600, level: 1,
    str: GAME.BASE_STR, agi: GAME.BASE_AGI, int: GAME.BASE_INT,
    damage: GAME.BASE_DAMAGE, armor: GAME.BASE_ARMOR,
    fleshHeapStacks: 0,
    name: `Pudge_${nextPlayerId}`
  };
  calculatePlayerStats(player);
  return player;
}

function killPlayer(victim, killer) {
  victim.isDead = true;
  victim.respawnTime = Date.now() + GAME.RESPAWN_TIME;
  victim.deaths++;

  if (killer) {
    killer.kills++;
    killer.gold += GAME.GOLD_PER_KILL;
    if (distance(victim, killer) < GAME.FLESH_HEAP_RANGE) {
      killer.fleshHeapStacks++;
      killer.str += GAME.FLESH_HEAP_STR_PER_STACK;
      calculatePlayerStats(killer);
    }
  }

  console.log(`[KILL] ${killer?.id || 'unknown'} -> ${victim.id}`);
  broadcastEvent({ type: 'playerKill', victimId: victim.id, killerId: killer?.id });
}

function respawnPlayer(player) {
  const pos = getSpawnPosition(player.team);
  player.x = pos.x;
  player.y = pos.y;
  player.health = player.maxHealth;
  player.mana = player.maxMana;
  player.isDead = false;
  console.log(`[RESPAWN] Player ${player.id}`);
}

// ============================================
// INPUT HANDLING
// ============================================
function handlePlayerMessage(player, msg) {
  if (player.isDead) return;

  switch (msg.type) {
    case 'move': handleMove(player, msg); break;
    case 'hook': handleHook(player, msg); break;
    case 'rot': handleRot(player, msg); break;
  }
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
  if (now < player.hookCooldown || player.mana < GAME.HOOK_MANA_COST) return;

  const angle = msg.angle || 0;
  const targetX = player.x + Math.cos(angle) * GAME.HOOK_RANGE;
  const targetY = player.y + Math.sin(angle) * GAME.HOOK_RANGE;

  hooks.push({
    id: `hook_${player.id}_${now}`,
    x: player.x, y: player.y, targetX, targetY,
    ownerId: player.id, owner: player,
    vx: Math.cos(angle) * GAME.HOOK_SPEED,
    vy: Math.sin(angle) * GAME.HOOK_SPEED,
    traveled: 0, state: 'flying', targetId: null,
    damage: GAME.HOOK_DAMAGE, range: GAME.HOOK_RANGE, speed: GAME.HOOK_SPEED
  });

  player.hookCooldown = now + GAME.HOOK_COOLDOWN;
  player.mana -= GAME.HOOK_MANA_COST;
  console.log(`[HOOK] Player ${player.id} fired`);
  broadcastEvent({ type: 'hookFire', playerId: player.id });
}

function handleRot(player, msg) {
  const now = Date.now();
  if (now < player.rotCooldown) return;

  player.rotActive = !player.rotActive;
  player.rotEndTime = player.rotActive ? now + GAME.ROT_DURATION : 0;
  player.rotCooldown = now + GAME.ROT_COOLDOWN;
  console.log(`[ROT] Player ${player.id} ${player.rotActive ? 'ON' : 'OFF'}`);
  broadcastEvent({ type: 'rotToggle', playerId: player.id, active: player.rotActive });
}

// ============================================
// HOOK PHYSICS
// ============================================
function updateHooks() {
  for (let i = hooks.length - 1; i >= 0; i--) {
    const hook = hooks[i];
    updateHook(hook);
    if (hook.state === 'done') hooks.splice(i, 1);
  }
  checkHookToHookCollision();
}

function updateHook(hook) {
  if (hook.state === 'flying') {
    hook.x += hook.vx;
    hook.y += hook.vy;
    hook.traveled += hook.speed;
    if (hook.traveled >= hook.range) hook.state = 'returning';
    checkHookPlayerCollision(hook);
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

function checkHookPlayerCollision(hook) {
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
      const h1 = hooks[i], h2 = hooks[j];
      if (h1.state !== 'flying' || h2.state !== 'flying') continue;

      if (circleCollision(h1, GAME.HOOK_RADIUS, h2, GAME.HOOK_RADIUS)) {
        const dx = h2.x - h1.x, dy = h2.y - h1.y;
        const dist = Math.hypot(dx, dy) || 1;
        const bounce = 0.5;

        h1.vx = -h1.vx * bounce; h1.vy = -h1.vy * bounce;
        h2.vx = -h2.vx * bounce; h2.vy = -h2.vy * bounce;
        h1.x -= (dx / dist) * 5; h1.y -= (dy / dist) * 5;
        h2.x += (dx / dist) * 5; h2.y += (dy / dist) * 5;

        console.log(`[HOOK COLLISION] ${h1.id} <-> ${h2.id}`);
      }
    }
  }
}

function applyHookHit(hook, target) {
  const owner = hook.owner;
  const armorReduction = target.armor / (100 + target.armor);
  const actualDamage = hook.damage * (1 - armorReduction);
  target.health -= actualDamage;
  hook.state = 'pulling';
  hook.targetId = target.id;

  console.log(`[HIT] ${owner.id} -> ${target.id} (${Math.round(actualDamage)} dmg)`);
  broadcastEvent({ type: 'hookHit', targetId: target.id, hitterId: owner.id });

  if (target.health <= 0 && !target.isDead) killPlayer(target, owner);
}

function applyHookPull(hook, ally) {
  const owner = hook.owner;
  hook.state = 'pulling';
  hook.targetId = ally.id;
  console.log(`[SAVE] ${owner.id} saved ${ally.id}`);
  broadcastEvent({ type: 'allySaved', allyId: ally.id, saverId: owner.id });
}

// ============================================
// COMBAT & ROT
// ============================================
function updateRot() {
  const now = Date.now();

  for (const player of players.values()) {
    if (!player.rotActive) continue;
    if (now >= player.rotEndTime) {
      player.rotActive = false;
      continue;
    }

    for (const other of players.values()) {
      if (other.team === player.team || other.isDead) continue;
      if (distance(player, other) < GAME.ROT_RADIUS + GAME.PLAYER_RADIUS) {
        const armorReduction = other.armor / (100 + other.armor);
        const actualDamage = GAME.ROT_DAMAGE * (1 - armorReduction);
        other.health -= actualDamage;
        if (other.health <= 0 && !other.isDead) killPlayer(other, player);
      }
    }
  }
}

function checkRespawn() {
  const now = Date.now();
  for (const player of players.values()) {
    if (player.isDead && now >= player.respawnTime) respawnPlayer(player);
  }
}

// ============================================
// MATCH MANAGEMENT
// ============================================
function endMatch() {
  const radiantKills = [...players.values()].filter(p => p.team === 'radiant').reduce((s, p) => s + p.kills, 0);
  const direKills = [...players.values()].filter(p => p.team === 'dire').reduce((s, p) => s + p.kills, 0);
  const winner = radiantKills > direKills ? 'radiant' : direKills > radiantKills ? 'dire' : 'draw';

  console.log(`[MATCH END] ${winner} (${radiantKills} - ${direKills})`);
  broadcastEvent({ type: 'matchEnd', winner, radiantKills, direKills });

  setTimeout(resetMatch, 10000);
}

function resetMatch() {
  matchStartTime = Date.now();
  for (const player of players.values()) {
    const pos = getSpawnPosition(player.team);
    Object.assign(player, {
      x: pos.x, y: pos.y,
      health: player.maxHealth, mana: player.maxMana,
      isDead: false, kills: 0, deaths: 0, gold: 600,
      fleshHeapStacks: 0, str: GAME.BASE_STR, agi: GAME.BASE_AGI,
      int: GAME.BASE_INT, level: 1
    });
    calculatePlayerStats(player);
  }
  hooks.length = 0;
  console.log('[MATCH] New match started');
}

// ============================================
// HTTP SERVER
// ============================================
const httpServer = http.createServer((req, res) => {
  fs.readFile(path.join(__dirname, 'index.html'), (err, data) => {
    if (err) {
      res.writeHead(500);
      res.end('Error loading game');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(data);
  });
});

// ============================================
// WEBSOCKET SERVER
// ============================================
const wss = new WebSocket.Server({
  server: httpServer,
  maxPayload: 1024,
  perMessageDeflate: false
});

wss.on('connection', (ws) => {
  const radiantCount = [...players.values()].filter(p => p.team === 'radiant').length;
  const direCount = [...players.values()].filter(p => p.team === 'dire').length;
  const team = radiantCount <= direCount ? 'radiant' : 'dire';

  const player = createPlayer(ws, team);
  players.set(player.id, player);

  ws.send(JSON.stringify({
    type: 'welcome',
    playerId: player.id,
    team: player.team,
    matchTime: Math.max(0, MATCH_DURATION - (Date.now() - matchStartTime)),
    players: [...players.values()].map(playerToData)
  }));

  console.log(`[JOIN] Player ${player.id} joined ${team}`);

  ws.on('message', (data) => {
    try {
      handlePlayerMessage(player, JSON.parse(data));
    } catch (e) { /* Invalid format */ }
  });

  ws.on('close', () => {
    console.log(`[LEAVE] Player ${player.id}`);
    players.delete(player.id);
  });

  ws.on('error', () => players.delete(player.id));
});

// ============================================
// GAME LOOP
// ============================================
const gameLoop = setInterval(() => {
  if (Date.now() - matchStartTime >= MATCH_DURATION) {
    endMatch();
    return;
  }

  updateHooks();
  updateRot();
  checkRespawn();
  broadcastState();
}, 1000 / TICK_RATE);

// ============================================
// SERVER STARTUP
// ============================================
httpServer.listen(PORT, '0.0.0.0', () => {
  console.log('========================================');
  console.log('  🥩 PUDGE WARS SERVER v2.0');
  console.log('========================================');
  console.log(`  Port: ${PORT} | Field: ${FIELD_SIZE}x${FIELD_SIZE}`);
  console.log(`  Tick Rate: ${TICK_RATE} TPS`);
  console.log(`  Open: http://localhost:${PORT}`);
  console.log('========================================');
  console.log('  Q - Meat Hook | W - Rot');
  console.log('========================================');
});

process.on('SIGINT', () => {
  console.log('\n[SHUTDOWN] Closing...');
  clearInterval(gameLoop);
  for (const p of players.values()) p.ws.close();
  httpServer.close(() => {
    wss.close(() => {
      console.log('[SHUTDOWN] Done');
      process.exit(0);
    });
  });
});
