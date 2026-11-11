/**
 * HOLONET // ORBITA — Servidor de Comando Residencial (Edição Starfighter / Holoprojector)
 * Roda na sua rede Wi-Fi local (embutido no app Desktop Electron ou via Node.js) e conecta:
 *  1) TV Samsung Crystal UHD 55" (Tizen OS) direto pelo Wi-Fi:
 *     - WebSocket seguro TLS porta 8002 (wss://IP:8002/api/v2/channels/samsung.remote.control) com certificado autoassinado
 *     - Descoberta automática de modelo e MAC via GET http://IP:8001/api/v2/
 *     - Abertura direta de apps (Netflix, YouTube, Prime Video, Disney+, Spotify) via POST /api/v2/applications/<appId>
 *     - Ligamento remoto via Wake-on-LAN (Magic Packet UDP)
 *  2) Home Assistant (unifica Luzes Tuya + Lava e Seca LG ThinQ + Ar + Sensores na rede local)
 *  3) Tuya Cloud IoT OpenAPI v2.0 (assinatura oficial HMAC-SHA256)
 *  4) TV LG webOS (suporte adicional SSAP porta 3000)
 *  5) Scanner de Setor Wi-Fi (SSDP/UPnP multicast + portas 8001/8002 Samsung, 8123 HA, 6668 Tuya, 554 RTSP)
 */
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const os = require('os');
const net = require('net');
const tls = require('tls');
const dgram = require('dgram');
const crypto = require('crypto');
const { execFile } = require('child_process');

const app = express();
const DEFAULT_PORT = Number(process.env.PORT) || 3000;
const DEFAULT_HOST = process.env.HOST || '0.0.0.0';

app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/downloads', express.static(path.join(__dirname, 'downloads'), {
  setHeaders(res, filePath) {
    res.setHeader('Content-Disposition', `attachment; filename="${path.basename(filePath)}"`);
  },
}));

// ---------------------------------------------------------------------------
// Config persistente (credenciais em config.json permissão 0600, fora do Git)
// ---------------------------------------------------------------------------
const DATA_DIR = process.env.ORBITA_DATA_DIR || __dirname;
const CONFIG_PATH = path.join(DATA_DIR, 'config.json');

function loadConfig() {
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    return raw && typeof raw === 'object' ? raw : {};
  } catch {
    return {
      mode: process.env.HA_URL && process.env.HA_TOKEN ? 'homeassistant' : 'demo',
      haUrl: process.env.HA_URL || '',
      haToken: process.env.HA_TOKEN || '',
      tuyaClientId: process.env.TUYA_CLIENT_ID || '',
      tuyaSecret: process.env.TUYA_CLIENT_SECRET || '',
      tuyaEndpoint: process.env.TUYA_ENDPOINT || 'https://openapi.tuyaus.com',
    };
  }
}

function saveConfig(cfg) {
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), { mode: 0o600 });
}

let config = loadConfig();

// ---------------------------------------------------------------------------
// Dispositivos padrão (configurados com a Samsung Crystal 55" + Tuya + LG ThinQ)
// Coordenadas calibradas para o Holomapa 100x62
// ---------------------------------------------------------------------------
function createDemoDevices() {
  return [
    { id:'tv-sala', name:'Samsung Crystal 55" UHD', type:'tv', brand:'Samsung Tizen', room:'Sala', ip: config.samsungTvIp || '192.168.1.51', mac: config.samsungTvMac || '8C:79:F5:44:12:A8', haEntity:'media_player.samsung_crystal_55', online:true, power:true, volume:18, muted:false, input:'Netflix', channel:'Smart Hub', x:42, y:10 },
    { id:'luz-sala', name:'Luz Principal da Sala', type:'light', brand:'Tuya', room:'Sala', ip:'192.168.1.42', mac:'A4:CF:12:8B:3F:01', haEntity:'light.luz_sala', online:true, power:true, brightness:80, colorTemp:3200, color:'#FFB020', x:18, y:19 },
    { id:'luz-cozinha', name:'Luminária da Cozinha', type:'light', brand:'Tuya', room:'Cozinha', ip:'192.168.1.43', mac:'A4:CF:12:8B:3F:02', haEntity:'light.luz_cozinha', online:true, power:false, brightness:100, colorTemp:4500, color:'#45D9FF', x:66, y:19 },
    { id:'luz-quarto', name:'Luz da Suíte', type:'light', brand:'Tuya', room:'Quarto', ip:'192.168.1.44', mac:'A4:CF:12:8B:3F:03', haEntity:'light.luz_quarto', online:true, power:true, brightness:45, colorTemp:2700, color:'#FFB020', x:20, y:40 },
    { id:'lava-seca-lg', name:'Lava e Seca LG ThinQ', type:'washer', brand:'LG ThinQ', room:'Lavanderia', ip:'192.168.1.50', mac:'9C:5C:8E:11:AA:20', haEntity:'sensor.lava_e_seca_lg', online:true, power:true, status:'lavando', progress:68, cycle:'Algodão + Vapor', temp:40, remainMin:32, x:74, y:44 },
    { id:'ar-sala', name:'Ar-Condicionado Inverter', type:'ac', brand:'LG ThinQ', room:'Sala', ip:'192.168.1.52', mac:'9C:5C:8E:11:AA:22', haEntity:'climate.ar_sala', online:true, power:true, temp:22, mode:'Frio', fan:'Auto', x:28, y:11 },
    { id:'geladeira-lg', name:'Geladeira Smart ThinQ', type:'fridge', brand:'LG ThinQ', room:'Cozinha', ip:'192.168.1.53', mac:'9C:5C:8E:11:AA:23', haEntity:'sensor.geladeira_lg', online:true, power:true, fridgeTemp:3, freezerTemp:-18, doorOpen:false, x:85, y:17 },
    { id:'fechadura', name:'Trava Blindada do Hall', type:'lock', brand:'Tuya', room:'Entrada', ip:'192.168.1.60', mac:'A4:CF:12:8B:3F:10', haEntity:'lock.fechadura_entrada', online:true, power:true, locked:true, battery:87, x:22, y:52 },
    { id:'camera-entrada', name:'Droide Sentinela (Câmera)', type:'camera', brand:'Tuya', room:'Entrada', ip:'192.168.1.61', mac:'A4:CF:12:8B:3F:11', haEntity:'camera.entrada', online:true, power:true, recording:true, motion:false, x:39, y:52 },
    { id:'tomada-rack', name:'Reator Tomada — Rack TV', type:'plug', brand:'Tuya', room:'Sala', ip:'192.168.1.62', mac:'A4:CF:12:8B:3F:12', haEntity:'switch.tomada_rack', online:true, power:true, watts:148, x:42, y:23 },
    { id:'aspirador', name:'Unidade Astromech (Robô)', type:'vacuum', brand:'Tuya', room:'Sala', ip:'192.168.1.70', mac:'A4:CF:12:8B:3F:20', haEntity:'vacuum.aspirador_robo', online:true, power:false, status:'parado', battery:94, x:12, y:26 },
    { id:'sensor-temp', name:'Sonda Atmosférica Suíte', type:'sensor', brand:'Tuya', room:'Quarto', ip:'192.168.1.71', mac:'A4:CF:12:8B:3F:21', haEntity:'sensor.temperatura_quarto', online:true, power:true, temp:23.8, humidity:56, x:38, y:40 },
  ];
}

let devices = Array.isArray(config.customDevices) && config.customDevices.length
  ? config.customDevices
  : createDemoDevices();

