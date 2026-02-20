/**
 * 🥩 PUDGE WARS - Warcraft 3 Original
 * Оригинальные скиллы: Hook/Rot/Dismember/Flesh Heap
 */
const WebSocket = require('ws');
const http = require('http');
const path = require('path');
const fs = require('fs');

const PORT = process.env.PORT || 8080;
const FIELD_SIZE = 2000;
const MATCH_DURATION = 420000;

const GAME = {
  PLAYER_RADIUS: 25,
  PLAYER_SPEED: 3.6,
  BASE_HEALTH: 700,
  BASE_MANA: 291,
  BASE_STR: 25,
  BASE_AGI: 14,
  BASE_INT: 16,
  HOOK_RANGE: 1050,
  HOOK_SPEED: 30,
  HOOK_RADIUS: 40,
  HOOK_COOLDOWN: 14000,
  HOOK_DAMAGE: 180,
  HOOK_MANA_COST: 110,
  ROT_DAMAGE: 30,
  ROT_SLOW: 0.2,
  ROT_RADIUS: 250,
  ROT_TICK: 1000,
  DISMEMBER_DAMAGE: 100,
  DISMEMBER_DURATION: 2750,
  DISMEMBER_COOLDOWN: 30000,
  DISMEMBER_MANA_COST: 100,
  DISMEMBER_RANGE: 160,
  FLESH_HEAP_PER_KILL: 1.4,
  FLESH_HEAP_RADIUS: 450,
  RESPAWN_TIME: 5000,
  GOLD_PER_KILL: 150,
  RIVER_Y: 1000,
  RIVER_WIDTH: 200
};

