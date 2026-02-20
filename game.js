// ============================================
// 🥩 PUDGE WARS - AAA EDITION
// Enhanced Graphics & Effects
// ============================================

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

const CONFIG = {
  FIELD_SIZE: 2000, RIVER_Y: 1000, RIVER_WIDTH: 200,
  PLAYER_RADIUS: 28, PLAYER_SPEED: 4.2,
  BASE_HEALTH: 800, BASE_MANA: 300,
  HOOK_RANGE: 1200, HOOK_SPEED: 32, HOOK_RADIUS: 18,
  HOOK_COOLDOWN: 12000, HOOK_DAMAGE: 150, HOOK_MANA_COST: 120,
  PHASE_DURATION: 1500, PHASE_COOLDOWN: 18000, PHASE_MANA_COST: 80,
  EARTHBIND_RANGE: 900, EARTHBIND_RADIUS: 200,
  EARTHBIND_DURATION: 2000, EARTHBIND_COOLDOWN: 16000, EARTHBIND_MANA_COST: 100,
  BLINK_RANGE: 800, BLINK_COOLDOWN: 8000, BLINK_MANA_COST: 60,
  REARM_COOLDOWN: 60000, REARM_MANA_COST: 200
};

let ws = null, myId = null, gameRunning = false;
let cameraX = 0, cameraY = 0, cameraFollow = true;

const state = { players: new Map(), hooks: [], earthbinds: [], myTeam: null, radiantScore: 0, direScore: 0 };
const input = { mouseX: 0, mouseY: 0, moveTarget: null, keys: {} };
const cooldowns = { hook: 0, phase: 0, earthbind: 0, blink: 0, rearm: 0 };
const particles = [], floatingTexts = [];