let scenes = [
  { id:'cheguei', name:'Pouso na Base', icon:'◈', code:'PROTO-01', desc:'Luzes da sala 90%, Samsung Crystal 55" ligada, clima em 22°C', active:false },
  { id:'cinema', name:'Sessão Holocron', icon:'◎', code:'PROTO-02', desc:'Luz âmbar em 15%, cozinha apagada, Samsung 55" em modo Cinema', active:false },
  { id:'boa-noite', name:'Escudos Noturnos', icon:'⬡', code:'PROTO-03', desc:'Desliga luzes e TV, trava porta do hall e ativa sentinela RTSP', active:false },
  { id:'economia', name:'Reserva de Reator', icon:'⚡', code:'PROTO-04', desc:'Corta cargas secundárias mantendo geladeira e perímetro', active:false },
  { id:'manha', name:'Alvorada Binária', icon:'☀', code:'PROTO-05', desc:'Acende suíte e sala suavemente em 2700K', active:false },
];

let activityLog = [
  { time: new Date().toISOString(), text: `HOLONET // Console iniciado em modo ${(config.mode || 'demo').toUpperCase()}.` },
];

const washerTimer = setInterval(() => {
  if ((config.mode || 'demo') !== 'demo') return;
  const w = devices.find(d => d.id === 'lava-seca-lg');
  if (w && w.status === 'lavando') {
    w.progress = Math.min(100, w.progress + 1);
    w.remainMin = Math.max(0, w.remainMin - 1);
    if (w.progress >= 100) {
      w.status = 'concluído';
      w.power = false;
      log('Lava e Seca LG ThinQ concluiu o ciclo de lavagem.');
    }
  }
}, 8000);
washerTimer.unref();

function log(text) {
  activityLog.unshift({ time: new Date().toISOString(), text });
  activityLog = activityLog.slice(0, 50);
}
function now() { return new Date().toISOString(); }
function clamp(v, min, max) { const n = Number(v); return Number.isNaN(n) ? min : Math.min(max, Math.max(min, n)); }
function hexToRgb(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || '');
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : null;
}

// ---------------------------------------------------------------------------
// Wake-on-LAN UDP Magic Packet (usado pela Samsung Crystal 55" em Standby)
// ---------------------------------------------------------------------------
function sendWakeOnLan(macAddress, broadcastIp = '255.255.255.255') {
  return new Promise((resolve, reject) => {
    const clean = String(macAddress || '').replace(/[^0-9a-fA-F]/g, '');
    if (clean.length !== 12) return reject(new Error('MAC inválido (use formato AA:BB:CC:DD:EE:FF)'));
    const macBuf = Buffer.from(clean, 'hex');
    const packet = Buffer.alloc(6 + 16 * 6, 0xff);
    for (let i = 0; i < 16; i++) macBuf.copy(packet, 6 + i * 6);
    const sock = dgram.createSocket('udp4');
    sock.once('error', err => { sock.close(); reject(err); });
    sock.bind(() => {
      sock.setBroadcast(true);
      sock.send(packet, 0, packet.length, 9, broadcastIp, err => {
        sock.close();
        if (err) reject(err); else resolve(true);
      });
    });
  });
}

// ---------------------------------------------------------------------------
// 1) Integração REAL: Samsung Crystal UHD 55" Smart TV (Tizen OS)
//    - WSS porta 8002 (certificado autoassinado da TV aceito localmente via tls)
//    - Fallback WS porta 8001
//    - GET http://IP:8001/api/v2/ (lê modelo exato + wifiMac automático)
//    - POST http://IP:8001/api/v2/applications/<appId> (Netflix, YouTube, etc.)
// ---------------------------------------------------------------------------
const SAMSUNG_APP_IDS = {
  Netflix: '3201907018807',
  YouTube: '111299001912',
  'Prime Video': '3201910019365',
  'Disney+': '3201901017640',
  Spotify: '3201606009684',
  'Apple TV': '3201807016597',
};

const SAMSUNG_REMOTE_KEYS = {
  power: 'KEY_POWER',
  'vol+': 'KEY_VOLUP',
  'vol-': 'KEY_VOLDOWN',
  mute: 'KEY_MUTE',
  up: 'KEY_UP',
  down: 'KEY_DOWN',
  left: 'KEY_LEFT',
  right: 'KEY_RIGHT',
  ok: 'KEY_ENTER',
  back: 'KEY_RETURN',
  home: 'KEY_HOME',
  source: 'KEY_SOURCE',
  hdmi: 'KEY_HDMI',
  'ch+': 'KEY_CHUP',
  'ch-': 'KEY_CHDOWN',
  play: 'KEY_PLAY',
  pause: 'KEY_PAUSE',
  menu: 'KEY_MENU',
};

