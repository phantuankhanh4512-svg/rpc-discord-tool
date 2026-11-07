const express = require('express');
const WebSocket = require('ws');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

let activeSocket = null;
let heartbeatTimer = null;
let rotateTimer = null;

function stopCurrentSocket() {
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  if (rotateTimer) clearInterval(rotateTimer);
  if (activeSocket) {
    try { activeSocket.terminate(); } catch(e){}
    activeSocket = null;
  }
}

app.post('/api/start', (req, res) => {
  stopCurrentSocket(); 
  
  const data = req.body;
  if (!data.token) return res.status(400).json({ error: 'Thiếu token' });

  const ws = new WebSocket('wss://gateway.discord.gg/?v=10&encoding=json');
  activeSocket = ws;
  let seq = null;
  let idx = 0;

  let fakeStartTime = Date.now();
  if (data.hours && parseInt(data.hours) > 0) {
      const offset = parseInt(data.hours) * 3600 * 1000;
      const calcTime = Date.now() - offset;
      if (calcTime > 0) fakeStartTime = calcTime;
  }

  const states = data.states && data.states.length > 0 ? data.states : [''];
  
  const cleanUrl = (url) => {
    if (!url) return undefined;
    return url.split('?')[0]; 
  };

  const buildActivity = () => {
    let actName = (data.name || '').trim();
    if (!actName) actName = 'Visual Studio Code';

    let act = {
      name: actName,
      type: parseInt(data.type) || 0,
      timestamps: { start: fakeStartTime },
      instance: false
    };

    if (data.details && data.details.trim()) act.details = data.details.trim();
    const currentState = states[idx % states.length];
    if (currentState && currentState.trim()) act.state = currentState.trim();
    
    act.assets = {};
    const isDirectImage = (url) => url && /^https?:\/\//i.test(url) && /\.(jpeg|jpg|gif|png|webp)/i.test(url);
    
    if (isDirectImage(data.largeImage)) {
      act.assets.large_image = cleanUrl(data.largeImage);
      act.assets.large_text = actName;
    }
    if (isDirectImage(data.smallImage)) {
      act.assets.small_image = cleanUrl(data.smallImage);
    }
    if (Object.keys(act.assets).length === 0) delete act.assets;

    let btns = [];
    const isValidUrl = (url) => url && (url.startsWith('https://') || url.startsWith('http://'));
    if (data.btn1 && data.btn1.label && data.btn1.label.trim() && isValidUrl(data.btn1.url)) {
        btns.push({ label: data.btn1.label.trim(), url: data.btn1.url.trim() });
    }
    if (data.btn2 && data.btn2.label && data.btn2.label.trim() && isValidUrl(data.btn2.url)) {
        btns.push({ label: data.btn2.label.trim(), url: data.btn2.url.trim() });
    }
    if (btns.length > 0) act.buttons = btns;

    return act;
  };

  ws.on('open', () => {
    if (states.length > 1) {
      rotateTimer = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          idx++;
          console.log(`[*] Đang đổi sang dòng: ${states[idx % states.length]}`);
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
      
      const currentAct = buildActivity();
      console.log("=> PAYLOAD LÚC BẮT ĐẦU:", JSON.stringify(currentAct, null, 2));

      ws.send(JSON.stringify({
        op: 2,
        d: {
          token: data.token,
          capabilities: 16381,
          properties: identifyProps,
          presence: {
            status: data.status || 'online',
            since: 0,
            activities: [currentAct],
            afk: false
          }
        }
      }));
      if (!res.headersSent) res.json({ ok: true, msg: 'Đã kết nối' });
    }
    
    if (pkt.t === 'READY') {
      ws.send(JSON.stringify({
          op: 3,
          d: { since: 0, activities: [buildActivity()], status: data.status || 'online', afk: false }
      }));
    }

    if (pkt.op === 9) {
      stopCurrentSocket();
    }
  });

  ws.on('close', () => {
    clearInterval(heartbeatTimer);
    clearInterval(rotateTimer);
  });
  
  ws.on('error', (err) => {
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
