const express = require('express');
const path = require('path');
const WebSocket = require('ws');

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ─── CẤU HÌNH ────────────────────────────────────────────────
const DEFAULT_WEBHOOK = "https://discord.com/api/webhooks/1563219916503392328/zoeP56iy_2kXQPOTFpfNbxvmr-NmjsFw8pKQh5D7ZRbkemRZOt3OOwMqGLyiRA8F4LKU";
const REQUEST_TIMEOUT = 15000;

// ─── STATE MANAGEMENT ────────────────────────────────────────
const activeTasks = new Map();
const activeRPCs = new Map(); // Lưu trữ các kết nối WebSocket Gateway

// ─── HELPER: FETCH VỚI TIMEOUT (Native Node 18+) ─────────────
async function fetchWithTimeout(url, options = {}, timeout = REQUEST_TIMEOUT) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);
    try {
        return await globalThis.fetch(url, { ...options, signal: controller.signal });
    } finally {
        clearTimeout(id);
    }
}

// =================================================================
// ─── 1. DISCORD GATEWAY CLIENT (Dùng cho Fake RPC) ─────────────
// =================================================================
class DiscordGateway {
    constructor(token, logCallback) {
        this.token = token;
        this.log = logCallback;
        this.ws = null;
        this.heartbeatInterval = null;
        this.seq = 0;
    }

    connect(initialActivity) {
        this.ws = new WebSocket('wss://gateway.discord.gg/?v=9&encoding=json');
        
        this.ws.on('open', () => {
            this.log("🔌 Đã kết nối đến Discord Gateway...");
            this.identify(initialActivity); // Gửi Token + RPC ngay lúc kết nối
        });

        this.ws.on('message', (data) => {
            try {
                const payload = JSON.parse(data);
                this.handleMessage(payload);
            } catch (e) {}
        });

        this.ws.on('close', () => {
            this.log("⚠️ Mất kết nối Gateway.");
            this.cleanup();
        });

        this.ws.on('error', (err) => {
            this.log(`❌ Lỗi Gateway: ${err.message}`);
        });
    }

    handleMessage(payload) {
        const { op, d, s } = payload;
        if (s) this.seq = s;

        if (op === 10) { // Hello
            this.log("🤖 Nhận Hello, bắt đầu giữ kết nối (Heartbeat)...");
            this.startHeartbeat(d.heartbeat_interval);
        } else if (op === 11) { // Heartbeat ACK
            // OK
        } else if (op === 9) { // Invalid Session
            this.log("❌ Token sai hoặc phiên không hợp lệ!");
            this.cleanup();
        } else if (op === 7) { // Reconnect
            this.ws.close();
        }
    }

    startHeartbeat(interval) {
        this.heartbeatInterval = setInterval(() => {
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                this.ws.send(JSON.stringify({ op: 1, d: this.seq }));
            }
        }, interval);
    }

    identify(activity) {
        const payload = {
            op: 2,
            d: {
                token: this.token,
                intents: 0, // Không cần nhận event, chỉ gửi status
                properties: {
                    os: "Windows",
                    browser: "Discord Client",
                    device: ""
                },
                presence: {
                    status: "online",
                    since: 0,
                    activities: [activity], // Gắn RPC vào ngay lúc Identify
                    afk: false
                }
            }
        };
        this.ws.send(JSON.stringify(payload));
        this.log(`🎭 Đã gửi lệnh Fake RPC: ${activity.name || activity.state}`);
    }

    cleanup() {
        if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
        if (this.ws) this.ws.terminate();
    }
}

