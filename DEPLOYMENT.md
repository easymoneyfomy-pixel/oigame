# Deployment Guide

Инструкции по развёртыванию Pudge Wars на различных платформах.

## 📋 Требования

- Node.js >= 18.0.0
- npm или yarn
- 256 MB RAM минимум
- Открытый порт (по умолчанию 8080)

## 🚀 Render.com (Бесплатно)

### Автоматический деплой

1. Зарегистрируйтесь на [Render.com](https://render.com)
2. Создайте новый **Web Service**
3. Подключите ваш GitHub репозиторий
4. Настройте:
   - **Name**: pudge-wars
   - **Region**: Frankfurt (ближе к вам)
   - **Branch**: main
   - **Root Directory**: (оставьте пустым)
   - **Runtime**: Node
   - **Build Command**: `npm install`
   - **Start Command**: `node server.js`
   - **Instance Type**: Free

5. Нажмите **Create Web Service**

### Ручной деплой

```bash
# Установите Render CLI
npm install -g @render-cloud/cli

# Авторизация
render login

# Деплой
render deploy
```

### Конфигурация render.yaml

Файл `render.yaml` уже настроен:

```yaml
services:
  - type: web
    name: pudge-wars
    env: node
    buildCommand: npm install
    startCommand: node server.js
    plan: free
    region: frankfurt
    envVars:
      - key: NODE_ENV
        value: production
      - key: PORT
        value: 8080
```

## 🖥️ VPS (Ubuntu/Debian)

### 1. Подготовка сервера

```bash
# Обновление
sudo apt update && sudo apt upgrade -y

# Установка Node.js
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install -y nodejs

# Установка git
sudo apt install -y git
```

### 2. Клонирование проекта

```bash
git clone <repository-url> /var/www/pudge-wars
cd /var/www/pudge-wars
npm install
```

### 3. Настройка PM2

```bash
# Установка PM2
sudo npm install -g pm2

# Запуск приложения
pm2 start server.js --name pudge-wars

# Автозапуск при загрузке
pm2 startup
pm2 save
```

### 4. Настройка Nginx (опционально)

```bash
sudo apt install -y nginx

# Создание конфига
sudo nano /etc/nginx/sites-available/pudge-wars
```

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://localhost:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

```bash
# Включение сайта
sudo ln -s /etc/nginx/sites-available/pudge-wars /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

### 5. SSL сертификат (Let's Encrypt)

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com
```

## 🐳 Docker

### Dockerfile

Создайте `Dockerfile` в корне проекта:

```dockerfile
FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .

EXPOSE 8080

CMD ["node", "server.js"]
```

### Сборка и запуск

```bash
# Сборка образа
docker build -t pudge-wars .

# Запуск контейнера
docker run -d -p 8080:8080 --name pudge-wars pudge-wars
```

### Docker Compose

Создайте `docker-compose.yml`:

```yaml
version: '3.8'

services:
  pudge-wars:
    build: .
    ports:
      - "8080:8080"
    environment:
      - NODE_ENV=production
      - PORT=8080
    restart: unless-stopped
```

```bash
# Запуск
docker-compose up -d
```

## 🔧 Heroku

### 1. Установка Heroku CLI

```bash
# macOS
brew tap heroku/brew && brew install heroku

# Ubuntu
curl https://cli-assets.heroku.com/install.sh | sh
```

### 2. Деплой

```bash
# Авторизация
heroku login

# Создание приложения
heroku create pudge-wars

# Деплой
git push heroku main

# Открыть приложение
heroku open
```

## ⚙️ Настройка окружения

### Переменные окружения

Создайте `.env` файл (не коммитьте в git!):

```env
PORT=8080
NODE_ENV=production
```

### Безопасность

```bash
# Запретите доступ к .env
echo ".env" >> .gitignore

# Установите права доступа
chmod 600 .env
```

## 📊 Мониторинг

### PM2 Monitor

```bash
pm2 monit
```

### Логи

```bash
# PM2 логи
pm2 logs pudge-wars

# Systemd логи
journalctl -u pudge-wars -f
```

## 🔄 Обновление

```bash
# Pull изменений
git pull origin main

# Установка зависимостей
npm install

# Перезапуск
pm2 restart pudge-wars
```

## 🐛 Решение проблем

### Порт уже занят

```bash
# Найти процесс на порту
lsof -i :8080

# Убить процесс
kill -9 <PID>
```

### Недостаточно памяти

```bash
# Увеличьте swap
sudo fallocate -l 1G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
```

### Ошибки в логах

```bash
# Проверьте логи
pm2 logs pudge-wars --lines 100

# Проверьте статус
pm2 status
```

## 📈 Масштабирование

### Load Balancing с PM2

```bash
# Запуск нескольких инстансов
pm2 start server.js -i max --name pudge-wars
```

### Кластеризация

Для поддержки большего количества игроков используйте кластер:

```javascript
// В server.js
const cluster = require('cluster');
const os = require('os');

if (cluster.isMaster) {
  const cpus = os.cpus().length;
  for (let i = 0; i < cpus; i++) {
    cluster.fork();
  }
} else {
  // Запуск сервера
  require('./server');
}
```

## ✅ Чеклист перед деплоем

- [ ] Все тесты проходят (`npm test`)
- [ ] `.env` файл настроен
- [ ] `.gitignore` содержит чувствительные данные
- [ ] Версия в `package.json` обновлена
- [ ] CHANGELOG обновлён
- [ ] Логи настроены
- [ ] Мониторинг настроен
- [ ] Бэкапы настроены

## 📞 Поддержка

При возникновении проблем:

1. Проверьте логи
2. Погуглите ошибку
3. Создайте issue на GitHub
4. Обратитесь в сообщество

Успешного деплоя! 🚀
