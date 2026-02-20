/**
 * PUDGE WARS - Warcraft 3 Original Mechanics
 * Классическая версия из Warcraft 3
 */

const WebSocket = require('ws');
const http = require('http');
const path = require('path');
const fs = require('fs');

// ============================================
// CONFIGURATION
// ============================================
const PORT = process.env.PORT || 8080;
const TICK_RATE = 64;
const FIELD_SIZE = 2000;
const MATCH_DURATION = 420000;

const GAME = {
  PLAYER_RADIUS: 24,
  PLAYER_SPEED: 3.6,
  BASE_HEALTH: 700,
  BASE_MANA: 291,
  BASE_DAMAGE: 52,
  BASE_ARMOR: 1,
  BASE_STR: 25,
  BASE_AGI: 14,
  BASE_INT: 16,
  STR_PER_LEVEL: 3.2,
  AGI_PER_LEVEL: 1.4,
  INT_PER_LEVEL: 1.8,

  // Q - Meat Hook
  HOOK_RANGE: [1000, 1100, 1200, 1300],
  HOOK_SPEED: 25,
  HOOK_RADIUS: 12,
  HOOK_COOLDOWN: [14000, 13000, 12000, 11000],
  HOOK_DAMAGE: [90, 180, 270, 360],
  HOOK_MANA_COST: [110, 120, 130, 140],

  // E - Rot
  ROT_DAMAGE: [30, 40, 50, 60],
  ROT_RADIUS: 250,
  ROT_COOLDOWN: [1500, 1500, 1500, 1500],
  ROT_SLOW: [0.20, 0.25, 0.30, 0.35],
  // FIXED: В оригинале Rot наносит урон по себе
  ROT_SELF_DAMAGE: true,
  ROT_TICK_RATE: 100,

  // Passive - Flesh Heap
  FLESH_HEAP_STR_PER_STACK: [0.8, 1.0, 1.2, 1.4],
  FLESH_HEAP_RANGE: 450,
  FLESH_HEAP_MAGIC_RESIST: [0.08, 0.12, 0.16, 0.20],

  // R - Dismember
  DISMEMBER_DAMAGE: [75, 100, 125],
  DISMEMBER_DURATION: 3000,
  DISMEMBER_COOLDOWN: [30000, 25000, 20000],
  DISMEMBER_MANA_COST: [175, 250, 325],
  DISMEMBER_RANGE: 200,
  DISMEMBER_HEAL_FACTOR: 0.75,
  DISMEMBER_STR_FACTOR: 0.75,

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

function distanceSquared(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

function pointInCircle(px, py, cx, cy, radius) {
  return distanceSquared({x: px, y: py}, {x: cx, y: cy}) < (radius * radius);
}

function circleCollision(c1, r1, c2, r2) {
  const dist = distance(c1, c2);
  return dist < (r1 + r2);
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
  // FIXED: Сохраняем процент здоровья до пересчета
  const healthPercent = player.health / player.maxHealth;
  
  const levelBonus = (player.level - 1);
  const strBonus = player.str * 20;
  const agiBonus = player.agi * 0.15;
  const intBonus = player.int * 12;

  const oldMaxHealth = player.maxHealth;
  player.maxHealth = GAME.BASE_HEALTH + (levelBonus * 20) + strBonus;
  player.maxMana = GAME.BASE_MANA + (levelBonus * 15) + intBonus;
  player.armor = GAME.BASE_ARMOR + agiBonus;
  player.damage = GAME.BASE_DAMAGE + (player.str * 0.5);

  // Flesh Heap бонусы
  const fleshStrBonus = player.fleshHeapStacks * player.fleshHeapStrPerStack * 20;
  player.maxHealth += fleshStrBonus;
  player.magicResist = player.fleshHeapMagicResist;
  
  // FIXED: Восстанавливаем процент здоровья после пересчета
  if (oldMaxHealth > 0 && !player.isDead) {
    player.health = player.maxHealth * healthPercent;
  }
}

// ============================================
// SERIALIZATION
// ============================================
function playerToData(p) {
  return [
    p.id, Math.round(p.x * 100) / 100, Math.round(p.y * 100) / 100, p.team,
    Math.round(p.health), p.maxHealth, Math.round(p.mana), p.maxMana,
    p.level, Math.round(p.str), Math.round(p.agi), Math.round(p.int),
    Math.round(p.damage), Math.round(p.armor * 100) / 100,
    p.kills, p.deaths, p.fleshHeapStacks, p.rotActive, p.gold || 0,
    p.hookLevel || 1, p.rotLevel || 1, p.dismemberLevel || 0,
    p.hasAghanim ? 1 : 0, p.magicResist || 0,
    p.name || `Pudge_${p.id}`,
    p.abilityPoints || 0
  ];
}

function hookToData(h) {
  return [h.id, h.x, h.y, h.targetX, h.targetY, h.ownerId, h.state];
}

// ============================================
// PLAYER CREATION
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
    
    // Кулдауны
    hookCooldown: 0, rotCooldown: 0, dismemberCooldown: 0,
    
    // Rot состояние
    rotActive: false, rotEndTime: 0,
    
    // Hook параметры
    hookRange: GAME.HOOK_RANGE[0],
    hookSpeed: GAME.HOOK_SPEED,
    hookDamage: GAME.HOOK_DAMAGE[0],
    hookCooldownTime: GAME.HOOK_COOLDOWN[0],
    hookManaCost: GAME.HOOK_MANA_COST[0],
    hookLevel: 1,
    
    // Flesh Heap
    fleshHeapStacks: 0,
    fleshHeapStrPerStack: GAME.FLESH_HEAP_STR_PER_STACK[0],
    fleshHeapMagicResist: GAME.FLESH_HEAP_MAGIC_RESIST[0],
    fleshHeapLevel: 1,
    
    // Dismember
    dismemberDamage: GAME.DISMEMBER_DAMAGE[0],
    dismemberCooldownTime: GAME.DISMEMBER_COOLDOWN[0],
    dismemberManaCost: GAME.DISMEMBER_MANA_COST[0],
    dismemberLevel: 0,
    
    // Статы
    isDead: false,
    respawnTime: 0,
    kills: 0,
    deaths: 0,
    str: GAME.BASE_STR,
    agi: GAME.BASE_AGI,
    int: GAME.BASE_INT,
    damage: GAME.BASE_DAMAGE,
    armor: GAME.BASE_ARMOR,
    level: 1,
    gold: 600,
    xp: 0,
    abilityPoints: 0,
    abilityLevels: { hook: 1, rot: 1, dismember: 0, fleshHeap: 1 },
    hasAghanim: false,
    items: [],
    name: null,
    magicResist: 0
  };
}

