/**
 * ============================================
 * PUDGE WARS - Server
 * Multiplayer .io Game
 * ============================================
 * Architecture:
 * - 60 TPS tick-based physics
 * - Authoritative server
 * - WebSocket real-time communication
 * ============================================
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
const MATCH_DURATION = 420000; // 7 minutes

// Game constants (synced with client)
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
  
  // Skill Q - Meat Hook
  HOOK_RANGE: 400,
  HOOK_SPEED: 16,
  HOOK_RADIUS: 8,
  HOOK_COOLDOWN: 4000,
  HOOK_DAMAGE: 80,
  HOOK_MANA_COST: 110,
  
  // Skill W - Rot
  ROT_DAMAGE: 30,
  ROT_RADIUS: 200,
  ROT_COOLDOWN: 1500,
  ROT_MANA_COST: 0,
  ROT_DURATION: 5000,
  
  // Passive - Flesh Heap
  FLESH_HEAP_STR_PER_STACK: 0.9,
  FLESH_HEAP_RANGE: 400,
  
  // Physics
  HOOK_PULL_SPEED: 10,
  RESPAWN_TIME: 5000,
  GOLD_PER_KILL: 150,
  GOLD_PER_ASSIST: 50,
  
  // Map
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

/**
 * Calculate distance between two points
 */
function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Check if point is in circle
 */
function pointInCircle(px, py, cx, cy, radius) {
  return Math.hypot(px - cx, py - cy) < radius;
}

/**
 * Check collision between two circles
 */
function circleCollision(c1, r1, c2, r2) {
  return Math.hypot(c1.x - c2.x, c1.y - c2.y) < (r1 + r2);
}

/**
 * Clamp value between min and max
 */
function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

/**
 * Check if player is in river (players cannot cross)
 */
function isInRiver(y, radius) {
  const riverTop = GAME.RIVER_Y - GAME.RIVER_WIDTH / 2;
  const riverBottom = GAME.RIVER_Y + GAME.RIVER_WIDTH / 2;
  return y + radius > riverTop && y - radius < riverBottom;
}

/**
 * Get spawn position based on team
 */
function getSpawnPosition(team) {
  if (team === 'radiant') {
    return {
      x: 500 + Math.random() * 1000,
      y: 200 + Math.random() * 300
    };
  } else {
    return {
      x: 500 + Math.random() * 1000,
      y: 1500 + Math.random() * 300
    };
  }
}

/**
 * Calculate player stats based on level and attributes
 */
function calculatePlayerStats(player) {
  // Base stats + growth per level
  const bonusHealth = (player.level - 1) * 20;
  const bonusMana = (player.level - 1) * 15;
  
  // Attribute bonuses
  const strBonus = player.str * 20;
  const agiBonus = player.agi * 0.15; // Armor
  const intBonus = player.int * 12;
  
  player.maxHealth = GAME.BASE_HEALTH + bonusHealth + strBonus;
  player.maxMana = GAME.BASE_MANA + bonusMana + intBonus;
  player.armor = GAME.BASE_ARMOR + agiBonus;
  player.damage = GAME.BASE_DAMAGE + (player.str * 0.5);
  
  // Flesh Heap passive
  player.maxHealth += player.fleshHeapStacks * GAME.FLESH_HEAP_STR_PER_STACK * 20;
}

