// ============================================
// ПРОГРЕССИЯ И ПРЕДМЕТЫ (WC3 STYLE)
// ============================================

const ITEMS = {
  orchid: { id: 'orchid', name: 'Orchid Malevolence', cost: 4700, icon: '🔮', stats: { int: 25, damage: 30, manaRegen: 5 } },
  shiva: { id: 'shiva', name: 'Shiva\'s Guard', cost: 4700, icon: '❄️', stats: { armor: 15, int: 30 } },
  heart: { id: 'heart', name: 'Heart of Tarrasque', cost: 5200, icon: '❤️', stats: { str: 45, health: 250 } },
  basher: { id: 'basher', name: 'Skull Basher', cost: 2875, icon: '🔨', stats: { damage: 25, str: 10 } },
  abyssal: { id: 'abyssal', name: 'Abyssal Blade', cost: 6250, icon: '⚔️', stats: { damage: 25, str: 10, health: 250 } },
  rapier: { id: 'rapier', name: 'Divine Rapier', cost: 6000, icon: '🗡️', stats: { damage: 330 } },
  bloodstone: { id: 'bloodstone', name: 'Bloodstone', cost: 4700, icon: '🩸', stats: { health: 400, mana: 400, int: 18 } },
  tango: { id: 'tango', name: 'Tango', cost: 90, icon: '🍎', stats: {}, active: 'Regen 115 HP' },
  salve: { id: 'salve', name: 'Healing Salve', cost: 110, icon: '🧪', stats: {}, active: 'Heal 400 HP' },
  clarity: { id: 'clarity', name: 'Clarity', cost: 50, icon: '💧', stats: {}, active: 'Regen 170 Mana' },
  tp: { id: 'tp', name: 'Town Portal', cost: 100, icon: '📜', stats: {}, active: 'Teleport' }
};

const PERKS = [
  { id: 'flesh_heap_plus', name: 'Flesh Heap+', icon: '🪝', description: '+2 STR per stack instead of 1', cost: 1 },
  { id: 'rot_damage_plus', name: 'Rot Damage+', icon: '☠️', description: '+20% Rot damage', cost: 1 },
  { id: 'hook_range_plus', name: 'Hook Range+', icon: '🎯', description: '+200 Hook range', cost: 1 },
  { id: 'respawn_faster', name: 'Respawn Faster', icon: '⚡', description: '-30% respawn time', cost: 2 }
];

let myItems = [];
let myPerks = [];
let shopOpen = false;

// ============================================
// ФУНКЦИИ МАГАЗИНА
// ============================================
function initShop() {
  const shopEl = document.getElementById('shop');
  const shopItemsEl = document.getElementById('shopItems');
  const closeBtn = document.getElementById('closeShop');
  
  // Генерация предметов в магазине
  shopItemsEl.innerHTML = '';
  for (const item of Object.values(ITEMS)) {
    const itemEl = document.createElement('div');
    itemEl.className = 'shop-item';
    itemEl.style.cssText = 'background:rgba(50,50,50,0.8);border:2px solid #f39c12;border-radius:8px;padding:10px;text-align:center;cursor:pointer;transition:all 0.2s;';
    itemEl.onmouseover = function() { if(!shopOpen) return; this.style.transform='scale(1.05)'; this.style.borderColor='#fff'; };
    itemEl.onmouseout = function() { if(!shopOpen) return; this.style.transform='scale(1)'; this.style.borderColor='#f39c12'; };
    itemEl.onclick = () => buyItem(item.id);
    itemEl.innerHTML = `
      <div style="font-size:32px;margin-bottom:5px;">${item.icon}</div>
      <div style="color:#fff;font-size:11px;font-weight:bold;margin-bottom:3px;">${item.name}</div>
      <div style="color:#f39c12;font-size:12px;">💰 ${item.cost}</div>
    `;
    shopItemsEl.appendChild(itemEl);
  }
  
  // Закрытие магазина
  closeBtn.onclick = toggleShop;
  
  // Открытие магазина по P
  document.addEventListener('keydown', (e) => {
    if (e.code === 'KeyP' && gameRunning) {
      toggleShop();
    }
  });
}

function toggleShop() {
  shopOpen = !shopOpen;
  const shopEl = document.getElementById('shop');
  shopEl.style.display = shopOpen ? 'block' : 'none';
}

function buyItem(itemId) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  
  const player = state.players.get(myId);
  if (!player) return;
  
  const item = ITEMS[itemId];
  if (!item) return;
  
  if (player.gold < item.cost) {
    console.log('[SHOP] Not enough gold!');
    showNotification('Not enough gold!', 'notify-hit');
    return;
  }
  
  ws.send(JSON.stringify({ type: 'buyItem', itemId }));
  console.log('[SHOP] Buying', item.name);
}

function applyItemStats(item) {
  if (!item || !item.stats) return;
  
  // Применяем статы от предмета (визуально)
  if (item.stats.str) console.log('[ITEM] +', item.stats.str, 'STR');
  if (item.stats.agi) console.log('[ITEM] +', item.stats.agi, 'AGI');
  if (item.stats.int) console.log('[ITEM] +', item.stats.int, 'INT');
  if (item.stats.damage) console.log('[ITEM] +', item.stats.damage, 'DMG');
  if (item.stats.armor) console.log('[ITEM] +', item.stats.armor, 'ARMOR');
  if (item.stats.health) console.log('[ITEM] +', item.stats.health, 'HP');
}

// ============================================
// ФУНКЦИИ ПРОГРЕССИИ
// ============================================
function updateXPDisplay(xp, level) {
  const xpEl = document.getElementById('xp');
  if (xpEl) xpEl.textContent = xp || 0;
}

function showLevelUp(level) {
  showNotification(`LEVEL ${level}!`, 'notify-kill');
  
  // Звуковой эффект (опционально)
  // const audio = new Audio('sounds/levelup.mp3');
  // audio.play();
}

function showKillReward(gold, xp) {
  showFloatingText(
    state.players.get(myId)?.x || 0,
    state.players.get(myId)?.y || 0,
    `+${gold}💰 +${xp}⭐`,
    '#f39c12'
  );
}