// ============================================
// УБИЙСТВО И РЕСПАВН
// ============================================
function killPlayer(victim, killer) {
  victim.isDead = true;
  victim.respawnTime = Date.now() + GAME.RESPAWN_TIME;
  victim.deaths++;
  // FIXED: Выключаем Rot при смерти
  victim.rotActive = false;
  victim.rotEndTime = 0;

  if (killer) {
    killer.kills++;
    killer.gold += GAME.GOLD_PER_KILL;
    killer.xp += 500;

    // Проверка уровня
    checkLevelUp(killer);

    // Flesh Heap стек
    const dist = distance(victim, killer);
    if (dist < GAME.FLESH_HEAP_RANGE) {
      addFleshHeapStack(killer);
    }
  }

  console.log(`[KILL] ${killer?.id || 'unknown'} -> ${victim.id}`);
  broadcastEvent({ type: 'playerKill', victimId: victim.id, killerId: killer?.id });
}

function addFleshHeapStack(player) {
  player.fleshHeapStacks++;
  player.str += player.fleshHeapStrPerStack;
  calculatePlayerStats(player);
  
  console.log(`[FLESH HEAP] Player ${player.id} now has ${player.fleshHeapStacks} stacks, STR: ${player.str}`);
}

function checkLevelUp(player) {
  const xpNeeded = player.level * 200;
  if (player.xp >= xpNeeded) {
    player.level++;
    player.xp -= xpNeeded;
    player.abilityPoints++;
    
    // Бонус статы за уровень
    player.str += GAME.STR_PER_LEVEL;
    player.agi += GAME.AGI_PER_LEVEL;
    player.int += GAME.INT_PER_LEVEL;
    
    calculatePlayerStats(player);
    
    console.log(`[LEVEL UP] Player ${player.id} reached level ${player.level}`);
    broadcastEvent({ 
      type: 'levelUp', 
      playerId: player.id, 
      level: player.level,
      str: player.str,
      agi: player.agi,
      int: player.int
    });
  }
}

