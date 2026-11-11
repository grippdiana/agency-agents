/**
 * HOLONET // ORBITA — Suíte de Testes End-to-End (Edição Starfighter + Samsung Crystal 55")
 * Valida:
 *  1) Servidor local, UI Star Wars Holotable, PWA Manifest e 12 unidades Demo calibradas no mapa
 *  2) Comandos de dispositivos, Protocolo Cinema ("Sessão Holocron") e Telemetria do Reator
 *  3) Integração REAL Home Assistant (mock server HTTP: /api/, /api/states, sync e /api/services/light/turn_on)
 *  4) Integração REAL Tuya Cloud OpenAPI v2.0 (validação HMAC-SHA256 + envio de switch_led)
 *  5) Integração REAL Samsung Crystal 55" Tizen OS:
 *     - Descoberta GET /api/v2/ (modelo UN55CU7700 + wifiMac automático)
 *     - Pareamento WebSocket /api/v2/channels/samsung.remote.control -> ms.channel.connect (token 8 dígitos salvo)
 *     - Tecla remota ms.remote.control (KEY_HOME e KEY_VOLUP)
 *     - Abertura direta do Netflix via POST /api/v2/applications/3201907018807
 *     - Wake-on-LAN Magic Packet UDP
 *  6) Restauração da Simulação + Geração íntegra do Pacote Desktop (.tar.gz)
 */
const assert = require('assert');
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'holonet-test-'));
process.env.ORBITA_DATA_DIR = tmpDir;

const { startServer } = require('../server.js');

async function jfetch(base, pathname, opts = {}) {
  const r = await fetch(base + pathname, {
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    ...opts,
  });
  const data = await r.json();
  return { status: r.status, ok: r.ok, data };
}

