const express = require('express');
const WebSocket = require('ws');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

let activeSocket = null;
let heartbeatTimer = null;
let rotateTimer = null;

app.post('/api/start', (req, res) => {
  const data = req.body;
  if (!data.token) return res.status(400).json({ error: 'Thiếu token' });
  
  if (activeSocket) {
    try { activeSocket.close(); } catch(e){}
    clearInterval(heartbeatTimer);
    clearInterval(rotateTimer);
  }

  const ws = new WebSocket('wss://gateway.discord.gg/?v=10&encoding=json');
  activeSocket = ws;
  let seq = null;
  let idx = 0;

  // Hàm build dữ liệu activity
  const buildActivity = () => {
    let act = {
      name: data.name || 'App',
      type: parseInt(data.type) || 0,
      details: data.details || '',
      state: data.states[idx % data.states.length] || '',
      timestamps: { start: data.hours > 0 ? Date.now() - (data.hours * 3600 * 1000) : Date.now() },
      assets: {
        large_image: data.largeImage || undefined,
        large_text: data.name || '',
        small_image: data.smallImage || undefined,
        small_text: data.details || ''
      },
      instance: false
    };

    // Chỉ thêm buttons nếu có nhập
    let btns = [];
    if (data.btn1 && data.btn1.label && data.btn1.url) btns.push({ label: data.btn1.label, url: data.btn1.url });
    if (data.btn2 && data.btn2.label && data.btn2.url) btns.push({ label: data.btn2.label, url: data.btn2.url });
    if (btns.length > 0) act.buttons = btns;

    return act;
  };

  ws.on('message', (raw) => {
    const pkt = JSON.parse(raw);
    if (pkt.s) seq = pkt.s;

    if (pkt.op === 10) {
      heartbeatTimer = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ op: 1, d: seq }));
      }, pkt.d.heartbeat_interval);

      const identifyProps = { os: data.platform || 'desktop', browser: 'Chrome', device: '' };
      
      ws.send(JSON.stringify({
        op: 2,
        d: {
          token: data.token,
          capabilities: 16381,
          properties: identifyProps,
          presence: {
            status: data.status || 'online',
            since: 0,
            activities: [buildActivity()],
            afk: false
          }
        }
      }));
      res.json({ ok: true, msg: 'Đã kết nối' });
    }
  });

  ws.on('open', () => {
    // Bắt đầu xoay vòng nếu có nhiều hơn 1 state
    if (data.states && data.states.length > 1) {
      rotateTimer = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          idx++;
          ws.send(JSON.stringify({
            op: 3,
            d: {
              since: 0,
              activities: [buildActivity()],
              status: data.status || 'online',
              afk: false
            }
          }));
        }
      }, (parseInt(data.delay) || 4) * 1000);
    }
  });

  ws.on('close', () => {
    clearInterval(heartbeatTimer);
    clearInterval(rotateTimer);
  });
  
  ws.on('error', (err) => {
    clearInterval(heartbeatTimer);
    clearInterval(rotateTimer);
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
    clearInterval(rotateTimer);
    activeSocket = null;
  }
  res.json({ ok: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
