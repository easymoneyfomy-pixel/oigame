/**
 * PUDGE WARS Server v3.0 - AAA Edition
 * Full Pudge Mechanics - Authoritative Server
 */

const WebSocket = require('ws');
const http = require('http');
const path = require('path');
const fs = require('fs');

// ============================================
// CONFIGURATION
// ============================================
const PORT = process.env.PORT || 8080;
const TICK_RATE = 60;
const FIELD_SIZE = 2000;
const MATCH_DURATION = 420000;

const GAME = {
  PLAYER_RADIUS: 22,
  PLAYER_SPEED: 3.8,
  BASE_HEALTH: 625,
  BASE_MANA: 267,
  BASE_DAMAGE: 52,
  BASE_ARMOR: 1,
  BASE_STR: 25,
  BASE_AGI: 14,
  BASE_INT: 14,
  STR_PER_LEVEL: 3.2,
  AGI_PER_LEVEL: 1.6,
  INT_PER_LEVEL: 1.8,
  
  // Q - Meat Hook
  HOOK_RANGE: 450,
  HOOK_SPEED: 18,
  HOOK_RADIUS: 10,
  HOOK_COOLDOWN: [4000, 3500, 3000, 2500],
  HOOK_DAMAGE: [90, 140, 190, 240],
  HOOK_MANA_COST: [110, 120, 130, 140],
  
  // E - Rot
  ROT_DAMAGE: [30, 50, 70, 90],
  ROT_RADIUS: 220,
  ROT_COOLDOWN: [1500, 1500, 1500, 1500],
  ROT_SLOW: 0.3,
  
  // Passive - Flesh Heap
  FLESH_HEAP_STR_PER_STACK: 1.0,
  FLESH_HEAP_RANGE: 450,
  
  // R - Dismember
  DISMEMBER_DAMAGE: 60,
  DISMEMBER_DURATION: 3000,
  DISMEMBER_COOLDOWN: [17000, 14000, 11000],
  DISMEMBER_MANA_COST: [175, 250, 325],
  DISMEMBER_RANGE: 200,
  
  HOOK_PULL_SPEED: 12,
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
const dismembers = [];
let nextPlayerId = 1;
let matchStartTime = Date.now();

// ============================================
// HELPER FUNCTIONS
// ============================================
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
  return [h.id, h.x, h.y, h.targetX, h.targetY, h.ownerId];
}

// ============================================
// PLAYER MANAGEMENT
// ============================================
function createPlayer(ws) {
  const radiantCount = [...players.values()].filter(p => p.team === 'radiant').length;
  const direCount = [...players.values()].filter(p => p.team === 'dire').length;
  const team = radiantCount <= direCount ? 'radiant' : 'dire';
  const pos = getSpawnPosition(team);

  return {
    id: nextPlayerId++,
    x: pos.x, y: pos.y,
    team,
    health: GAME.BASE_HEALTH,
    maxHealth: GAME.BASE_HEALTH,
    mana: GAME.BASE_MANA,
    maxMana: GAME.BASE_MANA,
    speed: GAME.PLAYER_SPEED,
    ws,
    hookCooldown: 0, rotCooldown: 0, dismemberCooldown: 0,
    rotActive: false, rotEndTime: 0,
    hookRange: GAME.HOOK_RANGE,
    hookSpeed: GAME.HOOK_SPEED,
    hookDamage: GAME.HOOK_DAMAGE[0],
    hookCooldownTime: GAME.HOOK_COOLDOWN[0],
    rotDamage: GAME.ROT_DAMAGE[0],
    dismemberDamage: GAME.DISMEMBER_DAMAGE,
    dismemberCooldownTime: GAME.DISMEMBER_COOLDOWN[0],
    isDead: false,
    respawnTime: 0,
    kills: 0,
    deaths: 0,
    fleshHeapStacks: 0,
    str: GAME.BASE_STR,
    agi: GAME.BASE_AGI,
    int: GAME.BASE_INT,
    damage: GAME.BASE_DAMAGE,
    armor: GAME.BASE_ARMOR,
    level: 1,
    gold: 600,
    abilityLevels: { hook: 1, rot: 1, dismember: 1 }
  };
}

