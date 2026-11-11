/**
 * Gera native-win/embed_assets.h e native-win/app.ico a partir de public/*
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const outDir = path.join(root, 'native-win');
fs.mkdirSync(outDir, { recursive: true });

// 1) Gera app.ico (formato ICO Windows válido com PNG 192x192 32-bit RGBA)
const png192 = fs.readFileSync(path.join(root, 'public', 'icon-192.png'));
const w = png192.readUInt32BE(16);
const h = png192.readUInt32BE(20);
const icoHeader = Buffer.alloc(22);
icoHeader.writeUInt16LE(0, 0);
icoHeader.writeUInt16LE(1, 2); // ICO
icoHeader.writeUInt16LE(1, 4); // 1 image
icoHeader.writeUInt8(w >= 256 ? 0 : w, 6);
icoHeader.writeUInt8(h >= 256 ? 0 : h, 7);
icoHeader.writeUInt8(0, 8);
icoHeader.writeUInt8(0, 9);
icoHeader.writeUInt16LE(1, 10);
icoHeader.writeUInt16LE(32, 12);
icoHeader.writeUInt32LE(png192.length, 14);
icoHeader.writeUInt32LE(22, 18);
fs.writeFileSync(path.join(outDir, 'app.ico'), Buffer.concat([icoHeader, png192]));
fs.writeFileSync(path.join(outDir, 'app.rc'), '1 ICON "app.ico"\n');

// 2) Gera embed_assets.h com todos os arquivos da interface
const files = [
  { sym: 'ASSET_INDEX_HTML', rel: 'public/index.html', route: '/', mime: 'text/html; charset=utf-8' },
  { sym: 'ASSET_STYLE_CSS', rel: 'public/style.css', route: '/style.css', mime: 'text/css; charset=utf-8' },
  { sym: 'ASSET_APP_JS', rel: 'public/app.js', route: '/app.js', mime: 'application/javascript; charset=utf-8' },
  { sym: 'ASSET_ICON_192', rel: 'public/icon-192.png', route: '/icon-192.png', mime: 'image/png' },
  { sym: 'ASSET_ICON_512', rel: 'public/icon-512.png', route: '/icon-512.png', mime: 'image/png' },
  { sym: 'ASSET_MANIFEST', rel: 'public/manifest.webmanifest', route: '/manifest.webmanifest', mime: 'application/manifest+json' },
  { sym: 'ASSET_SW_JS', rel: 'public/sw.js', route: '/sw.js', mime: 'application/javascript; charset=utf-8' },
];

let out = '/* Gerado automaticamente — não edite manualmente */\n#pragma once\n#include <stddef.h>\n\n';
for (const f of files) {
  const buf = fs.readFileSync(path.join(root, f.rel));
  out += `static const unsigned char ${f.sym}[] = {`;
  for (let i = 0; i < buf.length; i++) {
    if (i % 24 === 0) out += '\n  ';
    out += buf[i] + ',';
  }
  out += `\n};\nstatic const size_t ${f.sym}_LEN = ${buf.length};\n\n`;
}

out += `typedef struct { const char *route; const char *mime; const unsigned char *data; size_t len; } EmbeddedAsset;\n`;
out += `static const EmbeddedAsset EMBEDDED_ASSETS[] = {\n`;
for (const f of files) {
  out += `  { "${f.route}", "${f.mime}", ${f.sym}, ${f.sym}_LEN },\n`;
  if (f.route === '/') {
    out += `  { "/index.html", "${f.mime}", ${f.sym}, ${f.sym}_LEN },\n`;
  }
}
out += `  { NULL, NULL, NULL, 0 }\n};\n`;

fs.writeFileSync(path.join(outDir, 'embed_assets.h'), out);
console.log('embed_assets.h e app.ico gerados com sucesso.');