function respawnPlayer(player) {
  const pos = getSpawnPosition(player.team);
  player.x = pos.x;
  player.y = pos.y;
  player.health = player.maxHealth;
  player.mana = player.maxMana;
  player.isDead = false;
  player.rotActive = false;
  console.log(`[RESPAWN] Player ${player.id}`);
}

// ============================================
// ОБРАБОТКА ВХОДА
// ============================================
function handlePlayerMessage(player, msg) {
  if (player.isDead) return;

  switch (msg.type) {
    case 'move': handleMove(player, msg); break;
    case 'hook': handleHook(player, msg); break;
    case 'rot': handleRot(player, msg); break;
    case 'dismember': handleDismember(player, msg); break;
    case 'upgrade': handleUpgrade(player, msg); break;
    case 'buyItem': handleBuyItem(player, msg); break;  // FIXED: Добавлена покупка предметов
  }
}

// ============================================
// МАГАЗИН - ПОКУПКА ПРЕДМЕТОВ
// ============================================
function handleBuyItem(player, msg) {
  const itemId = msg.itemId;
  if (!itemId) return;
  
  // Простая проверка - списываем золото
  const itemCost = getItemCost(itemId);
  if (player.gold >= itemCost) {
    player.gold -= itemCost;
    player.items = player.items || [];
    player.items.push(itemId);
    
    console.log(`[SHOP] Player ${player.id} bought ${itemId} for ${itemCost} gold`);
    broadcastEvent({ type: 'itemPurchased', playerId: player.id, itemId });
  }
}

function getItemCost(itemId) {
  // Базовые цены предметов
  const prices = {
    'orchid': 4700, 'shiva': 4700, 'heart': 5200,
    'basher': 2875, 'abyssal': 6250, 'rapier': 6000,
    'bloodstone': 4700, 'tango': 90, 'salve': 110, 'tp': 100
  };
  return prices[itemId] || 0;
}

function handleMove(player, msg) {
  if (player.isDead) return;
  
  const dx = clamp(msg.dx || 0, -1, 1);
  const dy = clamp(msg.dy || 0, -1, 1);
  const len = Math.hypot(dx, dy);

  if (len > 0) {
    const moveX = (dx / len) * player.speed;
    const moveY = (dy / len) * player.speed;
    let newX = clamp(player.x + moveX, GAME.PLAYER_RADIUS, FIELD_SIZE - GAME.PLAYER_RADIUS);
    let newY = clamp(player.y + moveY, GAME.PLAYER_RADIUS, FIELD_SIZE - GAME.PLAYER_RADIUS);

    // Проверка на реку - блокируем только вход в реку
    const inRiver = isInRiver(newY, GAME.PLAYER_RADIUS);
    const wasInRiver = isInRiver(player.y, GAME.PLAYER_RADIUS);
    
    if (inRiver && !wasInRiver) {
      // Игрок пытается зайти в реку - блокируем движение по Y, но разрешаем по X
      player.x = newX;
    } else {
      // Игрок не в реке или уже в реке - разрешаем движение
      player.x = newX;
      player.y = newY;
    }
  }
}

// ============================================
// Q - MEAT HOOK
// ============================================
function handleHook(player, msg) {
  const now = Date.now();
  const abilityLevel = msg.abilityLevel || player.abilityLevels.hook;
  const cooldownIndex = Math.min(abilityLevel - 1, GAME.HOOK_COOLDOWN.length - 1);
  
  if (now < player.hookCooldown || player.mana < GAME.HOOK_MANA_COST[cooldownIndex]) return;

  const angle = msg.angle || 0;
  
  // Базовая дальность
  let hookRange = GAME.HOOK_RANGE[cooldownIndex];
  
  // Aghanim's Scepter бонус
  if (player.hasAghanim) {
    hookRange *= GAME.AGHANIM_HOOK_RANGE;
  }
  
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
    abilityLevel,
    isAghanim: player.hasAghanim,
    // FIXED: Флаг для предотвращения повторного урона
    damageDealt: false
  });

  player.hookCooldown = now + GAME.HOOK_COOLDOWN[cooldownIndex];
  player.mana -= GAME.HOOK_MANA_COST[cooldownIndex];
  
  console.log(`[HOOK] Player ${player.id} fired (lvl ${abilityLevel}, dmg ${GAME.HOOK_DAMAGE[cooldownIndex]})`);
  broadcastEvent({ type: 'hookFire', playerId: player.id, angle });
}