// Классы
class Player {
  constructor(data) {
    this.id = data[0]; this.x = data[1]; this.y = data[2]; this.team = data[3];
    this.health = data[4]; this.maxHealth = data[5];
    this.mana = data[6]; this.maxMana = data[7];
    this.kills = data[8] || 0; this.deaths = data[9] || 0;
    this.angle = 0; this.isDead = false; this.isPhasing = false; this.isRooted = false;
    this.rootEndTime = 0; this.name = data[10] || `Pudge_${this.id}`;
  }
  update() {
    if (this.isRooted && Date.now() > this.rootEndTime) this.isRooted = false;
    if (this.id === myId && cameraFollow && !this.isDead) {
      cameraX = this.x - canvas.width / 2;
      cameraY = this.y - canvas.height / 2;
      cameraX = Math.max(0, Math.min(cameraX, CONFIG.FIELD_SIZE - canvas.width));
      cameraY = Math.max(0, Math.min(cameraY, CONFIG.FIELD_SIZE - canvas.height));
    }
  }
  draw(ctx, camX, camY) {
    const sx = this.x - camX, sy = this.y - camY;
    if (this.isPhasing) {
      const phaseGlow = ctx.createRadialGradient(sx, sy, 0, sx, sy, CONFIG.PLAYER_RADIUS * 3);
      phaseGlow.addColorStop(0, 'rgba(52, 152, 219, 0.7)');
      phaseGlow.addColorStop(1, 'rgba(52, 152, 219, 0)');
      ctx.fillStyle = phaseGlow; ctx.beginPath(); ctx.arc(sx, sy, CONFIG.PLAYER_RADIUS * 3, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 0.5;
    }
    // Тело
    ctx.beginPath(); ctx.arc(sx, sy, CONFIG.PLAYER_RADIUS, 0, Math.PI * 2);
    ctx.fillStyle = this.team === 'radiant' ? '#2ecc71' : '#e74c3c'; ctx.fill();
    ctx.lineWidth = 5; ctx.strokeStyle = this.id === myId ? '#f1c40f' : '#2c3e50'; ctx.stroke();
    ctx.globalAlpha = 1;
    // Направление
    ctx.beginPath(); ctx.moveTo(sx, sy);
    ctx.lineTo(sx + Math.cos(this.angle) * CONFIG.PLAYER_RADIUS * 1.8, sy + Math.sin(this.angle) * CONFIG.PLAYER_RADIUS * 1.8);
    ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 5; ctx.stroke();
    if (this.id === myId) {
      ctx.fillStyle = '#f1c40f'; ctx.font = 'bold 18px Arial'; ctx.textAlign = 'center';
      ctx.fillText('YOU', sx, sy - CONFIG.PLAYER_RADIUS - 25);
    }
    // HP бар
    const hpPercent = this.health / this.maxHealth;
    ctx.fillStyle = '#1a1a1a'; ctx.fillRect(sx - 40, sy + CONFIG.PLAYER_RADIUS + 12, 80, 10);
    ctx.fillStyle = hpPercent > 0.5 ? '#2ecc71' : hpPercent > 0.25 ? '#f39c12' : '#e74c3c';
    ctx.fillRect(sx - 40, sy + CONFIG.PLAYER_RADIUS + 12, 80 * hpPercent, 10);
    if (this.isRooted) { ctx.fillStyle = '#9b59b6'; ctx.font = 'bold 24px Arial'; ctx.fillText('🕸️', sx, sy - CONFIG.PLAYER_RADIUS - 15); }
  }
}

class Hook {
  constructor(x, y, targetX, targetY, ownerId) {
    this.x = x; this.y = y; this.targetX = targetX; this.targetY = targetY;
    this.ownerId = ownerId; this.traveled = 0; this.state = 'flying'; this.targetId = null; this.trail = [];
    const dx = targetX - x, dy = targetY - y, dist = Math.hypot(dx, dy);
    this.vx = (dx / dist) * CONFIG.HOOK_SPEED; this.vy = (dy / dist) * CONFIG.HOOK_SPEED;
  }
  update() {
    if (this.state === 'flying') {
      this.trail.push({ x: this.x, y: this.y, life: 12 });
      this.x += this.vx; this.y += this.vy; this.traveled += CONFIG.HOOK_SPEED;
      if (this.traveled >= CONFIG.HOOK_RANGE) this.state = 'returning';
    } else if (this.state === 'pulling') {
      const owner = state.players.get(this.ownerId);
      if (owner) {
        const dx = owner.x - this.x, dy = owner.y - this.y, dist = Math.hypot(dx, dy);
        if (dist < 25) this.state = 'done';
        else {
          this.x += (dx / dist) * 14; this.y += (dy / dist) * 14;
          if (this.targetId !== null) {
            const target = state.players.get(this.targetId);
            if (target) { target.x = this.x; target.y = this.y; }
          }
        }
      }
    }
    for (let i = this.trail.length - 1; i >= 0; i--) { this.trail[i].life--; if (this.trail[i].life <= 0) this.trail.splice(i, 1); }
  }
  draw(ctx, camX, camY) {
    const sx = this.x - camX, sy = this.y - camY;
    const owner = state.players.get(this.ownerId); if (!owner) return;
    const ox = owner.x - camX, oy = owner.y - camY;
    for (const point of this.trail) {
      const alpha = point.life / 12; ctx.globalAlpha = alpha; ctx.fillStyle = '#e74c3c';
      ctx.beginPath(); ctx.arc(point.x - camX, point.y - camY, CONFIG.HOOK_RADIUS, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.beginPath(); ctx.moveTo(ox, oy); ctx.lineTo(sx, sy);
    ctx.strokeStyle = '#888'; ctx.lineWidth = 6; ctx.setLineDash([10, 6]); ctx.stroke(); ctx.setLineDash([]);
    ctx.beginPath(); ctx.arc(sx, sy, CONFIG.HOOK_RADIUS, 0, Math.PI * 2);
    ctx.fillStyle = this.state === 'pulling' ? '#f39c12' : '#e74c3c'; ctx.fill();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 4; ctx.stroke();
  }
}

class Earthbind {
  constructor(x, y, radius) { this.x = x; this.y = y; this.radius = radius; this.life = 35; this.maxLife = 35; }
  update() { this.life--; }
  draw(ctx, camX, camY) {
    const sx = this.x - camX, sy = this.y - camY, alpha = this.life / this.maxLife;
    ctx.globalAlpha = alpha * 0.6; ctx.fillStyle = '#9b59b6';
    ctx.beginPath(); ctx.arc(sx, sy, this.radius, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = alpha; ctx.strokeStyle = '#8e44ad'; ctx.lineWidth = 3;
    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * Math.PI * 2;
      ctx.beginPath(); ctx.moveTo(sx, sy);
      ctx.lineTo(sx + Math.cos(angle) * this.radius, sy + Math.sin(angle) * this.radius); ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
}

class Particle {
  constructor(x, y, color, speed, life) {
    this.x = x; this.y = y; this.color = color;
    this.angle = Math.random() * Math.PI * 2;
    this.speed = speed * (0.5 + Math.random() * 0.5);
    this.vx = Math.cos(this.angle) * this.speed;
    this.vy = Math.sin(this.angle) * this.speed;
    this.life = life; this.maxLife = life;
    this.size = 4 + Math.random() * 4;
  }
  update() { this.x += this.vx; this.y += this.vy; this.vx *= 0.94; this.vy *= 0.94; this.life--; }
  draw(ctx, camX, camY) {
    const alpha = this.life / this.maxLife; ctx.globalAlpha = alpha;
    ctx.fillStyle = this.color; ctx.beginPath();
    ctx.arc(this.x - camX, this.y - camY, this.size, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
  }
}

// Эффекты
function createHookHitEffect(x, y) { for (let i = 0; i < 35; i++) { particles.push(new Particle(x, y, '#e74c3c', 10, 45)); particles.push(new Particle(x, y, '#f39c12', 8, 35)); } }
function createPhaseEffect(x, y) { for (let i = 0; i < 25; i++) particles.push(new Particle(x, y, '#3498db', 6, 35)); }
function createEarthbindEffect(x, y) { for (let i = 0; i < 30; i++) particles.push(new Particle(x, y, '#9b59b6', 5, 40)); }
function createBlinkEffect(x, y) { for (let i = 0; i < 50; i++) particles.push(new Particle(x, y, '#3498db', 12, 55)); }
function createDeathEffect(x, y) { for (let i = 0; i < 60; i++) { particles.push(new Particle(x, y, '#8e44ad', 12, 65)); particles.push(new Particle(x, y, '#e74c3c', 10, 55)); } }
function createRearmEffect(x, y) { for (let i = 0; i < 70; i++) { particles.push(new Particle(x, y, '#9b59b6', 14, 75)); particles.push(new Particle(x, y, '#f1c40f', 12, 65)); } }
function showFloatingText(x, y, text, color) { floatingTexts.push({ x, y, text, color, life: 65, vy: -2.5 }); }

// Инициализация
function resize() { canvas.width = window.innerWidth; canvas.height = window.innerHeight; }
window.addEventListener('resize', resize); resize();

// Управление
canvas.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  if (gameRunning && ws && ws.readyState === WebSocket.OPEN) {
    const rect = canvas.getBoundingClientRect();
    input.moveTarget = { x: e.clientX - rect.left + cameraX, y: e.clientY - rect.top + cameraY };
    
    // Отправка движения на сервер
    ws.send(JSON.stringify({ type: 'move', x: input.moveTarget.x, y: input.moveTarget.y }));
    
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
  input.keys[e.code] = true;
  if (e.code === 'Space') { cameraFollow = true; const p = state.players.get(myId); if (p) { cameraX = p.x - canvas.width / 2; cameraY = p.y - canvas.height / 2; } }
  if (e.code === 'KeyQ') useAbility('hook');
  if (e.code === 'KeyW') useAbility('phase');
  if (e.code === 'KeyE') useAbility('earthbind');
  if (e.code === 'KeyR') useAbility('blink');
  if (e.code === 'KeyT') useAbility('rearm');
});
document.addEventListener('keyup', (e) => { input.keys[e.code] = false; if (e.code === 'Space') cameraFollow = false; });
document.getElementById('startBtn').addEventListener('click', () => { document.getElementById('startScreen').classList.add('hidden'); gameRunning = true; connect(); });
['Q','W','E','R'].forEach((key, i) => {
  document.getElementById(`ability${key}`).addEventListener('click', () => { if (gameRunning) useAbility(['hook','phase','earthbind','blink'][i]); });
});
document.getElementById('rearm').addEventListener('click', () => { if (gameRunning) useAbility('rearm'); });

// Способность
function useAbility(ability) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  const player = state.players.get(myId);
  if (!player || player.isDead || player.isPhasing) return;
  const now = Date.now();
  switch(ability) {
    case 'hook':
      if (now < cooldowns.hook || player.mana < CONFIG.HOOK_MANA_COST) return;
      const angle = Math.atan2(input.mouseY - canvas.height/2, input.mouseX - canvas.width/2);
      ws.send(JSON.stringify({ type: 'hook', angle, targetX: player.x + Math.cos(angle) * CONFIG.HOOK_RANGE, targetY: player.y + Math.sin(angle) * CONFIG.HOOK_RANGE }));
      break;
    case 'phase':
      if (now < cooldowns.phase || player.mana < CONFIG.PHASE_MANA_COST) return;
      ws.send(JSON.stringify({ type: 'phase' }));
      break;
    case 'earthbind':
      if (now < cooldowns.earthbind || player.mana < CONFIG.EARTHBIND_MANA_COST) return;
      const bindAngle = Math.atan2(input.mouseY - canvas.height/2, input.mouseX - canvas.width/2);
      ws.send(JSON.stringify({ type: 'earthbind', x: player.x + Math.cos(bindAngle) * CONFIG.EARTHBIND_RANGE, y: player.y + Math.sin(bindAngle) * CONFIG.EARTHBIND_RANGE }));
      break;
    case 'blink':
      if (now < cooldowns.blink || player.mana < CONFIG.BLINK_MANA_COST) return;
      const blinkAngle = Math.atan2(input.mouseY - canvas.height/2, input.mouseX - canvas.width/2);
      ws.send(JSON.stringify({ type: 'blink', x: player.x + Math.cos(blinkAngle) * CONFIG.BLINK_RANGE, y: player.y + Math.sin(blinkAngle) * CONFIG.BLINK_RANGE }));
      break;
    case 'rearm':
      if (now < cooldowns.rearm || player.mana < CONFIG.REARM_MANA_COST) return;
      ws.send(JSON.stringify({ type: 'rearm' }));
      break;
  }
}

// Сеть
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
  switch(data.type) {
    case 'welcome':
      myId = data.playerId; state.myTeam = data.team;
      for (const p of data.players) state.players.set(p[0], new Player(p));
      break;
    case 'state':
      const newPlayers = new Map();
      for (const p of data.players) {
        const existing = state.players.get(p[0]);
        if (existing) {
          existing.x = p[1]; existing.y = p[2]; existing.team = p[3];
          existing.health = p[4]; existing.maxHealth = p[5];
          existing.mana = p[6]; existing.maxMana = p[7];
          existing.kills = p[8]; existing.deaths = p[9];
          newPlayers.set(p[0], existing);
        } else newPlayers.set(p[0], new Player(p));
      }
      state.players = newPlayers;
      if (data.hooks) state.hooks = data.hooks.map(h => new Hook(h[1], h[2], h[3], h[4], h[5]));
      if (data.earthbinds) state.earthbinds = data.earthbinds.map(e => new Earthbind(e[1], e[2], e[3]));
      if (data.scores) { state.radiantScore = data.scores[0]; state.direScore = data.scores[1]; document.getElementById('radiantScore').textContent = state.radiantScore; document.getElementById('direScore').textContent = state.direScore; }
      break;
    case 'event': handleEvent(data.event); break;
  }
}

function handleEvent(evt) {
  if (evt.type === 'hookFire') startCooldown('hook');
  if (evt.type === 'hookHit') { const t = state.players.get(evt.targetId); if (t) { createHookHitEffect(t.x, t.y); showFloatingText(t.x, t.y, `-${CONFIG.HOOK_DAMAGE}`, '#e74c3c'); if (t.id === myId) showNotification('HOOKED!', 'notify-hook'); } }
  if (evt.type === 'phaseStart') { const p = state.players.get(evt.playerId); if (p) { p.isPhasing = true; createPhaseEffect(p.x, p.y); if (evt.playerId === myId) startCooldown('phase'); } }
  if (evt.type === 'phaseEnd') { const p = state.players.get(evt.playerId); if (p) p.isPhasing = false; }
  if (evt.type === 'earthbindCast') { state.earthbinds.push(new Earthbind(evt.x, evt.y, CONFIG.EARTHBIND_RADIUS)); createEarthbindEffect(evt.x, evt.y); if (evt.playerId === myId) startCooldown('earthbind'); }
  if (evt.type === 'earthbindHit') { const t = state.players.get(evt.targetId); if (t) { t.isRooted = true; t.rootEndTime = Date.now() + CONFIG.EARTHBIND_DURATION; showFloatingText(t.x, t.y, 'ROOTED!', '#9b59b6'); } }
  if (evt.type === 'blinkCast') { const p = state.players.get(evt.playerId); if (p) { p.x = evt.x; p.y = evt.y; createBlinkEffect(evt.x, evt.y); if (evt.playerId === myId) { startCooldown('blink'); showNotification('BLINK!', 'notify-blink'); } } }
  if (evt.type === 'rearmCast') { const p = state.players.get(evt.playerId); if (p) { createRearmEffect(p.x, p.y); if (evt.playerId === myId) { cooldowns.hook = 0; cooldowns.phase = 0; cooldowns.earthbind = 0; cooldowns.blink = 0; startCooldown('rearm'); showNotification('REARM!', 'notify-rearm'); } } }
  if (evt.type === 'playerKill') { const v = state.players.get(evt.victimId); if (v) { createDeathEffect(v.x, v.y); if (evt.killerId === myId) { showNotification('KILL! +150💰', 'notify-kill'); showFloatingText(v.x, v.y, '+150', '#f39c12'); } } }
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
    { el: document.getElementById('abilityQ'), cd: document.getElementById('qCd'), key: 'hook' },
    { el: document.getElementById('abilityW'), cd: document.getElementById('wCd'), key: 'phase' },
    { el: document.getElementById('abilityE'), cd: document.getElementById('eCd'), key: 'earthbind' },
    { el: document.getElementById('abilityR'), cd: document.getElementById('rCd'), key: 'blink' },
    { el: document.getElementById('rearm'), cd: document.getElementById('tCd'), key: 'rearm' }
  ];
  for (const ab of abilities) {
    if (cooldowns[ab.key] > now) { ab.el.classList.add('on-cooldown'); ab.cd.textContent = ((cooldowns[ab.key] - now) / 1000).toFixed(1); }
    else { ab.el.classList.remove('on-cooldown'); ab.cd.textContent = ''; }
  }
}

function updateUI() {
  const player = state.players.get(myId); if (!player) return;
  const hpPercent = (player.health / player.maxHealth) * 100;
  const manaPercent = (player.mana / player.maxMana) * 100;
  document.getElementById('healthBar').style.width = hpPercent + '%';
  document.getElementById('manaBar').style.width = manaPercent + '%';
  document.getElementById('healthText').textContent = `${Math.round(player.health)}/${Math.round(player.maxHealth)}`;
  document.getElementById('manaText').textContent = `${Math.round(player.mana)}/${Math.round(player.maxMana)}`;
}

function showNotification(text, type) {
  const el = document.createElement('div'); el.className = 'notify-' + type; el.textContent = text;
  document.body.appendChild(el); setTimeout(() => el.remove(), 800);
}

// Рендеринг
function drawMap(camX, camY) {
  ctx.fillStyle = '#1a1a2e'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = 'rgba(255,255,255,0.04)'; ctx.lineWidth = 1;
  const gridSize = 100, offsetX = -camX % gridSize, offsetY = -camY % gridSize;
  for (let x = offsetX; x < canvas.width; x += gridSize) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke(); }
  for (let y = offsetY; y < canvas.height; y += gridSize) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke(); }
  const riverY = CONFIG.RIVER_Y - camY;
  const riverGrad = ctx.createLinearGradient(0, riverY - CONFIG.RIVER_WIDTH/2, 0, riverY + CONFIG.RIVER_WIDTH/2);
  riverGrad.addColorStop(0, 'rgba(52,152,219,0.5)'); riverGrad.addColorStop(0.5, 'rgba(52,152,219,0.7)'); riverGrad.addColorStop(1, 'rgba(52,152,219,0.5)');
  ctx.fillStyle = riverGrad; ctx.fillRect(0, riverY - CONFIG.RIVER_WIDTH/2, canvas.width, CONFIG.RIVER_WIDTH);
  ctx.strokeStyle = '#e74c3c'; ctx.lineWidth = 5; ctx.strokeRect(-camX, -camY, CONFIG.FIELD_SIZE, CONFIG.FIELD_SIZE);
}

