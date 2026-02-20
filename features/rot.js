/**
 * 🧟 Rot Mechanic - Pudge Wars
 * При активации (клавиша E) игрок запускает гниение:
 * - Все враги в радиусе теряют HP
 * - Игрок тоже получает урон (самопожертвование)
 */

// Глобальные переменные для Rot
let rotActive = false;
let rotStartTime = 0;
const ROT_RADIUS = 200;
const ROT_DAMAGE_PER_SEC = 50;
const ROT_SELF_DAMAGE_PER_SEC = 25;
const ROT_COOLDOWN = 8000; // 8 секунд

/**
 * Активация Rot
 */
function activateRot() {
  if (rotActive || !myId) return;
  
  // Отправляем на сервер команду активации
  ws.send(JSON.stringify({
    type: 'activateRot'
  }));
  
  rotActive = true;
  rotStartTime = Date.now();
  
  // Визуальный эффект
  document.getElementById('hookIndicator').classList.add('rot-active');
  document.getElementById('hookIndicator').textContent = '☠️ ROT ACTIVE';
}

/**
 * Деактивация Rot
 */
function deactivateRot() {
  if (!rotActive) return;
  
  ws.send(JSON.stringify({
    type: 'deactivateRot'
  }));
  
  rotActive = false;
  document.getElementById('hookIndicator').classList.remove('rot-active');
  document.getElementById('hookIndicator').textContent = '🪝 HOOK READY';
}

/**
 * Обновление Rot каждую секунду
 */
function updateRot(deltaTime) {
  if (!rotActive || !myId) return;
  
  const elapsed = Date.now() - rotStartTime;
  if (elapsed > ROT_COOLDOWN) {
    deactivateRot();
    return;
  }
  
  // Вычисляем урон за этот кадр
  const damagePerFrame = (ROT_DAMAGE_PER_SEC / 60) * deltaTime;
  const selfDamagePerFrame = (ROT_SELF_DAMAGE_PER_SEC / 60) * deltaTime;
  
  // Отправляем урон врагам и себе
  ws.send(JSON.stringify({
    type: 'rotTick',
    damage: Math.floor(damagePerFrame),
    selfDamage: Math.floor(selfDamagePerFrame)
  }));
}

// Регистрация клавиши E
document.addEventListener('keydown', (e) => {
  if (e.code === 'KeyE' && gameRunning && myId) {
    activateRot();
  }
});

// Обработчик сообщений от сервера
function handleServerMessage(data) {
  switch(data.type) {
    case 'rotUpdate':
      // Сервер отправил обновление Rot
      if (data.active) {
        rotActive = true;
        rotStartTime = Date.now() - data.elapsed;
        document.getElementById('hookIndicator').classList.add('rot-active');
        document.getElementById('hookIndicator').textContent = '☠️ ROT ACTIVE';
      } else {
        rotActive = false;
        document.getElementById('hookIndicator').classList.remove('rot-active');
        document.getElementById('hookIndicator').textContent = '🪝 HOOK READY';
      }
      break;
  }
}