// ============================================
// E - ROT
// ============================================
function handleRot(player, msg) {
  const now = Date.now();
  
  // Rot можно включать/выключать без кулдауна
  player.rotActive = !player.rotActive;
  player.rotEndTime = player.rotActive ? now + 5000 : 0;
  
  const abilityLevel = player.abilityLevels.rot;
  player.rotDamage = GAME.ROT_DAMAGE[Math.min(abilityLevel - 1, GAME.ROT_DAMAGE.length - 1)];
  player.rotSlow = GAME.ROT_SLOW[Math.min(abilityLevel - 1, GAME.ROT_SLOW.length - 1)];
  
  console.log(`[ROT] Player ${player.id} ${player.rotActive ? 'ON' : 'OFF'}`);
  broadcastEvent({ type: 'rotToggle', playerId: player.id, active: player.rotActive });
}

// ============================================
// R - DISMEMBER
// ============================================
function handleDismember(player, msg) {
  const now = Date.now();
  const abilityLevel = msg.abilityLevel || player.abilityLevels.dismember;
  const cooldownIndex = Math.min(abilityLevel - 1, GAME.DISMEMBER_COOLDOWN.length - 1);
  
  if (now < player.dismemberCooldown) return;
  if (player.mana < GAME.DISMEMBER_MANA_COST[cooldownIndex]) return;
  if (abilityLevel < 1) return; // Ульта недоступна

  const angle = msg.angle || 0;
  const range = GAME.DISMEMBER_RANGE;
  const targetX = player.x + Math.cos(angle) * range;
  const targetY = player.y + Math.sin(angle) * range;

  // Поиск цели
  for (const other of players.values()) {
    if (other.team === player.team || other.isDead) continue;
    
    if (pointInCircle(targetX, targetY, other.x, other.y, GAME.PLAYER_RADIUS + 30)) {
      // Начало канала
      dismembers.push({
        id: `dismember_${player.id}_${now}`,
        caster: player,
        target: other,
        startTime: now,
        endTime: now + GAME.DISMEMBER_DURATION,
        damagePerSec: GAME.DISMEMBER_DAMAGE[cooldownIndex],
        tickDamage: GAME.DISMEMBER_DAMAGE[cooldownIndex] / 10,
        healFactor: GAME.DISMEMBER_HEAL_FACTOR,
        strDamage: GAME.DISMEMBER_STR_FACTOR
      });
      
      other.dismembered = true;
      other.dismemberer = player;
      other.dismemberEndTime = now + GAME.DISMEMBER_DURATION;
      
      player.dismemberCooldown = now + GAME.DISMEMBER_COOLDOWN[cooldownIndex];
      player.mana -= GAME.DISMEMBER_MANA_COST[cooldownIndex];
      
      console.log(`[DISMEMBER] Player ${player.id} -> Player ${other.id}`);
      broadcastEvent({ type: 'dismemberStart', casterId: player.id, targetId: other.id });
      return;
    }
  }
}

// ============================================
// ФИЗИКА ХУКА
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
          if (target) { target.x = hook.x; target.y = hook.y; }
        }
      }
    } else {
      hook.state = 'done';
    }
  }
}

