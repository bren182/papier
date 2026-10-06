'use strict';

const { app, BrowserWindow, Tray, Menu, dialog, shell, nativeImage, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// electron-updater is only meaningful in a packaged build.
let autoUpdater = null;
if (app.isPackaged) {
  try { ({ autoUpdater } = require('electron-updater')); } catch {}
}

const APP_PORT = 37842;

let tray = null;
let mainWindow = null;
let fastifyServer = null;

// ── Persistent settings (userData/settings.json) ─────────────────────────────

const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');

/** @returns {{ serverUrl?: string }} */
function readSettings() {
  try { return JSON.parse(fs.readFileSync(settingsFile(), 'utf8')); } catch { return {}; }
}

/** @param {{ serverUrl?: string | null }} settings */
function writeSettings(settings) {
  const clean = { ...settings };
  if (!clean.serverUrl) delete clean.serverUrl;
  fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
  fs.writeFileSync(settingsFile(), JSON.stringify(clean, null, 2));
}

// ── Local server ──────────────────────────────────────────────────────────────

// dist/ is always one level above src/ — both in dev and when packaged
// with asar:false (where files land at resources/app/src/ and resources/app/dist/).
function getDistDir() {
  return path.join(__dirname, '..', 'dist');
}

// Load or create a stable setup token so the user can always find it.
function getSetupToken(dataDir) {
  const tokenFile = path.join(dataDir, 'setup-token.txt');
  if (fs.existsSync(tokenFile)) {
    return fs.readFileSync(tokenFile, 'utf8').trim();
  }
  const token = crypto.randomBytes(9).toString('base64url');
  fs.writeFileSync(tokenFile, token, 'utf8');
  return token;
}

async function startServer() {
  const distDir = getDistDir();
  const dataDir = app.getPath('userData');
  const dbPath = path.join(dataDir, 'papier.db');
  const isFirstRun = !fs.existsSync(dbPath);
  const setupToken = getSetupToken(dataDir);

  fs.mkdirSync(dataDir, { recursive: true });

  process.env.DATABASE_PATH = dbPath;
  process.env.STATIC_DIR = path.join(distDir, 'web');
  process.env.PAPIER_MIGRATIONS_DIR = path.join(distDir, 'drizzle');
  process.env.PAPIER_SETUP_TOKEN = setupToken;
  process.env.HOST = '127.0.0.1';
  process.env.PORT = String(APP_PORT);
  process.env.NODE_ENV = 'production';

  const { buildApp } = require(path.join(distDir, 'server.cjs'));
  fastifyServer = buildApp({ dbPath, scheduler: true });
  await fastifyServer.listen({ port: APP_PORT, host: '127.0.0.1' });

  return { isFirstRun, setupToken };
}

// ── Window ────────────────────────────────────────────────────────────────────

/** @param {string} serverUrl */
function createWindow(serverUrl) {
  const iconPath = path.join(__dirname, '..', 'build', 'icon.png');
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 600,
    minHeight: 480,
    title: 'Papier',
    ...(fs.existsSync(iconPath) && { icon: iconPath }),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
    },
  });

  mainWindow.loadURL(serverUrl);

  // Open links to other origins in the system browser.
  const serverOrigin = new URL(serverUrl).origin;
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(serverOrigin)) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  mainWindow.on('closed', () => { mainWindow = null; });
  return mainWindow;
}

function showSetupDialog(win, setupToken) {
  dialog.showMessageBox(win, {
    type: 'info',
    title: 'Welcome to Papier',
    message: 'First-time setup',
    detail: `Enter this token on the setup screen to create your owner account:\n\n${setupToken}\n\nIt's also saved to:\n${path.join(app.getPath('userData'), 'setup-token.txt')}`,
    buttons: ['Got it'],
  });
}

// ── Auto-updater ──────────────────────────────────────────────────────────────

function setupAutoUpdater() {
  if (!autoUpdater) return;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('update-downloaded', () => {
    dialog.showMessageBox({
      type: 'info',
      title: 'Update ready',
      message: 'A new version of Papier has been downloaded.',
      detail: 'Restart to apply the update, or it will install automatically next time you quit.',
      buttons: ['Restart now', 'Later'],
      defaultId: 0,
    }).then(({ response }) => {
      if (response === 0) autoUpdater.quitAndInstall();
    });
  });

  autoUpdater.on('error', (err) => {
    console.error('Auto-update error:', err.message);
  });

  // Check silently 10 s after launch so startup isn't delayed.
  setTimeout(() => autoUpdater.checkForUpdates().catch(() => {}), 10_000);
}

