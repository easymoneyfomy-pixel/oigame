// ============================================
// 🥩 PUDGE WARS - Do You Wanna Jam 2024
// Original Game Mechanics
// ============================================

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

// Настройки
const CONFIG = {
  FIELD_SIZE: 2000,
  RIVER_Y: 1000,
  RIVER_WIDTH: 200,
  PLAYER_RADIUS: 25,
  PLAYER_SPEED: 4,
  BASE_HEALTH: 800,
  BASE_MANA: 300,
  
  // Q - Meat Hook
  HOOK_RANGE: 1200,
  HOOK_SPEED: 30,
  HOOK_RADIUS: 15,
  HOOK_COOLDOWN: 12000,
  HOOK_DAMAGE: 150,
  HOOK_MANA_COST: 120,
  
  // W - Phase Shift
  PHASE_DURATION: 1500,
  PHASE_COOLDOWN: 18000,
  PHASE_MANA_COST: 80,
  
  // E - Earthbind
  EARTHBIND_RANGE: 900,
  EARTHBIND_RADIUS: 180,
  EARTHBIND_DURATION: 2000,
  EARTHBIND_COOLDOWN: 16000,
  EARTHBIND_MANA_COST: 100,
  
  // R - Blink
  BLINK_RANGE: 800,
  BLINK_COOLDOWN: 8000,
  BLINK_MANA_COST: 60,
  
  // T - Rearm
  REARM_COOLDOWN: 60000,
  REARM_MANA_COST: 200
};

// Состояние игры
let ws = null;
let myId = null;
let gameRunning = false;
let cameraX = 0;
let cameraY = 0;
let cameraFollow = true;

const state = {
  players: new Map(),
  hooks: [],
  earthbinds: [],
  phaseEffects: [],
  myTeam: null,
  radiantScore: 0,
  direScore: 0
};

const input = {
  mouseX: 0,
  mouseY: 0,
  moveTarget: null,
  spacePressed: false
};

