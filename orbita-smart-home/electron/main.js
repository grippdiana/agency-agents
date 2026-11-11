/**
 * ORBITA — Aplicativo Desktop Nativo (Electron)
 * Sobe o servidor local da casa inteligente no mesmo processo (compatível com .asar)
 * e abre a janela nativa HUD em tela escura.
 */
const { app, BrowserWindow, Menu, Tray, shell, nativeImage } = require('electron');
const path = require('path');

let win = null;
let tray = null;
let httpServer = null;

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(async () => {
    // Ativa inicialização automática com o sistema (Windows / macOS)
    try { app.setLoginItemSettings({ openAtLogin: true }); } catch {}

    // Garante que config.json seja salvo na pasta de dados do usuário (fora do .asar)
    process.env.ORBITA_DATA_DIR = app.getPath('userData');
    const { startServer } = require('../server.js');

    let port = Number(process.env.PORT) || 3000;
    try {
      httpServer = await startServer(port, '0.0.0.0');
    } catch {
      // Se a porta 3000 já estiver em uso, escolhe porta livre automaticamente
      httpServer = await startServer(0, '0.0.0.0');
    }
    port = httpServer.address().port;

    const iconPath = path.join(__dirname, '..', 'assets', 'icon.png');
    const icon = nativeImage.createFromPath(iconPath);

    win = new BrowserWindow({
      width: 1540,
      height: 950,
      minWidth: 1080,
      minHeight: 680,
      backgroundColor: '#04070D',
      title: 'HOLONET // Comando Residencial',
      icon,
      autoHideMenuBar: true,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    Menu.setApplicationMenu(null);
    win.webContents.setWindowOpenHandler(({ url }) => {
      shell.openExternal(url);
      return { action: 'deny' };
    });

    try {
      tray = new Tray(icon.resize({ width: 18, height: 18 }));
      tray.setToolTip(`ORBITA — Casa Inteligente (porta ${port})`);
      tray.setContextMenu(Menu.buildFromTemplate([
        { label: 'Abrir Painel ORBITA', click: () => { win?.show(); win?.focus(); } },
        { label: `Abrir no Navegador (localhost:${port})`, click: () => shell.openExternal(`http://localhost:${port}`) },
        { type: 'separator' },
        { label: 'Sair', click: () => app.quit() },
      ]));
      tray.on('click', () => { win?.show(); win?.focus(); });
    } catch {}

    await win.loadURL(`http://127.0.0.1:${port}`);
  });
}

app.on('window-all-closed', () => {
  if (httpServer) {
    try { httpServer.close(); } catch {}
  }
  if (process.platform !== 'darwin') app.quit();
});
