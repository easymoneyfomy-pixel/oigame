# 🥩 PUDGE WARS - AAA EDITION

**Do You Wanna Jam 2024 Submission**

## 🎮 GAME DESCRIPTION

Pudge Wars is a 5v5 team battle game where each player controls Pudge with 5 unique abilities. Fight across a divided arena with an uncrossable river. The team with the most kills wins!

## 🚀 HOW TO PLAY

### Launch the Game
1. Open browser: **http://localhost:8080**
2. Click **"⚔️ START BATTLE ⚔️"**
3. Join the battle!

### Controls
| Key | Ability | Description | Cooldown |
|-----|---------|-------------|----------|
| **RMB** | Move | Right-click to move | - |
| **Q** | 🪝 Meat Hook | Pull enemies to you (150 damage) | 12s |
| **W** | 💨 Phase Shift | Become invisible for 1.5s (dodge all projectiles) | 18s |
| **E** | 🕸️ Earthbind | Root enemy for 2 seconds | 16s |
| **R** | ⚡ Blink | Teleport to target location | 8s |
| **T** | 🔄 Rearm | **RESET ALL COOLDOWNS!** | 60s |
| **SPACE** | Camera | Center camera on Pudge | - |

## 🏆 GAME FEATURES

### AAA Graphics
- ✨ Enhanced particle effects (60-70 particles per effect)
- 🌊 Animated river with waves
- 💫 Glowing abilities and UI elements
- 🎨 Smooth animations and transitions
- 📊 Polished score board and health bars

### 5 Unique Abilities
1. **Meat Hook (Q)** - Skill shot that pulls enemies to you
2. **Phase Shift (W)** - Become invisible and dodge attacks
3. **Earthbind (E)** - Area root that immobilizes enemies
4. **Blink (R)** - Instant teleportation
5. **Rearm (T)** - Reset ALL ability cooldowns instantly!

### Game Mechanics
- 5v5 team battles
- Radiant vs Dire teams
- First to most kills wins
- 7 minute match duration
- Respawn time: 5 seconds
- Gold per kill: 150

## 📁 FILES

```
server.js       - Game server (64 TPS, WebSocket)
game.js         - Client game logic
index_jam.html  - Game client (AAA UI)
package.json    - Dependencies (ws)
```

## 🛠️ INSTALLATION

### Requirements
- Node.js 18+ 
- Modern browser (Chrome, Firefox, Edge)

### Install Dependencies
```bash
npm install
```

### Run Server
```bash
npm start
```

Or directly:
```bash
node server.js
```

### Development Mode
```bash
npm run dev
```

## 🌐 ENDPOINTS

- **Game:** http://localhost:8080/
- **Health:** http://localhost:8080/health
- **Stats:** http://localhost:8080/api/stats

## 🎯 GAME TIPS

### Offense
- Use **Meat Hook** to initiate fights
- **Earthbind** prevents enemies from escaping
- **Rearm** + **Hook** = Double hook combo!

### Defense
- **Phase Shift** dodges hooks and projectiles
- **Blink** over river to escape
- Use **Rearm** to reset Phase Shift cooldown

### Pro Combos
1. **Hook + Earthbind** - Pull and root enemy
2. **Blink + Hook** - Surprise engage
3. **Rearm + All abilities** - Full combo reset
4. **Phase + Blink** - Safe escape

## 🏅 SCORING

- **Kill:** +150 gold, +500 XP
- **Assist:** +50 gold
- **Flesh Heap:** +STR per kill (passive)

## ⚙️ SERVER CONFIG

```javascript
PORT: 8080
TICK_RATE: 64 TPS
FIELD_SIZE: 2000x2000
MATCH_DURATION: 420000ms (7 min)
RESPAWN_TIME: 5000ms (5 sec)
```

## 🎨 ABILITY VALUES

### Meat Hook (Q)
- Range: 1200
- Speed: 32
- Damage: 150 (pure)
- Mana Cost: 120
- Cooldown: 12s

### Phase Shift (W)
- Duration: 1.5s
- Mana Cost: 80
- Cooldown: 18s

### Earthbind (E)
- Range: 900
- Radius: 200
- Root Duration: 2s
- Mana Cost: 100
- Cooldown: 16s

### Blink (R)
- Range: 800
- Mana Cost: 60
- Cooldown: 8s

### Rearm (T)
- Resets: ALL abilities
- Mana Cost: 200
- Cooldown: 60s

## 🐛 TROUBLESHOOTING

### Server won't start
```bash
# Check Node.js version
node --version

# Reinstall dependencies
npm install

# Check for port conflicts
netstat -ano | findstr :8080
```

### Can't connect
1. Make sure server is running
2. Check firewall settings
3. Try http://127.0.0.1:8080

### Game lagging
1. Close other browser tabs
2. Lower browser hardware acceleration
3. Check server tick rate: http://localhost:8080/health

## 📝 VERSION HISTORY

### AAA Edition (Current)
- ✨ Enhanced graphics and effects
- 🎨 Polished UI with animations
- 💫 Smooth particle systems
- 🌊 Animated river
- 🎯 Improved gameplay mechanics

## 🎓 CREDITS

- **Game Design:** Based on Pudge Wars from Warcraft 3
- **Characters:** Dota 2 (Valve Corporation)
- **Audio:** Dota 2 sound effects
- **Art:** Original pixel art

## 📜 LICENSE

MIT License - Free for educational and personal use

## 🎮 ENJOY THE GAME!

**Good luck and have fun!** 🥩⚔️

---
*Made for Do You Wanna Jam 2024*