const cooldowns = {
  hook: 0,
  phase: 0,
  earthbind: 0,
  blink: 0,
  rearm: 0
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
    this.isPhasing = false;
    this.isRooted = false;
    this.rootEndTime = 0;
    this.name = data[10] || `Pudge_${this.id}`;
  }
  
  update() {
    // Проверка корня
    if (this.isRooted && Date.now() > this.rootEndTime) {
      this.isRooted = false;
    }
    
    // Движение к точке
    if (input.moveTarget && this.id === myId && !this.isRooted && !this.isDead) {
      const dx = input.moveTarget.x - this.x;
      const dy = input.moveTarget.y - this.y;
      const dist = Math.hypot(dx, dy);
      
      if (dist > 10) {
        this.x += (dx / dist) * CONFIG.PLAYER_SPEED;
        this.y += (dy / dist) * CONFIG.PLAYER_SPEED;
        this.angle = Math.atan2(dy, dx);
      } else {
        input.moveTarget = null;
      }
    }
    
    // Камера следует за игроком
    if (this.id === myId && cameraFollow && !this.isDead) {
      cameraX = this.x - canvas.width / 2;
      cameraY = this.y - canvas.height / 2;
      
      // Ограничение камеры
      cameraX = Math.max(0, Math.min(cameraX, CONFIG.FIELD_SIZE - canvas.width));
      cameraY = Math.max(0, Math.min(cameraY, CONFIG.FIELD_SIZE - canvas.height));
    }
  }
  
  draw(ctx, camX, camY) {
    const sx = this.x - camX;
    const sy = this.y - camY;
    
    // Phase Shift эффект
    if (this.isPhasing) {
      const phaseGlow = ctx.createRadialGradient(sx, sy, 0, sx, sy, CONFIG.PLAYER_RADIUS * 2.5);
      phaseGlow.addColorStop(0, 'rgba(52, 152, 219, 0.6)');
      phaseGlow.addColorStop(1, 'rgba(52, 152, 219, 0)');
      ctx.fillStyle = phaseGlow;
      ctx.beginPath();
      ctx.arc(sx, sy, CONFIG.PLAYER_RADIUS * 2.5, 0, Math.PI * 2);
      ctx.fill();
      
      // Полупрозрачный игрок
      ctx.globalAlpha = 0.5;
    }
    
    // Игрок
    ctx.beginPath();
    ctx.arc(sx, sy, CONFIG.PLAYER_RADIUS, 0, Math.PI * 2);
    ctx.fillStyle = this.team === 'radiant' ? '#2ecc71' : '#e74c3c';
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = this.id === myId ? '#f1c40f' : '#2c3e50';
    ctx.stroke();
    
    ctx.globalAlpha = 1;
    
    // Направление взгляда
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(sx + Math.cos(this.angle) * CONFIG.PLAYER_RADIUS * 1.5, sy + Math.sin(this.angle) * CONFIG.PLAYER_RADIUS * 1.5);
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.lineWidth = 4;
    ctx.stroke();
    
    // Индикатор "YOU"
    if (this.id === myId) {
      ctx.fillStyle = '#f1c40f';
      ctx.font = 'bold 16px Arial';
      ctx.textAlign = 'center';
      ctx.fillText('YOU', sx, sy - CONFIG.PLAYER_RADIUS - 20);
    }
    
    // Полоска здоровья
    const hpPercent = this.health / this.maxHealth;
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(sx - 35, sy + CONFIG.PLAYER_RADIUS + 10, 70, 8);
    ctx.fillStyle = hpPercent > 0.5 ? '#2ecc71' : hpPercent > 0.25 ? '#f39c12' : '#e74c3c';
    ctx.fillRect(sx - 35, sy + CONFIG.PLAYER_RADIUS + 10, 70 * hpPercent, 8);
    
    // Индикатор корня
    if (this.isRooted) {
      ctx.fillStyle = '#9b59b6';
      ctx.font = 'bold 20px Arial';
      ctx.fillText('🕸️', sx, sy - CONFIG.PLAYER_RADIUS - 10);
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
    this.traveled = 0;
    this.state = 'flying';
    this.targetId = null;
    this.trail = [];
    
    const dx = targetX - x;
    const dy = targetY - y;
    const dist = Math.hypot(dx, dy);
    this.vx = (dx / dist) * CONFIG.HOOK_SPEED;
    this.vy = (dy / dist) * CONFIG.HOOK_SPEED;
  }
  
  update() {
    if (this.state === 'flying') {
      this.trail.push({ x: this.x, y: this.y, life: 10 });
      this.x += this.vx;
      this.y += this.vy;
      this.traveled += CONFIG.HOOK_SPEED;
      
      if (this.traveled >= CONFIG.HOOK_RANGE) {
        this.state = 'returning';
      }
    } else if (this.state === 'pulling') {
      const owner = state.players.get(this.ownerId);
      if (owner) {
        const dx = owner.x - this.x;
        const dy = owner.y - this.y;
        const dist = Math.hypot(dx, dy);
        
        if (dist < 20) {
          this.state = 'done';
        } else {
          this.x += (dx / dist) * 12;
          this.y += (dy / dist) * 12;
          
          // Притягивание цели
          if (this.targetId !== null) {
            const target = state.players.get(this.targetId);
            if (target) {
              target.x = this.x;
              target.y = this.y;
            }
          }
        }
      }
    }
    
    // Удаление trail
    for (let i = this.trail.length - 1; i >= 0; i--) {
      this.trail[i].life--;
      if (this.trail[i].life <= 0) this.trail.splice(i, 1);
    }
  }
  
  draw(ctx, camX, camY) {
    const sx = this.x - camX;
    const sy = this.y - camY;
    const owner = state.players.get(this.ownerId);
    if (!owner) return;
    
    const ox = owner.x - camX;
    const oy = owner.y - camY;
    
    // Trail
    for (const point of this.trail) {
      const alpha = point.life / 10;
      ctx.globalAlpha = alpha;
      ctx.fillStyle = '#e74c3c';
      ctx.beginPath();
      ctx.arc(point.x - camX, point.y - camY, CONFIG.HOOK_RADIUS * 0.8, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    
    // Цепь
    ctx.beginPath();
    ctx.moveTo(ox, oy);
    ctx.lineTo(sx, sy);
    ctx.strokeStyle = '#888';
    ctx.lineWidth = 5;
    ctx.setLineDash([8, 5]);
    ctx.stroke();
    ctx.setLineDash([]);
    
    // Крюк
    ctx.beginPath();
    ctx.arc(sx, sy, CONFIG.HOOK_RADIUS, 0, Math.PI * 2);
    ctx.fillStyle = this.state === 'pulling' ? '#f39c12' : '#e74c3c';
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 3;
    ctx.stroke();
  }
}

class Earthbind {
  constructor(x, y, radius) {
    this.x = x;
    this.y = y;
    this.radius = radius;
    this.life = 30;
    this.maxLife = 30;
  }
  
  update() {
    this.life--;
  }
  
  draw(ctx, camX, camY) {
    const sx = this.x - camX;
    const sy = this.y - camY;
    const alpha = this.life / this.maxLife;
    
    ctx.globalAlpha = alpha * 0.5;
    ctx.fillStyle = '#9b59b6';
    ctx.beginPath();
    ctx.arc(sx, sy, this.radius, 0, Math.PI * 2);
    ctx.fill();
    
    // Паутина
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = '#8e44ad';
    ctx.lineWidth = 2;
    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(sx + Math.cos(angle) * this.radius, sy + Math.sin(angle) * this.radius);
      ctx.stroke();
    }
    
    ctx.globalAlpha = 1;
  }
}

class Particle {
  constructor(x, y, color, speed, life) {
    this.x = x;
    this.y = y;
    this.color = color;
    this.angle = Math.random() * Math.PI * 2;
    this.speed = speed * (0.5 + Math.random() * 0.5);
    this.vx = Math.cos(this.angle) * this.speed;
    this.vy = Math.sin(this.angle) * this.speed;
    this.life = life;
    this.maxLife = life;
    this.size = 3 + Math.random() * 3;
  }
  
  update() {
    this.x += this.vx;
    this.y += this.vy;
    this.vx *= 0.95;
    this.vy *= 0.95;
    this.life--;
  }
  
  draw(ctx, camX, camY) {
    const alpha = this.life / this.maxLife;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = this.color;
    ctx.beginPath();
    ctx.arc(this.x - camX, this.y - camY, this.size, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
}

// ============================================
// ЭФФЕКТЫ
// ============================================
function createHookHitEffect(x, y) {
  for (let i = 0; i < 30; i++) {
    particles.push(new Particle(x, y, '#e74c3c', 8, 40));
    particles.push(new Particle(x, y, '#f39c12', 6, 30));
  }
}

function createPhaseEffect(x, y) {
  for (let i = 0; i < 20; i++) {
    particles.push(new Particle(x, y, '#3498db', 5, 30));
  }
}

function createEarthbindEffect(x, y) {
  for (let i = 0; i < 25; i++) {
    particles.push(new Particle(x, y, '#9b59b6', 4, 35));
  }
}

function createBlinkEffect(x, y) {
  for (let i = 0; i < 40; i++) {
    particles.push(new Particle(x, y, '#3498db', 10, 50));
  }
}

function createDeathEffect(x, y) {
  for (let i = 0; i < 50; i++) {
    particles.push(new Particle(x, y, '#8e44ad', 10, 60));
    particles.push(new Particle(x, y, '#e74c3c', 8, 50));
  }
}

function createRearmEffect(x, y) {
  for (let i = 0; i < 60; i++) {
    particles.push(new Particle(x, y, '#9b59b6', 12, 70));
    particles.push(new Particle(x, y, '#f1c40f', 10, 60));
  }
}

function showFloatingText(x, y, text, color) {
  floatingTexts.push({ x, y, text, color, life: 60, vy: -2 });
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

// ============================================
// УПРАВЛЕНИЕ
// ============================================
canvas.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  if (gameRunning) {
    const rect = canvas.getBoundingClientRect();
    input.moveTarget = {
      x: e.clientX - rect.left + cameraX,
      y: e.clientY - rect.top + cameraY
    };
    
    // Эффект клика
    createPhaseEffect(input.moveTarget.x, input.moveTarget.y);
  }
});

canvas.addEventListener('mousemove', (e) => {
  const rect = canvas.getBoundingClientRect();
  input.mouseX = e.clientX - rect.left + cameraX;
  input.mouseY = e.clientY - rect.top + cameraY;
});

document.addEventListener('keydown', (e) => {
  if (!gameRunning) return;
  
  if (e.code === 'Space') {
    cameraFollow = true;
    const player = state.players.get(myId);
    if (player) {
      cameraX = player.x - canvas.width / 2;
      cameraY = player.y - canvas.height / 2;
    }
  }
  
  if (e.code === 'KeyQ') useAbility('hook');
  if (e.code === 'KeyW') useAbility('phase');
  if (e.code === 'KeyE') useAbility('earthbind');
  if (e.code === 'KeyR') useAbility('blink');
  if (e.code === 'KeyT') useAbility('rearm');
});

document.addEventListener('keyup', (e) => {
  if (e.code === 'Space') {
    cameraFollow = false;
  }
});

document.getElementById('startBtn').addEventListener('click', () => {
  document.getElementById('startScreen').classList.add('hidden');
  gameRunning = true;
  connect();
});

document.getElementById('abilityQ').addEventListener('click', () => { if (gameRunning) useAbility('hook'); });
document.getElementById('abilityW').addEventListener('click', () => { if (gameRunning) useAbility('phase'); });
document.getElementById('abilityE').addEventListener('click', () => { if (gameRunning) useAbility('earthbind'); });
document.getElementById('abilityR').addEventListener('click', () => { if (gameRunning) useAbility('blink'); });
document.getElementById('rearm').addEventListener('click', () => { if (gameRunning) useAbility('rearm'); });

// ============================================
// СПОСОБНОСТИ
// ============================================
function useAbility(ability) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  
  const player = state.players.get(myId);
  if (!player || player.isDead || player.isPhasing) return;
  
  const now = Date.now();
  
  switch(ability) {
    case 'hook':
      if (now < cooldowns.hook || player.mana < CONFIG.HOOK_MANA_COST) return;
      const hookAngle = Math.atan2(input.mouseY - canvas.height/2, input.mouseX - canvas.width/2);
      ws.send(JSON.stringify({ 
        type: 'hook', 
        angle: hookAngle,
        targetX: player.x + Math.cos(hookAngle) * CONFIG.HOOK_RANGE,
        targetY: player.y + Math.sin(hookAngle) * CONFIG.HOOK_RANGE
      }));
      break;
      
    case 'phase':
      if (now < cooldowns.phase || player.mana < CONFIG.PHASE_MANA_COST) return;
      ws.send(JSON.stringify({ type: 'phase' }));
      break;
      
    case 'earthbind':
      if (now < cooldowns.earthbind || player.mana < CONFIG.EARTHBIND_MANA_COST) return;
      const bindAngle = Math.atan2(input.mouseY - canvas.height/2, input.mouseX - canvas.width/2);
      ws.send(JSON.stringify({ 
        type: 'earthbind',
        x: player.x + Math.cos(bindAngle) * CONFIG.EARTHBIND_RANGE,
        y: player.y + Math.sin(bindAngle) * CONFIG.EARTHBIND_RANGE
      }));
      break;
      
    case 'blink':
      if (now < cooldowns.blink || player.mana < CONFIG.BLINK_MANA_COST) return;
      const blinkAngle = Math.atan2(input.mouseY - canvas.height/2, input.mouseX - canvas.width/2);
      ws.send(JSON.stringify({ 
        type: 'blink',
        x: player.x + Math.cos(blinkAngle) * CONFIG.BLINK_RANGE,
        y: player.y + Math.sin(blinkAngle) * CONFIG.BLINK_RANGE
      }));
      break;
      
    case 'rearm':
      if (now < cooldowns.rearm || player.mana < CONFIG.REARM_MANA_COST) return;
      ws.send(JSON.stringify({ type: 'rearm' }));
      break;
  }
}

// ============================================
// СЕТЬ
// ============================================
function connect() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${protocol}//${location.host}`);
  
  ws.onopen = () => {
    document.getElementById('connectionStatus').textContent = 'Connected ✓';
    document.getElementById('connectionStatus').style.color = '#2ecc71';
  };
  
  ws.onmessage = (e) => handleServerMessage(JSON.parse(e.data));
  
  ws.onclose = () => {
    document.getElementById('connectionStatus').textContent = 'Disconnected ✗';
    document.getElementById('connectionStatus').style.color = '#e74c3c';
    gameRunning = false;
  };
}

