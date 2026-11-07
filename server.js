// ─── AUTOBADGE WORKER (OPTIMIZED FOR CLOUD/LINUX) ─────────────────
async function runAutoBadge(taskId, token, cookie, gameId, hours, logCallback) {
    try {
        logCallback("🎮 Bắt đầu giả lập chơi game (Chế độ Cloud)...");
        
        // Lưu ý: Trên Cloud (Linux), ta không thể tạo fingerprint thật từ .exe Windows.
        // Ta sẽ dùng một fingerprint "giả" nhưng có cấu trúc đúng để tránh bị lỗi cú pháp.
        // Tỷ lệ thành công thấp hơn máy thật, nhưng vẫn thử được.
        
        const durationMs = hours * 3600 * 1000;
        const now = Date.now();
        const startTime = now - durationMs;
        const sessionId = "cloud-session-" + Math.random().toString(36).substring(7);

        // Fingerprint giả lập an toàn cho Linux (Base64 encoded dummy data)
        // Đây là fingerprint mẫu thường thấy, không gắn với máy cụ thể để tránh conflict
        const fakeFingerprint = "AQAAAAEAAABgAAAAYQAAAGIAAABjAAAAZAAAAGUAAABmAAAAZwAAAGgAAABpAAAAagAAAGsAAABsAAAAbQAAAG4AAABvAAAAcAAAAHEAAABzAAAAdAAAAHUAAAB2AAAAdwAAAHgAAAB5AAAAeg=="; 

        const events = [
            {
                type: "launch_game",
                properties: {
                    game_id: gameId,
                    executable_fingerprint: fakeFingerprint, 
                    client_track_timestamp: startTime,
                    client_heartbeat_session_id: sessionId,
                    game_platform: "desktop",
                    detection_method: "verified_game"
                }
            },
            {
                type: "running_game_heartbeat",
                properties: {
                    game_id: gameId,
                    duration_tracked_ms: durationMs,
                    final_heartbeat: true,
                    client_track_timestamp: now,
                    client_heartbeat_session_id: sessionId,
                    initial_heartbeat: false
                }
            }
        ];

        // Lấy Analytics Token (Bắt buộc)
        let analyticsToken = "";
        try {
            const meRes = await fetchWithTimeout('https://discord.com/api/v9/users/@me?with_analytics_token=true', {
                headers: { 
                    'Authorization': token,
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                }
            });
            if (meRes.ok) {
                const meData = await meRes.json();
                analyticsToken = meData.analytics_token;
            }
        } catch (e) {
            logCallback("⚠️ Không lấy được Analytics Token.");
        }

        if (!analyticsToken) {
             logCallback("❌ Thiếu Analytics Token, không thể gửi sự kiện.");
             return;
        }

        const headers = {
            'Authorization': token,
            'Cookie': cookie || '', // Cookie cf_clearance rất quan trọng
            'Content-Type': 'application/json',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) discord/1.0.900 Chrome/108.0.5359.124 Electron/22.0.3 Safari/537.36',
            'X-Super-Properties': 'eyJvcyI6IldpbmRvd3MiLCJicm93c2VyIjoiRGlzY29yZCBDbGllbnQiLCJjbGllbnRfdmVyc2lvbiI6IjEuMC45MDAiLCJvc192ZXJzaW9uIjoiMTAuMC4xOTA0MiIsIm9zX2FyY2giOiJ4NjQiLCJzeXN0ZW1fbG9jYWxlIjoiZW4tVVMiLCJicm93c2VyX3VzZXJfYWdlbnQiOiIiLCJicm93c2VyX3ZlcnNpb24iOiIiLCJjbGllbnRfYnVpbGRfbnVtYmVyIjo5MDAsImNsaWVudF9ldmVudF9zb3VyY2UiOm51bGx9',
            'Origin': 'https://discord.com',
            'Referer': 'https://discord.com/channels/@me'
        };

        const res = await fetchWithTimeout('https://discord.com/api/v9/science', {
            method: 'POST',
            headers,
            body: JSON.stringify({ 
                token: analyticsToken, 
                events: events 
            })
        });

        if (res.status === 204 || res.status === 200) {
            logCallback(`✅ Đã gửi tín hiệu chơi game ${hours} giờ cho ID: ${gameId}`);
            logCallback("⚠️ Lưu ý: Vì chạy trên Cloud Linux, badge có thể không hiện ngay hoặc bị Discord bỏ qua nếu thiếu Fingerprint thật.");
        } else {
            const errText = await res.text();
            logCallback(`⚠️ Discord phản hồi: ${res.status} - ${errText}`);
        }
    } catch (err) {
        logCallback(`❌ Lỗi AutoBadge: ${err.message}`);
    } finally {
        activeTasks.delete(taskId);
    }
}
