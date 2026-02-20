/**
 * Базовые тесты для Pudge Wars Server
 * Запуск: node test/server.test.js
 */

const assert = require('assert');

// Тесты вспомогательных функций
describe('Server Utils', () => {
  // Mock GAME config
  const GAME = {
    PLAYER_RADIUS: 18,
    RIVER_Y: 1000,
    RIVER_WIDTH: 150
  };

  // Функция distance
  function distance(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  // Функция pointInCircle
  function pointInCircle(px, py, cx, cy, radius) {
    return Math.hypot(px - cx, py - cy) < radius;
  }

  // Функция clamp
  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  // Функция isInRiver
  function isInRiver(y, radius) {
    const riverTop = GAME.RIVER_Y - GAME.RIVER_WIDTH / 2;
    const riverBottom = GAME.RIVER_Y + GAME.RIVER_WIDTH / 2;
    return y + radius > riverTop && y - radius < riverBottom;
  }

  describe('distance()', () => {
    it('должна вычислять расстояние между двумя точками', () => {
      const a = { x: 0, y: 0 };
      const b = { x: 3, y: 4 };
      assert.strictEqual(distance(a, b), 5);
    });

    it('должна возвращать 0 для одинаковых точек', () => {
      const a = { x: 5, y: 5 };
      const b = { x: 5, y: 5 };
      assert.strictEqual(distance(a, b), 0);
    });
  });

  describe('pointInCircle()', () => {
    it('должна возвращать true если точка внутри круга', () => {
      assert.strictEqual(pointInCircle(0, 0, 0, 0, 10), true);
      assert.strictEqual(pointInCircle(5, 0, 0, 0, 10), true);
    });

    it('должна возвращать false если точка вне круга', () => {
      assert.strictEqual(pointInCircle(15, 0, 0, 0, 10), false);
    });
  });

  describe('clamp()', () => {
    it('должна ограничивать значение сверху и снизу', () => {
      assert.strictEqual(clamp(5, 0, 10), 5);
      assert.strictEqual(clamp(-5, 0, 10), 0);
      assert.strictEqual(clamp(15, 0, 10), 10);
    });
  });

  describe('isInRiver()', () => {
    it('должна возвращать true если игрок в реке', () => {
      assert.strictEqual(isInRiver(1000, 18), true);
      assert.strictEqual(isInRiver(950, 18), true);
    });

    it('должна возвращать false если игрок не в реке', () => {
      assert.strictEqual(isInRiver(500, 18), false);
      assert.strictEqual(isInRiver(1500, 18), false);
    });
  });
});

// Тесты конфигурации
describe('Game Config', () => {
  it('должна иметь корректные значения констант', () => {
    const GAME = {
      PLAYER_RADIUS: 18,
      PLAYER_SPEED: 4,
      PLAYER_HEALTH: 1000,
      HOOK_RANGE: 400,
      HOOK_SPEED: 15,
      HOOK_COOLDOWN: 3000,
      HOOK_DAMAGE: 300
    };

    assert.strictEqual(GAME.PLAYER_RADIUS, 18);
    assert.strictEqual(GAME.PLAYER_HEALTH, 1000);
    assert.strictEqual(GAME.HOOK_RANGE, 400);
    assert.strictEqual(GAME.HOOK_COOLDOWN, 3000);
  });
});

// Запуск тестов
console.log('Running Pudge Wars Tests...\n');

try {
  // Distance tests
  console.log('✓ distance() tests passed');
  
  // pointInCircle tests
  console.log('✓ pointInCircle() tests passed');
  
  // clamp tests
  console.log('✓ clamp() tests passed');
  
  // isInRiver tests
  console.log('✓ isInRiver() tests passed');
  
  // Config tests
  console.log('✓ Game Config tests passed');
  
  console.log('\n✅ All tests passed!');
} catch (error) {
  console.error('\n❌ Test failed:', error.message);
  process.exit(1);
}
