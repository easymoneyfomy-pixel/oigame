// ============================================
// 🥩 PUDGE WARS - Warcraft 3 Original
// Оригинальные скиллы из Warcraft 3
// ============================================

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

const CONFIG = {
  FIELD_SIZE: 2000,
  RIVER_Y: 1000,
  RIVER_WIDTH: 200,
  PLAYER_RADIUS: 25,
  PLAYER_SPEED: 3.6,
  BASE_HEALTH: 700,
  BASE_MANA: 291,
  BASE_STR: 25,
  BASE_AGI: 14,
  BASE_INT: 16,
  
  // Q - Meat Hook
  HOOK_RANGE: 1200,
  HOOK_SPEED: 30,
  HOOK_RADIUS: 15,
  HOOK_COOLDOWN: 12000,
  HOOK_MANA_COST: 120,
  
  // E - Rot
  ROT_DAMAGE: 40,
  ROT_SLOW: 0.3,
  ROT_DURATION: 8000,
  ROT_COOLDOWN: 8000,
  ROT_MANA_COST: 70,
  ROT_RADIUS: 200,
  
  // R - Dismember
  DISMEMBER_DAMAGE: 80,
  DISMEMBER_DURATION: 3000,
  DISMEMBER_COOLDOWN: 20000,
  DISMEMBER_MANA_COST: 150,
  DISMEMBER_RANGE: 150,
  
  // Пассивка - Flesh Heap
  FLESH_HEAP_PER_KILL: 1.5
};

let ws = null, myId = null, gameRunning = false;
let cameraX = 0, cameraY = 0, cameraFollow = true;

const state = {
  players: new Map(),
  hooks: [],
  rotEffects: [],
  dismemberTargets: new Set(),
  myTeam: null,
  radiantScore: 0,
  direScore: 0
};

const input = {
  mouseX: 0,
  mouseY: 0,
  moveTarget: null,
  keys: {}
};

const cooldowns = {
  hook: 0,
  rot: 0,
  dismember: 0
};

const particles = [];
const floatingTexts = [];

// ============================================
// КЛАССЫ
// ============================================
class Player {
  constructor(data) {
    this.id = data[0];
    this.x = data[1];
    this.y = data[2];
    this.team = data[3];
    this.health = data[4];
    this.maxHealth = data[5];
    this.mana = data[6];
    this.maxMana = data[7];
    this.kills = data[8] || 0;
    this.deaths = data[9] || 0;
    this.angle = 0;
    this.isDead = false;
    this.isRotting = false;
    this.isDismembering = false;
    this.isDismemberTarget = false;
    this.rotEndTime = 0;
    this.dismemberEndTime = 0;
    this.strBonus = 0; // Flesh Heap бонус
    this.name = data[10] || `Pudge_${this.id}`;
  }

  update() {
    if (this.isRotting && Date.now() > this.rotEndTime) {
      this.isRotting = false;
    }
    if (this.isDismembering && Date.now() > this.dismemberEndTime) {
      this.isDismembering = false;
    }
    if (this.isDismemberTarget && Date.now() > this.dismemberEndTime) {
      this.isDismemberTarget = false;
    }
    
    if (this.id === myId && cameraFollow && !this.isDead) {
      cameraX = this.x - canvas.width / 2;
      cameraY = this.y - canvas.height / 2;
      cameraX = Math.max(0, Math.min(cameraX, CONFIG.FIELD_SIZE - canvas.width));
      cameraY = Math.max(0, Math.min(cameraY, CONFIG.FIELD_SIZE - canvas.height));
    }
  }