function drawMinimap() {
  const mm = document.getElementById('minimap'), mmCtx = mm.getContext('2d'), SCALE = 220 / CONFIG.FIELD_SIZE;
  mmCtx.fillStyle = 'rgba(10,10,20,0.95)'; mmCtx.fillRect(0, 0, 220, 220);
  mmCtx.fillStyle = 'rgba(52,152,219,0.7)'; mmCtx.fillRect(0, (CONFIG.RIVER_Y - CONFIG.RIVER_WIDTH/2) * SCALE, 220, CONFIG.RIVER_WIDTH * SCALE);
  for (const p of state.players.values()) { mmCtx.fillStyle = p.team === 'radiant' ? '#2ecc71' : '#e74c3c'; const size = p.id === myId ? 10 : 6; mmCtx.beginPath(); mmCtx.arc(p.x * SCALE, p.y * SCALE, size, 0, Math.PI * 2); mmCtx.fill(); }
  const player = state.players.get(myId);
  if (player) { mmCtx.strokeStyle = '#fff'; mmCtx.lineWidth = 2; mmCtx.strokeRect((player.x - canvas.width/2) * SCALE, (player.y - canvas.height/2) * SCALE, canvas.width * SCALE, canvas.height * SCALE); }
}

function updateAndDrawParticles(camX, camY) {
  for (let i = particles.length - 1; i >= 0; i--) { const p = particles[i]; p.update(); p.draw(ctx, camX, camY); if (p.life <= 0) particles.splice(i, 1); }
  for (let i = floatingTexts.length - 1; i >= 0; i--) { const ft = floatingTexts[i]; ft.y += ft.vy; ft.life--; ctx.globalAlpha = ft.life / 65; ctx.fillStyle = ft.color; ctx.font = 'bold 28px Arial'; ctx.textAlign = 'center'; ctx.fillText(ft.text, ft.x - camX, ft.y - camY); ctx.globalAlpha = 1; if (ft.life <= 0) floatingTexts.splice(i, 1); }
}

function draw() {
  drawMap(cameraX, cameraY);
  updateAndDrawParticles(cameraX, cameraY);
  for (let i = state.earthbinds.length - 1; i >= 0; i--) { const eb = state.earthbinds[i]; eb.update(); eb.draw(ctx, cameraX, cameraY); if (eb.life <= 0) state.earthbinds.splice(i, 1); }
  for (const hook of state.hooks) { hook.update(); hook.draw(ctx, cameraX, cameraY); }
  for (const player of state.players.values()) { player.update(); player.draw(ctx, cameraX, cameraY); }
  drawMinimap(); updateUI(); updateCooldowns();
}

function gameLoop() { if (gameRunning) draw(); requestAnimationFrame(gameLoop); }
requestAnimationFrame(gameLoop);
