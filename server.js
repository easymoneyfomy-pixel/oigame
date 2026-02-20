/**
 * ============================================
 * PUDGE WARS - Server
 * Многопользовательская .io игра
 * ============================================
 * Архитектура:
 * - Tick-based физика (60 TPS)
 * - Авторитетный сервер для всех вычислений
 * - WebSocket для realtime коммуникации
 * ============================================
 */

const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');

// ============================================
// КОНФИГУРАЦИЯ
// ============================================
const PORT = process.env.PORT || 8080;
const TICK_RATE = 60; // Обновлений в секунду
const FIELD_SIZE = 2000;
const TEAM_SIZE = 5;

// Игровые константы (синхронизированы с клиентом)
const GAME = {
  PLAYER_RADIUS: 18,
  PLAYER_SPEED: 4,
  PLAYER_HEALTH: 1000,
  HOOK_RANGE: 400,
  HOOK_SPEED: 15,
  HOOK_RADIUS: 6,
  HOOK_COOLDOWN: 3000,      // 3 секунды
  HOOK_DAMAGE: 300,
  HOOK_PULL_SPEED: 8,
  RESPAWN_TIME: 5000,       // 5 секунд
  RIVER_Y: 1000,
  RIVER_WIDTH: 150
};

// ============================================
// СОСТОЯНИЕ СЕРВЕРА
// ============================================
const players = new Map();     // Все игроки
const hooks = [];              // Активные крюки
let nextPlayerId = 1;          // Генератор ID
let matchStartTime = Date.now();
const MATCH_DURATION = 420000; // 7 минут

// ============================================
// ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
// ============================================

/**
 * Вычисляет расстояние между двумя точками
 */
function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Проверка столкновения точки с кругом
 */
function pointInCircle(px, py, cx, cy, radius) {
  return Math.hypot(px - cx, py - cy) < radius;
}

/**
 * Проверка столкновения двух кругов
 */
function circleCollision(c1, r1, c2, r2) {
  return Math.hypot(c1.x - c2.x, c1.y - c2.y) < (r1 + r2);
}

/**
 * Ограничивает значение в диапазоне
 */
function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

/**
 * Проверка столкновения с рекой (игроки не могут проходить)
 */
function isInRiver(y, radius) {
  const riverTop = GAME.RIVER_Y - GAME.RIVER_WIDTH / 2;
  const riverBottom = GAME.RIVER_Y + GAME.RIVER_WIDTH / 2;
  return y + radius > riverTop && y - radius < riverBottom;
}

/**
 * Спавн игрока на стороне команды
 */
function getSpawnPosition(team) {
  if (team === 'radiant') {
    // Верхняя часть карты
    return {
      x: 500 + Math.random() * 1000,
      y: 200 + Math.random() * 300
    };
  } else {
    // Нижняя часть карты
    return {
      x: 500 + Math.random() * 1000,
      y: 1500 + Math.random() * 300
    };
  }
}

// ============================================
// HTTP СЕРВЕР (раздача клиента + статика)
// ============================================
const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  let pathname = url.pathname;

  // MIME типы для статики
  const mimeTypes = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml; charset=utf-8',
    '.json': 'application/json; charset=utf-8'
  };

  // Маршруты
  if (pathname === '/' || pathname === '/index.html') {
    const clientPath = path.join(__dirname, 'index.html');
    fs.readFile(clientPath, (err, data) => {
      if (err) {
        res.writeHead(500);
        res.end('Error loading game');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(data);
    });
  } else {
    // Раздача статики (js/, assets/)
    const filePath = path.join(__dirname, pathname);
    const ext = path.extname(filePath).toLowerCase();
    const contentType = mimeTypes[ext] || 'application/octet-stream';

    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end('File not found');
        return;
      }
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(data);
    });
  }
});

// ============================================
// WEBSOCKET СЕРВЕР
// ============================================
const wss = new WebSocket.Server({ 
  server,
  maxPayload: 1024,
  perMessageDeflate: false 
});

/**
 * Обработка нового подключения
 */
