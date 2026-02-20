/**
 * PUDGE WARS - Dota 2 Original Mechanics
 * Оптимизированная версия сервера
 */

const WebSocket = require('ws');
const http = require('http');
const path = require('path');
const fs = require('fs');

// ============================================
// КОНФИГУРАЦИЯ
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
  STR_GAIN: 3.2,
  AGI_GAIN: 1.4,
  INT_GAIN: 1.8,

  HOOK_RANGE: [1000, 1100, 1200, 1300],
  HOOK_SPEED: 25,
  HOOK_RADIUS: 12,
  HOOK_COOLDOWN: [14, 13, 12, 11],
  HOOK_DAMAGE: [90, 180, 270, 360],
  HOOK_MANA_COST: [110, 120, 130, 140],
  HOOK_PULL_SPEED: 10,

  ROT_DAMAGE: [30, 40, 50, 60],
  ROT_RADIUS: 250,
  ROT_SLOW: [0.20, 0.25, 0.30, 0.35],
  // FIXED: Отключил самоповреждение от Rot - это было причиной утечки ХП
  ROT_SELF_DAMAGE: false,
  ROT_TICK_RATE: 100,

  FLESH_HEAP_STR_PER_STACK: [0.8, 1.0, 1.2, 1.4],
  FLESH_HEAP_RANGE: 450,
  FLESH_HEAP_MAGIC_RESIST: [0.08, 0.12, 0.16, 0.20],

  DISMEMBER_DAMAGE_PER_SEC: [75, 100, 125],
  DISMEMBER_DURATION: 3000,
  DISMEMBER_COOLDOWN: [30, 25, 20],
  DISMEMBER_MANA_COST: [175, 250, 325],
  DISMEMBER_RANGE: 200,
  DISMEMBER_HEAL_FACTOR: 0.75,
  DISMEMBER_STR_DAMAGE: 0.75,

  RESPAWN_TIME: 5000,
  GOLD_PER_KILL: 150,
  GOLD_PER_ASSIST: 50,
  GOLD_PER_CREEP: 15,
  RIVER_Y: 1000,
  RIVER_WIDTH: 180,

  AGHANIM_HOOK_DAMAGE: 1.5,
  AGHANIM_HOOK_RANGE: 1.3,
  AGHANIM_COST: 4200
};

// ============================================
// СОСТОЯНИЕ СЕРВЕРА
// ============================================
const players = new Map();
const hooks = [];
const dismembers = [];
let nextPlayerId = 1;
let matchStartTime = Date.now();

// ============================================
// ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
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
  return distance(c1, c2) < (r1 + r2);
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
  const levelBonus = (player.level - 1);
  const strBonus = player.str * 20;
  const agiBonus = player.agi * 0.15;
  const intBonus = player.int * 12;

  player.maxHealth = GAME.BASE_HEALTH + levelBonus * 20 + strBonus;
  player.maxMana = GAME.BASE_MANA + levelBonus * 15 + intBonus;
  player.armor = GAME.BASE_ARMOR + agiBonus;
  player.damage = GAME.BASE_DAMAGE + player.str * 0.5;

  const fleshBonus = player.fleshHeapStacks * player.fleshHeapStrPerStack * 20;
  player.maxHealth += fleshBonus;
  player.magicResist = player.fleshHeapMagicResist;
}

// ============================================
// СЕРИАЛИЗАЦИЯ ДЛЯ СЕТИ
// ============================================
function playerToData(p) {
  return [
    p.id,
    Math.round(p.x * 100) / 100,
    Math.round(p.y * 100) / 100,
    p.team,
    Math.round(p.health),
    p.maxHealth,
    Math.round(p.mana),
    p.maxMana,
    p.level,
    Math.round(p.str),
    Math.round(p.agi),
    Math.round(p.int),
    Math.round(p.damage),
    Math.round(p.armor * 100) / 100,
    p.kills,
    p.deaths,
    p.fleshHeapStacks,
    p.rotActive,
    p.gold || 0,
    p.abilityLevels.hook,
    p.abilityLevels.rot,
    p.abilityLevels.dismember,
    p.hasAghanim ? 1 : 0,
    p.magicResist || 0
  ];
}

