const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

let WebSocketServer;
let LiveConnectionClass;

try {
  WebSocketServer = require('ws').WebSocketServer;
} catch (e) {
  console.warn('⚠️ Pacote "ws" ainda não instalado. Rode: npm install');
}

try {
  const tiktokPkg = require('tiktok-live-connector');
  LiveConnectionClass = tiktokPkg.TikTokLiveConnection || tiktokPkg.WebcastPushConnection;
} catch (e) {
  console.warn('⚠️ Pacote "tiktok-live-connector" ainda não instalado. Rode: npm install');
}

const PORT = process.env.PORT || 3000;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml'
};

const server = http.createServer((req, res) => {
  const safeUrl = (req.url || '/').split('?')[0];
  const relPath = safeUrl === '/' ? 'index.html' : safeUrl.replace(/^\/+/, '');
  const filePath = path.join(__dirname, path.basename(relPath));
  const ext = path.extname(filePath).toLowerCase();

  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404);
      res.end('Arquivo não encontrado');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
    res.end(content);
  });
});

let tiktokConnection = null;
let currentUsername = null;

if (WebSocketServer) {
  const wss = new WebSocketServer({ server });

  function broadcast(data) {
    const payload = JSON.stringify(data);
    wss.clients.forEach((client) => {
      if (client.readyState === 1) {
        client.send(payload);
      }
    });
  }

  function extractUsername(data) {
    if (!data) return 'torcedor';
    if (data.user && (data.user.uniqueId || data.user.nickname)) {
      return data.user.uniqueId || data.user.nickname;
    }
    return data.uniqueId || data.nickname || 'torcedor';
  }

  function connectToTikTok(username) {
    if (!LiveConnectionClass) {
      broadcast({
        type: 'status',
        connected: false,
        message: 'Instale as dependências com "npm install" para conectar ao TikTok.'
      });
      return;
    }

    const cleanUser = username.replace(/^@/, '').trim();
    if (!cleanUser) return;

    if (tiktokConnection) {
      try {
        tiktokConnection.disconnect();
      } catch (_) {}
    }

    currentUsername = cleanUser;
    tiktokConnection = new LiveConnectionClass(cleanUser, {});
    tiktokConnection.on('error', (err) => {
      console.error('⚠️ Aviso TikTok Live:', err && err.message ? err.message : err);
    });

    broadcast({
      type: 'status',
      connected: false,
      message: `Conectando à live de @${cleanUser}...`
    });

    tiktokConnection
      .connect()
      .then((state) => {
        console.log(`✅ Conectado à Live de @${cleanUser} (Room ID: ${state && state.roomId})`);
        broadcast({
          type: 'status',
          connected: true,
          username: cleanUser,
          viewerCount: (state && state.viewerCount) || 0,
          message: `LIVE CONECTADA: @${cleanUser}`
        });
      })
      .catch((err) => {
        console.error('❌ Erro ao conectar na live:', err && err.message ? err.message : err);
        broadcast({
          type: 'status',
          connected: false,
          message: `Não foi possível conectar em @${cleanUser}: Verifique se @${cleanUser} já está AO VIVO agora no TikTok.`
        });
      });

    tiktokConnection.on('chat', (data) => {
      const comment = (data && data.comment ? data.comment : '').trim();
      const user = extractUsername(data);
      broadcast({
        type: 'chat',
        user,
        comment
      });
    });

    tiktokConnection.on('gift', (data) => {
      if (data && data.giftType === 1 && !data.repeatEnd) return;
      const user = extractUsername(data);
      const giftName = (
        (data && data.giftDetails && data.giftDetails.giftName) ||
        (data && data.giftName) ||
        ''
      ).toLowerCase();
      const diamondCount =
        (data && data.giftDetails && data.giftDetails.diamondCount) ||
        (data && data.diamondCount) ||
        1;

      broadcast({
        type: 'gift',
        user,
        giftName,
        diamondCount,
        repeatCount: (data && data.repeatCount) || 1
      });
    });

    tiktokConnection.on('like', (data) => {
      const user = extractUsername(data);
      broadcast({
        type: 'like',
        user,
        likeCount: (data && data.likeCount) || 1,
        totalLikeCount: (data && data.totalLikeCount) || 0
      });
    });

    tiktokConnection.on('roomUser', (data) => {
      broadcast({
        type: 'viewers',
        viewerCount: (data && data.viewerCount) || 0
      });
    });
  }

  wss.on('connection', (ws) => {
    if (currentUsername && tiktokConnection) {
      ws.send(
        JSON.stringify({
          type: 'status',
          connected: true,
          username: currentUsername,
          message: `LIVE CONECTADA: @${currentUsername}`
        })
      );
    }

    ws.on('message', (msg) => {
      try {
        const data = JSON.parse(msg.toString());
        if (data.type === 'connect_tiktok' && data.username) {
          connectToTikTok(data.username);
        } else if (data.type === 'disconnect_tiktok') {
          if (tiktokConnection) {
            try {
              tiktokConnection.disconnect();
            } catch (_) {}
            tiktokConnection = null;
            currentUsername = null;
          }
          broadcast({
            type: 'status',
            connected: false,
            message: 'MODO SIMULAÇÃO / LOCAL'
          });
        }
      } catch (e) {
        console.error('Erro ao processar mensagem WS:', e);
      }
    });
  });
}

function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

server.listen(PORT, '0.0.0.0', () => {
  const ip = getLocalIP();
  console.log('\n======================================================');
  console.log('🏆 CORRIDA PELO BRASILEIRÃO: URUBU DO FLOW vs PORCO');
  console.log('======================================================');
  console.log(`💻 Abra no Mac:     http://localhost:${PORT}`);
  console.log(`📱 Abra no Celular: http://${ip}:${PORT}`);
  console.log('======================================================\n');
});