function handleServerMessage(data) {
  switch(data.type) {
    case 'welcome':
      myId = data.playerId;
      state.myTeam = data.team;
      for (const p of data.players) state.players.set(p[0], new Player(p));
      break;
      
    case 'state':
      const newPlayers = new Map();
      for (const p of data.players) {
        const existing = state.players.get(p[0]);
        if (existing) {
          Object.assign(existing, {
            x: p[1], y: p[2], team: p[3], health: p[4], maxHealth: p[5],
            mana: p[6], maxMana: p[7], kills: p[8], deaths: p[9]
          });
          newPlayers.set(p[0], existing);
        } else {
          newPlayers.set(p[0], new Player(p));
        }
      }
      state.players = newPlayers;
      
      if (data.hooks) state.hooks = data.hooks.map(h => new Hook(h[1], h[2], h[3], h[4], h[5]));
      if (data.earthbinds) state.earthbinds = data.earthbinds.map(e => new Earthbind(e[1], e[2], e[3]));
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
      showFloatingText(target.x, target.y, `-${CONFIG.HOOK_DAMAGE}`, '#e74c3c');
      if (target.id === myId) showNotification('HOOKED!', 'notify-hook');
    }
  }
  
  if (evt.type === 'phaseStart') {
    const player = state.players.get(evt.playerId);
    if (player) {
      player.isPhasing = true;
      createPhaseEffect(player.x, player.y);
      if (evt.playerId === myId) startCooldown('phase');
    }
  }
  
  if (evt.type === 'phaseEnd') {
    const player = state.players.get(evt.playerId);
    if (player) player.isPhasing = false;
  }
  
  if (evt.type === 'earthbindCast') {
    state.earthbinds.push(new Earthbind(evt.x, evt.y, CONFIG.EARTHBIND_RADIUS));
    createEarthbindEffect(evt.x, evt.y);
    if (evt.playerId === myId) startCooldown('earthbind');
  }
  
  if (evt.type === 'earthbindHit') {
    const target = state.players.get(evt.targetId);
    if (target) {
      target.isRooted = true;
      target.rootEndTime = Date.now() + CONFIG.EARTHBIND_DURATION;
      showFloatingText(target.x, target.y, 'ROOTED!', '#9b59b6');
    }
  }
  
  if (evt.type === 'blinkCast') {
    const player = state.players.get(evt.playerId);
    if (player) {
      player.x = evt.x;
      player.y = evt.y;
      createBlinkEffect(evt.x, evt.y);
      if (evt.playerId === myId) {
        startCooldown('blink');
        showNotification('BLINK!', 'notify-blink');
      }
    }
  }
  
  if (evt.type === 'rearmCast') {
    const player = state.players.get(evt.playerId);
    if (player) {
      createRearmEffect(player.x, player.y);
      if (evt.playerId === myId) {
        cooldowns.hook = 0;
        cooldowns.phase = 0;
        cooldowns.earthbind = 0;
        cooldowns.blink = 0;
        startCooldown('rearm');
        showNotification('REARM!', 'notify-rearm');
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
  if (ability === 'phase') cooldowns.phase = now + CONFIG.PHASE_COOLDOWN;
  if (ability === 'earthbind') cooldowns.earthbind = now + CONFIG.EARTHBIND_COOLDOWN;
  if (ability === 'blink') cooldowns.blink = now + CONFIG.BLINK_COOLDOWN;
  if (ability === 'rearm') cooldowns.rearm = now + CONFIG.REARM_COOLDOWN;
}

function updateCooldowns() {
  const now = Date.now();
  
  const abilities = [
    { id: 'hook', el: document.getElementById('abilityQ'), cd: document.getElementById('qCd'), key: 'hook' },
    { id: 'phase', el: document.getElementById('abilityW'), cd: document.getElementById('wCd'), key: 'phase' },
    { id: 'earthbind', el: document.getElementById('abilityE'), cd: document.getElementById('eCd'), key: 'earthbind' },
    { id: 'blink', el: document.getElementById('abilityR'), cd: document.getElementById('rCd'), key: 'blink' },
    { id: 'rearm', el: document.getElementById('rearm'), cd: document.getElementById('tCd'), key: 'rearm' }
  ];
  
  for (const ab of abilities) {
    if (cooldowns[ab.key] > now) {
      ab.el.classList.add('on-cooldown');
      ab.cd.textContent = ((cooldowns[ab.key] - now) / 1000).toFixed(1);
    } else {
      ab.el.classList.remove('on-cooldown');
      ab.cd.textContent = '';
    }
  }
}

function updateUI() {
  const player = state.players.get(myId);
  if (!player) return;
  
  const hpPercent = (player.health / player.maxHealth) * 100;
  const manaPercent = (player.mana / player.maxMana) * 100;
  document.getElementById('healthBar').style.width = hpPercent + '%';
  document.getElementById('manaBar').style.width = manaPercent + '%';
  document.getElementById('healthText').textContent = `${Math.round(player.health)}/${Math.round(player.maxHealth)}`;
  document.getElementById('manaText').textContent = `${Math.round(player.mana)}/${Math.round(player.maxMana)}`;
}

function showNotification(text, type) {
  const el = document.createElement('div');
  el.className = 'notify-' + type;
  el.textContent = text;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 700);
}

// ============================================
// ОТРИСОВКА
// ============================================
function drawMap(camX, camY) {
  // Фон
  ctx.fillStyle = '#1a1a2e';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  
  // Сетка
  ctx.strokeStyle = 'rgba(255,255,255,0.03)';
  ctx.lineWidth = 1;
  const gridSize = 100;
  const offsetX = -camX % gridSize;
  const offsetY = -camY % gridSize;
  
  for (let x = offsetX; x < canvas.width; x += gridSize) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke();
  }
  for (let y = offsetY; y < canvas.height; y += gridSize) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke();
  }
  
  // Река
  const riverY = CONFIG.RIVER_Y - camY;
  const riverGrad = ctx.createLinearGradient(0, riverY - CONFIG.RIVER_WIDTH/2, 0, riverY + CONFIG.RIVER_WIDTH/2);
  riverGrad.addColorStop(0, 'rgba(52,152,219,0.4)');
  riverGrad.addColorStop(0.5, 'rgba(52,152,219,0.6)');
  riverGrad.addColorStop(1, 'rgba(52,152,219,0.4)');
  ctx.fillStyle = riverGrad;
  ctx.fillRect(0, riverY - CONFIG.RIVER_WIDTH/2, canvas.width, CONFIG.RIVER_WIDTH);
  
  // Граница
  ctx.strokeStyle = '#e74c3c';
  ctx.lineWidth = 4;
  ctx.strokeRect(-camX, -camY, CONFIG.FIELD_SIZE, CONFIG.FIELD_SIZE);
}