function hookToData(h) {
  return [h.id, h.x, h.y, h.targetX, h.targetY, h.ownerId, h.state];
}

// ============================================
// СОЗДАНИЕ ИГРОКА
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

    hookCooldown: 0,
    rotCooldown: 0,
    dismemberCooldown: 0,

    rotActive: false,
    rotEndTime: 0,
    rotLevel: 1,

    hookRange: GAME.HOOK_RANGE[0],
    hookSpeed: GAME.HOOK_SPEED,
    hookDamage: GAME.HOOK_DAMAGE[0],
    hookCooldownTime: GAME.HOOK_COOLDOWN[0],
    hookManaCost: GAME.HOOK_MANA_COST[0],
    hookLevel: 1,

    fleshHeapStacks: 0,
    fleshHeapStrPerStack: GAME.FLESH_HEAP_STR_PER_STACK[0],
    fleshHeapMagicResist: GAME.FLESH_HEAP_MAGIC_RESIST[0],
    fleshHeapLevel: 1,

    dismemberDamage: GAME.DISMEMBER_DAMAGE_PER_SEC[0],
    dismemberCooldownTime: GAME.DISMEMBER_COOLDOWN[0],
    dismemberManaCost: GAME.DISMEMBER_MANA_COST[0],
    dismemberLevel: 1,

    isDead: false,
    respawnTime: 0,
    kills: 0,
    deaths: 0,
    str: GAME.BASE_STR,
    agi: GAME.BASE_AGI,
    int: GAME.BASE_INT,
    damage: GAME.BASE_DAMAGE,
    armor: GAME.BASE_ARMOR,
    magicResist: 0,
    level: 1,
    gold: 600,
    xp: 0,

    abilityLevels: { hook: 1, rot: 1, dismember: 0, fleshHeap: 1 },
    abilityPoints: 0,

    hasAghanim: false,
    items: []
  };
}

