const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

let WebSocketServer;
let WebcastPushConnection;

try {
  WebSocketServer = require('ws').WebSocketServer;
} catch (e) {
  console.warn('⚠️ Pacote "ws" ainda não instalado. Rode: npm install');
}

try {
  WebcastPushConnection = require('tiktok-live-connector').WebcastPushConnection;
} catch (e) {
  console.warn('⚠️ Pacote "tiktok-live-connector" ainda não instalado. Rode: npm install');
}

const PORT = process.env.PORT || 3000;

const server = http.createServer((req, res) => {
  const filePath = path.join(__dirname, 'index.html');
  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(500);
      res.end('Erro ao carregar index.html');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
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

  function connectToTikTok(username) {
    if (!WebcastPushConnection) {
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
    tiktokConnection = new WebcastPushConnection(cleanUser);

    broadcast({
      type: 'status',
      connected: false,
      message: `Conectando à live de @${cleanUser}...`
    });

    tiktokConnection
      .connect()
      .then((state) => {
        console.log(`✅ Conectado à Live de @${cleanUser} (Room ID: ${state.roomId})`);
        broadcast({
          type: 'status',
          connected: true,
          username: cleanUser,
          viewerCount: state.viewerCount || 0,
          message: `LIVE CONECTADA: @${cleanUser}`
        });
      })
      .catch((err) => {
        console.error('❌ Erro ao conectar na live:', err.message);
        broadcast({
          type: 'status',
          connected: false,
          message: `Erro ao conectar em @${cleanUser}: Verifique se a conta está em LIVE agora.`
        });
      });

    // Comentários do Chat
    tiktokConnection.on('chat', (data) => {
      const comment = (data.comment || '').trim();
      const user = data.uniqueId || data.nickname || 'torcedor';
      broadcast({
        type: 'chat',
        user,
        comment
      });
    });

    // Presentes (Gifts)
    tiktokConnection.on('gift', (data) => {
      if (data.giftType === 1 && !data.repeatEnd) return;
      const user = data.uniqueId || data.nickname || 'torcedor';
      const giftName = (data.giftName || '').toLowerCase();
      const diamondCount = data.diamondCount || 1;

      broadcast({
        type: 'gift',
        user,
        giftName,
        diamondCount,
        repeatCount: data.repeatCount || 1
      });
    });

    // Curtidas (Likes)
    tiktokConnection.on('like', (data) => {
      const user = data.uniqueId || data.nickname || 'torcedor';
      broadcast({
        type: 'like',
        user,
        likeCount: data.likeCount || 1,
        totalLikeCount: data.totalLikeCount || 0
      });
    });

    // Audiência
    tiktokConnection.on('roomUser', (data) => {
      broadcast({
        type: 'viewers',
        viewerCount: data.viewerCount || 0
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
  console.log('🦅 CORRIDA MALUCA: URUBU DO FLOW vs PORCO (TIKTOK LIVE)');
  console.log('======================================================');
  console.log(`💻 Abra no Mac:     http://localhost:${PORT}`);
  console.log(`📱 Abra no Celular: http://${ip}:${PORT}`);
  console.log('======================================================\n');
});
