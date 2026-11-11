/* HOLONET // SECTOR COMMAND — Starfighter Tactical HUD + Samsung Crystal 55" Tizen Control */
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const API = '';
let devices = [], scenes = [], selectedId = 'tv-sala', filterType = 'all', mode = 'demo';
let deferredPwaPrompt = null;
let sfxEnabled = true;
let audioCtx = null;

const ICONS = { light:'💡', washer:'🫧', tv:'📺', ac:'❄️', fridge:'🧊', lock:'🔒', camera:'📷', plug:'🔌', vacuum:'🤖', sensor:'🌡️' };
const TYPE_LABEL = { light:'Iluminação', washer:'Lava e Seca', tv:'TV Samsung', ac:'Climatizador', fridge:'Refrigerador', lock:'Trava', camera:'Sentinela', plug:'Reator/Tomada', vacuum:'Droide Robô', sensor:'Sonda Clima' };

/* ---------- Starfield Canvas ---------- */
(function initStarfield() {
  const c = $('#starfield');
  if (!c) return;
  const ctx = c.getContext('2d');
  let stars = [];
  function resize() {
    c.width = window.innerWidth;
    c.height = window.innerHeight;
    stars = Array.from({ length: 130 }, () => ({
      x: Math.random() * c.width,
      y: Math.random() * c.height,
      r: Math.random() * 1.35 + 0.3,
      a: Math.random() * 0.65 + 0.2,
      s: Math.random() * 0.14 + 0.03,
      hue: Math.random() > 0.82 ? '#FFB020' : Math.random() > 0.55 ? '#3DD8FF' : '#E8E6DF',
    }));
  }
  resize();
  window.addEventListener('resize', resize);
  function draw() {
    ctx.clearRect(0, 0, c.width, c.height);
    for (const st of stars) {
      st.x -= st.s;
      if (st.x < 0) st.x = c.width;
      ctx.globalAlpha = st.a;
      ctx.fillStyle = st.hue;
      ctx.fillRect(st.x, st.y, st.r, st.r);
    }
    requestAnimationFrame(draw);
  }
  requestAnimationFrame(draw);
})();

/* ---------- Cockpit Tactical Audio (Web Audio Synthesizer) ---------- */
function playSfx(kind = 'blip') {
  if (!sfxEnabled) return;
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const now = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);

    if (kind === 'lock') {
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(680, now);
      osc.frequency.setValueAtTime(980, now + 0.045);
      gain.gain.setValueAtTime(0.045, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.11);
      osc.start(now);
      osc.stop(now + 0.12);
    } else if (kind === 'cmd') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(520, now);
      osc.frequency.exponentialRampToValueAtTime(760, now + 0.08);
      gain.gain.setValueAtTime(0.05, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
      osc.start(now);
      osc.stop(now + 0.11);
    } else if (kind === 'scene') {
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(330, now);
      osc.frequency.setValueAtTime(495, now + 0.07);
      osc.frequency.setValueAtTime(660, now + 0.14);
      gain.gain.setValueAtTime(0.035, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.24);
      osc.start(now);
      osc.stop(now + 0.25);
    } else {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(840, now);
      gain.gain.setValueAtTime(0.03, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
      osc.start(now);
      osc.stop(now + 0.06);
    }
  } catch {}
}

$('#btnSfx').addEventListener('click', () => {
  sfxEnabled = !sfxEnabled;
  const b = $('#btnSfx');
  b.textContent = sfxEnabled ? '🔊 HUD SFX' : '🔇 SFX OFF';
  b.classList.toggle('muted', !sfxEnabled);
  if (sfxEnabled) playSfx('lock');
});

let autostartEnabled = true;
function renderAutostartBtn() {
  const b = $('#btnAutostart');
  if (!b) return;
  b.textContent = autostartEnabled ? '🚀 BOOT: ATIVO' : '🚀 BOOT: OFF';
  b.classList.toggle('muted', !autostartEnabled);
}
$('#btnAutostart')?.addEventListener('click', async () => {
  try {
    playSfx('cmd');
    const r = await api('/api/autostart', {
      method: 'POST',
      body: JSON.stringify({ enabled: !autostartEnabled }),
    });
    autostartEnabled = Boolean(r.enabled);
    renderAutostartBtn();
    toast(autostartEnabled
      ? 'Inicialização automática ATIVADA — abrirá ao ligar o PC!'
      : 'Inicialização automática com o PC desativada.');
  } catch (e) {
    toast('Erro ao alternar auto-iniciar: ' + e.message);
  }
});

async function api(path, opts = {}) {
  const r = await fetch(API + path, { headers: { 'Content-Type': 'application/json' }, ...opts });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || ('HTTP ' + r.status));
  return data;
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = '// ' + msg;
  t.classList.add('show');
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.remove('show'), 3500);
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
}

/* ---------- PWA Service Worker ---------- */
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  deferredPwaPrompt = e;
  $('#pwaHint').innerHTML = '✅ Navegador compatível detectado! Clique em <b>Instalar Janela PWA</b> acima para fixar o console na sua área de trabalho.';
});

/* ---------- Clock ---------- */
function tickClock() {
  const d = new Date();
  $('#clockTime').textContent = d.toLocaleTimeString('pt-BR', { hour:'2-digit', minute:'2-digit', second:'2-digit' });
  $('#clockDate').textContent = d.toLocaleDateString('pt-BR', { weekday:'short', day:'2-digit', month:'short' });
}
setInterval(tickClock, 1000);
tickClock();