const players = new Map();
const hooks = [];
const rotEffects = new Map(); // playerId -> { endTime, lastDamage }
const dismemberEffects = new Map(); // casterId -> { targetId, endTime, lastDamage }
let nextPlayerId = 1;
let matchStartTime = Date.now();
let radiantScore = 0;
let direScore = 0;

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function pointInCircle(px, py, cx, cy, radius) {
  return Math.hypot(px - cx, py - cy) < radius;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function getSpawnPosition(team) {
  const x = 500 + Math.random() * 1000;
  return team === 'radiant'
    ? { x, y: 200 + Math.random() * 300 }
    : { x, y: 1500 + Math.random() * 300 };
}

function createPlayer(ws) {
  const radiantCount = [...players.values()].filter(p => p.team === 'radiant').length;
  const direCount = [...players.values()].filter(p => p.team === 'dire').length;
  const team = radiantCount <= direCount ? 'radiant' : 'dire';
  const pos = getSpawnPosition(team);

  return {
    id: nextPlayerId++,
    x: pos.x,
    y: pos.y,
    team,
    health: GAME.BASE_HEALTH,
    maxHealth: GAME.BASE_HEALTH,
    mana: GAME.BASE_MANA,
    maxMana: GAME.BASE_MANA,
    str: GAME.BASE_STR,
    agi: GAME.BASE_AGI,
    int: GAME.BASE_INT,
    strBonus: 0, // Flesh Heap
    speed: GAME.PLAYER_SPEED,
    ws,
    hookCooldown: 0,
    rotCooldown: 0,
    dismemberCooldown: 0,
    isRotting: false,
    rotEndTime: 0,
    rotLastDamage: 0,
    isDismembering: false,
    dismemberEndTime: 0,
    isDismemberTarget: false,
    isDead: false,
    respawnTime: 0,
    kills: 0,
    deaths: 0,
    gold: 600,
    name: `Pudge_${nextPlayerId - 1}`
  };
}

function killPlayer(victim, killer) {
  if (victim.isDead) return;
  victim.isDead = true;
  victim.deaths++;
  victim.respawnTime = Date.now() + GAME.RESPAWN_TIME;
  
  if (killer && killer.id !== victim.id) {
    killer.kills++;
    killer.gold += GAME.GOLD_PER_KILL;
    // Flesh Heap - сила за убийство
    killer.strBonus += GAME.FLESH_HEAP_PER_KILL;
    killer.maxHealth += GAME.FLESH_HEAP_PER_KILL * 20;
    killer.health = Math.min(killer.health + GAME.FLESH_HEAP_PER_KILL * 20, killer.maxHealth);
    broadcastEvent({ type: 'fleshHeap', playerId: killer.id, strBonus: killer.strBonus, strGain: GAME.FLESH_HEAP_PER_KILL });
    if (victim.team === 'radiant') direScore++;
    else radiantScore++;
    broadcastEvent({ type: 'playerKill', victimId: victim.id, killerId: killer.id });
  } else {
    if (victim.team === 'radiant') direScore++;
    else radiantScore++;
  }
  
  console.log(`[KILL] ${killer ? `Player ${killer.id}` : 'Unknown'} killed Player ${victim.id}`);
  broadcastEvent({ type: 'playerKill', victimId: victim.id, killerId: killer?.id });
}

function respawnPlayer(player) {
  const pos = getSpawnPosition(player.team);
  player.x = pos.x;
  player.y = pos.y;
  player.health = player.maxHealth;
  player.mana = player.maxMana;
  player.isDead = false;
  player.isRotting = false;
  player.isDismembering = false;
  player.isDismemberTarget = false;
  console.log(`[RESPAWN] Player ${player.id}`);
}

function handlePlayerMessage(player, msg) {
  if (player.isDead) return;
  const now = Date.now();

  switch (msg.type) {
    case 'move':
      // Не даём двигаться если под дизмембером
      if (player.isDismemberTarget) return;
      if (msg.x && msg.y && !player.isDead) {
        // Плавное движение к точке
        const dx = msg.x - player.x;
        const dy = msg.y - player.y;
        const dist = Math.hypot(dx, dy);
        if (dist > 5) {
          const moveDist = Math.min(dist, GAME.PLAYER_SPEED);
          player.x += (dx / dist) * moveDist;
          player.y += (dy / dist) * moveDist;
          player.x = clamp(player.x, GAME.PLAYER_RADIUS, FIELD_SIZE - GAME.PLAYER_RADIUS);
          player.y = clamp(player.y, GAME.PLAYER_RADIUS, FIELD_SIZE - GAME.PLAYER_RADIUS);
          // Поворот в сторону движения
          player.angle = Math.atan2(dy, dx);
        }
      }
      break;

    case 'hook':
      if (now < player.hookCooldown || player.mana < GAME.HOOK_MANA_COST) return;
      const angle = msg.angle || 0;
      hooks.push({
        id: `hook_${player.id}_${now}`,
        x: player.x,
        y: player.y,
        targetX: msg.targetX || player.x + Math.cos(angle) * GAME.HOOK_RANGE,
        targetY: msg.targetY || player.y + Math.sin(angle) * GAME.HOOK_RANGE,
        ownerId: player.id,
        owner: player,
        vx: Math.cos(angle) * GAME.HOOK_SPEED,
        vy: Math.sin(angle) * GAME.HOOK_SPEED,
        traveled: 0,
        state: 'flying',
        targetId: null,
        damage: GAME.HOOK_DAMAGE
      });
      player.hookCooldown = now + GAME.HOOK_COOLDOWN;
      player.mana -= GAME.HOOK_MANA_COST;
      broadcastEvent({ type: 'hookFire', playerId: player.id });
      break;

    case 'rot':
      if (now < player.rotCooldown || player.mana < GAME.ROT_MANA_COST) return;
      player.isRotting = true;
      player.rotEndTime = now + GAME.ROT_DURATION;
      player.rotCooldown = now + GAME.ROT_COOLDOWN;
      player.mana -= GAME.ROT_MANA_COST;
      player.rotLastDamage = now;
      broadcastEvent({ type: 'rotStart', playerId: player.id });
      break;

    case 'dismember':
      if (now < player.dismemberCooldown || player.mana < GAME.DISEMEMBER_MANA_COST) return;
      const targetId = msg.targetId;
      const target = players.get(targetId);
      if (!target || target.isDead || target.team === player.team) return;
      const dist = distance(player, target);
      if (dist > GAME.DISEMEMBER_RANGE) return;
      
      player.isDismembering = true;
      player.dismemberEndTime = now + GAME.DISEMEMBER_DURATION;
      player.dismemberCooldown = now + GAME.DISEMEMBER_COOLDOWN;
      player.mana -= GAME.DISEMEMBER_MANA_COST;
      
      target.isDismemberTarget = true;
      target.dismemberEndTime = now + GAME.DISEMEMBER_DURATION;
      
      dismemberEffects.set(player.id, {
        targetId: target.id,
        endTime: now + GAME.DISEMEMBER_DURATION,
        lastDamage: now
      });
      
      broadcastEvent({ type: 'dismemberStart', casterId: player.id, targetId: target.id });
      break;
  }
}

function updateHooks() {
  for (let i = hooks.length - 1; i >= 0; i--) {
    const hook = hooks[i];
    if (hook.state === 'flying') {
      hook.x += hook.vx;
      hook.y += hook.vy;
      hook.traveled += GAME.HOOK_SPEED;
      if (hook.traveled >= GAME.HOOK_RANGE) {
        hook.state = 'returning';
      }
      // Проверка попадания
      for (const [id, player] of players) {
        if (id === hook.ownerId || player.isDead) continue;
        if (pointInCircle(hook.x, hook.y, player.x, player.y, GAME.PLAYER_RADIUS + GAME.HOOK_RADIUS)) {
          if (player.team === hook.owner.team) {
            // Союзник - просто тащим
            hook.state = 'pulling';
            hook.targetId = player.id;
            broadcastEvent({ type: 'allySaved', playerId: hook.ownerId, allyId: player.id });
          } else {
            // Враг - урон и тащим
            player.health -= hook.damage;
            hook.state = 'pulling';
            hook.targetId = player.id;
            broadcastEvent({ type: 'hookHit', targetId: player.id, hitterId: hook.ownerId, damage: hook.damage });
            if (player.health <= 0 && !player.isDead) {
              killPlayer(player, hook.owner);
            }
          }
          break;
        }
      }
    } else if (hook.state === 'pulling') {
      const owner = hook.owner;
      if (owner && !owner.isDead) {
        const dx = owner.x - hook.x;
        const dy = owner.y - hook.y;
        const dist = Math.hypot(dx, dy);
        if (dist < 20) {
          hook.state = 'done';
        } else {
          hook.x += (dx / dist) * 12;
          hook.y += (dy / dist) * 12;
          if (hook.targetId !== null) {
            const target = players.get(hook.targetId);
            if (target && !target.isDead) {
              target.x = hook.x;
              target.y = hook.y;
            }
          }
        }
      } else {
        hook.state = 'done';
      }
    }
    if (hook.state === 'done') {
      hooks.splice(i, 1);
    }
  }
}

function updateRot() {
  const now = Date.now();
  for (const player of players.values()) {
    if (player.isRotting && !player.isDead) {
      if (now > player.rotEndTime) {
        player.isRotting = false;
      } else if (now - player.rotLastDamage >= GAME.ROT_TICK) {
        // Урон всем врагам в радиусе
        for (const other of players.values()) {
          if (other.team !== player.team && !other.isDead && !other.isDismemberTarget) {
            if (pointInCircle(other.x, other.y, player.x, player.y, GAME.ROT_RADIUS)) {
              other.health -= GAME.ROT_DAMAGE;
              broadcastEvent({ type: 'rotDamage', targetId: other.id, damage: GAME.ROT_DAMAGE });
              if (other.health <= 0 && !other.isDead) {
                killPlayer(other, player);
              }
            }
          }
        }
        player.rotLastDamage = now;
      }
    }
  }
}

function updateDismember() {
  const now = Date.now();
  for (const [casterId, effect] of dismemberEffects) {
    const caster = players.get(casterId);
    const target = players.get(effect.targetId);
    
    if (!caster || !target || caster.isDead || target.isDead) {
      dismemberEffects.delete(casterId);
      if (caster) {
        caster.isDismembering = false;
        broadcastEvent({ type: 'dismemberEnd', casterId: casterId, targetId: effect.targetId });
      }
      if (target) target.isDismemberTarget = false;
      continue;
    }
    
    if (now > effect.endTime || distance(caster, target) > GAME.DISEMEMBER_RANGE * 1.5) {
      dismemberEffects.delete(casterId);
      caster.isDismembering = false;
      target.isDismemberTarget = false;
      broadcastEvent({ type: 'dismemberEnd', casterId: casterId, targetId: effect.targetId });
      continue;
    }
    
    // Урон каждую секунду
    if (now - effect.lastDamage >= 1000) {
      target.health -= GAME.DISEMEMBER_DAMAGE;
      broadcastEvent({ type: 'dismemberDamage', targetId: effect.targetId, damage: GAME.DISEMEMBER_DAMAGE });
      effect.lastDamage = now;
      
      if (target.health <= 0 && !target.isDead) {
        killPlayer(target, caster);
      }
    }
  }
}

function checkRespawn() {
  const now = Date.now();
  for (const player of players.values()) {
    if (player.isDead && now >= player.respawnTime) {
      respawnPlayer(player);
    }
  }
}

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
  const rotPlayers = [...rotEffects.keys()].filter(pid => {
    const effect = rotEffects.get(pid);
    return effect && effect.endTime > Date.now();
  });
  
  const state = {
    type: 'state',
    matchTime,
    players: [...players.values()].map(p => [
      p.id,
      Math.round(p.x * 100) / 100,
      Math.round(p.y * 100) / 100,
      p.team,
      Math.round(p.health),
      p.maxHealth,
      Math.round(p.mana),
      p.maxMana,
      p.kills,
      p.deaths,
      p.name,
      p.strBonus
    ]),
    hooks: hooks.map(h => [h.id, h.x, h.y, h.targetX, h.targetY, h.ownerId, h.state]),
    rotPlayers,
    scores: [radiantScore, direScore]
  };
  const data = JSON.stringify(state);
  for (const player of players.values()) {
    if (player.ws.readyState === WebSocket.OPEN) {
      player.ws.send(data);
    }
  }
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  let pathname = url.pathname;
  
  if (pathname === '/health' || pathname === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      players: players.size,
      uptime: Math.floor((Date.now() - matchStartTime) / 1000),
      radiantScore,
      direScore
    }));
    return;
  }
  
  if (pathname === '/' || pathname === '/index.html') {
    const filePath = pathname === '/' ? '/index.html' : pathname;
    const clientPath = path.join(__dirname, filePath);
    fs.readFile(clientPath, (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end('Not found');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(data);
    });
  } else {
    const filePath = path.join(__dirname, pathname);
    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes = {
      '.html': 'text/html; charset=utf-8',
      '.js': 'application/javascript; charset=utf-8',
      '.css': 'text/css; charset=utf-8'
    };
    const contentType = mimeTypes[ext] || 'application/octet-stream';
    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end('Not found');
        return;
      }
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(data);
    });
  }
});