function checkHookPlayerCollision(hook) {
  // FIXED: Наносим урон только один раз при первом попадании
  if (hook.damageDealt) return;
  
  for (const [id, player] of players) {
    if (id === hook.ownerId || player.isDead) continue;

    if (pointInCircle(hook.x, hook.y, player.x, player.y, GAME.PLAYER_RADIUS + GAME.HOOK_RADIUS)) {
      if (player.team === hook.owner.team) {
        // Спасение союзника - урон не наносим
        hook.state = 'pulling';
        hook.targetId = player.id;
        broadcastEvent({ type: 'allySaved', playerId: hook.ownerId, allyId: player.id });
      } else {
        // Попадание во врага - наносим урон ОДИН раз
        player.health -= hook.damage;
        hook.state = 'pulling';
        hook.targetId = player.id;
        // FIXED: Помечаем что урон уже нанесён
        hook.damageDealt = true;

        console.log(`[HOOK HIT] Player ${hook.ownerId} -> Player ${player.id} for ${hook.damage} PURE damage`);
        broadcastEvent({ type: 'hookHit', targetId: player.id, hitterId: hook.ownerId, damage: hook.damage });

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

      const dist = distance(h1, h2);
      if (dist < GAME.HOOK_RADIUS * 2) {
        const dx = h2.x - h1.x;
        const dy = h2.y - h1.y;
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
// ROT И DISMEMBER
// ============================================
function updateRot() {
  const now = Date.now();

  for (const player of players.values()) {
    // FIXED: Мертвые не должны получать урон от Rot
    if (!player.rotActive || player.isDead) continue;

    // Rot урон по себе
    if (GAME.ROT_SELF_DAMAGE) {
      const magicDmg = player.rotDamage / 10; // Тик каждые 100мс
      player.health -= magicDmg;
      
      // FIXED: Проверка на смерть от Rot
      if (player.health <= 0 && !player.isDead) {
        killPlayer(player, player); // Самоубийство от Rot
      }
    }

    // Проверка времени
    if (now >= player.rotEndTime) {
      player.rotActive = false;
      continue;
    }

    // Rot урон по врагам + замедление
    for (const other of players.values()) {
      if (other.team === player.team || other.isDead) continue;

      const dist = distance(player, other);
      if (dist < GAME.ROT_RADIUS + GAME.PLAYER_RADIUS) {
        // Магический урон (игнорирует часть брони)
        const magicDmg = player.rotDamage / 10; // Тик каждые 100мс
        other.health -= magicDmg;

        // Замедление
        other.speed = GAME.PLAYER_SPEED * (1 - player.rotSlow);
        other.rotSlowEndTime = now + 500;

        if (other.health <= 0 && !other.isDead) {
          killPlayer(other, player);
        }
      }
    }

    // Восстановление скорости после замедления
    if (player.rotSlowEndTime && now > player.rotSlowEndTime) {
      player.speed = GAME.PLAYER_SPEED;
      player.rotSlowEndTime = null;
    }
  }
}

function updateDismember() {
  const now = Date.now();

  for (let i = dismembers.length - 1; i >= 0; i--) {
    const dis = dismembers[i];
    
    // Проверка окончания
    if (now >= dis.endTime || dis.caster.isDead || dis.target.isDead) {
      if (dis.target) {
        dis.target.dismembered = false;
        dis.target.dismemberer = null;
      }
      dismembers.splice(i, 1);
      continue;
    }

    // Урон каждые 100мс
    const totalDamage = dis.tickDamage + (dis.caster.str * dis.strDamage / 10);
    dis.target.health -= totalDamage;
    
    // Лечение Pudge
    dis.caster.health = Math.min(
      dis.caster.maxHealth, 
      dis.caster.health + (totalDamage * dis.healFactor)
    );
    
    if (dis.target.health <= 0 && !dis.target.isDead) {
      killPlayer(dis.target, dis.caster);
    }
  }
}

// ============================================
// РЕГЕНЕРАЦИЯ
// ============================================
function updateRegen() {
  const now = Date.now();
  
  for (const player of players.values()) {
    if (player.isDead) continue;
    
    // Реген маны (1% от макс маны в секунду + от интеллекта)
    const manaRegen = (player.maxMana * 0.01 + player.int * 0.05) / TICK_RATE;
    player.mana = Math.min(player.maxMana, player.mana + manaRegen);
    
    // Реген здоровья (0.5% от макс здоровья в секунду + от силы)
    const healthRegen = (player.maxHealth * 0.005 + player.str * 0.03) / TICK_RATE;
    player.health = Math.min(player.maxHealth, player.health + healthRegen);
  }
}

// ============================================
// ПРОКАЧКА СПОСОБНОСТЕЙ
// ============================================
function handleUpgrade(player, msg) {
  const { ability } = msg;
  
  if (!ability || player.abilityPoints <= 0) return;
  
  const maxLevel = ability === 'dismember' ? 3 : 4;
  
  if (player.abilityLevels[ability] >= maxLevel) return;
  if (ability === 'dismember' && player.level < 6) return; // Ульта с 6 уровня
  
  player.abilityLevels[ability]++;
  player.abilityPoints--;
  
  // Пересчёт статов
  if (ability === 'fleshHeap') {
    player.fleshHeapStrPerStack = GAME.FLESH_HEAP_STR_PER_STACK[player.abilityLevels.fleshHeap - 1];
    player.fleshHeapMagicResist = GAME.FLESH_HEAP_MAGIC_RESIST[player.abilityLevels.fleshHeap - 1];
  }
  
  calculatePlayerStats(player);
  
  console.log(`[UPGRADE] Player ${player.id} upgraded ${ability} to level ${player.abilityLevels[ability]}`);
  broadcastEvent({ 
    type: 'abilityUpgrade', 
    playerId: player.id, 
    ability, 
    level: player.abilityLevels[ability] 
  });
}

// ============================================
// СИСТЕМА
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
    player.level = 1;
    player.abilityPoints = 0;
    player.abilityLevels = { hook: 1, rot: 1, dismember: 0, fleshHeap: 1 };
  }
  hooks.length = 0;
  dismembers.length = 0;
  broadcastEvent({ type: 'matchStart', matchDuration: MATCH_DURATION });
  console.log('[MATCH] New match started');
}

// ============================================
// СЕТЕВАЯ РАССЫЛКА
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
    stats: [...players.values()].map(p => [p.id, p.kills, p.deaths, p.gold || 0, p.level, p.xp, p.abilityPoints])
  };

  const data = JSON.stringify(state);
  for (const player of players.values()) {
    if (player.ws.readyState === WebSocket.OPEN) {
      player.ws.send(data);
    }
  }
}

// ============================================
// HTTP СЕРВЕР
// ============================================
const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  let pathname = url.pathname;

  // Health check
  if (pathname === '/health' || pathname === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ 
      status: 'ok', 
      players: players.size, 
      uptime: Math.floor((Date.now() - matchStartTime) / 1000),
      tickRate: TICK_RATE
    }));
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
// WEBSOCKET СЕРВЕР
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

  console.log(`[JOIN] Player ${player.id} joined ${player.team}`);

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
// ИГРОВОЙ ЦИКЛ
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
  updateRegen();
  checkRespawn();
  broadcastState();
}, 1000 / TICK_RATE);