wss.on('connection', (ws) => {
  // Определяем команду (балансировка)
  const radiantCount = [...players.values()].filter(p => p.team === 'radiant').length;
  const direCount = [...players.values()].filter(p => p.team === 'dire').length;
  
  const team = radiantCount <= direCount ? 'radiant' : 'dire';
  const pos = getSpawnPosition(team);
  
  // Создаем игрока
  const player = {
    id: nextPlayerId++,
    x: pos.x,
    y: pos.y,
    team,
    health: GAME.PLAYER_HEALTH,
    maxHealth: GAME.PLAYER_HEALTH,
    speed: GAME.PLAYER_SPEED,
    ws,
    hookCooldown: 0,
    hookCooldownTime: GAME.HOOK_COOLDOWN,
    hookRange: GAME.HOOK_RANGE,
    hookSpeed: GAME.HOOK_SPEED,
    hookDamage: GAME.HOOK_DAMAGE,
    isDead: false,
    respawnTime: 0,
    kills: 0,
    deaths: 0,
    angle: 0,
    gold: 600
  };
  
  players.set(player.id, player);
  
  // Отправляем приветствие
  ws.send(JSON.stringify({
    type: 'welcome',
    playerId: player.id,
    team: player.team,
    matchTime: Math.max(0, MATCH_DURATION - (Date.now() - matchStartTime)),
    players: [...players.values()].map(p => playerToData(p))
  }));
  
  console.log(`[JOIN] Player ${player.id} joined ${team}`);
  
  // Обработка сообщений от клиента
  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data);
      if (msg.type === 'setName' && msg.name) {
        player.name = msg.name.substring(0, 20);
      } else {
        handlePlayerMessage(player, msg);
      }
    } catch (e) {
      // Неверный формат - игнорируем
    }
  });
  
  // Отключение
  ws.on('close', () => {
    console.log(`[LEAVE] Player ${player.id} disconnected`);
    players.delete(player.id);
  });
  
  ws.on('error', () => {
    players.delete(player.id);
  });
});

/**
 * Преобразование игрока в массив для сети
 * [id, x, y, team, health, maxHealth, gold, level, kills, deaths, isDead, name]
 */
function playerToData(player) {
  return [
    player.id,
    Math.round(player.x * 100) / 100,
    Math.round(player.y * 100) / 100,
    player.team,
    Math.round(player.health),
    player.maxHealth,
    player.gold || 0,
    player.level || 1,
    player.kills || 0,
    player.deaths || 0,
    player.isDead,
    player.name || `Pudge_${player.id}`
  ];
}

/**
 * Преобразование хука в массив для сети
 */
function hookToData(hook) {
  return [
    hook.id,
    hook.x,
    hook.y,
    hook.targetX,
    hook.targetY,
    hook.ownerId
  ];
}

/**
 * Обработка входящих сообщений от игрока
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
      
    case 'upgrade':
      handleUpgrade(player, msg);
      break;
  }
}

/**
 * Обработка прокачки характеристик хука
 */
function handleUpgrade(player, msg) {
  const { upgradeType, value } = msg;
  
  if (!upgradeType || typeof value !== 'number') return;
  
  // Применяем апгрейд к игроку
  switch (upgradeType) {
    case 'range':
      player.hookRange = value;
      break;
    case 'speed':
      player.hookSpeed = value;
      break;
    case 'damage':
      player.hookDamage = value;
      break;
    case 'cooldown':
      player.hookCooldownTime = value;
      break;
  }
  
  console.log(`[UPGRADE] Player ${player.id} upgraded ${upgradeType} to ${value}`);
}

/**
 * Обработка движения игрока
 */
function handleMove(player, msg) {
  const dx = clamp(msg.dx || 0, -1, 1);
  const dy = clamp(msg.dy || 0, -1, 1);
  
  // Нормализация вектора движения
  const len = Math.hypot(dx, dy);
  if (len > 0) {
    const moveX = (dx / len) * player.speed;
    const moveY = (dy / len) * player.speed;
    
    // Предсказание новой позиции
    let newX = player.x + moveX;
    let newY = player.y + moveY;
    
    // Проверка границ карты
    newX = clamp(newX, GAME.PLAYER_RADIUS, FIELD_SIZE - GAME.PLAYER_RADIUS);
    newY = clamp(newY, GAME.PLAYER_RADIUS, FIELD_SIZE - GAME.PLAYER_RADIUS);
    
    // Проверка реки (игроки не могут проходить)
    if (!isInRiver(newY, GAME.PLAYER_RADIUS)) {
      player.x = newX;
      player.y = newY;
    }
  }
}

/**
 * Выстрел крюком
 */