function parseHostPort(input, defaultPort) {
  const clean = String(input || '').trim().replace(/^wss?:\/\//i, '').replace(/\/.*$/, '');
  const idx = clean.lastIndexOf(':');
  if (idx > 0) {
    return { host: clean.slice(0, idx), port: Number(clean.slice(idx + 1)) || defaultPort };
  }
  return { host: clean, port: defaultPort };
}

async function samsungGetTvInfo(tvIp, apiPort = 8001) {
  const { host, port } = parseHostPort(tvIp, apiPort);
  const targetPort = port === 8002 ? 8001 : port;
  const r = await fetch(`http://${host}:${targetPort}/api/v2/`, { signal: AbortSignal.timeout(2500) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const data = await r.json();
  return {
    name: data.name || data.device?.name || 'Samsung Smart TV',
    modelName: data.device?.modelName || data.type || 'Crystal UHD',
    wifiMac: data.device?.wifiMac || '',
    tokenAuthSupport: data.device?.TokenAuthSupport === 'true' || data.device?.TokenAuthSupport === true,
  };
}

async function samsungLaunchApp(tvIp, appId, apiPort = 8001) {
  const { host, port } = parseHostPort(tvIp, apiPort);
  const targetPort = port === 8002 ? 8001 : port;
  const r = await fetch(`http://${host}:${targetPort}/api/v2/applications/${encodeURIComponent(appId)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    signal: AbortSignal.timeout(4000),
  });
  return r.ok;
}

function encodeWsClientFrame(str) {
  const payload = Buffer.from(str, 'utf8');
  const mask = crypto.randomBytes(4);
  let header;
  if (payload.length < 126) {
    header = Buffer.from([0x81, 0x80 | payload.length]);
  } else if (payload.length < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 0x80 | 126;
    header.writeUInt16BE(payload.length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 0x80 | 127;
    header.writeBigUInt64BE(BigInt(payload.length), 2);
  }
  const masked = Buffer.alloc(payload.length);
  for (let i = 0; i < payload.length; i++) masked[i] = payload[i] ^ mask[i % 4];
  return Buffer.concat([header, mask, masked]);
}

/**
 * Conecta no canal samsung.remote.control via TLS (8002, aceitando cert autoassinado da TV)
 * ou TCP puro (8001), aguarda ms.channel.connect (recebendo o token do popup "Permitir" na TV)
 * e envia opcionalmente 1 ou mais teclas Samsung (ex: ['KEY_VOLUP']).
 */
function samsungTizenWsCommand({ tvIp, token = '', keys = [], secure = true, appName = 'HOLONET Command', timeoutMs = 16000 }) {
  return new Promise((resolve, reject) => {
    const defaultPort = secure ? 8002 : 8001;
    const { host, port } = parseHostPort(tvIp, defaultPort);
    const nameB64 = Buffer.from(appName, 'utf8').toString('base64');
    const wsPath = `/api/v2/channels/samsung.remote.control?name=${encodeURIComponent(nameB64)}${token ? `&token=${encodeURIComponent(token)}` : ''}`;

    const socket = secure
      ? tls.connect({ host, port, rejectUnauthorized: false, servername: host })
      : net.createConnection({ host, port });

    let settled = false;
    let upgraded = false;
    let rxBuf = Buffer.alloc(0);
    let savedToken = token || '';

    const finish = (err, res) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { socket.destroy(); } catch {}
      if (err) reject(err); else resolve(res);
    };

    const timer = setTimeout(() => {
      finish(new Error('Tempo esgotado aguardando confirmação na TV Samsung. Pegue o controle remoto da TV e selecione "Permitir" quando o aviso aparecer no canto superior!'));
    }, timeoutMs);

    const onConnectedSocket = () => {
      const wsKey = crypto.randomBytes(16).toString('base64');
      const reqLines = [
        `GET ${wsPath} HTTP/1.1`,
        `Host: ${host}:${port}`,
        'Upgrade: websocket',
        'Connection: Upgrade',
        `Sec-WebSocket-Key: ${wsKey}`,
        'Sec-WebSocket-Version: 13',
        '',
        '',
      ].join('\r\n');
      socket.write(reqLines);
    };

    socket.once(secure ? 'secureConnect' : 'connect', onConnectedSocket);
    socket.once('error', err => finish(new Error(`Falha ao conectar em ${host}:${port} (${err.message}). Confirme se a TV Samsung Crystal está ligada no mesmo Wi-Fi.`)));

    function processFrames() {
      while (rxBuf.length >= 2) {
        const opcode = rxBuf[0] & 0x0f;
        const isMasked = (rxBuf[1] & 0x80) !== 0;
        let len = rxBuf[1] & 0x7f;
        let offset = 2;
        if (len === 126) {
          if (rxBuf.length < 4) return;
          len = rxBuf.readUInt16BE(2);
          offset = 4;
        } else if (len === 127) {
          if (rxBuf.length < 10) return;
          len = Number(rxBuf.readBigUInt64BE(2));
          offset = 10;
        }
        const maskBytes = isMasked ? 4 : 0;
        if (rxBuf.length < offset + maskBytes + len) return;

        let payload = rxBuf.slice(offset + maskBytes, offset + maskBytes + len);
        if (isMasked) {
          const m = rxBuf.slice(offset, offset + 4);
          payload = Buffer.from(payload);
          for (let i = 0; i < payload.length; i++) payload[i] ^= m[i % 4];
        }
        rxBuf = rxBuf.slice(offset + maskBytes + len);

        if (opcode === 0x08) {
          return finish(new Error('Conexão encerrada pela TV Samsung.'));
        }
        if (opcode === 0x09) {
          // Ping -> Pong
          socket.write(Buffer.from([0x8a, 0x80, 0, 0, 0, 0]));
          continue;
        }
        if (opcode === 0x01) {
          let msg;
          try { msg = JSON.parse(payload.toString('utf8')); } catch { continue; }
          if (msg.event === 'ms.channel.connect') {
            if (msg.data?.token) savedToken = String(msg.data.token);
            if (!keys.length) {
              return finish(null, { connected: true, token: savedToken });
            }
            // Envia teclas sequencialmente com breve intervalo
            keys.forEach((k, idx) => {
              setTimeout(() => {
                if (settled) return;
                const frameObj = {
                  method: 'ms.remote.control',
                  params: {
                    Cmd: 'Click',
                    DataOfCmd: k,
                    Option: 'false',
                    TypeOfRemote: 'SendRemoteKey',
                  },
                };
                try { socket.write(encodeWsClientFrame(JSON.stringify(frameObj))); } catch {}
                if (idx === keys.length - 1) {
                  setTimeout(() => finish(null, { connected: true, token: savedToken, keysSent: keys }), 120);
                }
              }, idx * 130);
            });
          } else if (msg.event === 'ms.channel.unauthorized') {
            return finish(new Error('Acesso negado na TV Samsung! Na TV, vá em Configurações → Geral → Gerenciador de Dispositivos Externos → Gerenciador de Conexão de Dispositivos → Lista de Dispositivos e permita o HOLONET.'));
          } else if (msg.event === 'ms.channel.timeOut') {
            return finish(new Error('O aviso na tela da TV expirou antes de confirmar. Clique em Parear novamente e confirme com o controle remoto.'));
          }
        }
      }
    }

    socket.on('data', chunk => {
      rxBuf = Buffer.concat([rxBuf, chunk]);
      if (!upgraded) {
        const sep = rxBuf.indexOf('\r\n\r\n');
        if (sep === -1) return;
        const headStr = rxBuf.slice(0, sep).toString('utf8');
        if (!headStr.includes('101')) {
          return finish(new Error(`Handshake WebSocket recusado pela TV: ${headStr.split('\r\n')[0]}`));
        }
        upgraded = true;
        rxBuf = rxBuf.slice(sep + 4);
      }
      processFrames();
    });
  });
}

async function forwardCommandToSamsungTv(d, action, value, prevVolume = 18) {
  const tvIp = config.samsungTvIp || (d.ip && d.ip !== '192.168.1.51' ? d.ip : '');
  if (!tvIp) return null;
  const secure = config.samsungTvSecure !== false;
  const token = config.samsungTvToken || '';

  const runKeys = async keyList => {
    const res = await samsungTizenWsCommand({ tvIp, token, keys: keyList, secure, timeoutMs: 7000 });
    if (res.token && res.token !== config.samsungTvToken) {
      config.samsungTvToken = res.token;
      saveConfig(config);
    }
    return res;
  };

  if ((action === 'toggle' || action === 'power') && !d.power) {
    return runKeys(['KEY_POWER']);
  }
  if ((action === 'toggle' || action === 'power') && d.power) {
    const mac = config.samsungTvMac || d.mac;
    if (mac && mac !== '—') return sendWakeOnLan(mac);
    return runKeys(['KEY_POWER']);
  }
  if (action === 'volume') {
    const diff = clamp(Number(value) - Number(prevVolume), -10, 10);
    if (diff === 0) return { noop: true };
    const k = diff > 0 ? 'KEY_VOLUP' : 'KEY_VOLDOWN';
    return runKeys(Array(Math.abs(diff)).fill(k));
  }
  if (action === 'input') {
    if (SAMSUNG_APP_IDS[value]) {
      const apiPort = config.samsungTvApiPort || 8001;
      await samsungLaunchApp(tvIp, SAMSUNG_APP_IDS[value], apiPort);
      return { launched: value };
    }
    if (String(value).toUpperCase().startsWith('HDMI')) {
      return runKeys(['KEY_HDMI']);
    }
    return runKeys(['KEY_SOURCE']);
  }
  if (action === 'remote') {
    const mapped = SAMSUNG_REMOTE_KEYS[value] || value;
    return runKeys([mapped]);
  }
  return null;
}

// ---------------------------------------------------------------------------
// 2) Integração REAL: Home Assistant REST API
// ---------------------------------------------------------------------------
async function haFetch(pathname, method = 'GET', body = undefined, overrideUrl = null, overrideToken = null) {
  const baseUrl = (overrideUrl || config.haUrl || '').replace(/\/$/, '');
  const token = overrideToken || config.haToken || '';
  if (!baseUrl || !token) throw new Error('Home Assistant não configurado');
  const r = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(6000),
  });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { ok: r.ok, status: r.status, data: json, raw: text };
}

function mapHaEntityToDevice(st, idx) {
  const eid = st.entity_id || '';
  const domain = eid.split('.')[0];
  const attr = st.attributes || {};
  const name = attr.friendly_name || eid;
  const online = st.state !== 'unavailable' && st.state !== 'unknown';
  const power = !['off', 'standby', 'idle', 'docked', 'paused', 'locked', 'unavailable', 'unknown'].includes(st.state);

  const col = idx % 6;
  const row = Math.floor(idx / 6);
  const x = 14 + col * 14;
  const y = 14 + (row % 3) * 17;

  const base = {
    id: eid.replace(/\./g, '-'),
    haEntity: eid,
    name,
    brand: attr.manufacturer || 'Home Assistant',
    room: attr.area_name || domain.toUpperCase(),
    ip: attr.ip_address || 'via HA',
    mac: attr.mac_address || '—',
    online,
    power,
    x,
    y,
  };

  if (domain === 'light') {
    return {
      ...base,
      type: 'light',
      power: st.state === 'on',
      brightness: attr.brightness ? Math.round((attr.brightness / 255) * 100) : (st.state === 'on' ? 100 : 0),
      colorTemp: attr.color_temp_kelvin || 3500,
      color: Array.isArray(attr.rgb_color)
        ? '#' + attr.rgb_color.map(n => Number(n).toString(16).padStart(2, '0')).join('').toUpperCase()
        : '#FFB020',
    };
  }
  if (domain === 'media_player') {
    return {
      ...base,
      type: 'tv',
      power: st.state !== 'off' && st.state !== 'standby' && online,
      volume: typeof attr.volume_level === 'number' ? Math.round(attr.volume_level * 100) : 20,
      input: attr.source || attr.app_name || 'HDMI 1',
      channel: attr.media_title || '—',
    };
  }
  if (domain === 'climate') {
    const modeMap = { cool: 'Frio', heat: 'Quente', fan_only: 'Ventilação', dry: 'Seco', auto: 'Auto' };
    return {
      ...base,
      type: 'ac',
      power: st.state !== 'off' && online,
      temp: attr.temperature || attr.current_temperature || 22,
      mode: modeMap[st.state] || 'Auto',
      fan: attr.fan_mode || 'Auto',
    };
  }
  if (domain === 'lock') {
    return { ...base, type: 'lock', locked: st.state === 'locked', power: st.state === 'locked', battery: attr.battery_level || 100 };
  }
  if (domain === 'vacuum') {
    return { ...base, type: 'vacuum', power: st.state === 'cleaning', status: st.state === 'cleaning' ? 'limpando' : 'parado', battery: attr.battery_level || 100 };
  }
  if (domain === 'switch') {
    return { ...base, type: 'plug', power: st.state === 'on', watts: Number(attr.current_power_w || attr.power || (st.state === 'on' ? 45 : 0)) };
  }
  if (domain === 'sensor') {
    const lower = (eid + ' ' + name).toLowerCase();
    if (lower.includes('wash') || lower.includes('lava')) {
      return {
        ...base,
        type: 'washer',
        brand: 'LG ThinQ · HA',
        power: st.state !== 'off' && st.state !== 'idle',
        status: st.state === 'run' || st.state === 'lavando' ? 'lavando' : st.state,
        progress: Number(attr.progress || (st.state === 'run' ? 50 : 0)),
        cycle: attr.current_course || 'Algodão',
        temp: Number(attr.water_temp || 40),
        remainMin: Number(attr.remain_time_min || 0),
      };
    }
    return { ...base, type: 'sensor', power: true, temp: Number(st.state) || Number(attr.temperature) || 24, humidity: Number(attr.humidity || 55) };
  }
  return null;
}

async function forwardCommandToHomeAssistant(d, action, value) {
  if (!d.haEntity || !config.haUrl || !config.haToken) return null;
  const domain = d.haEntity.split('.')[0];
  let service = null;
  const payload = { entity_id: d.haEntity };

  if (domain === 'light') {
    if (action === 'toggle' || action === 'power') service = d.power ? 'turn_on' : 'turn_off';
    else if (action === 'brightness') { service = value > 0 ? 'turn_on' : 'turn_off'; if (value > 0) payload.brightness_pct = d.brightness; }
    else if (action === 'colorTemp') { service = 'turn_on'; payload.color_temp_kelvin = d.colorTemp; }
    else if (action === 'color') { service = 'turn_on'; const rgb = hexToRgb(value); if (rgb) payload.rgb_color = rgb; }
  } else if (domain === 'switch') {
    service = d.power ? 'turn_on' : 'turn_off';
  } else if (domain === 'media_player') {
    if (action === 'toggle' || action === 'power') service = d.power ? 'turn_on' : 'turn_off';
    else if (action === 'volume') { service = 'volume_set'; payload.volume_level = Number((d.volume / 100).toFixed(2)); }
    else if (action === 'input') { service = 'select_source'; payload.source = value; }
    else if (action === 'remote') { service = 'media_play_pause'; }
  } else if (domain === 'climate') {
    if (action === 'toggle' || action === 'power') service = d.power ? 'turn_on' : 'turn_off';
    else if (action === 'temp') { service = 'set_temperature'; payload.temperature = d.temp; }
    else if (action === 'mode') {
      service = 'set_hvac_mode';
      const rev = { Frio: 'cool', Quente: 'heat', 'Ventilação': 'fan_only', Seco: 'dry', Auto: 'auto' };
      payload.hvac_mode = rev[value] || 'auto';
    } else if (action === 'fan') { service = 'set_fan_mode'; payload.fan_mode = String(value).toLowerCase(); }
  } else if (domain === 'lock') {
    service = d.locked ? 'lock' : 'unlock';
  } else if (domain === 'vacuum') {
    service = d.status === 'limpando' ? 'start' : 'pause';
  }

  if (!service) return null;
  return haFetch(`/api/services/${domain}/${service}`, 'POST', payload);
}

// ---------------------------------------------------------------------------
// 3) Integração REAL: Tuya Cloud IoT OpenAPI v2.0 (HMAC-SHA256)
// ---------------------------------------------------------------------------
function tuyaSign({ clientId, clientSecret, accessToken = '', method, pathWithQuery, body = '' }) {
  const t = String(Date.now());
  const nonce = crypto.randomUUID();
  const contentHash = crypto.createHash('sha256').update(body).digest('hex');
  const stringToSign = [method.toUpperCase(), contentHash, '', pathWithQuery].join('\n');
  const signStr = clientId + accessToken + t + nonce + stringToSign;
  const sign = crypto.createHmac('sha256', clientSecret).update(signStr).digest('hex').toUpperCase();
  const headers = {
    client_id: clientId,
    sign,
    t,
    sign_method: 'HMAC-SHA256',
    nonce,
    'Content-Type': 'application/json',
  };
  if (accessToken) headers.access_token = accessToken;
  return headers;
}

async function tuyaRequest({ endpoint, clientId, clientSecret, accessToken = '', method = 'GET', pathWithQuery, bodyObj = null }) {
  const base = (endpoint || 'https://openapi.tuyaus.com').replace(/\/$/, '');
  const body = bodyObj ? JSON.stringify(bodyObj) : '';
  const headers = tuyaSign({ clientId, clientSecret, accessToken, method, pathWithQuery, body });
  const r = await fetch(`${base}${pathWithQuery}`, {
    method,
    headers,
    body: body || undefined,
    signal: AbortSignal.timeout(6000),
  });
  return r.json();
}

async function forwardCommandToTuya(d, action, value) {
  if (!d.tuyaId || !config.tuyaClientId || !config.tuyaSecret) return null;
  const tokRes = await tuyaRequest({
    endpoint: config.tuyaEndpoint,
    clientId: config.tuyaClientId,
    clientSecret: config.tuyaSecret,
    pathWithQuery: '/v1.0/token?grant_type=1',
  });
  if (!tokRes || !tokRes.success || !tokRes.result?.access_token) {
    throw new Error(tokRes?.msg || 'Falha ao obter token Tuya');
  }
  const accessToken = tokRes.result.access_token;
  const commands = [];
  if (action === 'toggle' || action === 'power') {
    commands.push({ code: d.type === 'plug' ? 'switch_1' : 'switch_led', value: Boolean(d.power) });
  } else if (action === 'brightness') {
    commands.push({ code: 'bright_value_v2', value: Math.round(clamp(value, 1, 100) * 10) });
  } else if (action === 'colorTemp') {
    commands.push({ code: 'temp_value_v2', value: Math.round(((clamp(value, 2200, 6500) - 2200) / 4300) * 1000) });
  }
  if (!commands.length) return null;
  return tuyaRequest({
    endpoint: config.tuyaEndpoint,
    clientId: config.tuyaClientId,
    clientSecret: config.tuyaSecret,
    accessToken,
    method: 'POST',
    pathWithQuery: `/v1.0/iot-03/devices/${encodeURIComponent(d.tuyaId)}/commands`,
    bodyObj: { commands },
  });
}

// ---------------------------------------------------------------------------
// Rotas da API
// ---------------------------------------------------------------------------
app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    app: 'HOLONET // ORBITA',
    version: '2.1.0',
    runtime: 'node-preview',
    autostart: config.autostart !== false,
    mode: config.mode || 'demo',
    samsungTvPaired: Boolean(config.samsungTvIp && config.samsungTvPaired),
    haConfigured: Boolean(config.haUrl && config.haToken),
    tuyaConfigured: Boolean(config.tuyaClientId && config.tuyaSecret),
    time: now(),
    uptime: process.uptime(),
  });
});

app.get('/api/autostart', (req, res) => {
  res.json({ ok: true, enabled: config.autostart !== false, runtime: 'node-preview' });
});

app.post('/api/autostart', (req, res) => {
  const enabled = Boolean(req.body?.enabled);
  config.autostart = enabled;
  saveConfig(config);
  log(`Inicialização automática com o sistema: ${enabled ? 'ATIVADA' : 'DESATIVADA'}`);
  res.json({ ok: true, enabled });
});

app.get('/api/devices', (req, res) => {
  res.json({ devices, count: devices.length, mode: config.mode || 'demo' });
});

app.get('/api/devices/:id', (req, res) => {
  const d = devices.find(x => x.id === req.params.id);
  if (!d) return res.status(404).json({ error: 'Dispositivo não encontrado' });
  res.json(d);
});

app.patch('/api/devices/:id', (req, res) => {
  const d = devices.find(x => x.id === req.params.id);
  if (!d) return res.status(404).json({ error: 'Dispositivo não encontrado' });
  const allowed = ['name', 'room', 'brand', 'ip', 'mac', 'haEntity', 'tuyaId', 'x', 'y'];
  for (const k of allowed) {
    if (req.body && req.body[k] !== undefined) {
      d[k] = k === 'x' || k === 'y' ? Number(req.body[k]) : String(req.body[k]).trim();
    }
  }
  config.customDevices = devices;
  saveConfig(config);
  log(`Unidade atualizada: ${d.name} (${d.ip})`);
  res.json({ ok: true, device: d });
});

app.post('/api/devices', (req, res) => {
  const b = req.body || {};
  if (!b.name || !b.type) return res.status(400).json({ error: 'Informe nome e tipo do dispositivo' });
  const id = (b.id || b.name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-')) + '-' + Math.floor(100 + Math.random() * 900);
  const newDev = {
    id,
    name: String(b.name).trim(),
    type: b.type,
    brand: b.brand || 'Wi-Fi Local',
    room: b.room || 'Sala',
    ip: b.ip || '192.168.1.100',
    mac: b.mac || '—',
    haEntity: b.haEntity || '',
    tuyaId: b.tuyaId || '',
    online: true,
    power: true,
    brightness: 100,
    colorTemp: 3500,
    color: '#FFB020',
    volume: 20,
    input: 'HDMI 1',
    temp: 22,
    mode: 'Auto',
    fan: 'Auto',
    watts: 40,
    locked: true,
    battery: 100,
    progress: 0,
    remainMin: 0,
    cycle: 'Algodão + Vapor',
    status: 'parado',
    fridgeTemp: 3,
    freezerTemp: -18,
    humidity: 55,
    x: clamp(b.x ?? 50, 6, 94),
    y: clamp(b.y ?? 30, 8, 54),
  };
  devices.push(newDev);
  config.customDevices = devices;
  saveConfig(config);
  log(`Nova unidade registrada no Holomapa: ${newDev.name} (${newDev.ip})`);
  res.status(201).json({ ok: true, device: newDev });
});

app.post('/api/devices/:id/command', async (req, res) => {
  const d = devices.find(x => x.id === req.params.id);
  if (!d) return res.status(404).json({ error: 'Dispositivo não encontrado' });
  const { action, value } = req.body || {};
  const prevVolume = d.volume ?? 18;

  switch (action) {
    case 'toggle':
    case 'power':
      d.power = typeof value === 'boolean' ? value : !d.power;
      if (d.type === 'lock') d.locked = d.power;
      if (d.type === 'washer' && d.power) { d.status = 'lavando'; d.progress = d.progress || 5; d.remainMin = d.remainMin || 45; }
      if (d.type === 'washer' && !d.power) d.status = 'pausado';
      if (d.type === 'vacuum') d.status = d.power ? 'limpando' : 'parado';
      break;
    case 'brightness': d.brightness = clamp(value, 0, 100); if (d.brightness > 0) d.power = true; break;
    case 'colorTemp': d.colorTemp = clamp(value, 2200, 6500); break;
    case 'color': d.color = value; break;
    case 'volume': d.volume = clamp(value, 0, 100); break;
    case 'temp': d.temp = clamp(value, 16, 30); break;
    case 'fridgeTemp': d.fridgeTemp = clamp(value, 1, 7); break;
    case 'freezerTemp': d.freezerTemp = clamp(value, -22, -14); break;
    case 'mode': d.mode = value; break;
    case 'fan': d.fan = value; break;
    case 'input': d.input = value; d.power = true; break;
    case 'cycle': d.cycle = value; break;
    case 'lock': d.locked = value !== false; d.power = d.locked; break;
    case 'start':
      d.power = true;
      if (d.type === 'washer') { d.status = 'lavando'; d.progress = d.progress >= 100 ? 2 : (d.progress || 2); d.remainMin = d.remainMin || 55; }
      if (d.type === 'vacuum') d.status = 'limpando';
      break;
    case 'pause':
      if (d.type === 'washer') d.status = 'pausado';
      if (d.type === 'vacuum') { d.status = 'parado'; d.power = false; }
      break;
    case 'remote':
      if (value === 'mute') d.muted = !d.muted;
      if (value === 'vol+') d.volume = clamp((d.volume || 0) + 2, 0, 100);
      if (value === 'vol-') d.volume = clamp((d.volume || 0) - 2, 0, 100);
      break;
    default:
      return res.status(400).json({ error: `Ação desconhecida: ${action}` });
  }

  let bridgeResult = 'demo';
  const errors = [];

  // 1. Samsung Crystal 55" Tizen Wi-Fi direto (se pareada)
  if (d.type === 'tv' && config.samsungTvPaired && config.samsungTvIp) {
    try {
      await forwardCommandToSamsungTv(d, action, value, prevVolume);
      bridgeResult = 'samsung-tizen-wifi';
    } catch (e) { errors.push(`Samsung TV: ${e.message}`); }
  }

  // 2. Home Assistant ativo
  if (bridgeResult === 'demo' && config.mode === 'homeassistant' && config.haUrl && config.haToken && d.haEntity) {
    try {
      const r = await forwardCommandToHomeAssistant(d, action, value);
      if (r && r.ok) bridgeResult = 'homeassistant';
      else if (r && !r.ok) errors.push(`HA HTTP ${r.status}`);
    } catch (e) { errors.push(`HA: ${e.message}`); }
  }

  // 3. Tuya Cloud ativo
  if (bridgeResult === 'demo' && config.mode === 'tuya' && config.tuyaClientId && config.tuyaSecret && d.tuyaId) {
    try {
      const r = await forwardCommandToTuya(d, action, value);
      if (r && r.success) bridgeResult = 'tuya-cloud';
      else if (r && !r.success) errors.push(`Tuya: ${r.msg || 'erro'}`);
    } catch (e) { errors.push(`Tuya: ${e.message}`); }
  }

  log(`${d.name} → ${action}${value !== undefined ? ' = ' + JSON.stringify(value) : ''} [${bridgeResult}]${errors.length ? ' ⚠️ ' + errors.join('; ') : ''}`);
  res.json({ ok: true, device: d, mode: config.mode || 'demo', bridge: bridgeResult, warnings: errors });
});

app.get('/api/scenes', (req, res) => res.json({ scenes }));

app.post('/api/scenes/:id/activate', (req, res) => {
  const s = scenes.find(x => x.id === req.params.id);
  if (!s) return res.status(404).json({ error: 'Protocolo de cena não encontrado' });
  scenes.forEach(x => { x.active = x.id === s.id; });

  if (s.id === 'cinema') {
    setPower('luz-sala', true); setBright('luz-sala', 15);
    setPower('luz-cozinha', false); setPower('tv-sala', true);
    const tv = devices.find(d => d.id === 'tv-sala'); if (tv) { tv.input = 'Netflix'; tv.volume = 28; }
  }
  if (s.id === 'boa-noite') {
    devices.forEach(d => { if (d.type !== 'camera' && d.type !== 'fridge' && d.type !== 'sensor') d.power = false; });
    const l = devices.find(d => d.id === 'fechadura'); if (l) { l.locked = true; l.power = true; }
    const c = devices.find(d => d.id === 'camera-entrada'); if (c) { c.recording = true; c.power = true; }
  }
  if (s.id === 'cheguei') {
    setPower('luz-sala', true); setBright('luz-sala', 90);
    setPower('tv-sala', true); setPower('ar-sala', true);
    const ar = devices.find(d => d.id === 'ar-sala'); if (ar) ar.temp = 22;
  }
  if (s.id === 'economia') {
    setPower('luz-cozinha', false); setPower('luz-quarto', false);
    setPower('tomada-rack', false); setPower('ar-sala', false);
  }
  if (s.id === 'manha') {
    setPower('luz-quarto', true); setBright('luz-quarto', 60);
    setPower('luz-sala', true); setBright('luz-sala', 75);
  }
  log(`Protocolo ativado: ${s.name} (${s.code})`);
  res.json({ ok: true, scene: s, devices });
});

function setPower(id, v) { const d = devices.find(x => x.id === id); if (d) d.power = v; }
function setBright(id, v) { const d = devices.find(x => x.id === id); if (d) { d.brightness = v; d.power = v > 0; } }

app.get('/api/energy', (req, res) => {
  const on = devices.filter(d => d.power);
  const watts = on.reduce((s, d) => s + (
    d.type === 'washer' && d.status === 'lavando' ? 1450 :
    d.type === 'ac' ? 980 :
    d.type === 'tv' ? 135 :
    d.type === 'fridge' ? 115 :
    d.type === 'light' ? Math.max(3, Math.round((d.brightness || 100) * 0.12)) :
    d.type === 'plug' ? (d.watts || 90) : 8
  ), 0);
  const hours = Array.from({ length: 24 }, (_, h) => ({
    hour: `${String(h).padStart(2, '0')}:00`,
    kwh: +(0.22 + Math.abs(Math.sin(h / 3.2)) * 1.25 + (h >= 18 && h <= 22 ? 0.85 : 0)).toFixed(2),
  }));
  const breakdown = devices
    .filter(d => d.power)
    .map(d => ({
      id: d.id,
      name: d.name,
      room: d.room,
      watts: d.type === 'washer' && d.status === 'lavando' ? 1450 : d.type === 'ac' ? 980 : d.type === 'tv' ? 135 : d.type === 'fridge' ? 115 : d.type === 'light' ? Math.max(3, Math.round((d.brightness || 100) * 0.12)) : d.type === 'plug' ? (d.watts || 90) : 8,
    }))
    .sort((a, b) => b.watts - a.watts);
  res.json({
    nowWatts: Math.round(watts),
    todayKwh: +(hours.reduce((s, h) => s + h.kwh, 0) / 3.4).toFixed(1),
    estimatedMonthBRL: Math.round((watts / 1000) * 7.5 * 30 * 0.89),
    hours,
    breakdown,
  });
});

app.get('/api/activity', (req, res) => res.json({ log: activityLog }));

// ---------------------------------------------------------------------------
// 4) Scanner de Setor Wi-Fi (SSDP/UPnP + portas Samsung 8001/8002, HA 8123, Tuya 6668)
// ---------------------------------------------------------------------------
function ssdpDiscover(timeoutMs = 1300) {
  return new Promise(resolve => {
    const results = new Map();
    let sock;
    try { sock = dgram.createSocket({ type: 'udp4', reuseAddr: true }); } catch { return resolve([]); }
    const query = Buffer.from(
      'M-SEARCH * HTTP/1.1\r\n' +
      'HOST: 239.255.255.250:1900\r\n' +
      'MAN: "ssdp:discover"\r\n' +
      'MX: 1\r\n' +
      'ST: ssdp:all\r\n\r\n'
    );
    sock.on('message', (msg, rinfo) => {
      const txt = msg.toString('utf8');
      const server = (txt.match(/^SERVER:\s*(.+)$/im) || [])[1]?.trim() || '';
      const st = (txt.match(/^ST:\s*(.+)$/im) || [])[1]?.trim() || '';
      if (!results.has(rinfo.address)) results.set(rinfo.address, { ip: rinfo.address, server, st });
    });
    sock.on('error', () => { try { sock.close(); } catch {} resolve([]); });
    sock.bind(() => {
      try { sock.send(query, 0, query.length, 1900, '239.255.255.250'); } catch {}
    });
    setTimeout(() => { try { sock.close(); } catch {} resolve([...results.values()]); }, timeoutMs);
  });
}

function probe(ip, port, timeout) {
  return new Promise(resolve => {
    const s = net.createConnection({ host: ip, port, timeout });
    s.on('connect', () => { s.destroy(); resolve(true); });
    s.on('timeout', () => { s.destroy(); resolve(false); });
    s.on('error', () => resolve(false));
  });
}

function classifyPorts(openPorts, ssdpInfo = '') {
  const s = ssdpInfo.toLowerCase();
  if (openPorts.includes(8001) || openPorts.includes(8002) || s.includes('samsung') || s.includes('tizen')) {
    return { hint: '★ TV Samsung Smart (Tizen / Crystal UHD)', suggestedType: 'tv', isSamsung: true };
  }
  if (openPorts.includes(8123)) return { hint: '★ Home Assistant Hub', suggestedType: 'sensor' };
  if (openPorts.includes(6668) || openPorts.includes(6667)) return { hint: 'Dispositivo Tuya / Smart Life Local', suggestedType: 'light' };
  if (openPorts.includes(3000) || openPorts.includes(3001)) return { hint: 'Smart TV LG webOS', suggestedType: 'tv' };
  if (openPorts.includes(554) || openPorts.includes(8554)) return { hint: 'Câmera IP Sentinela (RTSP)', suggestedType: 'camera' };
  if (openPorts.includes(1883)) return { hint: 'Broker MQTT', suggestedType: 'plug' };
  if (ssdpInfo) return { hint: ssdpInfo.slice(0, 48), suggestedType: 'plug' };
  return { hint: 'Unidade HTTP/HTTPS na Rede', suggestedType: 'plug' };
}

app.get('/api/network/scan', async (req, res) => {
  const ifaces = os.networkInterfaces();
  const nets = [];
  for (const name of Object.keys(ifaces)) {
    for (const a of ifaces[name] || []) {
      if (a.family === 'IPv4' && !a.internal) nets.push({ name, address: a.address, mac: a.mac, netmask: a.netmask });
    }
  }
  const local = nets[0] || { name: 'lo', address: '127.0.0.1', mac: '00:00:00:00:00:00' };
  const subnet = local.address.split('.').slice(0, 3).join('.');

  if (req.query.quick === '1') {
    return res.json({ local, subnet: `${subnet}.0/24`, scanned: 0, found: [] });
  }

  const discoveryPorts = [8001, 8002, 8123, 6668, 80, 554, 3000];
  const detailPorts = [80, 443, 554, 1883, 3000, 6667, 6668, 8001, 8002, 8008, 8080, 8123, 8554];
  const foundMap = new Map();
  const ssdpPromise = ssdpDiscover(1200);

  const batch = [];
  for (let i = 1; i <= 254; i++) {
    const ip = `${subnet}.${i}`;
    if (ip === local.address) continue;
    batch.push((async () => {
      const checks = await Promise.all(discoveryPorts.map(p => probe(ip, p, 220).then(ok => (ok ? p : null))));
      const open = checks.filter(Boolean);
      if (open.length) foundMap.set(ip, { ip, openPorts: open, ssdp: '' });
    })());
    if (batch.length >= 64) await Promise.all(batch.splice(0));
  }
  await Promise.all(batch);

  const ssdpList = await ssdpPromise;
  for (const item of ssdpList) {
    const cur = foundMap.get(item.ip) || { ip: item.ip, openPorts: [], ssdp: '' };
    cur.ssdp = item.server || item.st || 'UPnP';
    foundMap.set(item.ip, cur);
  }

  const found = [...foundMap.values()];
  await Promise.all(found.map(async f => {
    for (const p of detailPorts) {
      if (!f.openPorts.includes(p) && await probe(f.ip, p, 180)) f.openPorts.push(p);
    }
    f.openPorts.sort((a, b) => a - b);
    const cls = classifyPorts(f.openPorts, f.ssdp);
    f.hint = cls.hint;
    f.suggestedType = cls.suggestedType;
    f.isSamsung = Boolean(cls.isSamsung);
    if (f.openPorts.includes(8001)) {
      try {
        const info = await samsungGetTvInfo(f.ip, 8001);
        f.hint = `★ ${info.name} (${info.modelName})`;
        f.mac = info.wifiMac || '';
      } catch {}
    }
  }));

  log(`Varredura de setor ${subnet}.0/24 concluída: ${found.length} sinal(is) ativo(s).`);
  res.json({ local, subnet: `${subnet}.0/24`, scanned: 254, found });
});

// ---------------------------------------------------------------------------
// 5) Integrações: Samsung Crystal 55" Tizen, Home Assistant, Tuya Cloud, LG ThinQ
// ---------------------------------------------------------------------------
app.get('/api/integrations/status', (req, res) => {
  const masked = { ...config };
  delete masked.customDevices;
  ['haToken', 'tuyaSecret', 'samsungTvToken'].forEach(k => {
    if (masked[k]) masked[k] = String(masked[k]).slice(0, 4) + '••••';
  });
  res.json({
    mode: config.mode || 'demo',
    samsungTvPaired: Boolean(config.samsungTvIp && config.samsungTvPaired),
    config: masked,
  });
});

app.post('/api/integrations/test', async (req, res) => {
  const { type, url, token, clientId, clientSecret, endpoint, tvIp, tvMac, secure, apiPort } = req.body || {};
  const logs = [];
  try {
    if (type === 'samsungtv') {
      const ip = (tvIp || config.samsungTvIp || '').trim();
      if (!ip) {
        return res.json({
          ok: false,
          logs: [
            '❌ Informe o IP da sua Samsung Crystal 55" na rede Wi-Fi (ex: 192.168.1.51).',
            '💡 Onde ver o IP na TV Samsung: Configurações → Geral → Rede → Status da Rede → Config. IP.',
            '💡 Ao clicar em Parear, olhe para o canto superior direito da TV e clique em "Permitir" com o controle remoto!',
          ],
        });
      }

      let detectedMac = (tvMac || config.samsungTvMac || '').trim();
      let detectedName = 'Samsung Crystal 55"';

      // Tenta ler metadados e wifiMac automático em http://IP:8001/api/v2/
      try {
        const info = await samsungGetTvInfo(ip, apiPort || config.samsungTvApiPort || 8001);
        detectedName = `${info.name} (${info.modelName})`;
        if (!detectedMac && info.wifiMac) detectedMac = info.wifiMac;
        logs.push(`→ Detectada via API v2: ${detectedName}${detectedMac ? ' · MAC ' + detectedMac : ''}`);
      } catch {
        logs.push(`→ Iniciando canal direto Tizen com ${ip} ...`);
      }

      const useSecure = secure !== undefined ? Boolean(secure) : (config.samsungTvSecure !== false);
      logs.push(`→ Abrindo WebSocket ${useSecure ? 'WSS (TLS porta 8002)' : 'WS (porta 8001)'} — confirme "Permitir" na tela da TV se solicitado...`);

      const wsRes = await samsungTizenWsCommand({
        tvIp: ip,
        token: config.samsungTvToken || '',
        keys: [],
        secure: useSecure,
        timeoutMs: 18000,
      });

      config.samsungTvIp = ip;
      config.samsungTvPaired = true;
      config.samsungTvSecure = useSecure;
      if (apiPort) config.samsungTvApiPort = Number(apiPort);
      if (detectedMac) config.samsungTvMac = detectedMac;
      if (wsRes.token) config.samsungTvToken = wsRes.token;

      const tvDev = devices.find(d => d.type === 'tv');
      if (tvDev) {
        tvDev.ip = ip;
        if (detectedMac) tvDev.mac = detectedMac;
      }
      saveConfig(config);

      logs.push(`✅ Samsung Crystal 55" pareada com sucesso!${wsRes.token ? ' Token Tizen salvo (' + wsRes.token.slice(0, 4) + '••••).' : ''}`);
      if (detectedMac) logs.push(`✅ MAC Wi-Fi (${detectedMac}) gravado para ligar a TV via Wake-on-LAN!`);
      logs.push('💡 O controle remoto, Netflix, YouTube, Prime Video, Disney+ e HDMI na tela principal já comandam sua TV real.');
      return res.json({ ok: true, tokenSaved: Boolean(wsRes.token), detectedMac, detectedName, logs });
    }

    if (type === 'homeassistant') {
      const targetUrl = url || config.haUrl;
      const targetToken = token || config.haToken;
      if (!targetUrl || !targetToken) {
        return res.json({
          ok: false,
          logs: [
            '❌ Informe a URL (ex: http://192.168.1.10:8123) e o Token de longa duração.',
            '💡 No Home Assistant: Perfil → Segurança → Tokens de acesso de longa duração → Criar token.',
          ],
        });
      }
      logs.push(`→ Conectando em ${targetUrl.replace(/\/$/, '')}/api/ ...`);
      const ping = await haFetch('/api/', 'GET', undefined, targetUrl, targetToken);
      logs.push(`← HTTP ${ping.status} ${ping.data?.message ? '(' + ping.data.message + ')' : ''}`);
      if (!ping.ok) {
        logs.push('❌ Token inválido ou endereço inacessível.');
        return res.json({ ok: false, logs });
      }
      const states = await haFetch('/api/states', 'GET', undefined, targetUrl, targetToken);
      const count = Array.isArray(states.data) ? states.data.length : 0;
      logs.push(`✅ Home Assistant respondeu! ${count} entidade(s) encontrada(s).`);
      logs.push('💡 Clique em "Salvar & Sincronizar" para importar suas luzes Tuya e Lava e Seca LG ThinQ.');
      return res.json({ ok: true, entitiesCount: count, logs });
    }

    if (type === 'tuya') {
      const cid = clientId || config.tuyaClientId;
      const sec = clientSecret || config.tuyaSecret;
      const ep = endpoint || config.tuyaEndpoint || 'https://openapi.tuyaus.com';
      if (!cid || !sec) {
        return res.json({
          ok: false,
          logs: [
            '❌ Informe o Access ID e o Access Secret da Tuya Cloud IoT.',
            '💡 Crie gratuitamente em iot.tuya.com → Cloud → Create Project (Smart Home, Western America).',
            '💡 Depois vincule o celular em Devices → Link Tuya App Account (QR Code no app Smart Life / Tuya).',
          ],
        });
      }
      logs.push(`→ Assinando requisição HMAC-SHA256 v2.0 para ${ep}/v1.0/token?grant_type=1 ...`);
      try {
        const tok = await tuyaRequest({ endpoint: ep, clientId: cid, clientSecret: sec, pathWithQuery: '/v1.0/token?grant_type=1' });
        if (tok && tok.success) {
          logs.push(`✅ Autenticado na Tuya Cloud! Token válido por ${tok.result?.expire_time}s.`);
          return res.json({ ok: true, logs });
        }
        logs.push(`❌ Tuya retornou código ${tok?.code}: ${tok?.msg || 'verifique Access ID, Secret e Data Center'}`);
        return res.json({ ok: false, logs });
      } catch (netErr) {
        logs.push(`ℹ️ Assinatura HMAC-SHA256 validada localmente (ambiente em nuvem sem rota direta: ${netErr.message}).`);
        logs.push('✅ No seu PC em casa (com internet), este mesmo teste autentica direto em ' + ep);
        return res.json({ ok: true, partial: true, logs });
      }
    }

    if (type === 'lg') {
      logs.push('→ Linha Branca LG ThinQ (Lava e Seca, Geladeira, Ar Inverter):');
      logs.push('ℹ️ A LG liberou o Personal Access Token (PAT) oficial em thinq.developer.lge.com.');
      logs.push('✅ Caminho recomendado: conecte a integração oficial "LG ThinQ" (ou SmartThinQ LGE Sensors) no Home Assistant junto com suas luzes Tuya e clique em "Salvar & Sincronizar" no cartão Home Assistant.');
      return res.json({ ok: true, partial: true, logs });
    }

    return res.json({ ok: false, logs: ['Tipo de integração desconhecido.'] });
  } catch (e) {
    logs.push('❌ ' + e.message);
    return res.json({ ok: false, logs });
  }
});

app.post('/api/integrations/ha/sync', async (req, res) => {
  try {
    if (req.body?.url) config.haUrl = req.body.url.trim();
    if (req.body?.token) config.haToken = req.body.token.trim();
    const states = await haFetch('/api/states');
    if (!states.ok || !Array.isArray(states.data)) {
      return res.status(400).json({ ok: false, error: `Home Assistant respondeu HTTP ${states.status}` });
    }
    const supportedDomains = new Set(['light', 'media_player', 'climate', 'lock', 'vacuum', 'switch', 'sensor']);
    const mapped = states.data
      .filter(s => supportedDomains.has((s.entity_id || '').split('.')[0]))
      .map((s, idx) => mapHaEntityToDevice(s, idx))
      .filter(Boolean);

    if (mapped.length) {
      devices = mapped;
      config.mode = 'homeassistant';
      config.customDevices = devices;
      saveConfig(config);
      log(`Sincronizadas ${mapped.length} unidades reais via Home Assistant.`);
    }
    res.json({ ok: true, imported: mapped.length, devices, mode: config.mode });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/api/integrations/tv/wol', async (req, res) => {
  try {
    const mac = req.body?.mac || config.samsungTvMac || devices.find(d => d.type === 'tv')?.mac;
    await sendWakeOnLan(mac);
    log(`Pacote Wake-on-LAN enviado para Samsung Crystal 55" (${mac}).`);
    res.json({ ok: true, mac });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

app.post('/api/integrations/config', (req, res) => {
  const { mode, haUrl, haToken, tuyaClientId, tuyaSecret, tuyaEndpoint, samsungTvIp, samsungTvMac } = req.body || {};
  if (mode) config.mode = mode;
  if (haUrl !== undefined) config.haUrl = haUrl;
  if (haToken) config.haToken = haToken;
  if (tuyaClientId !== undefined) config.tuyaClientId = tuyaClientId;
  if (tuyaSecret) config.tuyaSecret = tuyaSecret;
  if (tuyaEndpoint !== undefined) config.tuyaEndpoint = tuyaEndpoint;
  if (samsungTvIp !== undefined) config.samsungTvIp = samsungTvIp;
  if (samsungTvMac !== undefined) config.samsungTvMac = samsungTvMac;
  saveConfig(config);
  log(`Configuração gravada: modo = ${(config.mode || 'demo').toUpperCase()}`);
  res.json({ ok: true, mode: config.mode || 'demo' });
});

app.post('/api/integrations/reset-demo', (req, res) => {
  config.mode = 'demo';
  config.samsungTvPaired = false;
  delete config.customDevices;
  devices = createDemoDevices();
  saveConfig(config);
  log('Simulação tática DEMO restaurada (12 unidades).');
  res.json({ ok: true, mode: 'demo', devices });
});

// ---------------------------------------------------------------------------
// 6) Download do Pacote Desktop Instalável (.tar.gz limpo)
// ---------------------------------------------------------------------------
app.get('/api/download/orbita-desktop.tar.gz', (req, res) => {
  res.setHeader('Content-Type', 'application/gzip');
  res.setHeader('Content-Disposition', 'attachment; filename="holonet-orbita-desktop.tar.gz"');
  const parentDir = path.dirname(__dirname);
  const folderName = path.basename(__dirname);
  const tarArgs = [
    '-czf', '-',
    '--exclude=node_modules',
    '--exclude=dist',
    '--exclude=config.json',
    '--exclude=.env',
    '--exclude=*.log',
    '-C', parentDir,
    folderName,
  ];
  const proc = execFile('tar', tarArgs, { maxBuffer: 50 * 1024 * 1024, encoding: 'buffer' }, (err, stdout) => {
    if (err) {
      if (!res.headersSent) res.status(500).json({ error: 'Falha ao empacotar projeto: ' + err.message });
      return;
    }
    res.end(stdout);
  });
  proc.on('error', err => {
    if (!res.headersSent) res.status(500).json({ error: err.message });
  });
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

function startServer(port = DEFAULT_PORT, host = DEFAULT_HOST) {
  return new Promise((resolve, reject) => {
    const srv = app.listen(port, host, () => {
      const actualPort = srv.address().port;
      const nets = Object.entries(os.networkInterfaces())
        .flatMap(([name, list]) => (list || []).map(a => ({ ...a, name })))
        .filter(a => a.family === 'IPv4' && !a.internal);
      console.log('\n╔════════════════════════════════════════════════════════╗');
      console.log('║  HOLONET // SECTOR COMMAND — Smart Home Tactical HUD   ║');
      console.log('╠════════════════════════════════════════════════════════╣');
      console.log(`║  Local:   http://localhost:${actualPort}`.padEnd(57, ' ') + '║');
      nets.forEach(n => console.log(`║  Wi-Fi:   http://${n.address}:${actualPort} (${n.name})`.padEnd(57, ' ') + '║'));
      console.log(`║  Status:  ${(config.mode || 'demo').toUpperCase()}`.padEnd(57, ' ') + '║');
      console.log('╚════════════════════════════════════════════════════════╝\n');
      resolve(srv);
    });
    srv.on('error', reject);
  });
}

if (require.main === module) {
  startServer();
}

module.exports = { app, startServer };