  draw(ctx, camX, camY) {
    const sx = this.x - camX;
    const sy = this.y - camY;
    console.log(`[PLAYER.draw] id=${this.id} pos=(${this.x},${this.y}) cam=(${camX},${camY}) screen=(${sx},${sy})`);

    // Rot эффект
    if (this.isRotting) {
      ctx.save();
      ctx.globalAlpha = 0.4;
      ctx.fillStyle = '#2ecc71';
      ctx.beginPath();
      ctx.arc(sx, sy, CONFIG.ROT_RADIUS, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // Тело Pudge
    ctx.save();
    ctx.translate(sx, sy);
    ctx.rotate(this.angle);

    // Цвет команды
    ctx.fillStyle = this.team === 'radiant' ? '#2ecc71' : '#e74c3c';
    
    // Тело
    ctx.beginPath();
    ctx.arc(0, 0, CONFIG.PLAYER_RADIUS, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#1a1a1a';
    ctx.lineWidth = 3;
    ctx.stroke();

    // Направление взгляда
    ctx.fillStyle = '#1a1a1a';
    ctx.beginPath();
    ctx.arc(15, -8, 5, 0, Math.PI * 2);
    ctx.arc(15, 8, 5, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();

    // Имя
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 12px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(this.name, sx, sy - CONFIG.PLAYER_RADIUS - 8);

    // Flesh Heap бонус
    if (this.strBonus > 0) {
      ctx.fillStyle = '#e74c3c';
      ctx.font = '10px Arial';
      ctx.fillText(`+${this.strBonus.toFixed(1)} STR`, sx, sy - CONFIG.PLAYER_RADIUS - 20);
    }
  }
}

class Hook {
  constructor(x, y, targetX, targetY, ownerId) {
    this.x = x;
    this.y = y;
    this.targetX = targetX;
    this.targetY = targetY;
    this.ownerId = ownerId;
    const dx = targetX - x;
    const dy = targetY - y;
    const dist = Math.hypot(dx, dy);
    this.vx = (dx / dist) * CONFIG.HOOK_SPEED;
    this.vy = (dy / dist) * CONFIG.HOOK_SPEED;
    this.traveled = 0;
    this.state = 'flying';
    this.targetId = null;
  }

  update() {
    if (this.state === 'flying') {
      this.x += this.vx;
      this.y += this.vy;
      this.traveled += CONFIG.HOOK_SPEED;
      if (this.traveled >= CONFIG.HOOK_RANGE) {
        this.state = 'returning';
      }
    } else if (this.state === 'pulling') {
      const owner = state.players.get(this.ownerId);
      if (owner && !owner.isDead) {
        const dx = owner.x - this.x;
        const dy = owner.y - this.y;
        const dist = Math.hypot(dx, dy);
        if (dist < 20) {
          this.state = 'done';
        } else {
          this.x += (dx / dist) * 12;
          this.y += (dy / dist) * 12;
          if (this.targetId !== null) {
            const target = state.players.get(this.targetId);
            if (target && !target.isDead) {
              target.x = this.x;
              target.y = this.y;
            }
          }
        }
      } else {
        this.state = 'done';
      }
    }
    if (this.state === 'done') {
      const idx = state.hooks.indexOf(this);
      if (idx >= 0) state.hooks.splice(idx, 1);
    }
  }

  draw(ctx, camX, camY) {
    const sx = this.x - camX;
    const sy = this.y - camY;

    // Верёвка крюка
    ctx.strokeStyle = '#8e44ad';
    ctx.lineWidth = 4;
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    const owner = state.players.get(this.ownerId);
    if (owner) {
      ctx.moveTo(owner.x - camX, owner.y - camY);
      ctx.lineTo(sx, sy);
    }
    ctx.stroke();
    ctx.setLineDash([]);

    // Крюк
    ctx.fillStyle = '#9b59b6';
    ctx.beginPath();
    ctx.arc(sx, sy, CONFIG.HOOK_RADIUS, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#8e44ad';
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}

// ============================================
// ЭФФЕКТЫ
// ============================================
class Particle {
  constructor(x, y, color, speed, life) {
    this.x = x;
    this.y = y;
    this.color = color;
    this.vx = (Math.random() - 0.5) * speed;
    this.vy = (Math.random() - 0.5) * speed;
    this.life = life;
    this.maxLife = life;
    this.size = Math.random() * 4 + 2;
  }
  update() {
    this.x += this.vx;
    this.y += this.vy;
    this.life--;
    this.size *= 0.95;
  }
  draw(ctx, camX, camY) {
    ctx.globalAlpha = this.life / this.maxLife;
    ctx.fillStyle = this.color;
    ctx.beginPath();
    ctx.arc(this.x - camX, this.y - camY, this.size, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
}

class FloatingText {
  constructor(x, y, text, color) {
    this.x = x;
    this.y = y;
    this.text = text;
    this.color = color;
    this.life = 60;
    this.vy = -1;
  }
  update() {
    this.y += this.vy;
    this.life--;
  }
  draw(ctx, camX, camY) {
    ctx.globalAlpha = Math.max(0, this.life / 60);
    ctx.fillStyle = this.color;
    ctx.font = 'bold 18px Arial';
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 3;
    ctx.strokeText(this.text, this.x - camX, this.y - camY);
    ctx.fillText(this.text, this.x - camX, this.y - camY);
    ctx.globalAlpha = 1;
  }
}

function createHookHitEffect(x, y) {
  for (let i = 0; i < 30; i++) {
    particles.push(new Particle(x, y, '#e74c3c', 8, 40));
    particles.push(new Particle(x, y, '#f39c12', 6, 30));
  }
}

function createRotEffect(x, y) {
  for (let i = 0; i < 15; i++) {
    particles.push(new Particle(x, y, '#2ecc71', 4, 25));
  }
}

function createDismemberEffect(x, y) {
  for (let i = 0; i < 40; i++) {
    particles.push(new Particle(x, y, '#c0392b', 10, 50));
  }
}

function createDeathEffect(x, y) {
  for (let i = 0; i < 50; i++) {
    particles.push(new Particle(x, y, '#8e44ad', 12, 60));
  }
}

function showFloatingText(x, y, text, color) {
  floatingTexts.push(new FloatingText(x, y, text, color));
}

function showNotification(text, type) {
  const notif = document.createElement('div');
  notif.textContent = text;
  notif.style.cssText = `position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:rgba(0,0,0,0.9);color:#fff;padding:20px 40px;border:3px solid #e74c3c;border-radius:10px;font-size:24px;z-index:1000;animation:pudgeNotify 0.5s ease-out;`;
  document.body.appendChild(notif);
  setTimeout(() => notif.remove(), 1500);
}

// ============================================
// УПРАВЛЕНИЕ
// ============================================
canvas.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  if (gameRunning && ws && ws.readyState === WebSocket.OPEN) {
    const rect = canvas.getBoundingClientRect();
    input.moveTarget = {
      x: e.clientX - rect.left + cameraX,
      y: e.clientY - rect.top + cameraY
    };
    ws.send(JSON.stringify({ type: 'move', x: input.moveTarget.x, y: input.moveTarget.y }));
  }
});

canvas.addEventListener('mousemove', (e) => {
  const rect = canvas.getBoundingClientRect();
  input.mouseX = e.clientX - rect.left + cameraX;
  input.mouseY = e.clientY - rect.top + cameraY;
});

document.addEventListener('keydown', (e) => {
  if (!gameRunning) return;
  input.keys[e.code] = true;
  if (e.code === 'Space') {
    cameraFollow = true;
    const player = state.players.get(myId);
    if (player) {
      cameraX = player.x - canvas.width / 2;
      cameraY = player.y - canvas.height / 2;
    }
  }
  if (e.code === 'KeyQ') useAbility('hook');
  if (e.code === 'KeyE') useAbility('rot');
  if (e.code === 'KeyR') useAbility('dismember');
});

document.addEventListener('keyup', (e) => {
  input.keys[e.code] = false;
  if (e.code === 'Space') cameraFollow = false;
});

document.getElementById('startBtn').addEventListener('click', () => {
  document.getElementById('startScreen').classList.add('hidden');
  gameRunning = true;
  connect();
});

['Q', 'E', 'R'].forEach((key, i) => {
  const ability = ['hook', 'rot', 'dismember'][i];
  document.getElementById(`ability${key}`).addEventListener('click', () => {
    if (gameRunning) useAbility(ability);
  });
});

// ============================================
// ИСПОЛЬЗОВАНИЕ СПОСОБНОСТЕЙ
// ============================================
function useAbility(ability) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  const player = state.players.get(myId);
  if (!player || player.isDead) return;
  const now = Date.now();

  switch (ability) {
    case 'hook':
      if (now < cooldowns.hook || player.mana < CONFIG.HOOK_MANA_COST) return;
      const hookAngle = Math.atan2(input.mouseY - player.y, input.mouseX - player.x);
      ws.send(JSON.stringify({
        type: 'hook',
        angle: hookAngle,
        targetX: player.x + Math.cos(hookAngle) * CONFIG.HOOK_RANGE,
        targetY: player.y + Math.sin(hookAngle) * CONFIG.HOOK_RANGE
      }));
      break;

    case 'rot':
      if (now < cooldowns.rot || player.mana < CONFIG.ROT_MANA_COST) return;
      ws.send(JSON.stringify({ type: 'rot' }));
      break;

    case 'dismember':
      if (now < cooldowns.dismember || player.mana < CONFIG.DISEMEMBER_MANA_COST) return;
      // Найти ближайшего врага
      let nearestEnemy = null;
      let nearestDist = CONFIG.DISEMEMBER_RANGE;
      for (const p of state.players.values()) {
        if (p.team !== player.team && !p.isDead) {
          const dist = Math.hypot(p.x - player.x, p.y - player.y);
          if (dist < nearestDist) {
            nearestDist = dist;
            nearestEnemy = p;
          }
        }
      }
      if (nearestEnemy) {
        ws.send(JSON.stringify({
          type: 'dismember',
          targetId: nearestEnemy.id
        }));
      }
      break;
  }
}

// ============================================
// СЕТЬ
// ============================================
function connect() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${location.host}`;
  console.log('[WS] Connecting to:', wsUrl);
  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    console.log('[WS] Connected!');
    document.getElementById('connectionStatus').textContent = 'Connected ✓';
    document.getElementById('connectionStatus').style.color = '#2ecc71';
  };

  ws.onmessage = (e) => {
    try {
      const data = JSON.parse(e.data);
      console.log('[WS] Message:', data.type);
      handleServerMessage(data);
    } catch (err) {
      console.error('[WS] Parse error:', err);
    }
  };

  ws.onclose = () => {
    console.log('[WS] Closed');
    document.getElementById('connectionStatus').textContent = 'Disconnected ✗';
    document.getElementById('connectionStatus').style.color = '#e74c3c';
    gameRunning = false;
  };

  ws.onerror = (err) => {
    console.error('[WS] Error:', err);
  };
}

function handleServerMessage(data) {
  switch (data.type) {
    case 'welcome':
      myId = data.playerId;
      state.myTeam = data.team;
      for (const p of data.players) {
        state.players.set(p[0], new Player(p));
      }
      break;

    case 'state':
      const newPlayers = new Map();
      for (const p of data.players) {
        const existing = state.players.get(p[0]);
        if (existing) {
          existing.x = p[1];
          existing.y = p[2];
          existing.team = p[3];
          existing.health = p[4];
          existing.maxHealth = p[5];
          existing.mana = p[6];
          existing.maxMana = p[7];
          existing.kills = p[8];
          existing.deaths = p[9];
          existing.strBonus = p[11] || 0;
          newPlayers.set(p[0], existing);
        } else {
          newPlayers.set(p[0], new Player(p));
        }
      }
      state.players = newPlayers;

      if (data.hooks) {
        state.hooks = data.hooks.map(h => new Hook(h[1], h[2], h[3], h[4], h[5]));
      }
      if (data.rotPlayers) {
        for (const pid of data.rotPlayers) {
          const p = state.players.get(pid);
          if (p) p.isRotting = true;
        }
      }
      if (data.scores) {
        state.radiantScore = data.scores[0];
        state.direScore = data.scores[1];
        document.getElementById('radiantScore').textContent = state.radiantScore;
        document.getElementById('direScore').textContent = state.direScore;
      }
      break;

    case 'event':
      handleEvent(data.event);
      break;
  }
}

function handleEvent(evt) {
  if (evt.type === 'hookFire') {
    startCooldown('hook');
  }
  if (evt.type === 'hookHit') {
    const target = state.players.get(evt.targetId);
    if (target) {
      createHookHitEffect(target.x, target.y);
      showFloatingText(target.x, target.y, `-${evt.damage}`, '#e74c3c');
      if (target.id === myId) {
        showNotification('HOOKED!', 'notify-hook');
      }
    }
  }
  if (evt.type === 'rotStart') {
    const p = state.players.get(evt.playerId);
    if (p) {
      p.isRotting = true;
      createRotEffect(p.x, p.y);
      if (evt.playerId === myId) startCooldown('rot');
    }
  }
  if (evt.type === 'rotDamage') {
    const target = state.players.get(evt.targetId);
    if (target) {
      showFloatingText(target.x, target.y, `-${evt.damage}`, '#2ecc71');
    }
  }
  if (evt.type === 'dismemberStart') {
    const caster = state.players.get(evt.casterId);
    const target = state.players.get(evt.targetId);
    if (caster && target) {
      caster.isDismembering = true;
      target.isDismemberTarget = true;
      createDismemberEffect(target.x, target.y);
      if (evt.casterId === myId) startCooldown('dismember');
    }
  }
  if (evt.type === 'dismemberDamage') {
    const target = state.players.get(evt.targetId);
    if (target) {
      showFloatingText(target.x, target.y, `-${evt.damage}`, '#c0392b');
    }
  }
  if (evt.type === 'dismemberEnd') {
    const caster = state.players.get(evt.casterId);
    const target = state.players.get(evt.targetId);
    if (caster) caster.isDismembering = false;
    if (target) target.isDismemberTarget = false;
  }
  if (evt.type === 'fleshHeap') {
    const p = state.players.get(evt.playerId);
    if (p) {
      p.strBonus = evt.strBonus;
      if (evt.playerId === myId) {
        showNotification(`+${evt.strGain} STR!`, 'notify-flesh');
      }
    }
  }
  if (evt.type === 'playerKill') {
    const victim = state.players.get(evt.victimId);
    if (victim) {
      createDeathEffect(victim.x, victim.y);
      if (evt.killerId === myId) {
        showNotification('KILL! +150💰', 'notify-kill');
        showFloatingText(victim.x, victim.y, '+150', '#f39c12');
      }
    }
  }
}

function startCooldown(ability) {
  const now = Date.now();
  if (ability === 'hook') cooldowns.hook = now + CONFIG.HOOK_COOLDOWN;
  if (ability === 'rot') cooldowns.rot = now + CONFIG.ROT_COOLDOWN;
  if (ability === 'dismember') cooldowns.dismember = now + CONFIG.DISEMEMBER_COOLDOWN;
}

function updateCooldowns() {
  const now = Date.now();
  const abilities = [
    { el: document.getElementById('abilityQ'), cd: document.getElementById('qCd'), key: 'hook', maxCd: CONFIG.HOOK_COOLDOWN },
    { el: document.getElementById('abilityE'), cd: document.getElementById('eCd'), key: 'rot', maxCd: CONFIG.ROT_COOLDOWN },
    { el: document.getElementById('abilityR'), cd: document.getElementById('rCd'), key: 'dismember', maxCd: CONFIG.DISEMEMBER_COOLDOWN }
  ];

  for (const ab of abilities) {
    const cdEnd = cooldowns[ab.key];
    if (cdEnd > now) {
      const remaining = cdEnd - now;
      const pct = (remaining / ab.maxCd) * 100;
      ab.cd.style.width = `${pct}%`;
      ab.el.classList.add('on-cooldown');
    } else {
      ab.cd.style.width = '0%';
      ab.el.classList.remove('on-cooldown');
    }
  }
}

function updateUI() {
  const player = state.players.get(myId);
  if (!player) return;

  const maxHealth = player.maxHealth + (player.strBonus || 0) * 20;
  const healthPct = (player.health / maxHealth) * 100;
  const manaPct = (player.mana / player.maxMana) * 100;

  document.getElementById('healthBar').style.width = `${healthPct}%`;
  document.getElementById('manaBar').style.width = `${manaPct}%`;
  document.getElementById('healthText').textContent = `${Math.round(player.health)}/${maxHealth}`;
  document.getElementById('manaText').textContent = `${Math.round(player.mana)}/${player.maxMana}`;

  // Атрибуты
  const str = CONFIG.BASE_STR + (player.strBonus || 0);
  document.getElementById('strValue').textContent = str.toFixed(1);
  document.getElementById('agiValue').textContent = CONFIG.BASE_AGI.toFixed(1);
  document.getElementById('intValue').textContent = CONFIG.BASE_INT.toFixed(1);
}

// ============================================
// ОТРИСОВКА
// ============================================
function drawGrid(camX, camY) {
  ctx.fillStyle = '#1a1a1a';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const gridSize = 100;
  const offsetX = -camX % gridSize;
  const offsetY = -camY % gridSize;

  ctx.strokeStyle = '#333';
  ctx.lineWidth = 1;
  for (let x = offsetX; x < canvas.width; x += gridSize) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, canvas.height);
    ctx.stroke();
  }
  for (let y = offsetY; y < canvas.height; y += gridSize) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(canvas.width, y);
    ctx.stroke();
  }
}

function drawRiver(camX, camY) {
  ctx.fillStyle = 'rgba(52, 152, 219, 0.3)';
  ctx.fillRect(0, CONFIG.RIVER_Y - CONFIG.RIVER_WIDTH / 2 - camY, canvas.width, CONFIG.RIVER_WIDTH);
}

function drawMinimap() {
  const minimap = document.getElementById('minimap');
  const mctx = minimap.getContext('2d');
  const scale = minimap.width / CONFIG.FIELD_SIZE;

  mctx.fillStyle = '#1a1a1a';
  mctx.fillRect(0, 0, minimap.width, minimap.height);

  // Река
  mctx.fillStyle = 'rgba(52, 152, 219, 0.5)';
  mctx.fillRect(0, (CONFIG.RIVER_Y - CONFIG.RIVER_WIDTH / 2) * scale, minimap.width, CONFIG.RIVER_WIDTH * scale);

  // Игроки
  for (const player of state.players.values()) {
    mctx.fillStyle = player.team === 'radiant' ? '#2ecc71' : '#e74c3c';
    mctx.beginPath();
    mctx.arc(player.x * scale, player.y * scale, 3, 0, Math.PI * 2);
    mctx.fill();
  }

  // Камера
  if (myId) {
    mctx.strokeStyle = '#fff';
    mctx.lineWidth = 1;
    mctx.strokeRect(cameraX * scale, cameraY * scale, canvas.width * scale, canvas.height * scale);
  }
}

function draw() {
  drawGrid(cameraX, cameraY);
  drawRiver(cameraX, cameraY);

  console.log('[DRAW] players=', state.players.size, 'myId=', myId, 'camera=', cameraX, cameraY);
  for (const player of state.players.values()) {
    console.log('[DRAW player]', player.id, player.x, player.y, player.team);
    player.update();
    player.draw(ctx, cameraX, cameraY);
  }

  for (const hook of state.hooks) {
    hook.update();
    hook.draw(ctx, cameraX, cameraY);
  }

  // Частицы
  for (let i = particles.length - 1; i >= 0; i--) {
    particles[i].update();
    particles[i].draw(ctx, cameraX, cameraY);
    if (particles[i].life <= 0) particles.splice(i, 1);
  }

  // Плавающий текст
  for (let i = floatingTexts.length - 1; i >= 0; i--) {
    floatingTexts[i].update();
    floatingTexts[i].draw(ctx, cameraX, cameraY);
    if (floatingTexts[i].life <= 0) floatingTexts.splice(i, 1);
  }

  drawMinimap();
  updateUI();
  updateCooldowns();
}

function gameLoop() {
  if (gameRunning) {
    draw();
  }
  requestAnimationFrame(gameLoop);
}

// ============================================
// ИНИЦИАЛИЗАЦИЯ
// ============================================
function resize() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
window.addEventListener('resize', resize);
resize();

requestAnimationFrame(gameLoop);