function handleHook(player, msg) {
  const now = Date.now();
  
  // Проверка кулдауна (с учётом апгрейдов)
  const cooldownTime = player.hookCooldownTime || GAME.HOOK_COOLDOWN;
  if (now < player.hookCooldown) return;
  
  const angle = msg.angle || 0;
  const hookRange = player.hookRange || GAME.HOOK_RANGE;
  const hookSpeed = player.hookSpeed || GAME.HOOK_SPEED;
  const hookDamage = player.hookDamage || GAME.HOOK_DAMAGE;
  
  const targetX = player.x + Math.cos(angle) * hookRange;
  const targetY = player.y + Math.sin(angle) * hookRange;
  
  // Создаем хук
  const hook = {
    id: `hook_${player.id}_${now}`,
    x: player.x,
    y: player.y,
    targetX,
    targetY,
    ownerId: player.id,
    owner: player,
    vx: Math.cos(angle) * hookSpeed,
    vy: Math.sin(angle) * hookSpeed,
    traveled: 0,
    state: 'flying',
    targetId: null,
    damage: hookDamage,
    range: hookRange,
    speed: hookSpeed
  };
  
  hooks.push(hook);
  player.hookCooldown = now + cooldownTime;
  
  console.log(`[HOOK] Player ${player.id} fired hook (dmg:${hookDamage}, range:${hookRange})`);
  
  // Отправляем событие всем клиентам для отображения кулдауна
  broadcastEvent({
    type: 'hookFire',
    playerId: player.id
  });
}

// ============================================
// ФИЗИКА ХУКОВ
// ============================================

/**
 * Обновление всех хуков
 */
function updateHooks() {
  const now = Date.now();
  
  for (let i = hooks.length - 1; i >= 0; i--) {
    const hook = hooks[i];
    updateSingleHook(hook, now);
    
    // Удаляем завершенные хуки
    if (hook.state === 'done') {
      hooks.splice(i, 1);
    }
  }
}

/**
 * Обновление одного хука
 */