const wss = new WebSocket.Server({
  server,
  maxPayload: 1024,
  perMessageDeflate: false,
  clientTracking: true
});

wss.on('connection', (ws, req) => {
  console.log(`[WS CONNECT] ${req.socket.remoteAddress}`);
  const player = createPlayer(ws);
  if (!player) {
    ws.close();
    return;
  }
  players.set(player.id, player);
  ws.send(JSON.stringify({
    type: 'welcome',
    playerId: player.id,
    team: player.team,
    matchTime: Math.max(0, MATCH_DURATION - (Date.now() - matchStartTime)),
    players: [...players.values()].map(p => [
      p.id,
      Math.round(p.x * 100) / 100,
      Math.round(p.y * 100) / 100,
      p.team,
      Math.round(p.health),
      p.maxHealth,
      Math.round(p.mana),
      p.maxMana,
      p.kills,
      p.deaths,
      p.name,
      p.strBonus
    ])
  }));
  console.log(`[JOIN] Player ${player.id} joined ${player.team}`);
  
  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data);
      if (!msg || typeof msg !== 'object') return;
      console.log(`[MSG] Player ${player.id}: ${msg.type}`, msg.type === 'move' ? `x=${Math.round(msg.x)}, y=${Math.round(msg.y)}` : '');
      handlePlayerMessage(player, msg);
    } catch (e) {
      console.warn(`[PARSE ERROR] Player ${player.id}:`, e.message);
    }
  });
  
  ws.on('close', () => {
    console.log(`[LEAVE] Player ${player.id} disconnected`);
    players.delete(player.id);
  });
  
  ws.on('error', (err) => {
    console.log(`[ERROR] Player ${player.id}:`, err.message);
    players.delete(player.id);
  });
});