function killPlayer(victim, killer) {
  victim.isDead = true;
  victim.respawnTime = Date.now() + GAME.RESPAWN_TIME;
  victim.deaths++;

  if (killer) {
    killer.kills++;
    killer.gold += GAME.GOLD_PER_KILL;
    
    // Flesh Heap stack
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
    case 'dismember': handleDismember(player, msg); break;
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
  const abilityLevel = msg.abilityLevel || 1;
  const cooldownIndex = Math.min(abilityLevel - 1, GAME.HOOK_COOLDOWN.length - 1);
  
  if (now < player.hookCooldown || player.mana < GAME.HOOK_MANA_COST[cooldownIndex]) return;

  const angle = msg.angle || 0;
  const hookRange = GAME.HOOK_RANGE;
  const targetX = player.x + Math.cos(angle) * hookRange;
  const targetY = player.y + Math.sin(angle) * hookRange;

  hooks.push({
    id: `hook_${player.id}_${now}`,
    x: player.x, y: player.y, targetX, targetY,
    ownerId: player.id, owner: player,
    vx: Math.cos(angle) * GAME.HOOK_SPEED,
    vy: Math.sin(angle) * GAME.HOOK_SPEED,
    traveled: 0, state: 'flying', targetId: null,
    damage: GAME.HOOK_DAMAGE[cooldownIndex],
    range: hookRange,
    speed: GAME.HOOK_SPEED,
    abilityLevel
  });

  player.hookCooldown = now + GAME.HOOK_COOLDOWN[cooldownIndex];
  player.mana -= GAME.HOOK_MANA_COST[cooldownIndex];
  console.log(`[HOOK] Player ${player.id} fired (lvl ${abilityLevel})`);
  broadcastEvent({ type: 'hookFire', playerId: player.id });
}

function handleRot(player, msg) {
  const now = Date.now();
  const abilityLevel = msg.abilityLevel || 1;
  const cooldownIndex = Math.min(abilityLevel - 1, GAME.ROT_COOLDOWN.length - 1);
  
  if (now < player.rotCooldown) return;

  player.rotActive = !player.rotActive;
  player.rotEndTime = player.rotActive ? now + 5000 : 0;
  player.rotCooldown = now + GAME.ROT_COOLDOWN[cooldownIndex];
  player.rotDamage = GAME.ROT_DAMAGE[cooldownIndex];
  
  console.log(`[ROT] Player ${player.id} ${player.rotActive ? 'ON' : 'OFF'} (lvl ${abilityLevel})`);
  broadcastEvent({ type: 'rotToggle', playerId: player.id, active: player.rotActive });
}

function handleDismember(player, msg) {
  const now = Date.now();
  const abilityLevel = msg.abilityLevel || 1;
  const cooldownIndex = Math.min(abilityLevel - 1, GAME.DISMEMBER_COOLDOWN.length - 1);
  
  if (now < player.dismemberCooldown || player.mana < GAME.DISMEMBER_MANA_COST[cooldownIndex]) return;

  const angle = msg.angle || 0;
  const range = GAME.DISMEMBER_RANGE;
  const targetX = player.x + Math.cos(angle) * range;
  const targetY = player.y + Math.sin(angle) * range;

  // Find target
  for (const other of players.values()) {
    if (other.team === player.team || other.isDead) continue;
    if (pointInCircle(targetX, targetY, other.x, other.y, GAME.PLAYER_RADIUS + 20)) {
      // Channel dismember
      dismembers.push({
        id: `dismember_${player.id}_${now}`,
        caster: player,
        target: other,
        endTime: now + GAME.DISMEMBER_DURATION,
        damage: GAME.DISMEMBER_DAMAGE,
        tickDamage: GAME.DISMEMBER_DAMAGE / 10
      });
      
      other.dismembered = true;
      other.dismemberer = player;
      
      player.dismemberCooldown = now + GAME.DISMEMBER_COOLDOWN[cooldownIndex];
      player.mana -= GAME.DISMEMBER_MANA_COST[cooldownIndex];
      
      console.log(`[DISMEMBER] Player ${player.id} -> Player ${other.id}`);
      broadcastEvent({ type: 'dismemberStart', casterId: player.id, targetId: other.id });
      return;
    }
  }
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
    
    if (hook.traveled >= hook.range) {
      hook.state = 'returning';
    }
    
    checkHookPlayerCollision(hook);
  } else if (hook.state === 'returning' || hook.state === 'pulling') {
    const owner = hook.owner;
    if (owner && !owner.isDead) {
      const dx = owner.x - hook.x;
      const dy = owner.y - hook.y;
      const dist = Math.hypot(dx, dy);
      
      if (dist < 15) {
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
        // Save ally
        hook.state = 'pulling';
        hook.targetId = player.id;
        broadcastEvent({ type: 'allySaved', playerId: hook.ownerId, allyId: player.id });
      } else {
        // Hit enemy
        player.health -= hook.damage;
        hook.state = 'pulling';
        hook.targetId = player.id;
        
        console.log(`[HOOK HIT] Player ${hook.ownerId} -> Player ${player.id} for ${hook.damage}`);
        broadcastEvent({ type: 'hookHit', targetId: player.id, hitterId: hook.ownerId });
        
        if (player.health <= 0 && !player.isDead) {
          killPlayer(player, hook.owner);
        }
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
      }
    }
  }
}

// ============================================
// ROT & DISMEMBER
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
        const actualDamage = player.rotDamage * (1 - armorReduction);
        other.health -= actualDamage;
        
        if (other.health <= 0 && !other.isDead) {
          killPlayer(other, player);
        }
      }
    }
  }
}

function updateDismember() {
  const now = Date.now();

  for (let i = dismembers.length - 1; i >= 0; i--) {
    const dis = dismembers[i];
    
    if (now >= dis.endTime || dis.caster.isDead || dis.target.isDead) {
      if (dis.target) {
        dis.target.dismembered = false;
        dis.target.dismemberer = null;
      }
      dismembers.splice(i, 1);
      continue;
    }

    // Damage tick
    dis.target.health -= dis.tickDamage;
    
    if (dis.target.health <= 0 && !dis.target.isDead) {
      killPlayer(dis.target, dis.caster);
    }
  }
}

