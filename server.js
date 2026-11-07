const express = require('express');
const WebSocket = require('ws');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

let activeSocket = null;
let heartbeatTimer = null;
let rotateTimer = null;
let isQuestRunning = false;

function stopCurrentSocket() {
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  if (rotateTimer) clearInterval(rotateTimer);
  if (activeSocket) {
    try { activeSocket.terminate(); } catch(e){}
    activeSocket = null;
  }
}

// ==========================================
// PHẦN 1: FAKE RPC (WebSocket)
// ==========================================
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
  
  const buildActivity = () => {
    let actName = (data.name || '').trim() || 'Visual Studio Code';
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
      act.assets.large_image = data.largeImage;
      act.assets.large_text = actName;
    }
    if (isDirectImage(data.smallImage)) {
      act.assets.small_image = data.smallImage;
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
          presence: { status: data.status || 'online', since: 0, activities: [buildActivity()], afk: false }
        }
      }));
      if (!res.headersSent) res.json({ ok: true, msg: 'Đã kết nối RPC' });
    }
    
    if (pkt.t === 'READY') {
      ws.send(JSON.stringify({ op: 3, d: { since: 0, activities: [buildActivity()], status: data.status || 'online', afk: false } }));
    }
    if (pkt.op === 9) stopCurrentSocket();
  });

  ws.on('close', () => { clearInterval(heartbeatTimer); clearInterval(rotateTimer); });
  ws.on('error', (err) => { stopCurrentSocket(); if (!res.headersSent) res.status(500).json({ error: err.message }); });
});

app.post('/api/stop', (req, res) => {
  stopCurrentSocket();
  res.json({ ok: true });
});

app.get('/api/status', (req, res) => {
  res.json({ online: activeSocket && activeSocket.readyState === WebSocket.OPEN });
});

// ==========================================
// PHẦN 2: AUTOQUEST (Dùng Fetch của Node)
// ==========================================
const getQuestHeaders = (token) => {
  const sp = Buffer.from(JSON.stringify({
    os: "Windows", browser: "Discord Client", release_channel: "stable", client_version: "1.0.9175",
    os_version: "10.0.26100", os_arch: "x64", app_arch: "x64", system_locale: "en-US",
    browser_user_agent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) discord/1.0.9175 Chrome/128.0.6613.186 Electron/32.2.7 Safari/537.36",
    browser_version: "32.2.7", client_build_number: 504649, native_build_number: 59498, client_event_source: null
  })).toString('base64');
  
  return {
    "Authorization": token,
    "Content-Type": "application/json",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) discord/1.0.9175 Chrome/128.0.6613.186 Electron/32.2.7 Safari/537.36",
    "X-Super-Properties": sp,
    "Origin": "https://discord.com",
    "Referer": "https://discord.com/channels/@me"
  };
};

async function runAutoQuest(token) {
  if (isQuestRunning) {
    console.log("[Quest] Đang chạy tiến trình khác, bỏ qua...");
    return;
  }
  isQuestRunning = true;
  console.log("[Quest] Bắt đầu AutoQuest cho token:", token.substring(0, 15) + "...");
  
  const headers = getQuestHeaders(token);
  
  try {
    // 1. Lấy danh sách quest
    const res = await fetch("https://discord.com/api/v9/quests/@me", { headers });
    if (res.status !== 200) {
      console.log("[Quest] Lỗi lấy quest, có thể token die.");
      isQuestRunning = false;
      return;
    }
    const data = await res.json();
    const quests = Array.isArray(data) ? data : data.quests || [];
    
    for (const q of quests) {
      if (q.userStatus?.completedAt) continue; // Đã xong
      
      const qid = q.id;
      const name = q.config?.messages?.questName || q.config?.messages?.gameTitle || "Quest ẩn danh";
      const taskConfig = q.config?.taskConfig || q.config?.taskConfigV2 || {};
      const tasks = taskConfig.tasks || {};
      const taskType = Object.keys(tasks).find(t => ["WATCH_VIDEO", "PLAY_ON_DESKTOP", "STREAM_ON_DESKTOP", "PLAY_ACTIVITY"].includes(t));
      
      if (!taskType) continue;
      
      // 2. Enroll nếu chưa nhận
      if (!q.userStatus?.enrolledAt) {
        console.log(`[Quest] Đang nhận quest: ${name}`);
        await fetch(`https://discord.com/api/v9/quests/${qid}/enroll`, {
          method: 'POST', headers, body: JSON.stringify({ location: 11, is_targeted: false })
        });
        await new Promise(r => setTimeout(r, 2000));
      }

      // 3. Làm quest (Chỉ fake được WATCH_VIDEO)
      if (taskType === "WATCH_VIDEO") {
        let needed = tasks[taskType]?.target || 0;
        let done = q.userStatus?.progress?.[taskType]?.value || 0;
        
        console.log(`[Quest] Bắt đầu cày video: ${name} (${done}/${needed}s)`);
        let timeout = 0;
        
        while (done < needed && timeout < 100) {
          const timestamp = Math.min(needed, done + 7 + Math.random());
          const vRes = await fetch(`https://discord.com/api/v9/quests/${qid}/video-progress`, {
            method: 'POST', headers, body: JSON.stringify({ timestamp })
          });
          
          if (vRes.status === 200) {
            const vData = await vRes.json();
            if (vData.completed_at) break;
            done = timestamp;
          }
          await new Promise(r => setTimeout(r, 1000));
          timeout++;
        }
        console.log(`[Quest] Xong quest video: ${name}`);
      } else {
        console.log(`[Quest] Bỏ qua ${name} vì yêu cầu bật app (không fake được).`);
      }
    }
  } catch (err) {
    console.log("[Quest] Lỗi:", err.message);
  } finally {
    isQuestRunning = false;
    console.log("[Quest] Đã chạy xong chu trình AutoQuest.");
  }
}

app.post('/api/autoquest', (req, res) => {
  const token = req.body.token;
  if (!token) return res.status(400).json({ ok: false, msg: 'Thiếu token' });
  
  // Chạy ngầm, không bắt web phải chờ (tránh bị timeout 10s của Render)
  runAutoQuest(token); 
  
  res.json({ ok: true, msg: 'Đã bắt đầu AutoQuest, xem log Render để biết kết quả.' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