// ============================================
// HTTP SERVER
// ============================================
const server = http.createServer((req, res) => {
  const clientPath = path.join(__dirname, 'index.html');
  
  fs.readFile(clientPath, (err, data) => {
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
  server,
  maxPayload: 1024,
  perMessageDeflate: false 
});

/**
 * Handle new connection
 */
wss.on('connection', (ws) => {
  // Team balancing
  const radiantCount = [...players.values()].filter(p => p.team === 'radiant').length;
  const direCount = [...players.values()].filter(p => p.team === 'dire').length;
  
  const team = radiantCount <= direCount ? 'radiant' : 'dire';
  const pos = getSpawnPosition(team);
  
  // Create player with all attributes
  const player = {
    id: nextPlayerId++,
    x: pos.x,
    y: pos.y,
    team,
    health: GAME.BASE_HEALTH,
    maxHealth: GAME.BASE_HEALTH,
    mana: GAME.BASE_MANA,
    maxMana: GAME.BASE_MANA,
    speed: GAME.PLAYER_SPEED,
    ws,
    hookCooldown: 0,
    rotCooldown: 0,
    rotActive: false,
    rotEndTime: 0,
    isDead: false,
    respawnTime: 0,
    kills: 0,
    deaths: 0,
    angle: 0,
    gold: 600,
    level: 1,
    str: GAME.BASE_STR,
    agi: GAME.BASE_AGI,
    int: GAME.BASE_INT,
    damage: GAME.BASE_DAMAGE,
    armor: GAME.BASE_ARMOR,
    fleshHeapStacks: 0,
    name: `Pudge_${nextPlayerId}`
  };
  
  calculatePlayerStats(player);
  players.set(player.id, player);
  
  // Send welcome
  ws.send(JSON.stringify({
    type: 'welcome',
    playerId: player.id,
    team: player.team,
    matchTime: Math.max(0, MATCH_DURATION - (Date.now() - matchStartTime)),
    players: [...players.values()].map(p => playerToData(p))
  }));
  
  console.log(`[JOIN] Player ${player.id} joined ${team}`);
  
  // Handle messages
  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data);
      handlePlayerMessage(player, msg);
    } catch (e) {
      // Invalid format - ignore
    }
  });
  
  // Disconnect
  ws.on('close', () => {
    console.log(`[LEAVE] Player ${player.id} disconnected`);
    players.delete(player.id);
  });
  
  ws.on('error', () => {
    players.delete(player.id);
  });
});

/**
 * Convert player to array for network
 */
function playerToData(player) {
  return [
    player.id,
    Math.round(player.x * 100) / 100,
    Math.round(player.y * 100) / 100,
    player.team,
    Math.round(player.health),
    player.maxHealth,
    Math.round(player.mana),
    player.maxMana,
    player.level,
    Math.round(player.str),
    Math.round(player.agi),
    Math.round(player.int),
    Math.round(player.damage),
    Math.round(player.armor * 100) / 100,
    player.kills,
    player.deaths,
    player.fleshHeapStacks,
    player.rotActive,
    player.gold || 0
  ];
}

/**
 * Convert hook to array for network
 */
function hookToData(hook) {
  return [
    hook.id,
    Math.round(hook.x * 100) / 100,
    Math.round(hook.y * 100) / 100,
    Math.round(hook.targetX * 100) / 100,
    Math.round(hook.targetY * 100) / 100,
    hook.ownerId
  ];
}

/**
 * Handle incoming player messages
 */
function handlePlayerMessage(player, msg) {
  if (player.isDead) return;
  
  switch (msg.type) {
    case 'move':
      handleMove(player, msg);
      break;
      
    case 'hook':
      handleHook(player, msg);
      break;
      
    case 'rot':
      handleRot(player, msg);
      break;
  }
}

/**
 * Handle player movement
 */
function handleMove(player, msg) {
  const dx = clamp(msg.dx || 0, -1, 1);
  const dy = clamp(msg.dy || 0, -1, 1);
  
  const len = Math.hypot(dx, dy);
  if (len > 0) {
    const moveX = (dx / len) * player.speed;
    const moveY = (dy / len) * player.speed;
    
    let newX = player.x + moveX;
    let newY = player.y + moveY;
    
    // Map boundaries
    newX = clamp(newX, GAME.PLAYER_RADIUS, FIELD_SIZE - GAME.PLAYER_RADIUS);
    newY = clamp(newY, GAME.PLAYER_RADIUS, FIELD_SIZE - GAME.PLAYER_RADIUS);
    
    // River collision (players cannot cross)
    if (!isInRiver(newY, GAME.PLAYER_RADIUS)) {
      player.x = newX;
      player.y = newY;
    }
  }
}

/**
 * Handle Meat Hook (Skill Q)
 */