// ============================================
// БОЕВАЯ СИСТЕМА
// ============================================
function killPlayer(victim, killer) {
  victim.isDead = true;
  victim.respawnTime = Date.now() + GAME.RESPAWN_TIME;
  victim.deaths++;

  if (killer) {
    killer.kills++;
    killer.gold += GAME.GOLD_PER_KILL;
    killer.xp += 500;
    checkLevelUp(killer);

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
  console.log(`[FLESH HEAP] Player ${player.id}: ${player.fleshHeapStacks} stacks, STR: ${player.str}`);
}

function checkLevelUp(player) {
  const xpNeeded = player.level * 200;
  if (player.xp >= xpNeeded) {
    player.level++;
    player.xp -= xpNeeded;
    player.abilityPoints++;
    player.str += GAME.STR_GAIN;
    player.agi += GAME.AGI_GAIN;
    player.int += GAME.INT_GAIN;
    calculatePlayerStats(player);

    console.log(`[LEVEL UP] Player ${player.id} -> ${player.level}`);
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
// ОБРАБОТКА ВВОДА
// ============================================
function handlePlayerMessage(player, msg) {
  if (player.isDead) return;

  switch (msg.type) {
    case 'move': handleMove(player, msg); break;
    case 'hook': handleHook(player, msg); break;
    case 'rot': handleRot(player, msg); break;
    case 'dismember': handleDismember(player, msg); break;
    case 'upgrade': handleUpgrade(player, msg); break;
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

// ============================================
// Q - MEAT HOOK
// ============================================
function handleHook(player, msg) {
  const now = Date.now();
  const abilityLevel = msg.abilityLevel || player.abilityLevels.hook;
  const cooldownIndex = Math.min(abilityLevel - 1, GAME.HOOK_COOLDOWN.length - 1);

  if (now < player.hookCooldown || player.mana < GAME.HOOK_MANA_COST[cooldownIndex]) return;

  const angle = msg.angle || 0;
  let hookRange = GAME.HOOK_RANGE[cooldownIndex];

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
    isAghanim: player.hasAghanim
  });

  player.hookCooldown = now + GAME.HOOK_COOLDOWN[cooldownIndex] * 1000;
  player.mana -= GAME.HOOK_MANA_COST[cooldownIndex];

  console.log(`[HOOK] Player ${player.id} fired (lvl ${abilityLevel}, dmg ${GAME.HOOK_DAMAGE[cooldownIndex]})`);
  broadcastEvent({ type: 'hookFire', playerId: player.id, angle });
}

// ============================================
// E - ROT
// ============================================
function handleRot(player, msg) {
  const now = Date.now();
  player.rotActive = !player.rotActive;
  player.rotEndTime = player.rotActive ? now + 5000 : 0;

  const abilityLevel = player.abilityLevels.rot;
  player.rotDamage = GAME.ROT_DAMAGE[Math.min(abilityLevel - 1, GAME.ROT_DAMAGE.length - 1)];
  player.rotSlow = GAME.ROT_SLOW[Math.min(abilityLevel - 1, GAME.ROT_SLOW.length - 1)];

  console.log(`[ROT] Player ${player.id} ${player.rotActive ? 'ON' : 'OFF'}`);
  broadcastEvent({ type: 'rotToggle', playerId: player.id, active: player.rotActive });
}

function updateRot() {
  const now = Date.now();

  for (const player of players.values()) {
    // FIXED: Проверка на существование и активность - урон только если Rot включён
    if (!player || !player.rotActive) continue;

    // FIXED: Урон по себе ТОЛЬКО когда Rot активен
    if (GAME.ROT_SELF_DAMAGE && player.health !== undefined) {
      const magicDmg = player.rotDamage / 10;
      player.health -= magicDmg;

      if (player.health <= 0 && !player.isDead) {
        killPlayer(player, null);
      }
    }

    // FIXED: Проверка времени окончания Rot
    if (now >= player.rotEndTime) {
      player.rotActive = false;
      continue;
    }

    for (const other of players.values()) {
      if (!other || other.team === player.team || other.isDead) continue;

      const distSq = distanceSquared(player, other);
      const radiusSum = GAME.ROT_RADIUS + GAME.PLAYER_RADIUS;

      if (distSq < radiusSum * radiusSum) {
        const magicDmg = player.rotDamage / 10;
        other.health -= magicDmg;
        other.speed = GAME.PLAYER_SPEED * (1 - player.rotSlow);
        other.rotSlowEndTime = now + 500;

        if (other.health <= 0 && !other.isDead) {
          killPlayer(other, player);
        }
      }
    }

    if (player.rotSlowEndTime && now > player.rotSlowEndTime) {
      player.speed = GAME.PLAYER_SPEED;
      player.rotSlowEndTime = null;
    }
  }
}

// ============================================
// R - DISMEMBER
// ============================================
function handleDismember(player, msg) {
  const now = Date.now();
  const abilityLevel = msg.abilityLevel || player.abilityLevels.dismember;
  const cooldownIndex = Math.min(abilityLevel - 1, GAME.DISMEMBER_COOLDOWN.length - 1);

  if (now < player.dismemberCooldown ||
      player.mana < GAME.DISMEMBER_MANA_COST[cooldownIndex] ||
      abilityLevel < 1) return;

  const angle = msg.angle || 0;
  const range = GAME.DISMEMBER_RANGE;
  const targetX = player.x + Math.cos(angle) * range;
  const targetY = player.y + Math.sin(angle) * range;

  for (const other of players.values()) {
    if (other.team === player.team || other.isDead) continue;

    if (pointInCircle(targetX, targetY, other.x, other.y, GAME.PLAYER_RADIUS + 30)) {
      dismembers.push({
        id: `dismember_${player.id}_${now}`,
        caster: player,
        target: other,
        startTime: now,
        endTime: now + GAME.DISMEMBER_DURATION,
        damagePerSec: GAME.DISMEMBER_DAMAGE_PER_SEC[cooldownIndex],
        tickDamage: GAME.DISMEMBER_DAMAGE_PER_SEC[cooldownIndex] / 10,
        healFactor: GAME.DISMEMBER_HEAL_FACTOR,
        strDamage: GAME.DISMEMBER_STR_DAMAGE
      });

      other.dismembered = true;
      other.dismemberer = player;
      other.dismemberEndTime = now + GAME.DISMEMBER_DURATION;

      player.dismemberCooldown = now + GAME.DISMEMBER_COOLDOWN[cooldownIndex] * 1000;
      player.mana -= GAME.DISMEMBER_MANA_COST[cooldownIndex];

      console.log(`[DISMEMBER] Player ${player.id} -> Player ${other.id}`);
      broadcastEvent({ type: 'dismemberStart', casterId: player.id, targetId: other.id });
      return;
    }
  }
}

function updateDismember() {
  const now = Date.now();

  for (let i = dismembers.length - 1; i >= 0; i--) {
    const dis = dismembers[i];
    const casterExists = dis.caster && players.has(dis.caster.id) && !dis.caster.isDead;
    const targetExists = dis.target && players.has(dis.target.id) && !dis.target.isDead;

    if (now >= dis.endTime || !casterExists || !targetExists) {
      if (dis.target && players.has(dis.target.id)) {
        dis.target.dismembered = false;
        dis.target.dismemberer = null;
      }
      dismembers.splice(i, 1);
      continue;
    }

    const totalDamage = dis.tickDamage + (dis.caster.str || 0) * dis.strDamage / 10;

    if (typeof dis.target.health === 'number') {
      dis.target.health -= totalDamage;

      if (typeof dis.caster.health === 'number' && typeof dis.caster.maxHealth === 'number') {
        dis.caster.health = Math.min(
          dis.caster.maxHealth,
          dis.caster.health + totalDamage * dis.healFactor
        );
      }

      if (dis.target.health <= 0 && !dis.target.isDead) {
        killPlayer(dis.target, dis.caster);
      }
    }
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
  if (ability === 'dismember' && player.level < 6) return;

  player.abilityLevels[ability]++;
  player.abilityPoints--;

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

    const collided = checkLineCircleCollision(
      hook.prevX || hook.x, hook.prevY || hook.y,
      hook.x, hook.y,
      player.x, player.y,
      GAME.PLAYER_RADIUS + GAME.HOOK_RADIUS
    );

    if (collided) {
      if (player.team === hook.owner.team) {
        hook.state = 'pulling';
        hook.targetId = player.id;
        broadcastEvent({ type: 'allySaved', playerId: hook.ownerId, allyId: player.id });
      } else {
        player.health -= hook.damage;
        hook.state = 'pulling';
        hook.targetId = player.id;

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

function checkLineCircleCollision(x1, y1, x2, y2, cx, cy, radius) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const fx = x1 - cx;
  const fy = y1 - cy;

  const a = dx * dx + dy * dy;
  const b = 2 * (fx * dx + fy * dy);
  const c = fx * fx + fy * fy - radius * radius;

  let discriminant = b * b - 4 * a * c;

  if (discriminant < 0) return false;

  discriminant = Math.sqrt(discriminant);
  const t1 = (-b - discriminant) / (2 * a);
  const t2 = (-b + discriminant) / (2 * a);

  return (t1 >= 0 && t1 <= 1) || (t2 >= 0 && t2 <= 1);
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
// СИСТЕМНЫЕ ФУНКЦИИ
// ============================================
function checkRespawn() {
  const now = Date.now();
  for (const player of players.values()) {
    if (player.isDead && now >= player.respawnTime) {
      respawnPlayer(player);
    }
  }
}

function updatePlayerSpeed() {
  const now = Date.now();
  for (const player of players.values()) {
    if (player.rotSlowEndTime && now > player.rotSlowEndTime) {
      player.speed = GAME.PLAYER_SPEED;
      player.rotSlowEndTime = null;
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
  const playersArray = [...players.values()];

  const state = {
    type: 'state',
    matchTime,
    matchStartTime,
    players: playersArray.map(p => {
      const data = playerToData(p);
      return [...data, p.prevX || p.x, p.prevY || p.y];
    }),
    hooks: hooks.map(hookToData),
    stats: playersArray.map(p => [p.id, p.kills, p.deaths, p.gold || 0, p.level, p.xp, p.abilityPoints])
  };

  const data = JSON.stringify(state);
  for (const player of playersArray) {
    if (player.ws.readyState === WebSocket.OPEN) {
      player.ws.send(data);
    }
  }
}

function handlePlayerDisconnect(player) {
  if (!player) return;

  for (let i = hooks.length - 1; i >= 0; i--) {
    if (hooks[i].ownerId === player.id) {
      hooks.splice(i, 1);
    }
  }

  for (let i = dismembers.length - 1; i >= 0; i--) {
    const dis = dismembers[i];
    if (dis.caster?.id === player.id || dis.target?.id === player.id) {
      if (dis.target && dis.target.id !== player.id) {
        dis.target.dismembered = false;
        dis.target.dismemberer = null;
      }
      dismembers.splice(i, 1);
    }
  }

  players.delete(player.id);
  broadcastEvent({ type: 'playerLeave', playerId: player.id });
}

// ============================================
// ИГРОВОЙ ЦИКЛ
// ============================================
const gameLoop = setInterval(() => {
  try {
    const matchElapsed = Date.now() - matchStartTime;

    if (matchElapsed >= MATCH_DURATION) {
      endMatch();
      return;
    }

    updateHooks();
    updateRot();
    updateDismember();
    updatePlayerSpeed();
    checkRespawn();
    broadcastState();
  } catch (err) {
    console.error('[GAME LOOP ERROR]', err);
  }
}, 1000 / TICK_RATE);

// ============================================
// HTTP СЕРВЕР
// ============================================
const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = url.pathname;

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

  if (!player) {
    console.warn('[CONNECTION] Failed to create player');
    ws.close();
    return;
  }

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
      console.log(`[MSG] Player ${player.id}:`, msg.type, msg);
      
      if (!msg || typeof msg !== 'object') return;

      if (msg.type === 'setName' && msg.name) {
        player.name = msg.name.substring(0, 20);
      } else {
        handlePlayerMessage(player, msg);
      }
    } catch (e) {
      console.warn(`[PARSE ERROR] Player ${player.id}:`, e.message, data.toString().substring(0, 100));
    }
  });

  ws.on('close', () => {
    console.log(`[LEAVE] Player ${player.id} disconnected`);
    handlePlayerDisconnect(player);
  });

  ws.on('error', (err) => {
    console.warn(`[ERROR] Player ${player.id}:`, err.message);
    handlePlayerDisconnect(player);
  });
});

// ============================================
// ЗАПУСК
// ============================================
server.listen(PORT, '0.0.0.0', () => {
  console.log('========================================');
  console.log('  🥩 PUDGE WARS - DOTA 2 ORIGINAL');
  console.log('========================================');
  console.log(`  Port: ${PORT}`);
  console.log(`  Field: ${FIELD_SIZE}x${FIELD_SIZE}`);
  console.log(`  Tick Rate: ${TICK_RATE} TPS`);
  console.log(`  River at Y: ${GAME.RIVER_Y}`);
  console.log('========================================');
  console.log(`  Open: http://localhost:${PORT}`);
  console.log('========================================');
  console.log('  ABILITIES:');
  console.log('  Q - Meat Hook (90/180/270/360 pure)');
  console.log('  E - Rot (30/40/50/60 dmg/sec + slow)');
  console.log('  R - Dismember (75/100/125 + 75% STR)');
  console.log('  Passive - Flesh Heap (+STR per kill)');
  console.log('========================================');
});

server.on('error', (err) => console.error('[ERROR]', err));

process.on('SIGINT', () => {
  console.log('\n[SHUTDOWN] Closing...');
  clearInterval(gameLoop);
  for (const p of players.values()) p.ws.close();
  server.close(() => { wss.close(() => { console.log('[SHUTDOWN] Done'); process.exit(0); }); });
});