// ============================================
// MATCH MANAGEMENT
// ============================================
function checkRespawn() {
  const now = Date.now();
  for (const player of players.values()) {
    if (player.isDead && now >= player.respawnTime) {
      respawnPlayer(player);
    }
  }
}

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
    player.x = pos.x;
    player.y = pos.y;
    player.health = player.maxHealth;
    player.mana = player.maxMana;
    player.isDead = false;
    player.kills = 0;
    player.deaths = 0;
    player.gold = 600;
    player.fleshHeapStacks = 0;
  }
  hooks.length = 0;
  dismembers.length = 0;
  broadcastEvent({ type: 'matchStart', matchDuration: MATCH_DURATION });
  console.log('[MATCH] New match started');
}

// ============================================
// NETWORK BROADCAST
// ============================================
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
    matchStartTime,
    players: [...players.values()].map(playerToData),
    hooks: hooks.map(hookToData),
    stats: [...players.values()].map(p => [p.id, p.kills, p.deaths, p.gold || 0])
  };

  const data = JSON.stringify(state);
  for (const player of players.values()) {
    if (player.ws.readyState === WebSocket.OPEN) {
      player.ws.send(data);
    }
  }
}

// ============================================
// HTTP SERVER
// ============================================
const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  let pathname = url.pathname;

  // Health check
  if (pathname === '/health' || pathname === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', players: players.size, uptime: Math.floor((Date.now() - matchStartTime) / 1000) }));
    return;
  }

  // Stats API
  if (pathname === '/api/stats') {
    const radiantKills = [...players.values()].filter(p => p.team === 'radiant').reduce((s, p) => s + p.kills, 0);
    const direKills = [...players.values()].filter(p => p.team === 'dire').reduce((s, p) => s + p.kills, 0);
    
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
    res.end(JSON.stringify({
      players: players.size,
      radiant: { players: [...players.values()].filter(p => p.team === 'radiant').length, kills: radiantKills },
      dire: { players: [...players.values()].filter(p => p.team === 'dire').length, kills: direKills },
      matchTime: Math.max(0, MATCH_DURATION - (Date.now() - matchStartTime))
    }));
    return;
  }

  // Serve files
  const mimeTypes = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml; charset=utf-8'
  };

  if (pathname === '/' || pathname === '/index.html') {
    const clientPath = path.join(__dirname, 'index.html');
    fs.readFile(clientPath, (err, data) => {
      if (err) { res.writeHead(500); res.end('Error'); return; }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(data);
    });
  } else {
    const filePath = path.join(__dirname, pathname);
    const ext = path.extname(filePath).toLowerCase();
    const contentType = mimeTypes[ext] || 'application/octet-stream';

    fs.readFile(filePath, (err, data) => {
      if (err) { res.writeHead(404); res.end('Not found'); return; }
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(data);
    });
  }
});

// ============================================
// WEBSOCKET SERVER
// ============================================
const wss = new WebSocket.Server({ server, maxPayload: 1024, perMessageDeflate: false });

wss.on('connection', (ws) => {
  const player = createPlayer(ws);
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
      const msg = JSON.parse(data);
      if (msg.type === 'setName' && msg.name) {
        player.name = msg.name.substring(0, 20);
      } else {
        handlePlayerMessage(player, msg);
      }
    } catch (e) { /* ignore */ }
  });

  ws.on('close', () => {
    console.log(`[LEAVE] Player ${player.id} disconnected`);
    players.delete(player.id);
  });

  ws.on('error', () => players.delete(player.id));
});

// ============================================
// GAME LOOP
// ============================================
const gameLoop = setInterval(() => {
  const matchElapsed = Date.now() - matchStartTime;

  if (matchElapsed >= MATCH_DURATION) {
    endMatch();
    return;
  }

  updateHooks();
  updateRot();
  updateDismember();
  checkRespawn();
  broadcastState();
}, 1000 / TICK_RATE);

// ============================================
// START SERVER
// ============================================
server.listen(PORT, '0.0.0.0', () => {
  console.log('========================================');
  console.log('  🥩 PUDGE WARS - AAA EDITION');
  console.log('========================================');
  console.log(`  Port: ${PORT}`);
  console.log(`  Field: ${FIELD_SIZE}x${FIELD_SIZE}`);
  console.log(`  Tick Rate: ${TICK_RATE} TPS`);
  console.log(`  River at Y: ${GAME.RIVER_Y}`);
  console.log('========================================');
  console.log(`  Open: http://localhost:${PORT}`);
  console.log('========================================');
  console.log('  Q - Meat Hook | E - Rot | R - Dismember');
  console.log('========================================');
});

server.on('error', (err) => console.error('[ERROR]', err));

process.on('SIGINT', () => {
  console.log('\n[SHUTDOWN] Closing...');
  clearInterval(gameLoop);
  for (const p of players.values()) p.ws.close();
  server.close(() => { wss.close(() => { console.log('[SHUTDOWN] Done'); process.exit(0); }); });
});
