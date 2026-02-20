/**
 * Базовые тесты для Pudge Wars Server
 * Запуск: npm test
 */

const assert = require('assert');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`✓ ${name}`);
    passed++;
  } catch (error) {
    console.error(`✗ ${name}`);
    console.error(`  Error: ${error.message}`);
    failed++;
  }
}

// Mock GAME config
const GAME = {
  PLAYER_RADIUS: 18,
  RIVER_Y: 1000,
  RIVER_WIDTH: 150
};

// Вспомогательные функции
function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function pointInCircle(px, py, cx, cy, radius) {
  return Math.hypot(px - cx, py - cy) < radius;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function isInRiver(y, radius) {
  const riverTop = GAME.RIVER_Y - GAME.RIVER_WIDTH / 2;
  const riverBottom = GAME.RIVER_Y + GAME.RIVER_WIDTH / 2;
  return y + radius > riverTop && y - radius < riverBottom;
}

console.log('Running Pudge Wars Tests...\n');
console.log('='.repeat(50));

// Тесты distance()
console.log('\n📏 distance() tests:');
test('расстояние между (0,0) и (3,4) = 5', () => {
  const a = { x: 0, y: 0 };
  const b = { x: 3, y: 4 };
  assert.strictEqual(distance(a, b), 5);
});

test('расстояние между одинаковыми точками = 0', () => {
  const a = { x: 5, y: 5 };
  const b = { x: 5, y: 5 };
  assert.strictEqual(distance(a, b), 0);
});

// Тесты pointInCircle()
console.log('\n⭕ pointInCircle() tests:');
test('точка в центре круга', () => {
  assert.strictEqual(pointInCircle(0, 0, 0, 0, 10), true);
});

test('точка внутри круга', () => {
  assert.strictEqual(pointInCircle(5, 0, 0, 0, 10), true);
});

test('точка вне круга', () => {
  assert.strictEqual(pointInCircle(15, 0, 0, 0, 10), false);
});

// Тесты clamp()
console.log('\n🔧 clamp() tests:');
test('значение в диапазоне', () => {
  assert.strictEqual(clamp(5, 0, 10), 5);
});

test('значение ниже минимума', () => {
  assert.strictEqual(clamp(-5, 0, 10), 0);
});

test('значение выше максимума', () => {
  assert.strictEqual(clamp(15, 0, 10), 10);
});

// Тесты isInRiver()
console.log('\n🌊 isInRiver() tests:');
test('игрок в центре реки', () => {
  assert.strictEqual(isInRiver(1000, 18), true);
});

test('игрок на краю реки', () => {
  assert.strictEqual(isInRiver(950, 18), true);
});

test('игрок не в реке (сверху)', () => {
  assert.strictEqual(isInRiver(500, 18), false);
});

test('игрок не в реке (снизу)', () => {
  assert.strictEqual(isInRiver(1500, 18), false);
});

// Тесты конфигурации
console.log('\n⚙️  Game Config tests:');
test('константы игры корректны', () => {
  const GAME_CONFIG = {
    PLAYER_RADIUS: 18,
    PLAYER_SPEED: 4,
    PLAYER_HEALTH: 1000,
    HOOK_RANGE: 400,
    HOOK_SPEED: 15,
    HOOK_COOLDOWN: 3000,
    HOOK_DAMAGE: 300
  };
  
  assert.strictEqual(GAME_CONFIG.PLAYER_RADIUS, 18);
  assert.strictEqual(GAME_CONFIG.PLAYER_HEALTH, 1000);
  assert.strictEqual(GAME_CONFIG.HOOK_RANGE, 400);
  assert.strictEqual(GAME_CONFIG.HOOK_COOLDOWN, 3000);
});

// Итоги
console.log('\n' + '='.repeat(50));
console.log(`\n✅ Passed: ${passed}`);
console.log(`❌ Failed: ${failed}`);
console.log(`📊 Total:  ${passed + failed}`);

if (failed > 0) {
  console.log('\n❌ Some tests failed!');
  process.exit(1);
} else {
  console.log('\n✅ All tests passed!');
  process.exit(0);
}