// ============================================
// ЗАПУСК
// ============================================
server.listen(PORT, '0.0.0.0', () => {
  console.log('========================================');
  console.log('  🥩 PUDGE WARS - WARCRAFT 3 ORIGINAL');
  console.log('========================================');
  console.log(`  Port: ${PORT}`);
  console.log(`  Field: ${FIELD_SIZE}x${FIELD_SIZE}`);
  console.log(`  Tick Rate: ${TICK_RATE} TPS`);
  console.log(`  River at Y: ${GAME.RIVER_Y}`);
  console.log('========================================');
  console.log(`  Open: http://localhost:${PORT}`);
  console.log('========================================');
  console.log('  ABILITIES (Warcraft 3 Values):');
  console.log('  Q - Meat Hook (100/200/300/400 dmg)');
  console.log('  E - Rot (40/80/120/160 dmg/sec + slow)');
  console.log('  R - Dismember (80/120/160 + STR)');
  console.log('  Passive - Flesh Heap (+1/1.5/2/2.5 STR)');
  console.log('========================================');
});

server.on('error', (err) => console.error('[ERROR]', err));

process.on('SIGINT', () => {
  console.log('\n[SHUTDOWN] Closing...');
  clearInterval(gameLoop);
  for (const p of players.values()) p.ws.close();
  server.close(() => { wss.close(() => { console.log('[SHUTDOWN] Done'); process.exit(0); }); });
});