// ── Tray ──────────────────────────────────────────────────────────────────────

function buildTrayMenu() {
  const openAtLogin = app.getLoginItemSettings().openAtLogin;
  const settings = readSettings();
  const remoteUrl = settings.serverUrl;
  return Menu.buildFromTemplate([
    {
      label: 'Open Papier',
      click: () => {
        if (mainWindow) mainWindow.focus();
        else createWindow(remoteUrl || `http://127.0.0.1:${APP_PORT}`);
      },
    },
    { type: 'separator' },
    {
      label: 'Open at Login',
      type: 'checkbox',
      checked: openAtLogin,
      click: (item) => {
        app.setLoginItemSettings({ openAtLogin: item.checked });
        tray.setContextMenu(buildTrayMenu());
      },
    },
    ...(autoUpdater ? [{
      label: 'Check for updates…',
      click: () => autoUpdater.checkForUpdates().catch(() => {}),
    }] : []),
    { type: 'separator' },
    ...(remoteUrl
      ? [{ label: `Connected to ${remoteUrl}`, enabled: false }]
      : [
          { label: `Running on port ${APP_PORT}`, enabled: false },
          { label: 'Open in browser', click: () => shell.openExternal(`http://127.0.0.1:${APP_PORT}`) },
        ]
    ),
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ]);
}

function getTrayIcon() {
  for (const name of ['tray.png', 'icon.png']) {
    const p = path.join(__dirname, '..', 'build', name);
    if (fs.existsSync(p)) return nativeImage.createFromPath(p);
  }
  // Windows requires a non-empty tray icon; use a minimal 1×1 transparent PNG.
  return nativeImage.createFromDataURL(
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
  );
}

function createTray() {
  tray = new Tray(getTrayIcon());
  tray.setToolTip('Papier');
  tray.setContextMenu(buildTrayMenu());
  tray.on('click', () => {
    if (mainWindow) mainWindow.focus();
    else createWindow(readSettings().serverUrl || `http://127.0.0.1:${APP_PORT}`);
  });
}

// ── IPC (settings) ────────────────────────────────────────────────────────────

ipcMain.handle('papier:get-settings', () => readSettings());

ipcMain.handle('papier:set-settings', (_e, patch) => {
  writeSettings({ ...readSettings(), ...patch });
  // Relaunch so the new server URL takes effect.
  app.relaunch();
  app.quit();
});

// ── Boot ──────────────────────────────────────────────────────────────────────

app.whenReady().then(async () => {
  try {
    const { serverUrl } = readSettings();

    let win;
    if (serverUrl) {
      // Remote mode: skip local server, connect directly to the configured URL.
      win = createWindow(serverUrl);
    } else {
      // Local mode: start the bundled Fastify server, then open it.
      const { isFirstRun, setupToken } = await startServer();
      win = createWindow(`http://127.0.0.1:${APP_PORT}`);
      if (isFirstRun) {
        win.webContents.once('did-finish-load', () => {
          setTimeout(() => showSetupDialog(win, setupToken), 600);
        });
      }
    }

    createTray();
    setupAutoUpdater();
  } catch (err) {
    const isPortBusy = err?.code === 'EADDRINUSE';
    const msg = isPortBusy
      ? `Port ${APP_PORT} is already in use.\n\nAnother Papier instance may be running. Close it (or check the system tray) and try again.`
      : String(err);
    dialog.showErrorBox('Papier failed to start', msg);
    app.quit();
  }
});

// Keep the app alive in the system tray when all windows are closed.
// On Windows/Linux the default is to quit; by doing nothing here we stay in the tray.
app.on('window-all-closed', () => {});

app.on('before-quit', async () => {
  if (fastifyServer) {
    try { await fastifyServer.close(); } catch {}
  }
});

app.on('activate', () => {
  if (!mainWindow) createWindow(readSettings().serverUrl || `http://127.0.0.1:${APP_PORT}`);
});
