/**
 * Генерация текстур для карты
 * Создаёт PNG файлы для земли, воды и стен
 */

const fs = require('fs');
const path = require('path');
const { createCanvas } = require('canvas');

const assetsDir = path.join(__dirname, 'assets');
const TILE_SIZE = 64;

// Создаём директорию если нет
if (!fs.existsSync(assetsDir)) {
  fs.mkdirSync(assetsDir, { recursive: true });
}

console.log('🎨 Generating textures...');

// 1. Земля (коричневая с шумом)
const groundCanvas = createCanvas(TILE_SIZE, TILE_SIZE);
const groundCtx = groundCanvas.getContext('2d');

// Базовый цвет
groundCtx.fillStyle = '#3a2e2e';
groundCtx.fillRect(0, 0, TILE_SIZE, TILE_SIZE);

// Добавляем "шум" - случайные точки
for (let i = 0; i < 200; i++) {
  const x = Math.random() * TILE_SIZE;
  const y = Math.random() * TILE_SIZE;
  const size = Math.random() * 2 + 1;
  const alpha = Math.random() * 0.3 + 0.1;
  groundCtx.fillStyle = `rgba(93, 64, 55, ${alpha})`;
  groundCtx.beginPath();
  groundCtx.arc(x, y, size, 0, Math.PI * 2);
  groundCtx.fill();
}

// Линии "трещин"
groundCtx.strokeStyle = 'rgba(93, 64, 55, 0.5)';
groundCtx.lineWidth = 0.5;
for (let i = 0; i < 5; i++) {
  groundCtx.beginPath();
  groundCtx.moveTo(Math.random() * TILE_SIZE, Math.random() * TILE_SIZE);
  groundCtx.lineTo(Math.random() * TILE_SIZE, Math.random() * TILE_SIZE);
  groundCtx.stroke();
}

fs.writeFileSync(
  path.join(assetsDir, 'ground_texture.png'),
  groundCanvas.toBuffer('image/png')
);
console.log('✓ ground_texture.png');

// 2. Вода (синяя с волнами)
const waterCanvas = createCanvas(TILE_SIZE, TILE_SIZE);
const waterCtx = waterCanvas.getContext('2d');

// Градиент
const gradient = waterCtx.createLinearGradient(0, 0, TILE_SIZE, TILE_SIZE);
gradient.addColorStop(0, '#1e3c50');
gradient.addColorStop(0.5, '#2a5269');
gradient.addColorStop(1, '#1e3c50');
waterCtx.fillStyle = gradient;
waterCtx.fillRect(0, 0, TILE_SIZE, TILE_SIZE);

// Волны
waterCtx.strokeStyle = 'rgba(100, 200, 255, 0.3)';
waterCtx.lineWidth = 1.5;
for (let y = 10; y < TILE_SIZE; y += 12) {
  waterCtx.beginPath();
  for (let x = 0; x < TILE_SIZE; x += 5) {
    const waveY = y + Math.sin(x * 0.3) * 3;
    if (x === 0) {
      waterCtx.moveTo(x, waveY);
    } else {
      waterCtx.lineTo(x, waveY);
    }
  }
  waterCtx.stroke();
}

// Блеск
waterCtx.fillStyle = 'rgba(255, 255, 255, 0.1)';
for (let i = 0; i < 30; i++) {
  const x = Math.random() * TILE_SIZE;
  const y = Math.random() * TILE_SIZE;
  waterCtx.beginPath();
  waterCtx.ellipse(x, y, Math.random() * 8 + 2, Math.random() * 2 + 1, Math.random() * Math.PI, 0, Math.PI * 2);
  waterCtx.fill();
}

fs.writeFileSync(
  path.join(assetsDir, 'water_texture.png'),
  waterCanvas.toBuffer('image/png')
);
console.log('✓ water_texture.png');

// 3. Стена (каменная текстура)
const wallCanvas = createCanvas(TILE_SIZE, TILE_SIZE);
const wallCtx = wallCanvas.getContext('2d');

// Базовый цвет
wallCtx.fillStyle = '#5d4037';
wallCtx.fillRect(0, 0, TILE_SIZE, TILE_SIZE);

// Кирпичи
wallCtx.fillStyle = '#4a3a2a';
for (let row = 0; row < 4; row++) {
  const y = row * 16;
  const offset = (row % 2) * 16;
  for (let col = -1; col < 5; col++) {
    const x = col * 32 + offset;
    wallCtx.fillRect(x + 1, y + 1, 30, 14);
  }
}

// Раствор между кирпичами
wallCtx.strokeStyle = 'rgba(0, 0, 0, 0.3)';
wallCtx.lineWidth = 1;
for (let row = 0; row <= 4; row++) {
  const y = row * 16;
  wallCtx.beginPath();
  wallCtx.moveTo(0, y);
  wallCtx.lineTo(TILE_SIZE, y);
  wallCtx.stroke();
}

for (let col = 0; col <= 2; col++) {
  const x = col * 32;
  wallCtx.beginPath();
  wallCtx.moveTo(x, 0);
  wallCtx.lineTo(x, TILE_SIZE);
  wallCtx.stroke();
}

fs.writeFileSync(
  path.join(assetsDir, 'wall_texture.png'),
  wallCanvas.toBuffer('image/png')
);
console.log('✓ wall_texture.png');

console.log('\n✅ All textures generated successfully!');
console.log(`📁 Saved to: ${assetsDir}`);