function handleHook(player, msg) {
  const now = Date.now();
  
  // Cooldown check
  if (now < player.hookCooldown) return;
  
  // Mana check
  if (player.mana < GAME.HOOK_MANA_COST) return;
  
  const angle = msg.angle || 0;
  const targetX = player.x + Math.cos(angle) * GAME.HOOK_RANGE;
  const targetY = player.y + Math.sin(angle) * GAME.HOOK_RANGE;
  
  // Create hook
  const hook = {
    id: `hook_${player.id}_${now}`,
    x: player.x,
    y: player.y,
    targetX,
    targetY,
    ownerId: player.id,
    owner: player,
    vx: Math.cos(angle) * GAME.HOOK_SPEED,
    vy: Math.sin(angle) * GAME.HOOK_SPEED,
    traveled: 0,
    state: 'flying',
    targetId: null,
    damage: GAME.HOOK_DAMAGE,
    range: GAME.HOOK_RANGE,
    speed: GAME.HOOK_SPEED
  };
  
  hooks.push(hook);
  player.hookCooldown = now + GAME.HOOK_COOLDOWN;
  player.mana -= GAME.HOOK_MANA_COST;
  
  console.log(`[HOOK] Player ${player.id} fired hook`);
  
  broadcastEvent({
    type: 'hookFire',
    playerId: player.id
  });
}

/**
 * Handle Rot (Skill W)
 */
function handleRot(player, msg) {
  const now = Date.now();
  
  // Cooldown check
  if (now < player.rotCooldown) return;
  
  // Toggle Rot
  player.rotActive = !player.rotActive;
  player.rotEndTime = player.rotActive ? now + GAME.ROT_DURATION : 0;
  player.rotCooldown = now + GAME.ROT_COOLDOWN;
  
  console.log(`[ROT] Player ${player.id} ${player.rotActive ? 'activated' : 'deactivated'} Rot`);
  
  broadcastEvent({
    type: 'rotToggle',
    playerId: player.id,
    active: player.rotActive
  });
}

// ============================================
// HOOK PHYSICS
// ============================================

/**
 * Update all hooks
 */
function updateHooks() {
  for (let i = hooks.length - 1; i >= 0; i--) {
    const hook = hooks[i];
    updateSingleHook(hook);
    
    if (hook.state === 'done') {
      hooks.splice(i, 1);
    }
  }
  
  // Hook-to-hook collision
  checkHookToHookCollision();
}

/**
 * Update single hook
 */
