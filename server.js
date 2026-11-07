const express = require('express');
const WebSocket = require('ws');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

let activeSocket = null;
let heartbeatTimer = null;
let rotateTimer = null;

// Hàm dọn dẹp sạch sẽ mọi kết nối cũ và timer
function stopCurrentSocket() {
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  if (rotateTimer) clearInterval(rotateTimer);
  if (activeSocket) {
    try { activeSocket.terminate(); } catch(e){}
    activeSocket = null;
  }
}

app.post('/api/start', (req, res) => {
  stopCurrentSocket(); // Dọn dẹp trước khi chạy cái mới
  
  const data = req.body;
  if (!data.token) return res.status(400).json({ error: 'Thiếu token' });

  const ws = new WebSocket('wss://gateway.discord.gg/?v=10&encoding=json');
  activeSocket = ws;
  let seq = null;
  let idx = 0;

  // TÍNH MỐC THỜI GIAN 1 LẦN DUY NHẤT (Fix lỗi reset giờ)
  const fakeStartTime = data.hours > 0 ? Date.now() - (data.hours * 3600 * 1000) : Date.now();

  const states = data.states && data.states.length > 0 ? data.states : [''];
  
  const buildActivity = () => {
    let act = {
      name: data.name || 'Visual Studio Code',
      type: parseInt(data.type) || 0,
      timestamps: { start: fakeStartTime }, // Dùng hằng số cố định
      instance: false
    };

    // Lọc dữ liệu rỗng để tránh lỗi Discord API
    if (data.details) act.details = data.details;
    if (states[idx % states.length]) act.state = states[idx % states.length];
    
    act.assets = {};
    if (data.largeImage) {
      act.assets.large_image = data.largeImage;
      act.assets.large_text = data.name || 'Image';
    }
    if (data.smallImage) {
      act.assets.small_image = data.smallImage;
      act.assets.small_text = 'Small';
    }
    if (Object.keys(act.assets).length === 0) delete act.assets;

    // Nút bấm
    let btns = [];
    if (data.btn1 && data.btn1.label && data.btn1.url) btns.push({ label: data.btn1.label, url: data.btn1.url });
    if (data.btn2 && data.btn2.label && data.btn2.url) btns.push({ label: data.btn2.label, url: data.btn2.url });
    if (btns.length > 0) act.buttons = btns;

    return act;
  };

  ws.on('open', () => {
    if (states.length > 1) {
      rotateTimer = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          idx++;
          ws.send(JSON.stringify({
            op: 3,
            d: { since: 0, activities: [buildActivity()], status: data.status || 'online', afk: false }
          }));
        }
      }, (parseInt(data.delay) || 4) * 1000);
    }
  });

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
      if (!res.headersSent) res.json({ ok: true, msg: 'Đã kết nối' });
    }
    
    if (pkt.op === 9) {
      console.log("Lỗi: Invalid Session (Token sai hoặc bị block).");
      stopCurrentSocket();
    }
  });

  ws.on('close', () => {
    clearInterval(heartbeatTimer);
    clearInterval(rotateTimer);
  });
  
  ws.on('error', (err) => {
    console.error("WS Error:", err.message);
    stopCurrentSocket();
    if (!res.headersSent) res.status(500).json({ error: err.message });
  });
});

app.get('/api/status', (req, res) => {
  const isOnline = activeSocket && activeSocket.readyState === WebSocket.OPEN;
  res.json({ online: !!isOnline });
});

app.post('/api/stop', (req, res) => {
  stopCurrentSocket();
  res.json({ ok: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