function updateSingleHook(hook, now) {
  const hookSpeed = hook.speed || GAME.HOOK_SPEED;
  const hookRange = hook.range || GAME.HOOK_RANGE;
  const HOOK_PULL_SPEED = GAME.HOOK_PULL_SPEED;
  
  if (hook.state === 'flying') {
    // Движение вперед
    hook.x += hook.vx;
    hook.y += hook.vy;
    hook.traveled += hookSpeed;

    // Проверка достижения максимума
    if (hook.traveled >= hookRange) {
      hook.state = 'returning';
    }

    // Проверка попадания в игроков
    checkHookCollision(hook);

  } else if (hook.state === 'returning' || hook.state === 'pulling') {
    // Возвращение к владельцу
    const owner = hook.owner;
    if (owner && !owner.isDead) {
      const dx = owner.x - hook.x;
      const dy = owner.y - hook.y;
      const dist = Math.hypot(dx, dy);

      if (dist < 10) {
        hook.state = 'done';
      } else {
        // Движение к владельцу
        hook.x += (dx / dist) * HOOK_PULL_SPEED;
        hook.y += (dy / dist) * HOOK_PULL_SPEED;

        // Если тащим цель
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
 * Проверка столкновений хука с игроками
 * Хук попадает во врагов — наносит урон и тащит
 * Хук попадает в союзников — просто тащит (спасение)
 */
function checkHookCollision(hook) {
  for (const [id, player] of players) {
    if (id === hook.ownerId || player.isDead) continue;

    // Проверка попадания
    if (pointInCircle(hook.x, hook.y, player.x, player.y, GAME.PLAYER_RADIUS + GAME.HOOK_RADIUS)) {
      if (player.team === hook.owner.team) {
        // Союзник — спасаем (тащим без урона)
        applyHookPull(hook, player);
      } else {
        // Враг — наносим урон и тащим
        applyHookHit(hook, player);
      }
      return;
    }
  }
}

/**
 * Проверка столкновения двух хуков
 */
function checkHookToHookCollision() {
  for (let i = 0; i < hooks.length; i++) {
    for (let j = i + 1; j < hooks.length; j++) {
      const h1 = hooks[i];
      const h2 = hooks[j];
      
      // Проверяем только летящие хуки
      if (h1.state !== 'flying' || h2.state !== 'flying') continue;
      
      // Столкновение хуков
      if (circleCollision(h1, GAME.HOOK_RADIUS, h2, GAME.HOOK_RADIUS)) {
        // Отскок хуков в противоположные стороны
        const dx = h2.x - h1.x;
        const dy = h2.y - h1.y;
        const dist = Math.hypot(dx, dy) || 1;
        
        // Меняем направление на противоположное с отскоком
        const bounceFactor = 0.5;
        h1.vx = -h1.vx * bounceFactor;
        h1.vy = -h1.vy * bounceFactor;
        h2.vx = -h2.vx * bounceFactor;
        h2.vy = -h2.vy * bounceFactor;
        
        // Разводим хуки чтобы не залипали
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
 * Применение попадания хуком (враг — урон + притягивание)
 */
function applyHookHit(hook, target) {
  const owner = hook.owner;

  // Наносим урон
  target.health -= hook.damage;

  // Тащим цель к владельцу
  hook.state = 'pulling';
  hook.targetId = target.id;

  console.log(`[HIT] Player ${owner.id} hit Player ${target.id} for ${hook.damage} damage`);

  // Отправляем событие о попадании
  broadcastEvent({
    type: 'hookHit',
    targetId: target.id,
    hitterId: owner.id,
    x: target.x,
    y: target.y
  });

  // Проверка смерти
  if (target.health <= 0 && !target.isDead) {
    killPlayer(target, owner);
  }
}

/**
 * Применение притягивания союзника (спасение без урона)
 */
function applyHookPull(hook, ally) {
  const owner = hook.owner;

  // Тащим союзника без урона
  hook.state = 'pulling';
  hook.targetId = ally.id;

  console.log(`[SAVE] Player ${owner.id} saved ally ${ally.id}`);
  
  // Отправляем событие о спасении
  broadcastEvent({
    type: 'allySaved',
    allyId: ally.id,
    saverId: owner.id
  });
}

// ============================================
// БОЕВАЯ СИСТЕМА
// ============================================

/**
 * Убийство игрока
 */
function killPlayer(victim, killer) {
  victim.isDead = true;
  victim.respawnTime = Date.now() + GAME.RESPAWN_TIME;
  victim.kills = victim.kills || 0;
  victim.deaths = (victim.deaths || 0) + 1;

  if (killer) {
    killer.kills = (killer.kills || 0) + 1;
  }

  console.log(`[KILL] Player ${killer?.id || 'unknown'} killed Player ${victim.id}`);
  
  // Отправляем событие об убийстве
  broadcastEvent({
    type: 'playerKill',
    victimId: victim.id,
    killerId: killer?.id,
    x: victim.x,
    y: victim.y
  });
}

/**
 * Проверка респавна
 */
function checkRespawn() {
  const now = Date.now();
  
  for (const player of players.values()) {
    if (player.isDead && now >= player.respawnTime) {
      // Респавн
      const pos = getSpawnPosition(player.team);
      player.x = pos.x;
      player.y = pos.y;
      player.health = player.maxHealth;
      player.isDead = false;
      
      console.log(`[RESPAWN] Player ${player.id} respawned`);
    }
  }
}

/**
 * Конец матча
 */
function endMatch() {
  // Подсчитываем убийства команд
  const radiantKills = [...players.values()]
    .filter(p => p.team === 'radiant')
    .reduce((sum, p) => sum + p.kills, 0);
  const direKills = [...players.values()]
    .filter(p => p.team === 'dire')
    .reduce((sum, p) => sum + p.kills, 0);
  
  const winner = radiantKills > direKills ? 'radiant' : (direKills > radiantKills ? 'dire' : 'draw');
  
  console.log(`[MATCH END] Winner: ${winner} (${radiantKills} - ${direKills})`);
  
  // Отправляем событие всем
  broadcastEvent({
    type: 'matchEnd',
    winner,
    radiantKills,
    direKills
  });
  
  // Перезапуск через 10 секунд
  setTimeout(() => {
    matchStartTime = Date.now();
    
    // Сброс игроков
    for (const player of players.values()) {
      const pos = getSpawnPosition(player.team);
      player.x = pos.x;
      player.y = pos.y;
      player.health = player.maxHealth;
      player.isDead = false;
      player.kills = 0;
      player.deaths = 0;
      player.gold = 600;
    }
    
    hooks.length = 0;
    
    console.log('[MATCH] New match started');
  }, 10000);
}

// ============================================
// ИГРОВОЙ ЦИКЛ
// ============================================

/**
 * Рассылка события всем игрокам
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
 * Рассылка состояния всем игрокам
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

// Основной игровой цикл
const gameLoop = setInterval(() => {
  const matchElapsed = Date.now() - matchStartTime;
  
  // Проверка конца матча по времени
  if (matchElapsed >= MATCH_DURATION) {
    endMatch();
    return;
  }
  
  // Физика хуков
  updateHooks();
  
  // Столкновения хуков друг с другом
  checkHookToHookCollision();
  
  // Респавн игроков
  checkRespawn();

  // Рассылка состояния
  broadcastState();
}, 1000 / TICK_RATE);

// ============================================
// ЗАПУСК СЕРВЕРА
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
});

// Обработка ошибок
server.on('error', (err) => {
  console.error('[ERROR] Server error:', err);
});

// Graceful shutdown
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
