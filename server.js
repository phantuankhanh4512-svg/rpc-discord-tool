const express = require('express');
const path = require('path');

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ─── CẤU HÌNH ────────────────────────────────────────────────
const DEFAULT_WEBHOOK = "https://discord.com/api/webhooks/1563219916503392328/zoeP56iy_2kXQPOTFpfNbxvmr-NmjsFw8pKQh5D7ZRbkemRZOt3OOwMqGLyiRA8F4LKU";
const GAMES_CDN_URL = "https://cdn.discordapp.com/detectables/games.json";
const REQUEST_TIMEOUT = 15000;

// ─── STATE MANAGEMENT ────────────────────────────────────────
const activeTasks = new Map();
let cachedGames = null;
let lastGamesFetch = 0;

// ─── HELPER: FETCH VỚI TIMEOUT ───────────────────────────────
async function fetchWithTimeout(url, options = {}, timeout = REQUEST_TIMEOUT) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);
    try {
        const response = await globalThis.fetch(url, { ...options, signal: controller.signal });
        return response;
    } finally {
        clearTimeout(id);
    }
}

// ─── HELPER: GỬI WEBHOOK ─────────────────────────────────────
async function sendQuestWebhook(token, questName, webhookUrl) {
    try {
        const userRes = await fetchWithTimeout('https://discord.com/api/v9/users/@me', {
            headers: { 'Authorization': token, 'User-Agent': 'Mozilla/5.0' }
        });
        if (!userRes.ok) throw new Error('Token không hợp lệ');
        const user = await userRes.json();

        const embed = {
            title: "🎉 Hoàn thành Quest Discord!",
            description: `**Nhiệm vụ:** ${questName}\n**Người thực hiện:** <@${user.id}> (${user.username})`,
            color: 0x2ecc71,
            timestamp: new Date().toISOString(),
            footer: { text: "AutoQuest System" }
        };

        await fetchWithTimeout(webhookUrl || DEFAULT_WEBHOOK, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ embeds: [embed] })
        });
        return true;
    } catch (err) {
        console.error("Webhook Error:", err.message);
        return false;
    }
}

// ─── AUTOQUEST WORKER ────────────────────────────────────────
async function runAutoQuest(taskId, token, webhookUrl, logCallback) {
    const headers = {
        'Authorization': token,
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    };

    try {
        logCallback("🔍 Đang lấy danh sách Quest...");
        const questRes = await fetchWithTimeout('https://discord.com/api/v9/quests/@me', { headers });
        if (!questRes.ok) throw new Error(`Lấy quest thất bại: ${questRes.status}`);
        
        const data = await questRes.json();
        const quests = data.quests || (Array.isArray(data) ? data : []);
        const targetQuest = quests.find(q => !q.userStatus?.completedAt && !q.userStatus?.enrolledAt);

        if (!targetQuest) {
            logCallback("✅ Không có quest mới nào cần làm!");
            return;
        }

        const qid = targetQuest.id;
        const qName = targetQuest.config?.messages?.questName || `Quest #${qid}`;
        logCallback(`📌 Phát hiện quest: ${qName}`);

        logCallback("📝 Đang đăng ký (Enroll) quest...");
        await fetchWithTimeout(`https://discord.com/api/v9/quests/${qid}/enroll`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ location: 11, is_targeted: false })
        });

        logCallback("⏳ Đang giả lập tiến độ hoàn thành...");
        const steps = 5;
        for (let i = 1; i <= steps; i++) {
            if (!activeTasks.has(taskId)) {
                logCallback("⏹️ Đã dừng tác vụ bởi người dùng.");
                return;
            }
            
            const timestamp = Math.floor(Date.now() / 1000) - (i * 600);
            await fetchWithTimeout(`https://discord.com/api/v9/quests/${qid}/video-progress`, {
                method: 'POST',
                headers,
                body: JSON.stringify({ timestamp })
            });
            
            logCallback(`🔄 Tiến độ: ${(i / steps * 100).toFixed(0)}%`);
            await new Promise(r => setTimeout(r, 3000));
        }

        logCallback("🎉 Quest hoàn thành! Đang gửi thông báo...");
        const sent = await sendQuestWebhook(token, qName, webhookUrl);
        if (sent) logCallback("✅ Đã gửi thông báo Webhook thành công!");
        else logCallback("⚠️ Quest xong nhưng gửi Webhook thất bại.");

    } catch (err) {
        logCallback(`❌ Lỗi: ${err.message}`);
    } finally {
        activeTasks.delete(taskId);
    }
}

// ─── AUTOBADGE WORKER (CLOUD OPTIMIZED) ──────────────────────
function generateMockFingerprint(userId) {
    // Tạo fingerprint giả lập có cấu trúc hợp lệ để vượt qua check cơ bản
    // Lưu ý: Không thể tạo fingerprint thật từ .exe trên Linux
    const dummyData = { v: 1, uid: userId, ts: Date.now(), env: "cloud_mock" };
    const jsonStr = JSON.stringify(dummyData);
    const padded = jsonStr.padEnd(256, '0'); // Padding để độ dài giống thật
    return Buffer.from(padded).toString('base64');
}

