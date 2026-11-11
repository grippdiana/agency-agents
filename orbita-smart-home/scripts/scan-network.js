/**
 * ORBITA — varredura rápida da rede local (uso: npm run scan)
 * Lista sua interface, IP e testa portas comuns de smart home na sub-rede.
 */
const os = require('os');
const net = require('net');

const ifaces = os.networkInterfaces();
let local = null;
for (const name of Object.keys(ifaces))
  for (const a of ifaces[name] || [])
    if (a.family === 'IPv4' && !a.internal) local = { name, address: a.address, mac: a.mac };

if (!local) { console.log('Nenhuma interface de rede encontrada.'); process.exit(0); }
console.log(`\nORBITA — escaneando ${local.address} (${local.name})...\n`);

const subnet = local.address.split('.').slice(0, 3).join('.');
const ports = [80, 443, 8123, 8080, 554, 6668, 7000];
const labels = { 80:'HTTP', 443:'HTTPS', 8123:'Home Assistant', 8080:'HTTP alt', 554:'RTSP/câmera', 6668:'Tuya', 7000:'TV webOS' };

function probe(ip, port) {
  return new Promise(res => {
    const s = net.createConnection({ host: ip, port, timeout: 300 });
    s.on('connect', () => { s.destroy(); res(true); });
    s.on('timeout', () => { s.destroy(); res(false); });
    s.on('error', () => res(false));
  });
}

(async () => {
  const found = [];
  for (let i = 1; i <= 254; i++) {
    const ip = `${subnet}.${i}`;
    if (ip === local.address) continue;
    const open = [];
    for (const p of ports) if (await probe(ip, p)) open.push(p);
    if (open.length) { found.push({ ip, open }); console.log(`  ${ip}  →  ${open.map(p => `${p} (${labels[p]})`).join(', ')}`); }
  }
  console.log(`\nConcluído: ${found.length} host(s) com portas abertas.`);
  console.log('Dica: anote os IPs e cadastre os aparelhos no Home Assistant.\n');
})();