const gameLoop = setInterval(() => {
  const matchElapsed = Date.now() - matchStartTime;
  if (matchElapsed >= MATCH_DURATION) {
    const winner = radiantScore > direScore ? 'radiant' : direScore > radiantScore ? 'dire' : 'draw';
    console.log(`[MATCH END] ${winner} (${radiantScore} - ${direScore})`);
    broadcastEvent({ type: 'matchEnd', winner, radiantScore, direScore });
    setTimeout(() => {
      radiantScore = 0;
      direScore = 0;
      matchStartTime = Date.now();
      for (const p of players.values()) {
        const pos = getSpawnPosition(p.team);
        p.x = pos.x;
        p.y = pos.y;
        p.health = p.maxHealth;
        p.mana = p.maxMana;
        p.isDead = false;
        p.kills = 0;
        p.deaths = 0;
        p.gold = 600;
      }
      hooks.length = 0;
      rotEffects.clear();
      dismemberEffects.clear();
    }, 10000);
    return;
  }
  
  updateHooks();
  updateRot();
  updateDismember();
  checkRespawn();
  broadcastState();
}, 1000 / 64);

server.listen(PORT, '0.0.0.0', () => {
  console.log('========================================');
  console.log('  🥩 PUDGE WARS - Warcraft 3 Original');
  console.log('========================================');
  console.log(`  Port: ${PORT}`);
  console.log(`  Field: ${FIELD_SIZE}x${FIELD_SIZE}`);
  console.log(`  Tick Rate: 64 TPS`);
  console.log('========================================');
  console.log(`  Open: http://localhost:${PORT}`);
  console.log('========================================');
  console.log('  ABILITIES (Warcraft 3 Values):');
  console.log('  Q - Meat Hook (150 dmg)');
  console.log('  E - Rot (40 dmg/sec + slow)');
  console.log('  R - Dismember (80 dmg/sec)');
  console.log('  Passive - Flesh Heap (+1.5 STR/kill)');
  console.log('========================================');
});

server.on('error', (err) => console.error('[ERROR]', err));

process.on('SIGINT', () => {
  console.log('\n[SHUTDOWN] Closing...');
  clearInterval(gameLoop);
  for (const p of players.values()) p.ws.close();
  server.close(() => {
    wss.close(() => {
      console.log('[SHUTDOWN] Done');
      process.exit(0);
    });
  });
});
