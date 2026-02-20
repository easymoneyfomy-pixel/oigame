/**
 * 🥩 PUDGE WARS - Do You Wanna Jam 2024
 * Server with Original Abilities
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
  PLAYER_SPEED: 4,
  BASE_HEALTH: 800,
  BASE_MANA: 300,
  HOOK_RANGE: 1200,
  HOOK_SPEED: 30,
  HOOK_RADIUS: 15,
  HOOK_COOLDOWN: 12000,
  HOOK_DAMAGE: 150,
  HOOK_MANA_COST: 120,
  PHASE_DURATION: 1500,
  PHASE_COOLDOWN: 18000,
  PHASE_MANA_COST: 80,
  EARTHBIND_RANGE: 900,
  EARTHBIND_RADIUS: 180,
  EARTHBIND_DURATION: 2000,
  EARTHBIND_COOLDOWN: 16000,
  EARTHBIND_MANA_COST: 100,
  BLINK_RANGE: 800,
  BLINK_COOLDOWN: 8000,
  BLINK_MANA_COST: 60,
  REARM_COOLDOWN: 60000,
  REARM_MANA_COST: 200,
  RESPAWN_TIME: 5000,
  GOLD_PER_KILL: 150,
  RIVER_Y: 1000,
  RIVER_WIDTH: 200
};

const players = new Map();
const hooks = [];
const earthbinds = [];
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
    x: pos.x, y: pos.y,
    team,
    health: GAME.BASE_HEALTH,
    maxHealth: GAME.BASE_HEALTH,
    mana: GAME.BASE_MANA,
    maxMana: GAME.BASE_MANA,
    speed: GAME.PLAYER_SPEED,
    ws,
    hookCooldown: 0,
    phaseCooldown: 0,
    earthbindCooldown: 0,
    blinkCooldown: 0,
    rearmCooldown: 0,
    isPhasing: false,
    phaseEndTime: 0,
    isRooted: false,
    rootEndTime: 0,
    isDead: false,
    respawnTime: 0,
    kills: 0,
    deaths: 0,
    gold: 600
  };
}

function killPlayer(victim, killer) {
  victim.isDead = true;
  victim.respawnTime = Date.now() + GAME.RESPAWN_TIME;
  victim.deaths++;

  if (killer) {
    killer.kills++;
    killer.gold += GAME.GOLD_PER_KILL;
    
    if (killer.team === 'radiant') radiantScore++;
    else direScore++;
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

function handlePlayerMessage(player, msg) {
  if (player.isDead || player.isPhasing) return;

  const now = Date.now();

  switch (msg.type) {
    case 'move':
      const dx = clamp(msg.dx || 0, -1, 1);
      const dy = clamp(msg.dy || 0, -1, 1);
      const len = Math.hypot(dx, dy);
      if (len > 0 && !player.isRooted) {
        player.x = clamp(player.x + (dx / len) * player.speed, GAME.PLAYER_RADIUS, FIELD_SIZE - GAME.PLAYER_RADIUS);
        player.y = clamp(player.y + (dy / len) * player.speed, GAME.PLAYER_RADIUS, FIELD_SIZE - GAME.PLAYER_RADIUS);
      }
      break;

    case 'hook':
      if (now < player.hookCooldown || player.mana < GAME.HOOK_MANA_COST) return;
      const angle = msg.angle || 0;
      hooks.push({
        id: `hook_${player.id}_${now}`,
        x: player.x, y: player.y,
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

    case 'phase':
      if (now < player.phaseCooldown || player.mana < GAME.PHASE_MANA_COST) return;
      player.isPhasing = true;
      player.phaseEndTime = now + GAME.PHASE_DURATION;
      player.phaseCooldown = now + GAME.PHASE_COOLDOWN;
      player.mana -= GAME.PHASE_MANA_COST;
      broadcastEvent({ type: 'phaseStart', playerId: player.id });
      setTimeout(() => {
        if (player.isPhasing) {
          player.isPhasing = false;
          broadcastEvent({ type: 'phaseEnd', playerId: player.id });
        }
      }, GAME.PHASE_DURATION);
      break;

    case 'earthbind':
      if (now < player.earthbindCooldown || player.mana < GAME.EARTHBIND_MANA_COST) return;
      const ex = msg.x || player.x;
      const ey = msg.y || player.y;
      earthbinds.push({
        id: `eb_${player.id}_${now}`,
        x: ex, y: ey,
        radius: GAME.EARTHBIND_RADIUS,
        ownerId: player.id
      });
      player.earthbindCooldown = now + GAME.EARTHBIND_COOLDOWN;
      player.mana -= GAME.EARTHBIND_MANA_COST;
      broadcastEvent({ type: 'earthbindCast', playerId: player.id, x: ex, y: ey });
      
      // Проверка попадания
      setTimeout(() => {
        for (const other of players.values()) {
          if (other.team !== player.team && !other.isDead && !other.isPhasing) {
            if (pointInCircle(other.x, other.y, ex, ey, GAME.EARTHBIND_RADIUS)) {
              other.isRooted = true;
              other.rootEndTime = now + GAME.EARTHBIND_DURATION;
              broadcastEvent({ type: 'earthbindHit', playerId: player.id, targetId: other.id });
              setTimeout(() => { other.isRooted = false; }, GAME.EARTHBIND_DURATION);
            }
          }
        }
      }, 100);
      break;

    case 'blink':
      if (now < player.blinkCooldown || player.mana < GAME.BLINK_MANA_COST) return;
      const bx = Math.max(GAME.PLAYER_RADIUS, Math.min(FIELD_SIZE - GAME.PLAYER_RADIUS, msg.x || player.x));
      const by = Math.max(GAME.PLAYER_RADIUS, Math.min(FIELD_SIZE - GAME.PLAYER_RADIUS, msg.y || player.y));
      player.x = bx;
      player.y = by;
      player.blinkCooldown = now + GAME.BLINK_COOLDOWN;
      player.mana -= GAME.BLINK_MANA_COST;
      broadcastEvent({ type: 'blinkCast', playerId: player.id, x: bx, y: by });
      break;

    case 'rearm':
      if (now < player.rearmCooldown || player.mana < GAME.REARM_MANA_COST) return;
      player.hookCooldown = 0;
      player.phaseCooldown = 0;
      player.earthbindCooldown = 0;
      player.blinkCooldown = 0;
      player.rearmCooldown = now + GAME.REARM_COOLDOWN;
      player.mana -= GAME.REARM_MANA_COST;
      broadcastEvent({ type: 'rearmCast', playerId: player.id });
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
        if (id === hook.ownerId || player.isDead || player.isPhasing) continue;
        if (pointInCircle(hook.x, hook.y, player.x, player.y, GAME.PLAYER_RADIUS + GAME.HOOK_RADIUS)) {
          if (player.team === hook.owner.team) {
            hook.state = 'pulling';
            hook.targetId = player.id;
            broadcastEvent({ type: 'allySaved', playerId: hook.ownerId, allyId: player.id });
          } else {
            player.health -= hook.damage;
            hook.state = 'pulling';
            hook.targetId = player.id;
            broadcastEvent({ type: 'hookHit', targetId: player.id, hitterId: hook.ownerId, damage: hook.damage });
            if (player.health <= 0 && !player.isDead) killPlayer(player, hook.owner);
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

    if (hook.state === 'done') hooks.splice(i, 1);
  }
}

function updateEarthbinds() {
  for (let i = earthbinds.length - 1; i >= 0; i--) {
    earthbinds[i].life = (earthbinds[i].life || 30) - 1;
    if (earthbinds[i].life <= 0) earthbinds.splice(i, 1);
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

  const state = {
    type: 'state',
    matchTime,
    players: [...players.values()].map(p => [
      p.id, Math.round(p.x * 100) / 100, Math.round(p.y * 100) / 100, p.team,
      Math.round(p.health), p.maxHealth, Math.round(p.mana), p.maxMana,
      p.kills, p.deaths
    ]),
    hooks: hooks.map(h => [h.id, h.x, h.y, h.targetX, h.targetY, h.ownerId, h.state]),
    earthbinds: earthbinds.map(e => [e.id, e.x, e.y, e.radius]),
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

  if (pathname === '/' || pathname === '/index_jam.html') {
    const filePath = pathname === '/' ? '/index_jam.html' : pathname;
    const clientPath = path.join(__dirname, filePath);
    fs.readFile(clientPath, (err, data) => {
      if (err) { res.writeHead(404); res.end('Not found'); return; }
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
      if (err) { res.writeHead(404); res.end('Not found'); return; }
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(data);
    });
  }
});

const wss = new WebSocket.Server({ server, maxPayload: 1024, perMessageDeflate: false });

wss.on('connection', (ws) => {
  const player = createPlayer(ws);
  if (!player) { ws.close(); return; }
  
  players.set(player.id, player);

  ws.send(JSON.stringify({
    type: 'welcome',
    playerId: player.id,
    team: player.team,
    matchTime: Math.max(0, MATCH_DURATION - (Date.now() - matchStartTime)),
    players: [...players.values()].map(p => [
      p.id, Math.round(p.x * 100) / 100, Math.round(p.y * 100) / 100, p.team,
      Math.round(p.health), p.maxHealth, Math.round(p.mana), p.maxMana,
      p.kills, p.deaths, p.name
    ])
  }));

  console.log(`[JOIN] Player ${player.id} joined ${player.team}`);

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data);
      if (!msg || typeof msg !== 'object') return;
      handlePlayerMessage(player, msg);
    } catch (e) {
      console.warn(`[PARSE ERROR] Player ${player.id}:`, e.message);
    }
  });

  ws.on('close', () => {
    console.log(`[LEAVE] Player ${player.id} disconnected`);
    players.delete(player.id);
  });

  ws.on('error', () => players.delete(player.id));
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
        p.x = pos.x; p.y = pos.y;
        p.health = p.maxHealth; p.mana = p.maxMana;
        p.isDead = false; p.kills = 0; p.deaths = 0; p.gold = 600;
      }
      hooks.length = 0;
      earthbinds.length = 0;
    }, 10000);
    return;
  }

  updateHooks();
  updateEarthbinds();
  checkRespawn();
  broadcastState();
}, 1000 / 64);

server.listen(PORT, '0.0.0.0', () => {
  console.log('========================================');
  console.log('  🥩 PUDGE WARS - JAM 2024 EDITION');
  console.log('========================================');
  console.log(`  Port: ${PORT}`);
  console.log(`  Field: ${FIELD_SIZE}x${FIELD_SIZE}`);
  console.log(`  Tick Rate: 64 TPS`);
  console.log('========================================');
  console.log(`  Open: http://localhost:${PORT}`);
  console.log('========================================');
  console.log('  ABILITIES (Original Jam 2024):');
  console.log('  Q - Meat Hook (pull enemies)');
  console.log('  W - Phase Shift (invisible 1.5s)');
  console.log('  E - Earthbind (root enemy)');
  console.log('  R - Blink (teleport)');
  console.log('  T - Rearm (reset cooldowns)');
  console.log('========================================');
});

server.on('error', (err) => console.error('[ERROR]', err));

process.on('SIGINT', () => {
  console.log('\n[SHUTDOWN] Closing...');
  clearInterval(gameLoop);
  for (const p of players.values()) p.ws.close();
  server.close(() => { wss.close(() => { console.log('[SHUTDOWN] Done'); process.exit(0); }); });
});