function updateSingleHook(hook) {
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

/**
 * Check hook collision with players
 */
function checkHookCollision(hook) {
  for (const [id, player] of players) {
    if (id === hook.ownerId || player.isDead) continue;

    if (pointInCircle(hook.x, hook.y, player.x, player.y, GAME.PLAYER_RADIUS + GAME.HOOK_RADIUS)) {
      if (player.team === hook.owner.team) {
        // Ally - save without damage
        applyHookPull(hook, player);
      } else {
        // Enemy - damage and pull
        applyHookHit(hook, player);
      }
      return;
    }
  }
}

/**
 * Check hook-to-hook collision
 */
function checkHookToHookCollision() {
  for (let i = 0; i < hooks.length; i++) {
    for (let j = i + 1; j < hooks.length; j++) {
      const h1 = hooks[i];
      const h2 = hooks[j];
      
      if (h1.state !== 'flying' || h2.state !== 'flying') continue;
      
      if (circleCollision(h1, GAME.HOOK_RADIUS, h2, GAME.HOOK_RADIUS)) {
        // Bounce hooks
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

/**
 * Apply hook hit (enemy)
 */
function applyHookHit(hook, target) {
  const owner = hook.owner;
  
  // Calculate damage with armor reduction
  const armorReduction = target.armor / (100 + target.armor);
  const actualDamage = hook.damage * (1 - armorReduction);
  
  target.health -= actualDamage;
  
  hook.state = 'pulling';
  hook.targetId = target.id;
  
  console.log(`[HIT] Player ${owner.id} hit Player ${target.id} for ${Math.round(actualDamage)} damage`);
  
  broadcastEvent({
    type: 'hookHit',
    targetId: target.id,
    hitterId: owner.id
  });
  
  if (target.health <= 0 && !target.isDead) {
    killPlayer(target, owner);
  }
}

/**
 * Apply hook pull (ally save)
 */
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

// ============================================
// COMBAT SYSTEM
// ============================================

/**
 * Kill player
 */
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
  
  console.log(`[KILL] Player ${killer?.id || 'unknown'} killed Player ${victim.id}`);
  
  broadcastEvent({
    type: 'playerKill',
    victimId: victim.id,
    killerId: killer?.id
  });
}

/**
 * Update Rot damage
 */
function updateRot() {
  const now = Date.now();
  
  for (const player of players.values()) {
    if (!player.rotActive) continue;
    
    // Check if Rot ended
    if (now >= player.rotEndTime) {
      player.rotActive = false;
      continue;
    }
    
    // Damage nearby enemies
    for (const other of players.values()) {
      if (other.team === player.team || other.isDead) continue;
      if (distance(player, other) < GAME.ROT_RADIUS + GAME.PLAYER_RADIUS) {
        const armorReduction = other.armor / (100 + other.armor);
        const actualDamage = GAME.ROT_DAMAGE * (1 - armorReduction);
        other.health -= actualDamage;
        
        if (other.health <= 0 && !other.isDead) {
          killPlayer(other, player);
        }
      }
    }
  }
}

/**
 * Check respawn
 */
function checkRespawn() {
  const now = Date.now();
  
  for (const player of players.values()) {
    if (player.isDead && now >= player.respawnTime) {
      const pos = getSpawnPosition(player.team);
      player.x = pos.x;
      player.y = pos.y;
      player.health = player.maxHealth;
      player.mana = player.maxMana;
      player.isDead = false;
      
      console.log(`[RESPAWN] Player ${player.id} respawned`);
    }
  }
}

// ============================================
// BROADCAST
// ============================================

/**
 * Broadcast event to all players
 */
function broadcastEvent(event) {
  const data = JSON.stringify({ type: 'event', event });
  for (const player of players.values()) {
    if (player.ws.readyState === WebSocket.OPEN) {
      player.ws.send(data);
    }
  }
}

/**
 * Broadcast state to all players
 */
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

// ============================================
// GAME LOOP
// ============================================
const gameLoop = setInterval(() => {
  const matchElapsed = Date.now() - matchStartTime;
  
  // Check match end
  if (matchElapsed >= MATCH_DURATION) {
    endMatch();
    return;
  }
  
  // Physics
  updateHooks();
  updateRot();
  checkRespawn();

  // Broadcast
  broadcastState();
}, 1000 / TICK_RATE);

/**
 * End match
 */
function endMatch() {
  const radiantKills = [...players.values()]
    .filter(p => p.team === 'radiant')
    .reduce((sum, p) => sum + p.kills, 0);
  const direKills = [...players.values()]
    .filter(p => p.team === 'dire')
    .reduce((sum, p) => sum + p.kills, 0);
  
  const winner = radiantKills > direKills ? 'radiant' : (direKills > radiantKills ? 'dire' : 'draw');
  
  console.log(`[MATCH END] Winner: ${winner} (${radiantKills} - ${direKills})`);
  
  broadcastEvent({
    type: 'matchEnd',
    winner,
    radiantKills,
    direKills
  });
  
  // Restart after 10 seconds
  setTimeout(() => {
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
      player.str = GAME.BASE_STR;
      player.agi = GAME.BASE_AGI;
      player.int = GAME.BASE_INT;
      player.level = 1;
      calculatePlayerStats(player);
    }
    
    hooks.length = 0;
    
    console.log('[MATCH] New match started');
  }, 10000);
}

// ============================================
// START SERVER
// ============================================
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
  console.log('');
  console.log('🎮 ABILITIES:');
  console.log('  Q - Meat Hook (pull enemy/ally)');
  console.log('  W - Rot (damage aura)');
  console.log('');
  console.log('⚡ ATTRIBUTES:');
  console.log('  STR - Health & Damage');
  console.log('  AGI - Armor & Attack Speed');
  console.log('  INT - Mana & Mana Regen');
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