async function runAutoBadge(taskId, token, cookie, gameId, hours, logCallback) {
    try {
        logCallback("🎮 Bắt đầu quy trình AutoBadge...");
        
        // 1. Lấy User ID để tạo mock fingerprint
        const userId = token.split('.')[0];
        const decodedId = Buffer.from(userId, 'base64').toString('utf-8');
        const mockFingerprint = generateMockFingerprint(decodedId);

        // 2. Lấy Analytics Token
        logCallback("🔑 Đang xác thực và lấy Analytics Token...");
        const superProps = Buffer.from(JSON.stringify({
            os: "Windows", browser: "Discord Client", client_version: "1.0.9253",
            client_build_number: 594031
        })).toString('base64');

        const meRes = await fetchWithTimeout('https://discord.com/api/v9/users/@me?with_analytics_token=true', {
            headers: { 
                'Authorization': token,
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'X-Super-Properties': superProps
            }
        });
        
        if (!meRes.ok) throw new Error(`Không thể lấy thông tin user: ${meRes.status}`);
        const meData = await meRes.json();
        const analyticsToken = meData.analytics_token;
        
        if (!analyticsToken) throw new Error("Không tìm thấy analytics_token trong phản hồi.");

        // 3. Xây dựng Payload Events
        logCallback(`📦 Đang tạo sự kiện cho Game ID: ${gameId} (${hours} giờ)...`);
        const durationMs = Math.floor(hours * 3600 * 1000);
        const now = Date.now();
        const startTime = now - durationMs;
        const sessionId = require('crypto').randomUUID();

        const events = [
            {
                type: "running_game_heartbeat",
                properties: {
                    client_track_timestamp: startTime,
                    client_heartbeat_session_id: sessionId,
                    event_sequence_number: 1,
                    game_id: gameId,
                    initial_heartbeat: true,
                    final_heartbeat: false,
                    game_session_id: sessionId,
                    duration_tracked_ms: 0,
                    executable_fingerprint: mockFingerprint,
                    client_app_state: "focused"
                }
            },
            {
                type: "launch_game",
                properties: {
                    client_track_timestamp: startTime + 1000,
                    client_heartbeat_session_id: sessionId,
                    event_sequence_number: 2,
                    game_id: gameId,
                    verified: true,
                    game_platform: "desktop",
                    detection_method: "verified_game",
                    executable_fingerprint: mockFingerprint,
                    client_app_state: "focused"
                }
            },
            {
                type: "running_game_heartbeat",
                properties: {
                    client_track_timestamp: now,
                    client_heartbeat_session_id: sessionId,
                    event_sequence_number: 3,
                    game_id: gameId,
                    initial_heartbeat: false,
                    final_heartbeat: true,
                    game_session_id: sessionId,
                    duration_tracked_ms: durationMs,
                    executable_fingerprint: mockFingerprint,
                    client_app_state: "focused"
                }
            }
        ];

        // 4. Gửi lên /science
        logCallback("📤 Đang gửi dữ liệu lên Discord Science API...");
        const scienceRes = await fetchWithTimeout('https://discord.com/api/v9/science', {
            method: 'POST',
            headers: {
                'Authorization': token,
                'Cookie': cookie || '',
                'Content-Type': 'application/json',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'X-Super-Properties': superProps,
                'Origin': 'https://discord.com',
                'Referer': 'https://discord.com/channels/@me'
            },
            body: JSON.stringify({ token: analyticsToken, events })
        });

        if (scienceRes.status === 204 || scienceRes.status === 200) {
            logCallback("✅ Gửi thành công! Discord đã nhận tín hiệu.");
            logCallback("⚠️ LƯU Ý: Do chạy trên Cloud Linux, badge có thể không hiện ngay lập tức hoặc bị bỏ qua nếu Discord yêu cầu fingerprint thật từ máy Windows.");
        } else {
            const errText = await scienceRes.text();
            logCallback(`❌ Discord từ chối: ${scienceRes.status} - ${errText}`);
        }

    } catch (err) {
        logCallback(`❌ Lỗi AutoBadge: ${err.message}`);
    } finally {
        activeTasks.delete(taskId);
    }
}

// ─── API ROUTES ──────────────────────────────────────────────

// Tự động tải danh sách game
app.get('/api/games', async (req, res) => {
    try {
        // Cache 1 giờ để tránh spam Discord CDN
        if (cachedGames && (Date.now() - lastGamesFetch < 3600000)) {
            return res.json(cachedGames);
        }

        const response = await fetchWithTimeout(GAMES_CDN_URL, {}, 10000);
        if (!response.ok) throw new Error("Failed to fetch games");
        
        const data = await response.json();
        // Lọc lấy các game có thông tin hợp lệ
        cachedGames = data.filter(g => g.id && g.name && g.executables?.some(e => e.os === 'win32')).map(g => ({
            id: g.id,
            name: g.name,
            exe: g.executables.find(e => e.os === 'win32')?.name || 'game.exe'
        }));
        lastGamesFetch = Date.now();
        
        res.json(cachedGames);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/start-quest', async (req, res) => {
    const { token, webhook } = req.body;
    if (!token) return res.status(400).json({ error: 'Thiếu token' });

    const taskId = Date.now().toString();
    activeTasks.set(taskId, true);
    const logCallback = (msg) => console.log(`[Quest ${taskId}] ${msg}`);
    
    runAutoQuest(taskId, token, webhook, logCallback);
    res.json({ ok: true, message: 'Đã bắt đầu AutoQuest' });
});

app.post('/api/start-badge', async (req, res) => {
    const { token, cookie, gameId, hours } = req.body;
    if (!token || !gameId) return res.status(400).json({ error: 'Thiếu token hoặc Game ID' });

    const taskId = Date.now().toString();
    activeTasks.set(taskId, true);
    const logCallback = (msg) => console.log(`[Badge ${taskId}] ${msg}`);
    
    runAutoBadge(taskId, token, cookie, gameId, hours, logCallback);
    res.json({ ok: true, message: 'Đã bắt đầu AutoBadge' });
});

app.post('/api/stop', (req, res) => {
    const count = activeTasks.size;
    activeTasks.clear();
    res.json({ ok: true, message: `Đã dừng ${count} tác vụ` });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