/* ---------- Views Navigation ---------- */
function switchView(viewName) {
  playSfx('blip');
  $$('.rail-btn').forEach(x => x.classList.toggle('active', x.dataset.view === viewName));
  $$('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + viewName));
  if (viewName === 'energy') loadEnergy();
  if (viewName === 'network') loadLocalNetQuick();
  if (viewName === 'integrations') loadIntegrationStatus();
}
$$('.rail-btn').forEach(b => b.addEventListener('click', () => switchView(b.dataset.view)));
$('#btnTopInstall').addEventListener('click', () => switchView('install'));
$('#btnGoInteg').addEventListener('click', () => switchView('integrations'));

/* ---------- Load All ---------- */
async function loadAll() {
  try {
    const [d, s, h] = await Promise.all([api('/api/devices'), api('/api/scenes'), api('/api/health')]);
    devices = d.devices || [];
    scenes = s.scenes || [];
    mode = h.mode || 'demo';
    if (h.autostart !== undefined) {
      autostartEnabled = Boolean(h.autostart);
      renderAutostartBtn();
    }
    if (!devices.find(x => x.id === selectedId) && devices[0]) selectedId = devices[0].id;
    renderStats(h);
    renderFloor();
    renderCards();
    renderDetail();
    renderQuickScenes();
    renderScenes();
    renderFilters();
    loadLog();
  } catch {
    toast('Servidor local offline. Execute: npm start');
  }
}

function renderStats(health = {}) {
  const online = devices.filter(d => d.online).length;
  $('#statDevices').textContent = String(devices.length).padStart(2, '0');
  $('#statOnline').textContent = `${online}/${devices.length}`;
  const isReal = mode !== 'demo' || health.samsungTvPaired;
  const label = mode === 'homeassistant' ? 'HOLONET // HA' : mode === 'tuya' ? 'TUYA LINK' : health.samsungTvPaired ? 'SAMSUNG TIZEN' : 'SIMULAÇÃO';
  const m = $('#statMode');
  m.textContent = label;
  m.className = isReal ? 'mode-real' : 'mode-demo';
  $('#railMode').textContent = isReal ? 'LINK' : 'SIM';
  $('#railDot').className = 'rail-dot' + (isReal ? ' real' : '');
  $('#devCount').textContent = `${devices.length} MÓDULOS REGISTRADOS`;
}

/* ---------- Yavin IV Holographic Sector Map ---------- */
function renderFloor() {
  const g = $('#floorNodes');
  g.innerHTML = '';
  const NS = 'http://www.w3.org/2000/svg';
  devices.forEach(d => {
    const grp = document.createElementNS(NS, 'g');
    const isSel = d.id === selectedId;
    grp.setAttribute('class', 'floor-node' + (isSel ? ' sel' : ''));
    grp.dataset.id = d.id;

    const warn = d.type === 'washer' && d.status === 'concluído';
    const col = !d.online ? '#355066' : warn ? '#FF3344' : d.power ? '#FFB020' : '#3DD8FF';

    // Outer holographic ring
    const halo = document.createElementNS(NS, 'circle');
    halo.setAttribute('cx', d.x);
    halo.setAttribute('cy', d.y);
    halo.setAttribute('r', isSel ? 4.2 : 3.0);
    halo.setAttribute('fill', isSel ? 'rgba(255,176,32,0.14)' : d.power ? 'rgba(255,176,32,0.06)' : 'rgba(61,216,255,0.05)');
    halo.setAttribute('stroke', isSel ? '#FFB020' : '#266A8A');
    halo.setAttribute('stroke-width', isSel ? '.45' : '.3');
    if (isSel) halo.setAttribute('stroke-dasharray', '1.3 0.8');

    // X-Wing Targeting Corner Brackets when locked
    if (isSel) {
      const brk = document.createElementNS(NS, 'path');
      const bx = d.x, by = d.y, s = 5.1, l = 1.6;
      brk.setAttribute('d', [
        `M${bx - s},${by - s + l} V${by - s} H${bx - s + l}`,
        `M${bx + s - l},${by - s} H${bx + s} V${by - s + l}`,
        `M${bx + s},${by + s - l} V${by + s} H${bx + s - l}`,
        `M${bx - s + l},${by + s} H${bx - s} V${by + s - l}`,
      ].join(' '));
      brk.setAttribute('fill', 'none');
      brk.setAttribute('stroke', '#3DD8FF');
      brk.setAttribute('stroke-width', '0.42');
      grp.appendChild(brk);
    }

    // Diamond Starfighter Core
    const core = document.createElementNS(NS, 'rect');
    core.setAttribute('x', d.x - 1.3);
    core.setAttribute('y', d.y - 1.3);
    core.setAttribute('width', 2.6);
    core.setAttribute('height', 2.6);
    core.setAttribute('fill', col);
    core.setAttribute('transform', `rotate(45 ${d.x} ${d.y})`);
    if (d.power && d.online) core.style.filter = `drop-shadow(0 0 2.5px ${col})`;

    const label = document.createElementNS(NS, 'text');
    label.setAttribute('x', d.x);
    label.setAttribute('y', d.y + 5.7);
    label.setAttribute('text-anchor', 'middle');
    label.setAttribute('font-family', 'Share Tech Mono, monospace');
    label.setAttribute('font-size', '1.78');
    label.setAttribute('fill', isSel ? '#FFB020' : '#8CCCE5');
    const shortName = d.name.replace('Samsung Crystal 55" UHD', 'Crystal 55"').split('—')[0].trim().slice(0, 14);
    label.textContent = shortName.toUpperCase();

    grp.append(halo, core, label);
    grp.addEventListener('click', () => selectDevice(d.id));
    g.appendChild(grp);
  });
}

/* ---------- Module Cards ---------- */
function stateText(d) {
  switch (d.type) {
    case 'tv': return d.power ? `ATIVA · <b>${esc(d.input)}</b> · VOL ${d.volume}` : 'STANDBY (WAKE-ON-LAN)';
    case 'light': return d.power ? `ACESA · <b>${d.brightness}%</b> · ${d.colorTemp}K` : 'DESENERGIZADA';
    case 'washer': return d.status === 'lavando' ? `CICLO · <b>${d.progress}%</b> · -${d.remainMin}m` : d.status === 'concluído' ? 'CICLO CONCLUÍDO ✓' : d.power ? 'EM ESPERA' : 'PAUSADA';
    case 'ac': return d.power ? `<b>${d.temp}°C</b> · ${esc(d.mode)} · VENT ${esc(d.fan)}` : 'DESLIGADO';
    case 'fridge': return `REFRIG <b>${d.fridgeTemp}°C</b> · CRIO ${d.freezerTemp}°C`;
    case 'lock': return d.locked ? '🔒 COMPORTA SELADA' : '🔓 DESTRANCADA';
    case 'camera': return d.recording ? '● GRAVANDO SETOR' : 'EM ESPERA';
    case 'plug': return d.power ? `REATOR · <b>${d.watts}W</b>` : 'CORTADA (0W)';
    case 'vacuum': return d.status === 'limpando' ? 'PATRULHANDO SETOR…' : `NA DOCA · BAT ${d.battery}%`;
    case 'sensor': return `<b>${d.temp}°C</b> · UMID ${d.humidity}%`;
    default: return d.power ? 'OPERANDO' : 'STANDBY';
  }
}

function cardHTML(d, idx) {
  const warn = d.type === 'washer' && d.status === 'concluído';
  const bar = d.type === 'washer'
    ? `<div class="mini-bar"><i style="width:${d.progress || 0}%"></i></div>`
    : d.type === 'light'
    ? `<div class="mini-bar"><i style="width:${d.power ? (d.brightness || 0) : 0}%"></i></div>`
    : '';
  return `<article class="card ${d.power ? '' : 'off'} ${d.id === selectedId ? 'sel' : ''}" data-id="${esc(d.id)}">
    <div class="card-top">
      <div style="display:flex;align-items:center;gap:8px">
        <span class="card-icon">${ICONS[d.type] || '❖'}</span>
        <span class="card-sector">UNIT-${String(idx + 1).padStart(2, '0')} // ${esc(d.room).toUpperCase()}</span>
      </div>
      <span class="card-dot ${!d.online ? '' : warn ? 'warn' : d.power ? 'on' : ''}"></span>
    </div>
    <h4>${esc(d.name)}</h4>
    <div class="cmeta">${esc(d.brand)} · IP ${esc(d.ip)}</div>
    <div class="cstate">${stateText(d)}</div>${bar}
    <span class="card-toggle" title="Acionar / Cortar Energia"><span class="mini-toggle ${d.power ? 'on' : ''}" data-toggle="${esc(d.id)}"></span></span>
  </article>`;
}

function renderCards() {
  const list = filterType === 'all' ? devices : devices.filter(d => d.type === filterType);
  $('#deviceCards').innerHTML = devices.map((d, i) => cardHTML(d, i)).join('');
  $('#deviceCardsAll').innerHTML = list.map((d, i) => cardHTML(d, i)).join('');
  $$('.card').forEach(c => c.addEventListener('click', e => {
    if (e.target.closest('[data-toggle]')) return;
    selectDevice(c.dataset.id);
  }));
  $$('[data-toggle]').forEach(t => t.addEventListener('click', async e => {
    e.stopPropagation();
    const d = devices.find(x => x.id === t.dataset.toggle);
    if (d) await command(d.id, 'toggle', !d.power);
  }));
}

function renderFilters() {
  const types = ['all', ...new Set(devices.map(d => d.type))];
  $('#typeFilters').innerHTML = types
    .map(t => `<button class="fbtn ${t === filterType ? 'sel' : ''}" data-f="${t}">${t === 'all' ? 'Todos (' + devices.length + ')' : (TYPE_LABEL[t] || t)}</button>`)
    .join('');
  $$('.fbtn').forEach(b => b.addEventListener('click', () => {
    playSfx('blip');
    filterType = b.dataset.f;
    renderFilters();
    renderCards();
  }));
}

/* ---------- X-Wing Targeting Computer (Device Detail) ---------- */
function selectDevice(id) {
  selectedId = id;
  playSfx('lock');
  renderFloor();
  renderCards();
  renderDetail();
}

function renderDetail() {
  const d = devices.find(x => x.id === selectedId);
  const body = $('#detailBody');
  if (!d) {
    body.innerHTML = `<div class="hint">Trave a mira em uma unidade no holomapa.</div>`;
    $('#detailBrand').textContent = '—';
    return;
  }
  $('#detailBrand').textContent = d.brand.toUpperCase();
  const warn = d.type === 'washer' && d.status === 'concluído';
  const statusCls = !d.online ? '' : warn ? 'warn' : d.power ? 'on' : '';
  const statusTxt = !d.online ? 'SINAL PERDIDO' : warn ? 'CICLO FINALIZADO' : d.power ? 'SISTEMA ENERGIZADO' : 'EM STANDBY';
  let controls = '';

  if (d.type === 'tv') {
    controls = `
      <div class="ctrl"><label>POTÊNCIA DE ÁUDIO (PASSOS TIZEN) <output>${d.volume}%</output></label>
        <input type="range" min="0" max="100" value="${d.volume}" data-ctl="volume" style="--fill:${d.volume}%"></div>
      <div class="d-meta" style="margin:6px 0 4px;color:var(--cyan)">ATALHOS SAMSUNG TIZEN (API v2):</div>
      <div class="chips">${['Netflix', 'YouTube', 'Prime Video', 'Disney+', 'Spotify', 'HDMI 1', 'Entradas'].map(i => `<button class="chip ${d.input === i ? 'sel' : ''}" data-input="${i}">${i}</button>`).join('')}</div>
      <div class="d-meta" style="margin:10px 0 4px;color:var(--cyan)">DATAPAD SAMSUNG ONE REMOTE:</div>
      <div class="remote">
        <button data-r="vol+">VOL +</button>
        <button data-r="up" class="primary-key">▲</button>
        <button data-r="ch+">CH +</button>

        <button data-r="left" class="primary-key">◀</button>
        <button data-r="ok" class="primary-key">ENTER</button>
        <button data-r="right" class="primary-key">▶</button>

        <button data-r="vol-">VOL −</button>
        <button data-r="down" class="primary-key">▼</button>
        <button data-r="ch-">CH −</button>

        <button data-r="back">↩ VOLTAR</button>
        <button data-r="home">⌂ SMART HUB</button>
        <button data-r="mute">${d.muted ? '🔇 MUDO' : '🔊 MUDO'}</button>

        <button data-r="source">⎆ HDMI/SRC</button>
        <button data-r="play">▶ PLAY</button>
        <button data-r="pause">⏸ PAUSE</button>
      </div>
      <div class="d-actions">
        <button class="btn ghost sm" id="btnQuickWol">⚡ Wake-on-LAN (Ligar TV)</button>
        <button class="btn ghost sm" id="btnQuickPairTv">⬡ Parear Samsung 55"</button>
      </div>`;
  }

  if (d.type === 'light') {
    controls = `
      <div class="ctrl"><label>INTENSIDADE DE FÓTONS <output>${d.brightness}%</output></label>
        <input type="range" min="0" max="100" value="${d.brightness}" data-ctl="brightness" style="--fill:${d.brightness}%"></div>
      <div class="ctrl"><label>ESPECTRO KELVIN <output>${d.colorTemp}K</output></label>
        <input type="range" min="2200" max="6500" step="100" value="${d.colorTemp}" data-ctl="colorTemp" style="--fill:${(d.colorTemp - 2200) / 43}%"></div>
      <div class="chips">${['#FFB020', '#3DD8FF', '#FFFFFF', '#FF3344', '#FF7A2F'].map(c => `<button class="chip ${d.color === c ? 'sel' : ''}" data-color="${c}" style="border-color:${c}">◆ ${c}</button>`).join('')}</div>`;
  }

  if (d.type === 'washer') {
    const off = 2 * Math.PI * 44;
    controls = `<div class="progress-ring">
      <svg class="ring" viewBox="0 0 100 100">
        <circle class="track" cx="50" cy="50" r="44"/>
        <circle class="val" cx="50" cy="50" r="44" stroke-dasharray="${off}" stroke-dashoffset="${off * (1 - (d.progress || 0) / 100)}"/>
        <text x="50" y="48" text-anchor="middle" dy=".3em">${d.progress || 0}%</text>
        <text x="50" y="66" text-anchor="middle" class="subtxt">LG THINQ</text>
      </svg>
      <div>
        <div class="d-meta" style="margin:0;color:var(--cyan)">PROGRAMA</div><strong>${esc(d.cycle)}</strong>
        <div class="d-meta" style="margin:7px 0 0;color:var(--cyan)">CONTAGEM REGRESSIVA</div><strong class="amber">${d.remainMin} min</strong>
        <div class="d-meta" style="margin:7px 0 0;color:var(--cyan)">TEMPERATURA</div><strong>${d.temp}°C</strong>
      </div></div>
      <div class="chips">${['Algodão + Vapor', 'TurboWash 39', 'Delicado', 'Rápido 14 min', 'Edredom'].map(c => `<button class="chip ${d.cycle === c ? 'sel' : ''}" data-cycle="${c}">${c}</button>`).join('')}</div>
      <div class="d-actions">
        <button class="btn solid" data-act="start">▶ Iniciar Ciclo</button>
        <button class="btn ghost" data-act="pause">⏸ Pausar</button>
      </div>`;
  }

  if (d.type === 'ac') {
    controls = `<div class="ctrl"><label>SUPORTE DE VIDA // CLIMA <output>${d.temp}°C</output></label>
      <input type="range" min="16" max="30" value="${d.temp}" data-ctl="temp" style="--fill:${((d.temp - 16) / 14) * 100}%"></div>
      <div class="chips">${['Frio', 'Quente', 'Ventilação', 'Seco', 'Auto'].map(m => `<button class="chip ${d.mode === m ? 'sel' : ''}" data-mode="${m}">${m}</button>`).join('')}</div>
      <div class="chips">${['Baixa', 'Média', 'Alta', 'Auto'].map(f => `<button class="chip ${d.fan === f ? 'sel' : ''}" data-fan="${f}">Turbina: ${f}</button>`).join('')}</div>`;
  }

  if (d.type === 'fridge') {
    controls = `<div class="ctrl"><label>CÂMARA PRINCIPAL <output>${d.fridgeTemp}°C</output></label>
      <input type="range" min="1" max="7" value="${d.fridgeTemp}" data-ctl="fridgeTemp" style="--fill:${((d.fridgeTemp - 1) / 6) * 100}%"></div>
      <div class="ctrl"><label>CÂMARA CRIOGÊNICA (FREEZER) <output>${d.freezerTemp}°C</output></label>
      <input type="range" min="-22" max="-14" value="${d.freezerTemp}" data-ctl="freezerTemp" style="--fill:${((d.freezerTemp + 22) / 8) * 100}%"></div>`;
  }

  if (d.type === 'lock') {
    controls = `<div class="switch-row"><span>Comporta (${d.locked ? 'SELADA' : 'ABERTA'})</span><button class="toggle ${d.locked ? 'on' : ''}" data-act="locktoggle"></button></div>
      <p class="hint">Célula de energia da trava: <b class="amber">${d.battery}%</b></p>`;
  }

  if (d.type === 'camera') {
    controls = `<div style="background:#03060C;border:1px solid var(--line2);aspect-ratio:16/9;display:flex;align-items:center;justify-content:center;font-size:38px;position:relative">📷
      <span style="position:absolute;top:10px;left:12px;font-family:var(--mono);font-size:10.5px;color:${d.recording ? '#FF3344' : '#55728A'}">${d.recording ? '● REC // SENTINELA RTSP' : '○ STANDBY'}</span>
      <span style="position:absolute;bottom:10px;right:12px;font-family:var(--mono);font-size:10.5px;color:var(--cyan)">${esc(d.ip)}</span></div>`;
  }

  if (d.type === 'sensor') {
    controls = `<div class="progress-ring">
      <div><div class="d-meta" style="margin:0;color:var(--cyan)">TEMPERATURA</div><strong style="font-family:var(--display);font-size:28px" class="amber">${d.temp}°C</strong></div>
      <div><div class="d-meta" style="margin:0;color:var(--cyan)">UMIDADE</div><strong style="font-family:var(--display);font-size:28px" class="cyan">${d.humidity}%</strong></div>
    </div>`;
  }

  if (d.type === 'vacuum') {
    controls = `<p class="hint">Estado do droide: <b class="amber">${esc(d.status).toUpperCase()}</b> · Célula: <b>${d.battery}%</b></p>
      <div class="d-actions"><button class="btn solid" data-act="start">▶ Iniciar Patrulha</button><button class="btn ghost" data-act="pause">⏸ Retornar</button></div>`;
  }

  if (d.type === 'plug') {
    controls = `<p class="hint">Drenagem medida em tempo real: <b class="amber" style="font-size:17px">${d.power ? d.watts : 0} W</b></p>`;
  }

  body.innerHTML = `
    <div class="target-frame">
      <div class="target-kicker">// ALVO TRAVADO · COORD [${d.x}, ${d.y}]</div>
      <div class="d-top-row">
        <div class="d-name">${esc(d.name)}</div>
        <button class="btn ghost sm" id="btnEditDev">⚙ Vincular</button>
      </div>
      <div class="d-meta">SETOR: ${esc(d.room).toUpperCase()} · IP: ${esc(d.ip)} · MAC: ${esc(d.mac)}</div>
      <span class="d-status ${statusCls}"><i></i>${statusTxt}</span>
    </div>
    <div class="switch-row"><span>Chave Geral de Força</span><button class="toggle ${d.power ? 'on' : ''}" data-act="power"></button></div>
    ${controls}`;

  body.querySelector('#btnEditDev')?.addEventListener('click', () => openDeviceModal(d));
  body.querySelector('#btnQuickPairTv')?.addEventListener('click', () => switchView('integrations'));
  body.querySelector('#btnQuickWol')?.addEventListener('click', async () => {
    try {
      const r = await api('/api/integrations/tv/wol', { method: 'POST', body: JSON.stringify({ mac: d.mac }) });
      playSfx('cmd');
      toast(`Pacote Wake-on-LAN disparado para ${r.mac}`);
    } catch (e) { toast(e.message); }
  });
  body.querySelector('[data-act="power"]')?.addEventListener('click', () => command(d.id, 'toggle', !d.power));
  body.querySelector('[data-act="locktoggle"]')?.addEventListener('click', () => command(d.id, 'lock', !d.locked));
  body.querySelector('[data-act="start"]')?.addEventListener('click', () => command(d.id, 'start'));
  body.querySelector('[data-act="pause"]')?.addEventListener('click', () => command(d.id, 'pause'));

  body.querySelectorAll('[data-ctl]').forEach(el => {
    el.addEventListener('input', () => {
      const v = Number(el.value);
      el.style.setProperty('--fill', ((v - el.min) / (el.max - el.min) * 100) + '%');
      const unit = el.dataset.ctl === 'colorTemp' ? 'K' : ['temp', 'fridgeTemp', 'freezerTemp'].includes(el.dataset.ctl) ? '°C' : '%';
      el.closest('.ctrl').querySelector('output').textContent = v + unit;
    });
    el.addEventListener('change', () => command(d.id, el.dataset.ctl, Number(el.value)));
  });

  body.querySelectorAll('[data-color]').forEach(b => b.addEventListener('click', () => command(d.id, 'color', b.dataset.color)));
  body.querySelectorAll('[data-cycle]').forEach(b => b.addEventListener('click', () => command(d.id, 'cycle', b.dataset.cycle)));
  body.querySelectorAll('[data-input]').forEach(b => b.addEventListener('click', () => command(d.id, 'input', b.dataset.input)));
  body.querySelectorAll('[data-mode]').forEach(b => b.addEventListener('click', () => command(d.id, 'mode', b.dataset.mode)));
  body.querySelectorAll('[data-fan]').forEach(b => b.addEventListener('click', () => command(d.id, 'fan', b.dataset.fan)));
  body.querySelectorAll('[data-r]').forEach(b => b.addEventListener('click', () => command(d.id, 'remote', b.dataset.r)));
}

async function command(id, action, value) {
  try {
    playSfx('cmd');
    const r = await api(`/api/devices/${id}/command`, {
      method: 'POST',
      body: JSON.stringify({ action, value }),
    });
    const i = devices.findIndex(x => x.id === id);
    if (i >= 0) devices[i] = r.device;
    renderStats();
    renderFloor();
    renderCards();
    renderDetail();
    loadLog();
    loadEnergy();
    const via = r.bridge && r.bridge !== 'demo' ? ` [${r.bridge.toUpperCase()}]` : ' [SIMULAÇÃO]';
    toast(`${r.device.name}: ${action}${value !== undefined ? ' = ' + value : ''}${via}`);
  } catch (e) {
    toast('Falha na transmissão: ' + e.message);
  }
}

/* ---------- Modal: Add / Edit Device ---------- */
function openDeviceModal(dev = null, preset = {}) {
  playSfx('blip');
  $('#devModal').hidden = false;
  $('#modalTitle').textContent = dev ? `CALIBRAR UNIDADE // ${dev.name.toUpperCase()}` : 'REGISTRAR NOVA UNIDADE NO SETOR';
  $('#mDevId').value = dev ? dev.id : '';
  $('#mName').value = dev ? dev.name : (preset.name || '');
  $('#mType').value = dev ? dev.type : (preset.type || 'tv');
  $('#mType').disabled = Boolean(dev);
  $('#mRoom').value = dev ? dev.room : (preset.room || 'Sala');
  $('#mBrand').value = dev ? dev.brand : (preset.brand || 'Samsung Tizen');
  $('#mIp').value = dev ? dev.ip : (preset.ip || '');
  $('#mMac').value = dev ? dev.mac : (preset.mac || '');
  $('#mHaEntity').value = dev ? (dev.haEntity || '') : '';
  $('#mTuyaId').value = dev ? (dev.tuyaId || '') : '';
}
function closeDeviceModal() { $('#devModal').hidden = true; }
$('#btnNewDevice').addEventListener('click', () => openDeviceModal(null));
$('#btnNewDevice2').addEventListener('click', () => openDeviceModal(null));
$('#btnCloseModal').addEventListener('click', closeDeviceModal);
$('#btnCancelModal').addEventListener('click', closeDeviceModal);
$('#btnSaveModal').addEventListener('click', async () => {
  const id = $('#mDevId').value;
  const payload = {
    name: $('#mName').value.trim(),
    type: $('#mType').value,
    room: $('#mRoom').value.trim() || 'Sala',
    brand: $('#mBrand').value.trim() || 'Wi-Fi',
    ip: $('#mIp').value.trim(),
    mac: $('#mMac').value.trim(),
    haEntity: $('#mHaEntity').value.trim(),
    tuyaId: $('#mTuyaId').value.trim(),
  };
  if (!payload.name) return toast('Informe a designação da unidade.');
  try {
    if (id) {
      const r = await api(`/api/devices/${id}`, { method: 'PATCH', body: JSON.stringify(payload) });
      const idx = devices.findIndex(d => d.id === id);
      if (idx >= 0) devices[idx] = r.device;
      toast('Coordenadas de rede atualizadas!');
    } else {
      const r = await api('/api/devices', { method: 'POST', body: JSON.stringify(payload) });
      devices.push(r.device);
      selectedId = r.device.id;
      toast('Unidade incorporada ao Holomapa!');
    }
    closeDeviceModal();
    renderStats(); renderFloor(); renderCards(); renderDetail(); renderFilters();
  } catch (e) { toast('Erro: ' + e.message); }
});

/* ---------- Scenes / Protocols ---------- */
function renderQuickScenes() {
  $('#quickScenes').innerHTML = scenes.slice(0, 4)
    .map(s => `<button class="qscene" data-scene="${esc(s.id)}">
      <span class="qcode">// ${esc(s.code || 'PROTO')}</span>
      <b>${s.icon} ${esc(s.name)}</b>
      <small>${esc(s.desc)}</small>
    </button>`)
    .join('');
  $$('#quickScenes [data-scene]').forEach(b => b.addEventListener('click', () => activateScene(b.dataset.scene)));
}

function renderScenes() {
  $('#scenesGrid').innerHTML = scenes.map(s => `<div class="scene-card ${s.active ? 'active' : ''}">
    <div class="scode">// ${esc(s.code || 'PROTOCOL')}</div>
    <h3>${s.icon} ${esc(s.name)}</h3>
    <p>${esc(s.desc)}</p>
    <button class="btn ${s.active ? 'ghost' : 'solid'}" data-scene="${esc(s.id)}">${s.active ? '✓ PROTOCOLO EM EXECUÇÃO' : 'EXECUTAR PROTOCOLO'}</button>
  </div>`).join('');
  $$('#scenesGrid [data-scene]').forEach(b => b.addEventListener('click', () => activateScene(b.dataset.scene)));
}

async function activateScene(id) {
  playSfx('scene');
  const r = await api(`/api/scenes/${id}/activate`, { method: 'POST' });
  scenes = r.scenes || scenes;
  devices = r.devices || devices;
  renderStats(); renderFloor(); renderCards(); renderDetail(); renderScenes(); loadLog(); loadEnergy();
  const sc = scenes.find(s => s.id === id);
  if (sc) toast(`Protocolo ativado: ${sc.name}`);
}

$('#btnAllOff').addEventListener('click', async () => {
  playSfx('scene');
  for (const d of devices) {
    if (d.power && d.type !== 'fridge' && d.type !== 'camera' && d.type !== 'sensor') {
      await command(d.id, 'toggle', false);
    }
  }
  toast('Corte de emergência concluído (refrigerador e sentinela preservados).');
});

/* ---------- Log ---------- */
async function loadLog() {
  try {
    const { log } = await api('/api/activity');
    $('#activityLog').innerHTML = (log || [])
      .map(l => `<div><time>[${new Date(l.time).toLocaleTimeString('pt-BR')}]</time>${esc(l.text)}</div>`)
      .join('') || '<div>Nenhuma transmissão registrada.</div>';
  } catch {}
}
$('#btnRefreshLog').addEventListener('click', loadLog);

/* ---------- Reactor Energy ---------- */
let energyData = null;
async function loadEnergy() {
  try {
    energyData = await api('/api/energy');
    $('#statWatts').textContent = energyData.nowWatts + 'W';
    $('#energyNow').textContent = energyData.nowWatts;
    $('#energyToday').textContent = energyData.todayKwh;
    $('#energyMonth').textContent = energyData.estimatedMonthBRL;
    renderBreakdown();
    drawChart();
  } catch {}
}

function renderBreakdown() {
  const box = $('#energyBreakdown');
  if (!box || !energyData) return;
  const list = energyData.breakdown || [];
  const maxW = Math.max(100, ...list.map(x => x.watts));
  box.innerHTML = list.length
    ? list.map(item => `<div class="b-row">
        <div class="b-row-head"><span>${esc(item.name)} // ${esc(item.room)}</span><b>${item.watts} W</b></div>
        <div class="b-bar"><i style="width:${Math.max(5, Math.round((item.watts / maxW) * 100))}%"></i></div>
      </div>`).join('')
    : '<p class="hint">Reator em carga mínima de sobrevivência.</p>';
}

function drawChart() {
  const c = $('#energyChart');
  if (!c || !energyData || !c.clientWidth) return;
  const dpr = window.devicePixelRatio || 1;
  const w = c.clientWidth, h = 230;
  c.width = w * dpr; c.height = h * dpr; c.style.height = h + 'px';
  const ctx = c.getContext('2d');
  ctx.scale(dpr, dpr);
  const data = energyData.hours.map(x => x.kwh);
  const max = Math.max(...data) * 1.15, pad = 38;
  ctx.strokeStyle = '#172A3E'; ctx.lineWidth = 1;
  for (let i = 0; i < 4; i++) {
    const y = pad + ((h - pad - 24) * i) / 3;
    ctx.beginPath(); ctx.moveTo(pad, y); ctx.lineTo(w - 8, y); ctx.stroke();
    ctx.fillStyle = '#55728A'; ctx.font = '10px Share Tech Mono';
    ctx.fillText((max * (1 - i / 3)).toFixed(1), 4, y + 3);
  }
  const stepX = (w - pad - 10) / (data.length - 1);
  ctx.beginPath();
  data.forEach((v, i) => {
    const x = pad + i * stepX, y = h - 24 - (v / max) * (h - pad - 24);
    i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
  });
  ctx.strokeStyle = '#3DD8FF'; ctx.lineWidth = 2; ctx.stroke();
  ctx.lineTo(w - 10, h - 24); ctx.lineTo(pad, h - 24); ctx.closePath();
  ctx.fillStyle = 'rgba(61, 216, 255, 0.12)'; ctx.fill();

  // Amber peak markers
  data.forEach((v, i) => {
    const x = pad + i * stepX, y = h - 24 - (v / max) * (h - pad - 24);
    if (i % 3 === 0) {
      ctx.fillStyle = '#FFB020';
      ctx.fillRect(x - 2, y - 2, 4, 4);
    }
  });

  ctx.fillStyle = '#67B7D4'; ctx.font = '10px Share Tech Mono';
  energyData.hours.forEach((hh, i) => {
    if (i % 4 === 0) ctx.fillText(hh.hour, pad + i * stepX - 12, h - 7);
  });
}

/* ---------- Wi-Fi Sensor Sweep ---------- */
async function loadLocalNetQuick() {
  try {
    const r = await api('/api/network/scan?quick=1');
    $('#localNetBody').innerHTML = `TRANSCEPTOR <b>${esc(r.local.name)}</b> · IP <b>${esc(r.local.address)}</b> · MAC <b>${esc(r.local.mac)}</b> · SETOR <b>${esc(r.subnet)}</b>`;
    $('#netIp').textContent = r.local.address;
  } catch {}
}

async function scanNetwork() {
  playSfx('scene');
  const btn = $('#btnScan');
  btn.disabled = true; btn.textContent = '◎ SONDANDO SUB-REDE…';
  $('#radar').classList.remove('idle');
  $('#scanStatus').textContent = 'SONDANDO 254 COORDENADAS IP…';
  $('#foundList').innerHTML = '<div class="found-item"><span>Emitindo pulso SSDP/UPnP e testando portas 8001/8002 (Samsung Crystal), 8123 (Home Assistant), 6668 (Tuya)…</span></div>';
  try {
    const r = await api('/api/network/scan');
    $('#localNetBody').innerHTML = `TRANSCEPTOR <b>${esc(r.local.name)}</b> · IP <b>${esc(r.local.address)}</b> · MAC <b>${esc(r.local.mac)}</b> · SETOR <b>${esc(r.subnet)}</b>`;
    $('#netIp').textContent = r.local.address;
    $('#scanStatus').textContent = `${r.found.length} ASSINATURA(S) ATIVA(S)`;
    if (r.found.length) {
      $('#foundList').innerHTML = r.found.map((f, idx) => `<div class="found-item">
        <div>
          <b>${esc(f.ip)}</b>${f.mac ? ` · MAC <span class="ports">${esc(f.mac)}</span>` : ''} · <span class="ports">PORTAS [${f.openPorts.join(', ') || 'SSDP'}]</span>
          <div style="margin-top:4px;color:var(--ink)">${esc(f.hint || '')}</div>
        </div>
        <div style="display:flex;gap:8px">
          ${f.isSamsung ? `<button class="btn solid sm" data-pair-sam="${idx}">⌖ Parear Samsung</button>` : ''}
          <button class="btn ghost sm" data-add-host="${idx}">+ Registrar</button>
        </div>
      </div>`).join('');
      $$('[data-pair-sam]').forEach(b => b.addEventListener('click', () => {
        const f = r.found[Number(b.dataset.pairSam)];
        $('#samsungTvIp').value = f.ip;
        if (f.mac) $('#samsungTvMac').value = f.mac;
        switchView('integrations');
        $('#btnPairSamsungTv').click();
      }));
      $$('[data-add-host]').forEach(b => b.addEventListener('click', () => {
        const f = r.found[Number(b.dataset.addHost)];
        openDeviceModal(null, { name: f.hint.replace('★ ', ''), type: f.suggestedType || 'plug', ip: f.ip, mac: f.mac || '', brand: f.hint.replace('★ ', '') });
      }));
    } else {
      $('#foundList').innerHTML = '<div class="found-item"><span>Nenhuma assinatura doméstica detectada nesta rede isolada de demonstração. Ao abrir o <b>HOLONET Desktop</b> no seu PC em casa, sua Samsung Crystal 55", lâmpadas Tuya e Home Assistant aparecerão listados aqui com botão de pareamento em 1 clique!</span></div>';
    }
    toast(`Sonda finalizada: ${r.found.length} assinatura(s) encontrada(s).`);
  } catch (e) {
    $('#foundList').innerHTML = `<div class="found-item"><span>Erro na sonda: ${esc(e.message)}</span></div>`;
  }
  $('#radar').classList.add('idle');
  btn.disabled = false; btn.textContent = '◎ Iniciar Varredura de Setor';
}
$('#btnScan').addEventListener('click', scanNetwork);
$('#btnScanTop').addEventListener('click', () => { switchView('network'); scanNetwork(); });

/* ---------- Integrations ---------- */
async function loadIntegrationStatus() {
  try {
    const s = await api('/api/integrations/status');
    if (s.config?.samsungTvIp) $('#samsungTvIp').value = s.config.samsungTvIp;
    if (s.config?.samsungTvMac) $('#samsungTvMac').value = s.config.samsungTvMac;
    if (s.config?.haUrl) $('#haUrl').value = s.config.haUrl;
    if (s.config?.tuyaClientId) $('#tuyaId').value = s.config.tuyaClientId;
    if (s.config?.tuyaEndpoint) $('#tuyaEndpoint').value = s.config.tuyaEndpoint;
  } catch {}
}

function term(id, lines) {
  const el = $('#' + id);
  el.classList.add('show');
  el.innerHTML = (lines || []).map(l => `<div class="${l.startsWith('✅') ? 'ok' : l.startsWith('❌') ? 'err' : ''}">${esc(l)}</div>`).join('');
}

$('#btnPairSamsungTv').addEventListener('click', async () => {
  playSfx('lock');
  const tvIp = $('#samsungTvIp').value.trim();
  const tvMac = $('#samsungTvMac').value.trim();
  term('termSamsungTv', [`→ Abrindo link seguro Tizen WSS (porta 8002) com ${tvIp || '...'} — olhe para sua Samsung Crystal 55" e clique em "Permitir" no controle remoto…`]);
  const r = await api('/api/integrations/test', {
    method: 'POST',
    body: JSON.stringify({ type: 'samsungtv', tvIp, tvMac }),
  });
  if (r.detectedMac && !$('#samsungTvMac').value) $('#samsungTvMac').value = r.detectedMac;
  term('termSamsungTv', r.logs);
  await loadAll();
  toast(r.ok ? '✅ Samsung Crystal 55" pareada!' : '❌ Veja as instruções no terminal do cartão.');
});

$('#btnWolSamsungTv').addEventListener('click', async () => {
  playSfx('cmd');
  const mac = $('#samsungTvMac').value.trim();
  try {
    const r = await api('/api/integrations/tv/wol', { method: 'POST', body: JSON.stringify({ mac }) });
    term('termSamsungTv', [`✅ Pulso Wake-on-LAN UDP transmitido para MAC ${r.mac}.`]);
    toast(`⚡ Pulso Wake-on-LAN enviado (${r.mac})`);
  } catch (e) {
    term('termSamsungTv', [`❌ ${e.message}`]);
    toast(e.message);
  }
});

$('#btnTestHa').addEventListener('click', async () => {
  playSfx('blip');
  term('termHa', ['→ Testando canal Home Assistant…']);
  const r = await api('/api/integrations/test', {
    method: 'POST',
    body: JSON.stringify({ type: 'homeassistant', url: $('#haUrl').value.trim(), token: $('#haToken').value.trim() }),
  });
  term('termHa', r.logs);
  toast(r.ok ? '✅ Home Assistant online!' : '❌ Verifique URL e Token.');
});

$('#btnSyncHa').addEventListener('click', async () => {
  playSfx('scene');
  const url = $('#haUrl').value.trim();
  const token = $('#haToken').value.trim();
  if (!url) return toast('Informe a URL do Home Assistant.');
  term('termHa', ['→ Sincronizando entidades Tuya e LG ThinQ do Home Assistant…']);
  try {
    const r = await api('/api/integrations/ha/sync', { method: 'POST', body: JSON.stringify({ url, token }) });
    term('termHa', [`✅ ${r.imported} módulos importados com sucesso!`, '💡 Volte ao Holomapa Tático para operá-los ao vivo.']);
    await loadAll();
    toast(`✅ ${r.imported} módulos sincronizados!`);
  } catch (e) {
    term('termHa', [`❌ Falha ao sincronizar: ${e.message}`]);
    toast('Falha ao sincronizar com Home Assistant.');
  }
});

$('#btnTestTuya').addEventListener('click', async () => {
  playSfx('blip');
  term('termTuya', ['→ Calculando assinatura HMAC-SHA256 Tuya OpenAPI v2.0…']);
  const r = await api('/api/integrations/test', {
    method: 'POST',
    body: JSON.stringify({
      type: 'tuya',
      clientId: $('#tuyaId').value.trim(),
      clientSecret: $('#tuyaSecret').value.trim(),
      endpoint: $('#tuyaEndpoint').value.trim(),
    }),
  });
  term('termTuya', r.logs);
});

$('#btnSaveTuya').addEventListener('click', async () => {
  playSfx('cmd');
  await api('/api/integrations/config', {
    method: 'POST',
    body: JSON.stringify({
      mode: 'tuya',
      tuyaClientId: $('#tuyaId').value.trim(),
      tuyaSecret: $('#tuyaSecret').value.trim(),
      tuyaEndpoint: $('#tuyaEndpoint').value.trim(),
    }),
  });
  await loadAll();
  toast('Credenciais Tuya gravadas no console!');
});

$('#btnTestLg').addEventListener('click', async () => {
  playSfx('blip');
  const r = await api('/api/integrations/test', { method: 'POST', body: JSON.stringify({ type: 'lg' }) });
  term('termLg', r.logs);
});

$('#btnResetDemo').addEventListener('click', async () => {
  playSfx('scene');
  await api('/api/integrations/reset-demo', { method: 'POST' });
  await loadAll();
  toast('Simulação tática restaurada.');
});

/* ---------- PWA Install (optional) ---------- */
$('#btnPwaInstall')?.addEventListener('click', async () => {
  if (deferredPwaPrompt) {
    deferredPwaPrompt.prompt();
    const choice = await deferredPwaPrompt.userChoice;
    if (choice.outcome === 'accepted') toast('✅ Console instalado na sua área de trabalho!');
    deferredPwaPrompt = null;
  }
});

/* ---------- Boot ---------- */
loadAll();
loadEnergy();
loadLocalNetQuick();
setInterval(loadEnergy, 15000);
window.addEventListener('resize', drawChart);

/* ===================== MODO VISUAL LIMPO ===================== */
function applyCleanMode(on) {
  document.body.classList.toggle('clean', on);
  const b = $('#btnClean');
  if (b) {
    b.textContent = on ? '✦ VISUAL: LIMPO' : '✧ VISUAL: HUD COMPLETO';
    b.classList.toggle('muted', !on);
  }
}
let cleanMode = localStorage.getItem('holonetClean') !== '0';
applyCleanMode(cleanMode);
$('#btnClean')?.addEventListener('click', () => {
  cleanMode = !cleanMode;
  localStorage.setItem('holonetClean', cleanMode ? '1' : '0');
  applyCleanMode(cleanMode);
  playSfx('blip');
});

/* ===================== ASSISTENTE DE CONEXÃO ===================== */
const WIZ_TITLES = ['Rede Wi-Fi', 'Samsung TV', 'Tuya / LG', 'Pronto'];
let wizStep = 1;

function renderWizard() {
  $$('#wizSteps li').forEach(li => {
    const n = Number(li.dataset.step);
    li.classList.toggle('current', n === wizStep);
    li.classList.toggle('done', n < wizStep);
  });
  $('#wizProgress').textContent = `Passo ${wizStep} de 4 — ${WIZ_TITLES[wizStep - 1]}`;
  $('#wizPrev').disabled = wizStep === 1;
  $('#wizNext').textContent = wizStep === 4 ? '✓ Concluir' : 'Próximo →';
  const body = $('#wizBody');
  if (wizStep === 1) {
    body.innerHTML = `
      <p>1. Ligue a <b>Samsung Crystal 55"</b> e confirme que ela está no <b>mesmo Wi-Fi</b> deste computador.</p>
      <p>2. Veja abaixo o endereço deste computador na rede.</p>
      <div class="wiz-net" id="wizNetInfo">Consultando rede…</div>
      <button class="btn ghost" id="wizScan">◎ Procurar TV na rede</button>
      <div class="wiz-hint" id="wizScanOut"></div>`;
    api('/api/network/scan?quick=1').then(r => {
      const el = $('#wizNetInfo'); if (el) el.innerHTML = `IP deste PC: <b>${esc(r.local.address)}</b> · Setor: <b>${esc(r.subnet)}.x</b>`;
    }).catch(() => { const el = $('#wizNetInfo'); if (el) el.textContent = 'Não foi possível consultar a rede.'; });
    $('#wizScan').addEventListener('click', () => { switchView('network'); setTimeout(() => $('#btnScan')?.click(), 150); });
  } else if (wizStep === 2) {
    body.innerHTML = `
      <p>1. Digite o IP da TV (ex.: <b>192.168.1.51</b>). Para achar: <b>Configurações → Geral → Rede → Status da Rede</b>.</p>
      <p>2. Clique em <b>Parear agora</b> e olhe para a TV.</p>
      <p>3. Na TV, selecione <b>Permitir</b> no controle remoto. Feito uma única vez.</p>
      <div class="wiz-hint">IP atual: <b>${esc($('#samsungTvIp')?.value || 'não informado')}</b></div>
      <button class="btn solid" id="wizPair">⌖ Parear agora</button>`;
    $('#wizPair').addEventListener('click', () => {
      if (!$('#samsungTvIp').value.trim()) { toast('Digite o IP da TV primeiro.'); $('#samsungTvIp').focus(); return; }
      $('#btnPairSamsungTv').click();
    });
  } else if (wizStep === 3) {
    body.innerHTML = `
      <p>Opcional. Use somente se tiver luzes <b>Tuya</b> ou lavadora/secadora <b>LG ThinQ</b>.</p>
      <p>Esses módulos são configurados pelo Home Assistant ou pela chave Tuya, nos cartões abaixo.</p>
      <button class="btn ghost" id="wizGoTuya">Ir para Tuya / Home Assistant</button>`;
    $('#wizGoTuya').addEventListener('click', () => $('#btnTestTuya')?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
  } else {
    body.innerHTML = `
      <p>✅ Conexão concluída. A Samsung já pode ser controlada pelo <b>Holomapa Tático</b>.</p>
      <button class="btn solid" id="wizDone">Abrir Holomapa Tático</button>`;
    $('#wizDone').addEventListener('click', () => switchView('overview'));
  }
}
$('#wizNext')?.addEventListener('click', () => {
  if (wizStep < 4) { wizStep++; renderWizard(); }
  else { wizStep = 1; renderWizard(); switchView('overview'); }
});
$('#wizPrev')?.addEventListener('click', () => { if (wizStep > 1) { wizStep--; renderWizard(); } });
$$('#wizSteps li').forEach(li => li.addEventListener('click', () => { wizStep = Number(li.dataset.step); renderWizard(); }));
renderWizard();