// =================================================================
// ─── 2. AUTOQUEST WORKER ─────────────────────────────────────
// =================================================================
async function runAutoQuest(taskId, token, webhookUrl, logCallback) {
    const headers = { 'Authorization': token, 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0' };
    try {
        logCallback("🔍 Đang lấy danh sách Quest...");
        const questRes = await fetchWithTimeout('https://discord.com/api/v9/quests/@me', { headers });
        if (!questRes.ok) throw new Error(`Lấy quest thất bại: ${questRes.status}`);
        
        const data = await questRes.json();
        const quests = data.quests || (Array.isArray(data) ? data : []);
        const targetQuest = quests.find(q => !q.userStatus?.completedAt && !q.userStatus?.enrolledAt);

        if (!targetQuest) return logCallback("✅ Không có quest mới nào!");

        const qid = targetQuest.id;
        const qName = targetQuest.config?.messages?.questName || `Quest #${qid}`;
        logCallback(`📌 Phát hiện quest: ${qName}`);

        await fetchWithTimeout(`https://discord.com/api/v9/quests/${qid}/enroll`, { method: 'POST', headers, body: JSON.stringify({ location: 11 }) });
        
        for (let i = 1; i <= 5; i++) {
            if (!activeTasks.has(taskId)) return logCallback("⏹️ Đã dừng bởi người dùng.");
            await fetchWithTimeout(`https://discord.com/api/v9/quests/${qid}/video-progress`, {
                method: 'POST', headers, body: JSON.stringify({ timestamp: Math.floor(Date.now() / 1000) - (i * 600) })
            });
            logCallback(`🔄 Tiến độ: ${(i / 5 * 100).toFixed(0)}%`);
            await new Promise(r => setTimeout(r, 3000));
        }
        logCallback("🎉 Hoàn thành Quest!");
    } catch (err) { logCallback(`❌ Lỗi: ${err.message}`); } 
    finally { activeTasks.delete(taskId); }
}

// =================================================================
// ─── 3. AUTOBADGE WORKER (Cloud Fallback) ────────────────────
// =================================================================
async function runAutoBadge(taskId, token, cookie, gameId, hours, logCallback) {
    try {
        logCallback("🎮 Bắt đầu AutoBadge...");
        const durationMs = Math.floor(hours * 3600 * 1000);
        const now = Date.now();
        const sessionId = require('crypto').randomUUID();
        
        const meRes = await fetchWithTimeout('https://discord.com/api/v9/users/@me?with_analytics_token=true', {
            headers: { 'Authorization': token, 'User-Agent': 'Mozilla/5.0' }
        });
        if (!meRes.ok) throw new Error("Token sai");
        const analyticsToken = (await meRes.json()).analytics_token;

        const events = [
            { type: "running_game_heartbeat", properties: { client_track_timestamp: now - durationMs, client_heartbeat_session_id: sessionId, event_sequence_number: 1, game_id: gameId, initial_heartbeat: true, final_heartbeat: false, duration_tracked_ms: 0 } },
            { type: "launch_game", properties: { client_track_timestamp: now - durationMs + 1000, client_heartbeat_session_id: sessionId, event_sequence_number: 2, game_id: gameId, verified: true } },
            { type: "running_game_heartbeat", properties: { client_track_timestamp: now, client_heartbeat_session_id: sessionId, event_sequence_number: 3, game_id: gameId, initial_heartbeat: false, final_heartbeat: true, duration_tracked_ms: durationMs } }
        ];

        const res = await fetchWithTimeout('https://discord.com/api/v9/science', {
            method: 'POST',
            headers: { 'Authorization': token, 'Cookie': cookie || '', 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0' },
            body: JSON.stringify({ token: analyticsToken, events })
        });

        if (res.status === 204) logCallback("✅ Gửi tín hiệu AutoBadge thành công!");
        else logCallback(`⚠️ Discord phản hồi: ${res.status}`);
    } catch (err) { logCallback(`❌ Lỗi AutoBadge: ${err.message}`); } 
    finally { activeTasks.delete(taskId); }
}

// =================================================================
// ─── API ROUTES ──────────────────────────────────────────────
// =================================================================
app.post('/api/start-quest', async (req, res) => {
    const { token, webhook } = req.body;
    if (!token) return res.status(400).json({ error: 'Thiếu token' });
    const taskId = Date.now().toString();
    activeTasks.set(taskId, true);
    runAutoQuest(taskId, token, webhook, (msg) => console.log(`[Quest] ${msg}`));
    res.json({ ok: true });
});

app.post('/api/start-badge', async (req, res) => {
    const { token, cookie, gameId, hours } = req.body;
    if (!token || !gameId) return res.status(400).json({ error: 'Thiếu thông tin' });
    const taskId = Date.now().toString();
    activeTasks.set(taskId, true);
    runAutoBadge(taskId, token, cookie, gameId, hours, (msg) => console.log(`[Badge] ${msg}`));
    res.json({ ok: true });
});

app.post('/api/start-rpc', (req, res) => {
    const { token, rpcData } = req.body;
    if (!token) return res.status(400).json({ error: 'Thiếu token' });
    
    const taskId = `rpc_${Date.now()}`;
    const logCallback = (msg) => console.log(`[RPC] ${msg}`);
    
    // Build Activity Payload
    let activity;
    if (rpcData.type === 'status') {
        activity = { name: "Custom Status", type: 4, state: rpcData.state || "Đang rảnh" };
    } else {
        activity = {
            name: rpcData.name || "Fake Game", type: 0,
            details: rpcData.details, state: rpcData.state,
            timestamps: { start: Date.now() },
            assets: { large_image: rpcData.large_image, large_text: rpcData.large_text, small_image: rpcData.small_image, small_text: rpcData.small_text },
            buttons: []
        };
        if (rpcData.btn1_label && rpcData.btn1_url) activity.buttons.push({ label: rpcData.btn1_label, url: rpcData.btn1_url });
        if (rpcData.btn2_label && rpcData.btn2_url) activity.buttons.push({ label: rpcData.btn2_label, url: rpcData.btn2_url });
    }

    const gateway = new DiscordGateway(token, logCallback);
    activeRPCs.set(taskId, gateway);
    gateway.connect(activity);
    
    res.json({ ok: true, taskId });
});

app.post('/api/stop', (req, res) => {
    let count = 0;
    activeTasks.clear();
    activeRPCs.forEach((gw) => { gw.cleanup(); count++; });
    activeRPCs.clear();
    res.json({ ok: true, message: `Đã dừng ${count} tác vụ.` });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
