/**
 * 🎨 Pudge Wars Texture Generator (Node.js)
 * Генерирует текстуры в стиле Warcraft 3
 * 
 * Использование:
 *   node generate_textures.js
 */

const fs = require('fs');
const path = require('path');
const { createCanvas } = require('canvas');

const TEXTURE_SIZE = 512;
const OUTPUT_DIR = path.join(__dirname, 'assets');

// Создаём папку assets если нет
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  console.log('📁 Created assets/ directory');
}

/**
 * Генерация текстуры земли (потрескавшаяся грязь с травой)
 */
function generateGroundTexture() {
  console.log('🎨 Generating ground texture...');
  
  const canvas = createCanvas(TEXTURE_SIZE, TEXTURE_SIZE);
  const ctx = canvas.getContext('2d');
  
  // Base layer - dark mud
  ctx.fillStyle = '#3a2e2e';
  ctx.fillRect(0, 0, TEXTURE_SIZE, TEXTURE_SIZE);
  
  // Add noise and variation
  for (let i = 0; i < 5000; i++) {
    const x = Math.random() * TEXTURE_SIZE;
    const y = Math.random() * TEXTURE_SIZE;
    const shade = Math.random();
    
    if (shade > 0.7) {
      ctx.fillStyle = `rgba(58, 46, 46, ${Math.random() * 0.3})`;
    } else if (shade > 0.4) {
      ctx.fillStyle = `rgba(74, 58, 42, ${Math.random() * 0.3})`;
    } else {
      ctx.fillStyle = `rgba(42, 32, 28, ${Math.random() * 0.3})`;
    }
    
    ctx.beginPath();
    ctx.arc(x, y, Math.random() * 3 + 1, 0, Math.PI * 2);
    ctx.fill();
  }
  
  // Add cracks
  ctx.strokeStyle = '#2a1e1e';
  ctx.lineWidth = 1.5;
  for (let i = 0; i < 30; i++) {
    ctx.beginPath();
    let x = Math.random() * TEXTURE_SIZE;
    let y = Math.random() * TEXTURE_SIZE;
    ctx.moveTo(x, y);
    
    for (let j = 0; j < 10; j++) {
      x += (Math.random() - 0.5) * 40;
      y += (Math.random() - 0.5) * 40;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  
  // Add dry grass patches
  ctx.fillStyle = '#4a5a3a';
  for (let i = 0; i < 200; i++) {
    const x = Math.random() * TEXTURE_SIZE;
    const y = Math.random() * TEXTURE_SIZE;
    const grassSize = Math.random() * 8 + 2;
    
    ctx.beginPath();
    ctx.ellipse(x, y, grassSize, grassSize * 0.3, Math.random() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  
  // Add small stones
  ctx.fillStyle = '#6a6a6a';
  for (let i = 0; i < 100; i++) {
    const x = Math.random() * TEXTURE_SIZE;
    const y = Math.random() * TEXTURE_SIZE;
    const stoneSize = Math.random() * 4 + 2;
    
    ctx.beginPath();
    ctx.arc(x, y, stoneSize, 0, Math.PI * 2);
    ctx.fill();
    
    // Stone highlight
    ctx.fillStyle = 'rgba(120, 120, 120, 0.5)';
    ctx.beginPath();
    ctx.arc(x - 1, y - 1, stoneSize * 0.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#6a6a6a';
  }
  
  // Add moss patches
  ctx.fillStyle = 'rgba(74, 90, 58, 0.4)';
  for (let i = 0; i < 50; i++) {
    const x = Math.random() * TEXTURE_SIZE;
    const y = Math.random() * TEXTURE_SIZE;
    const mossSize = Math.random() * 20 + 10;
    
    ctx.beginPath();
    ctx.arc(x, y, mossSize, 0, Math.PI * 2);
    ctx.fill();
  }
  
  // Save
  const buffer = canvas.toBuffer('image/png');
  fs.writeFileSync(path.join(OUTPUT_DIR, 'ground_texture.png'), buffer);
  console.log('✅ ground_texture.png generated');
}

/**
 * Генерация текстуры воды (мутная болотная)
 */
function generateWaterTexture() {
  console.log('🎨 Generating water texture...');
  
  const canvas = createCanvas(TEXTURE_SIZE, TEXTURE_SIZE);
  const ctx = canvas.getContext('2d');
  
  // Base layer - deep murky water
  const gradient = ctx.createLinearGradient(0, 0, TEXTURE_SIZE, TEXTURE_SIZE);
  gradient.addColorStop(0, '#1a3a4a');
  gradient.addColorStop(0.5, '#2a4a5a');
  gradient.addColorStop(1, '#1a3a4a');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, TEXTURE_SIZE, TEXTURE_SIZE);
  
  // Add wave patterns
  ctx.strokeStyle = 'rgba(42, 74, 90, 0.6)';
  ctx.lineWidth = 2;
  
  for (let y = 0; y < TEXTURE_SIZE; y += 20) {
    ctx.beginPath();
    for (let x = 0; x < TEXTURE_SIZE; x += 5) {
      const waveY = y + Math.sin(x * 0.05) * 5 + Math.cos(x * 0.02) * 3;
      if (x === 0) {
        ctx.moveTo(x, waveY);
      } else {
        ctx.lineTo(x, waveY);
      }
    }
    ctx.stroke();
  }
  
  // Add ripples
  ctx.strokeStyle = 'rgba(58, 90, 110, 0.4)';
  ctx.lineWidth = 1;
  for (let i = 0; i < 50; i++) {
    const x = Math.random() * TEXTURE_SIZE;
    const y = Math.random() * TEXTURE_SIZE;
    const rippleSize = Math.random() * 30 + 10;
    
    ctx.beginPath();
    ctx.arc(x, y, rippleSize, 0, Math.PI * 2);
    ctx.stroke();
  }
  
  // Add foam/bubbles
  ctx.fillStyle = 'rgba(100, 140, 160, 0.3)';
  for (let i = 0; i < 300; i++) {
    const x = Math.random() * TEXTURE_SIZE;
    const y = Math.random() * TEXTURE_SIZE;
    const bubbleSize = Math.random() * 3 + 1;
    
    ctx.beginPath();
    ctx.arc(x, y, bubbleSize, 0, Math.PI * 2);
    ctx.fill();
  }
  
  // Add depth variation
  ctx.fillStyle = 'rgba(20, 50, 70, 0.3)';
  for (let i = 0; i < 100; i++) {
    const x = Math.random() * TEXTURE_SIZE;
    const y = Math.random() * TEXTURE_SIZE;
    const depthSize = Math.random() * 40 + 20;
    
    ctx.beginPath();
    ctx.ellipse(x, y, depthSize, depthSize * 0.5, Math.random() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  
  // Add surface reflection highlights
  ctx.fillStyle = 'rgba(150, 180, 200, 0.15)';
  for (let i = 0; i < 100; i++) {
    const x = Math.random() * TEXTURE_SIZE;
    const y = Math.random() * TEXTURE_SIZE;
    const highlightWidth = Math.random() * 20 + 5;
    const highlightHeight = Math.random() * 3 + 1;
    
    ctx.beginPath();
    ctx.ellipse(x, y, highlightWidth, highlightHeight, Math.random() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  
  // Save
  const buffer = canvas.toBuffer('image/png');
  fs.writeFileSync(path.join(OUTPUT_DIR, 'water_texture.png'), buffer);
  console.log('✅ water_texture.png generated');
}

/**
 * Генерация текстуры стены (каменные блоки со мхом)
 */
function generateWallTexture() {
  console.log('🎨 Generating wall texture...');
  
  const canvas = createCanvas(TEXTURE_SIZE, TEXTURE_SIZE);
  const ctx = canvas.getContext('2d');
  const blockSize = 64;
  
  // Base layer - mortar
  ctx.fillStyle = '#3a3a3a';
  ctx.fillRect(0, 0, TEXTURE_SIZE, TEXTURE_SIZE);
  
  // Draw stone blocks
  for (let y = 0; y < TEXTURE_SIZE; y += blockSize) {
    const offset = (y / blockSize) % 2 === 0 ? 0 : blockSize / 2;
    
    for (let x = -blockSize; x < TEXTURE_SIZE; x += blockSize) {
      // Stone base color with variation
      const stoneShade = Math.random() * 20 - 10;
      const stoneColor = `rgb(${80 + stoneShade}, ${70 + stoneShade}, ${65 + stoneShade})`;
      
      ctx.fillStyle = stoneColor;
      ctx.fillRect(x + offset + 2, y + 2, blockSize - 4, blockSize - 4);
      
      // Add stone texture
      for (let i = 0; i < 50; i++) {
        const tx = x + offset + Math.random() * blockSize;
        const ty = y + Math.random() * blockSize;
        ctx.fillStyle = `rgba(${60 + Math.random() * 30}, ${50 + Math.random() * 30}, ${45 + Math.random() * 30}, 0.5)`;
        ctx.beginPath();
        ctx.arc(tx, ty, Math.random() * 2 + 1, 0, Math.PI * 2);
        ctx.fill();
      }
      
      // Add cracks in stone
      ctx.strokeStyle = 'rgba(40, 35, 30, 0.6)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      let cx = x + offset + Math.random() * blockSize;
      let cy = y + Math.random() * blockSize;
      ctx.moveTo(cx, cy);
      for (let j = 0; j < 5; j++) {
        cx += (Math.random() - 0.5) * 20;
        cy += (Math.random() - 0.5) * 20;
        ctx.lineTo(cx, cy);
      }
      ctx.stroke();
      
      // Add moss on edges
      if (Math.random() > 0.5) {
        ctx.fillStyle = 'rgba(74, 90, 58, 0.4)';
        ctx.beginPath();
        ctx.arc(x + offset + Math.random() * blockSize, y + Math.random() * blockSize, Math.random() * 15 + 5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  
  // Add mortar lines
  ctx.strokeStyle = '#2a2a2a';
  ctx.lineWidth = 3;
  ctx.strokeRect(0, 0, TEXTURE_SIZE, TEXTURE_SIZE);
  
  // Add weathering
  ctx.fillStyle = 'rgba(30, 30, 30, 0.3)';
  for (let i = 0; i < 200; i++) {
    const x = Math.random() * TEXTURE_SIZE;
    const y = Math.random() * TEXTURE_SIZE;
    ctx.beginPath();
    ctx.arc(x, y, Math.random() * 5 + 2, 0, Math.PI * 2);
    ctx.fill();
  }
  
  // Save
  const buffer = canvas.toBuffer('image/png');
  fs.writeFileSync(path.join(OUTPUT_DIR, 'wall_texture.png'), buffer);
  console.log('✅ wall_texture.png generated');
}

// Main
console.log('🎨 Pudge Wars Texture Generator\n');
console.log('Generating textures in style of Warcraft 3...\n');

try {
  generateGroundTexture();
  generateWaterTexture();
  generateWallTexture();
  
  console.log('\n✅ All textures generated successfully!');
  console.log(`📁 Output directory: ${OUTPUT_DIR}`);
  console.log('\n📝 Files created:');
  console.log('   - ground_texture.png (512x512)');
  console.log('   - water_texture.png (512x512)');
  console.log('   - wall_texture.png (512x512)');
  console.log('\n🚀 To use: commit and push to Render');
} catch (error) {
  console.error('❌ Error generating textures:', error.message);
  process.exit(1);
}
