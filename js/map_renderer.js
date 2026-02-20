/**
 * Pudge Wars Map Renderer v2.0
 * Изометрическая карта: болото, река, стены
 */

console.log('[MAP_RENDERER] Script loaded');

let waterOffset = 0;
const TILE_SIZE = 64;

class AssetManager {
  constructor() {
    this.textures = {};
    this.loadingCount = 0;
    this.totalCount = 0;
    this.onReady = null;
    this.isReady = false;
  }

  loadTexture(name, url) {
    this.loadingCount++;
    this.totalCount++;

    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        console.log(`[ASSETS] Loaded: ${name}`);
        this.textures[name] = img;
        this.loadingCount--;

        try {
          const loadingStatusEl = document.getElementById('loadingStatus');
          if (loadingStatusEl) {
            const loaded = this.totalCount - this.loadingCount;
            loadingStatusEl.innerHTML = `<span>✓ ${name} (${loaded}/${this.totalCount})</span>`;
          }
        } catch(e) {}

        if (this.loadingCount === 0) {
          this.isReady = true;
          if (this.onReady) this.onReady();
        }
        resolve(img);
      };
      img.onerror = () => {
        console.error(`[ASSETS] Failed: ${name}`);
        this.loadingCount--;
        reject(new Error(`Failed to load ${name}`));
      };
      img.src = url;
    });
  }

  async preload() {
    console.log('[ASSETS] Starting preload...');
    await Promise.all([
      this.loadTexture('ground', 'assets/ground_texture.svg'),
      this.loadTexture('water', 'assets/water_texture.svg'),
      this.loadTexture('wall', 'assets/wall_texture.svg')
    ]);
  }

  get(name) {
    return this.textures[name] || null;
  }

  ready(callback) {
    if (this.isReady) {
      callback();
    } else {
      this.onReady = callback;
    }
  }
}

const assetManager = new AssetManager();

function drawMap(cameraX, cameraY) {
  const ctx = canvas.getContext('2d');
  const fieldSize = CONFIG.FIELD_SIZE;

  ctx.imageSmoothingEnabled = false;

  // Фон
  ctx.fillStyle = '#1a1a2e';
  ctx.fillRect(-cameraX, -cameraY, fieldSize, fieldSize);

  // Земля (тайлы)
  if (assetManager.get('ground')) {
    const groundTex = assetManager.get('ground');
    const tilesX = Math.ceil(fieldSize / TILE_SIZE) + 1;
    const tilesY = Math.ceil(fieldSize / TILE_SIZE) + 1;

    for (let tx = 0; tx < tilesX; tx++) {
      for (let ty = 0; ty < tilesY; ty++) {
        const x = tx * TILE_SIZE - cameraX;
        const y = ty * TILE_SIZE - cameraY;
        ctx.drawImage(groundTex, x, y, TILE_SIZE, TILE_SIZE);
      }
    }
  } else {
    ctx.fillStyle = '#3a2e2e';
    ctx.fillRect(-cameraX, -cameraY, fieldSize, fieldSize);
  }

  // Река с анимацией
  const riverTop = CONFIG.RIVER_Y - CONFIG.RIVER_WIDTH / 2;
  const riverBottom = CONFIG.RIVER_Y + CONFIG.RIVER_WIDTH / 2;

  if (assetManager.get('water')) {
    const waterTex = assetManager.get('water');
    const waterHeight = riverBottom - riverTop;
    const tilesYWater = Math.ceil(waterHeight / TILE_SIZE) + 1;

    waterOffset += 0.2;
    if (waterOffset > TILE_SIZE) waterOffset -= TILE_SIZE;

    const waterAlpha = 0.6 + Math.sin(performance.now() * 0.001) * 0.1;
    ctx.globalAlpha = waterAlpha;

    for (let tx = 0; tx < Math.ceil(fieldSize / TILE_SIZE) + 1; tx++) {
      for (let ty = 0; ty < tilesYWater; ty++) {
        const x = tx * TILE_SIZE - cameraX + waterOffset;
        const y = riverTop + ty * TILE_SIZE - cameraY;
        ctx.drawImage(waterTex, x, y, TILE_SIZE, TILE_SIZE);
      }
    }
    ctx.globalAlpha = 1;
  } else {
    ctx.fillStyle = 'rgba(30, 60, 80, 0.7)';
    ctx.fillRect(-cameraX, riverTop - cameraY, fieldSize, riverBottom - riverTop);
  }

  // Берега
  ctx.fillStyle = '#4a3a2a';
  ctx.fillRect(-cameraX, riverTop - cameraY - 8, fieldSize, 8);
  ctx.fillRect(-cameraX, riverBottom - cameraY, fieldSize, 8);

  // Стены
  if (assetManager.get('wall')) {
    const wallTex = assetManager.get('wall');
    const wallHeight = TILE_SIZE;

    // Левая и правая
    for (let ty = 0; ty * TILE_SIZE < fieldSize; ty++) {
      const y = ty * TILE_SIZE - cameraY;
      ctx.drawImage(wallTex, -cameraX, y, TILE_SIZE, wallHeight);
      ctx.drawImage(wallTex, fieldSize - cameraX, y, TILE_SIZE, wallHeight);
    }
    // Верхняя и нижняя
    for (let tx = 0; tx * TILE_SIZE < fieldSize; tx++) {
      const x = tx * TILE_SIZE - cameraX;
      ctx.drawImage(wallTex, x, -cameraY, TILE_SIZE, wallHeight);
      ctx.drawImage(wallTex, x, fieldSize - cameraY, TILE_SIZE, wallHeight);
    }
  } else {
    ctx.strokeStyle = '#5d4037';
    ctx.lineWidth = 20;
    ctx.beginPath();
    ctx.moveTo(-cameraX, -cameraY);
    ctx.lineTo(fieldSize - cameraX, -cameraY);
    ctx.lineTo(fieldSize - cameraX, fieldSize - cameraY);
    ctx.lineTo(-cameraX, fieldSize - cameraY);
    ctx.closePath();
    ctx.stroke();
  }

  // Виньетка
  const gradient = ctx.createRadialGradient(
    canvas.width / 2, canvas.height / 2, 0,
    canvas.width / 2, canvas.height / 2, Math.max(canvas.width, canvas.height) * 0.8
  );
  gradient.addColorStop(0, 'rgba(0, 0, 0, 0)');
  gradient.addColorStop(1, 'rgba(0, 0, 0, 0.6)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
}

// Экспорт
window.assetManager = assetManager;
window.drawMap = drawMap;