function drawMinimap() {
  const mm = document.getElementById('minimap');
  const mmCtx = mm.getContext('2d');
  const SCALE = 200 / CONFIG.FIELD_SIZE;
  
  mmCtx.fillStyle = 'rgba(0,0,0,0.9)';
  mmCtx.fillRect(0, 0, 200, 200);
  
  // Река
  mmCtx.fillStyle = 'rgba(52,152,219,0.6)';
  mmCtx.fillRect(0, (CONFIG.RIVER_Y - CONFIG.RIVER_WIDTH/2) * SCALE, 200, CONFIG.RIVER_WIDTH * SCALE);
  
  // Игроки
  for (const p of state.players.values()) {
    mmCtx.fillStyle = p.team === 'radiant' ? '#2ecc71' : '#e74c3c';
    const size = p.id === myId ? 8 : 5;
    mmCtx.beginPath();
    mmCtx.arc(p.x * SCALE, p.y * SCALE, size, 0, Math.PI * 2);
    mmCtx.fill();
  }
}

function updateAndDrawParticles(camX, camY) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.update();
    p.draw(ctx, camX, camY);
    if (p.life <= 0) particles.splice(i, 1);
  }
  
  for (let i = floatingTexts.length - 1; i >= 0; i--) {
    const ft = floatingTexts[i];
    ft.y += ft.vy;
    ft.life--;
    ctx.globalAlpha = ft.life / 60;
    ctx.fillStyle = ft.color;
    ctx.font = 'bold 24px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(ft.text, ft.x - camX, ft.y - camY);
    ctx.globalAlpha = 1;
    if (ft.life <= 0) floatingTexts.splice(i, 1);
  }
}

function draw() {
  drawMap(cameraX, cameraY);
  updateAndDrawParticles(cameraX, cameraY);
  
  // Earthbinds
  for (let i = state.earthbinds.length - 1; i >= 0; i--) {
    const eb = state.earthbinds[i];
    eb.update();
    eb.draw(ctx, cameraX, cameraY);
    if (eb.life <= 0) state.earthbinds.splice(i, 1);
  }
  
  // Hooks
  for (const hook of state.hooks) {
    hook.update();
    hook.draw(ctx, cameraX, cameraY);
  }
  
  // Players
  for (const player of state.players.values()) {
    player.update();
    player.draw(ctx, cameraX, cameraY);
  }
  
  drawMinimap();
  updateUI();
  updateCooldowns();
}

// ============================================
// ИГРОВОЙ ЦИКЛ
// ============================================
function gameLoop() {
  if (gameRunning) {
    draw();
  }
  requestAnimationFrame(gameLoop);
}

requestAnimationFrame(gameLoop);