(async () => {
  console.log('🧪 Iniciando suíte de testes HOLONET (Samsung Crystal 55" + Tuya + LG ThinQ)...\n');

  const srv = await startServer(0, '127.0.0.1');
  const base = `http://127.0.0.1:${srv.address().port}`;

  try {
    // --- TESTE 1: Saúde + UI Star Wars + 12 dispositivos dentro da planta ---
    const health = await jfetch(base, '/api/health');
    assert.strictEqual(health.data.ok, true);
    assert.strictEqual(health.data.mode, 'demo');

    const html = await (await fetch(base + '/')).text();
    assert(html.includes('HOLONET'), 'HTML deve conter HOLONET');
    assert(html.includes('Samsung Crystal 55'), 'HTML deve destacar a Samsung Crystal 55"');

    const devs = await jfetch(base, '/api/devices');
    assert.strictEqual(devs.data.count, 12);
    const tvDemo = devs.data.devices.find(d => d.id === 'tv-sala');
    assert(tvDemo.name.includes('Samsung Crystal 55"'), 'TV padrão deve ser Samsung Crystal 55"');
    for (const d of devs.data.devices) {
      assert(d.x >= 2 && d.x <= 98 && d.y >= 4 && d.y <= 58, `Coordenada fora da planta: ${d.id}`);
    }
    console.log('  ✅ [1/6] Interface Star Wars Holotable, Samsung Crystal 55" e 12 módulos validados');

    // --- TESTE 2: Comandos Demo, Cena e Reator ---
    const cmdLuz = await jfetch(base, '/api/devices/luz-sala/command', {
      method: 'POST',
      body: JSON.stringify({ action: 'brightness', value: 40 }),
    });
    assert.strictEqual(cmdLuz.data.device.brightness, 40);

    const sc = await jfetch(base, '/api/scenes/cinema/activate', { method: 'POST' });
    assert.strictEqual(sc.data.ok, true);
    assert.strictEqual(sc.data.devices.find(d => d.id === 'luz-sala').brightness, 15);

    const energy = await jfetch(base, '/api/energy');
    assert(energy.data.nowWatts > 0 && Array.isArray(energy.data.breakdown));
    console.log('  ✅ [2/6] Comandos, Protocolo "Sessão Holocron" e Telemetria do Reator OK');

    // --- TESTE 3: Home Assistant Real (Tuya + LG ThinQ) ---
    const receivedHaCalls = [];
    const mockHa = http.createServer((req, res) => {
      let body = '';
      req.on('data', c => { body += c; });
      req.on('end', () => {
        if (req.headers.authorization !== 'Bearer TEST_HA_TOKEN_123') {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ message: 'Unauthorized' }));
        }
        if (req.url === '/api/') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ message: 'API running.' }));
        }
        if (req.url === '/api/states') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify([
            { entity_id: 'light.fita_led_tuya', state: 'on', attributes: { friendly_name: 'Fita LED Tuya Sala', brightness: 204 } },
            { entity_id: 'sensor.lava_e_seca_lg', state: 'run', attributes: { friendly_name: 'Lava e Seca LG ThinQ', progress: 74, remain_time_min: 19 } },
          ]));
        }
        if (req.url.startsWith('/api/services/')) {
          receivedHaCalls.push({ url: req.url, body: JSON.parse(body || '{}') });
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify([]));
        }
        res.writeHead(404); res.end();
      });
    });
    await new Promise(r => mockHa.listen(0, '127.0.0.1', r));
    const haUrl = `http://127.0.0.1:${mockHa.address().port}`;

    const syncHa = await jfetch(base, '/api/integrations/ha/sync', {
      method: 'POST',
      body: JSON.stringify({ url: haUrl, token: 'TEST_HA_TOKEN_123' }),
    });
    assert.strictEqual(syncHa.data.imported, 2);

    const haCmd = await jfetch(base, '/api/devices/light-fita_led_tuya/command', {
      method: 'POST',
      body: JSON.stringify({ action: 'brightness', value: 65 }),
    });
    assert.strictEqual(haCmd.data.bridge, 'homeassistant');
    assert.strictEqual(receivedHaCalls[0].body.brightness_pct, 65);
    mockHa.close();
    console.log('  ✅ [3/6] Integração Home Assistant (Sync + Disparo REST Tuya/LG) validada');

    // --- TESTE 4: Tuya Cloud OpenAPI v2.0 (HMAC-SHA256) ---
    const TUYA_ID = 'tuya_test_id_99';
    const TUYA_SECRET = 'tuya_test_secret_abc';
    let tuyaCmdReceived = null;

    const mockTuya = http.createServer((req, res) => {
      let body = '';
      req.on('data', c => { body += c; });
      req.on('end', () => {
        const { client_id, sign, t, nonce, access_token } = req.headers;
        const contentHash = crypto.createHash('sha256').update(body).digest('hex');
        const strToSign = [req.method.toUpperCase(), contentHash, '', req.url].join('\n');
        const expected = crypto.createHmac('sha256', TUYA_SECRET)
          .update(client_id + (access_token || '') + t + nonce + strToSign)
          .digest('hex')
          .toUpperCase();
        assert.strictEqual(sign, expected, 'Assinatura HMAC-SHA256 deve ser exata');
        if (req.url.startsWith('/v1.0/token')) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ success: true, result: { access_token: 'tok_xyz', expire_time: 7200 } }));
        }
        if (req.url.includes('/commands')) {
          tuyaCmdReceived = JSON.parse(body);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ success: true, result: true }));
        }
        res.writeHead(404); res.end();
      });
    });
    await new Promise(r => mockTuya.listen(0, '127.0.0.1', r));
    const tuyaEp = `http://127.0.0.1:${mockTuya.address().port}`;

    await jfetch(base, '/api/integrations/config', {
      method: 'POST',
      body: JSON.stringify({ mode: 'tuya', tuyaClientId: TUYA_ID, tuyaSecret: TUYA_SECRET, tuyaEndpoint: tuyaEp }),
    });
    const added = await jfetch(base, '/api/devices', {
      method: 'POST',
      body: JSON.stringify({ name: 'Luz Tuya Real', type: 'light', tuyaId: 'dev_tuya_001' }),
    });
    const tuyaCmdRes = await jfetch(base, `/api/devices/${added.data.device.id}/command`, {
      method: 'POST',
      body: JSON.stringify({ action: 'toggle', value: false }),
    });
    assert.strictEqual(tuyaCmdRes.data.bridge, 'tuya-cloud');
    assert.deepStrictEqual(tuyaCmdReceived, { commands: [{ code: 'switch_led', value: false }] });
    mockTuya.close();
    console.log('  ✅ [4/6] Integração Tuya OpenAPI v2.0 (HMAC-SHA256 + switch_led) validada');

    // --- TESTE 5: Samsung Crystal 55" Tizen OS (API v2 + WebSocket Remote + Launch Netflix + WoL) ---
    await jfetch(base, '/api/integrations/reset-demo', { method: 'POST' });

    const samsungKeysReceived = [];
    let samsungAppsLaunched = [];
    let samsungTokenReceivedInQuery = '';

    const mockSamsung = http.createServer((req, res) => {
      if (req.url === '/api/v2/' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
          name: '[TV] Samsung Crystal 55',
          device: { modelName: 'UN55CU7700GXZD', wifiMac: '8C:79:F5:AA:BB:CC', TokenAuthSupport: 'true' },
        }));
      }
      if (req.url.startsWith('/api/v2/applications/') && req.method === 'POST') {
        samsungAppsLaunched.push(req.url.split('/').pop());
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end('true');
      }
      res.writeHead(404); res.end();
    });

    mockSamsung.on('upgrade', (req, socket) => {
      if (req.url.includes('token=')) {
        samsungTokenReceivedInQuery = new URL('http://x' + req.url).searchParams.get('token') || '';
      }
      const key = req.headers['sec-websocket-key'];
      const accept = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
      socket.write(
        'HTTP/1.1 101 Switching Protocols\r\n' +
        'Upgrade: websocket\r\n' +
        'Connection: Upgrade\r\n' +
        `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
      );
      // Envia ms.channel.connect com token de 8 dígitos igual à Samsung Crystal real
      const connectEvent = JSON.stringify({ event: 'ms.channel.connect', data: { token: '84920173' } });
      const payload = Buffer.from(connectEvent, 'utf8');
      socket.write(Buffer.concat([Buffer.from([0x81, payload.length]), payload]));

      socket.on('data', buf => {
        let offset = 2;
        let len = buf[1] & 0x7f;
        if (len === 126) { len = buf.readUInt16BE(2); offset = 4; }
        const mask = buf.slice(offset, offset + 4);
        const data = Buffer.alloc(len);
        for (let i = 0; i < len; i++) data[i] = buf[offset + 4 + i] ^ mask[i % 4];
        try {
          const msg = JSON.parse(data.toString('utf8'));
          if (msg.method === 'ms.remote.control') samsungKeysReceived.push(msg.params?.DataOfCmd);
        } catch {}
      });
    });

    await new Promise(r => mockSamsung.listen(0, '127.0.0.1', r));
    const samPort = mockSamsung.address().port;
    const samAddr = `127.0.0.1:${samPort}`;

    // 5a. Pareia Samsung (auto-detecta modelo + wifiMac + salva token 84920173)
    const pairSam = await jfetch(base, '/api/integrations/test', {
      method: 'POST',
      body: JSON.stringify({ type: 'samsungtv', tvIp: samAddr, secure: false, apiPort: samPort }),
    });
    assert.strictEqual(pairSam.data.ok, true);
    assert.strictEqual(pairSam.data.tokenSaved, true);
    assert.strictEqual(pairSam.data.detectedMac, '8C:79:F5:AA:BB:CC');

    // 5b. Envia tecla Smart Hub (KEY_HOME) usando o token salvo automaticamente
    const cmdHome = await jfetch(base, '/api/devices/tv-sala/command', {
      method: 'POST',
      body: JSON.stringify({ action: 'remote', value: 'home' }),
    });
    assert.strictEqual(cmdHome.data.bridge, 'samsung-tizen-wifi');
    assert.strictEqual(samsungTokenReceivedInQuery, '84920173');
    assert(samsungKeysReceived.includes('KEY_HOME'), 'Samsung deve receber KEY_HOME');

    // 5c. Abre Netflix (App ID oficial Tizen 3201907018807)
    const cmdNetflix = await jfetch(base, '/api/devices/tv-sala/command', {
      method: 'POST',
      body: JSON.stringify({ action: 'input', value: 'Netflix' }),
    });
    assert.strictEqual(cmdNetflix.data.bridge, 'samsung-tizen-wifi');
    assert(samsungAppsLaunched.includes('3201907018807'), 'Samsung deve abrir Netflix 3201907018807');
    mockSamsung.close();

    // 5d. Wake-on-LAN com o MAC descoberto automaticamente
    const wol = await jfetch(base, '/api/integrations/tv/wol', { method: 'POST', body: JSON.stringify({}) });
    assert.strictEqual(wol.data.ok, true);
    assert.strictEqual(wol.data.mac, '8C:79:F5:AA:BB:CC');
    console.log('  ✅ [5/6] Samsung Crystal 55" Tizen (API v2 + MAC Auto + Token + KEY_HOME + Netflix + WoL) validada');

    // --- TESTE 6: Reset Simulação + Pacote Desktop (.tar.gz) ---
    const reset = await jfetch(base, '/api/integrations/reset-demo', { method: 'POST' });
    assert.strictEqual(reset.data.mode, 'demo');

    const dlRes = await fetch(base + '/api/download/orbita-desktop.tar.gz');
    assert.strictEqual(dlRes.status, 200);
    const buf = Buffer.from(await dlRes.arrayBuffer());
    assert(buf.length > 20000 && buf[0] === 0x1f && buf[1] === 0x8b);
    console.log(`  ✅ [6/6] Pacote instalável Desktop (.tar.gz, ${(buf.length / 1024).toFixed(1)} KB) verificado\n`);

    console.log('🎉 TODOS OS 6 BLOCOS DE TESTES PASSARAM COM SUCESSO!');
  } finally {
    srv.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
  process.exit(0);
})().catch(err => {
  console.error('❌ Falha nos testes:', err);
  process.exit(1);
});
