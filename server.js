app.post('/api/start', (req, res) => {
  stopCurrentSocket();
  
  const data = req.body;
  if (!data.token) return res.status(400).json({ error: 'Thiếu token' });

  const ws = new WebSocket('wss://gateway.discord.gg/?v=10&encoding=json');
  activeSocket = ws;
  let seq = null;
  let idx = 0;

  // TÍNH MỐC THỜI GIAN 1 LẦN DUY NHẤT Ở ĐÂY
  const fakeStartTime = data.hours > 0 ? Date.now() - (data.hours * 3600 * 1000) : Date.now();

  const states = data.states && data.states.length > 0 ? data.states : [''];
  
  const buildActivity = () => {
    let act = {
      name: data.name || 'Visual Studio Code',
      type: parseInt(data.type) || 0,
      timestamps: { start: fakeStartTime }, // DÙNG BIẾN CỐ ĐỊNH NÀY
      instance: false
    };

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

  // ... (giữ nguyên phần ws.on('message') và các phần khác như cũ)
