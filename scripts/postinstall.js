/**
 * Postinstall script - generates textures if not exist
 */
const fs = require('fs');
const path = require('path');

const assetsDir = path.join(__dirname, '..', 'assets');
const textureFiles = ['ground_texture.png', 'water_texture.png', 'wall_texture.png'];

// Check if textures exist
const missingTextures = textureFiles.filter(file => {
  return !fs.existsSync(path.join(assetsDir, file));
});

if (missingTextures.length > 0) {
  console.log('🎨 Missing textures detected, generating...');
  
  const { exec } = require('child_process');
  
  exec('npm run generate-textures', (error, stdout, stderr) => {
    if (error) {
      console.warn('⚠️  Could not generate textures automatically.');
      console.warn('   Run "npm run generate-textures" manually.');
      return;
    }
    console.log('✅ Textures generated successfully!');
    console.log(stdout);
  });
} else {
  console.log('✅ All textures already exist, skipping generation.');
}
