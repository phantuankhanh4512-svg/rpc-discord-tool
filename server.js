const express = require('express');
const WebSocket = require('ws');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

let activeSocket = null;
let heartbeatTimer = null;

app.post('/api/start', (req, res) => {
  const { token, line1, line2, hours } = req.body;
  if (!token) return res.status(400).json({ error: 'Thiếu token' });
  
  if (activeSocket) {
    try { activeSocket.close(); } catch(e){}
    clearInterval(heartbeatTimer);
  }

  const startMs = hours > 0 ? Date.now() - (hours * 3600 * 1000) : Date.now();
  const ws = new WebSocket('wss://gateway.discord.gg/?v=10&encoding=json');
  activeSocket = ws;
  let seq = null;

  ws.on('message', (data) => {
    const pkt = JSON.parse(data);
    if (pkt.s) seq = pkt.s;

    if (pkt.op === 10) {
      heartbeatTimer = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ op: 1, d: seq }));
        }
      }, pkt.d.heartbeat_interval);

      ws.send(JSON.stringify({
        op: 2,
        d: {
          token: token,
          capabilities: 16381,
          properties: { os: 'Windows', browser: 'Chrome', device: '' },
          presence: {
            status: 'online',
            since: 0,
            activities: [{
              name: 'Visual Studio Code',
              type: 0,
              details: line1 || '💻 Coding',
              state: line2 || '🔥 24/7',
              timestamps: { start: startMs },
              assets: {
                large_image: 'https://raw.githubusercontent.com/microsoft/vscode/main/resources/linux/code.png',
                large_text: 'VS Code'
              }
            }],
            afk: false
          }
        }
      }));
      res.json({ ok: true, msg: 'Đã kết nối' });
    }
  });

  ws.on('close', () => clearInterval(heartbeatTimer));
  ws.on('error', (err) => {
    clearInterval(heartbeatTimer);
    try { res.status(500).json({ error: err.message }); } catch(e){}
  });
});

app.get('/api/status', (req, res) => {
  const isOnline = activeSocket && activeSocket.readyState === WebSocket.OPEN;
  res.json({ online: !!isOnline });
});

app.post('/api/stop', (req, res) => {
  if (activeSocket) {
    try { activeSocket.close(); } catch(e){}
    clearInterval(heartbeatTimer);
    activeSocket = null;
  }
  res.json({ ok: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));