const { app, BrowserWindow, ipcMain, desktopCapturer, session, dialog, systemPreferences, shell, screen, globalShortcut } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { pathToFileURL } = require('url');

let win = null;
let remote = null;            // floating mini remote, always on top
let pendingSourceId = null;   // screen/window the user picked in our own picker
let rec = null;               // { stream, tmpPath } while a recording is being written

const BG = '#f2f5f3';
const webPreferences = {
  preload: path.join(__dirname, 'preload.js'),
  contextIsolation: true,
  nodeIntegration: false,
  // Keep compositing at full speed while the user is in another app.
  backgroundThrottling: false,
};

function createWindow() {
  win = new BrowserWindow({
    width: 1400,
    height: 880,
    minWidth: 1120,
    minHeight: 700,
    backgroundColor: BG,
    title: 'Onstage',
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: BG, symbolColor: '#14201a', height: 44 },
    webPreferences,
  });
  win.setMenuBarVisibility(false);
  // The only window the studio opens is the Live window: a clean copy of the stage to share in a call.
  win.webContents.setWindowOpenHandler(() => ({
    action: 'allow',
    overrideBrowserWindowOptions: {
      width: 1280, height: 720, useContentSize: true, title: 'Onstage Live', backgroundColor: '#000000',
      autoHideMenuBar: true, titleBarStyle: 'default', titleBarOverlay: false,
      webPreferences: { backgroundThrottling: false, contextIsolation: true, nodeIntegration: false },
    },
  }));
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.on('closed', () => { win = null; if (remote) remote.close(); });
}

function toggleRemote() {
  if (remote) { remote.close(); return false; }
  remote = new BrowserWindow({
    width: 250,
    height: 436,
    resizable: false,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    backgroundColor: BG,
    title: 'Onstage remote',
    webPreferences,
  });
  remote.setAlwaysOnTop(true, 'screen-saver');
  remote.loadFile(path.join(__dirname, 'renderer', 'remote.html'));
  remote.on('closed', () => { remote = null; if (win) win.webContents.send('remote:open', false); });
  return true;
}

// Global shortcuts so layouts, zoom and mute work while another app has focus.
const HOTKEYS = {
  'Control+Alt+Z': ['zoom'],
  'Control+Alt+X': ['mute'],
  'Control+Alt+R': ['record'],
  'Control+Alt+T': ['timer'],
  'Control+Alt+E': ['react', '👏'],
  'Control+Alt+C': ['confetti'],
  ...Object.fromEntries([1, 2, 3, 4, 5, 6].map((n) => [`Control+Alt+${n}`, ['layoutIndex', n - 1]])),
};

app.whenReady().then(async () => {
  if (process.platform === 'darwin') {
    for (const kind of ['camera', 'microphone']) {
      try { await systemPreferences.askForMediaAccess(kind); } catch { /* user can grant later */ }
    }
  }

  const ses = session.defaultSession;
  const allowed = ['media', 'display-capture'];
  ses.setPermissionRequestHandler((_wc, permission, cb) => cb(allowed.includes(permission)));
  ses.setPermissionCheckHandler((_wc, permission) => allowed.includes(permission));

  // getDisplayMedia() in the renderer resolves to whatever source was picked in our picker.
  ses.setDisplayMediaRequestHandler(async (request, callback) => {
    try {
      const sources = await desktopCapturer.getSources({ types: ['screen', 'window'] });
      const source = sources.find((s) => s.id === pendingSourceId) || sources[0];
      pendingSourceId = null;
      if (!source) return callback({});
      const streams = { video: source };
      if (process.platform === 'win32' && request.audioRequested) streams.audio = 'loopback';
      callback(streams);
    } catch (err) {
      console.error('display media request failed', err);
      callback({});
    }
  });

  createWindow();
  for (const [keys, cmd] of Object.entries(HOTKEYS)) {
    globalShortcut.register(keys, () => { if (win) win.webContents.send('command', cmd); });
  }
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

// ---------- screen sources ----------
ipcMain.handle('sources:list', async () => {
  let screenAccess = 'granted';
  if (process.platform === 'darwin') screenAccess = systemPreferences.getMediaAccessStatus('screen');
  let sources = [];
  try {
    sources = await desktopCapturer.getSources({
      types: ['screen', 'window'],
      thumbnailSize: { width: 400, height: 225 },
    });
  } catch (err) {
    console.error('getSources failed', err);
  }
  return {
    screenAccess,
    sources: sources
      .filter((s) => !s.name.startsWith('Onstage'))
      .map((s) => ({
        id: s.id,
        name: s.name,
        kind: s.id.startsWith('screen') ? 'screen' : 'window',
        displayId: s.display_id || null,
        thumb: s.thumbnail.isEmpty() ? null : s.thumbnail.toDataURL(),
      })),
  };
});

ipcMain.handle('sources:select', (_e, id) => { pendingSourceId = id; });

ipcMain.handle('system:openScreenSettings', () => {
  if (process.platform === 'darwin') {
    shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture');
  }
});

// Where the mouse is on its display (0..1), so Cinematic Zoom can follow it.
ipcMain.handle('cursor:pos', () => {
  const p = screen.getCursorScreenPoint();
  const d = screen.getDisplayNearestPoint(p);
  return { displayId: String(d.id), x: (p.x - d.bounds.x) / d.bounds.width, y: (p.y - d.bounds.y) / d.bounds.height };
});

ipcMain.on('theme:set', (_e, color, symbolColor) => {
  if (win && process.platform !== 'darwin') win.setTitleBarOverlay({ color, symbolColor, height: 44 });
});

// ---------- floating remote ----------
ipcMain.handle('remote:toggle', () => toggleRemote());
ipcMain.on('remote:state', (_e, state) => { if (remote) remote.webContents.send('remote:state', state); });
ipcMain.on('remote:command', (_e, cmd) => {
  if (!win) return;
  if (cmd[0] === 'share') { win.show(); win.focus(); }
  win.webContents.send('command', cmd);
});
ipcMain.on('remote:close', () => { if (remote) remote.close(); });

// ---------- video library: recordings live in Videos/Onstage, listed in videos.json ----------
const libraryDir = () => path.join(app.getPath('videos'), 'Onstage');
const indexPath = () => path.join(app.getPath('userData'), 'videos.json');
const readIndex = () => { try { return JSON.parse(fs.readFileSync(indexPath(), 'utf8')); } catch { return []; } };
const writeIndex = (list) => fs.writeFileSync(indexPath(), JSON.stringify(list));
const safeName = (s) => String(s).replace(/[<>:"/\\|?*\x00-\x1f]/g, ' ').trim().slice(0, 80) || 'Recording';

async function moveFile(from, to) {
  try {
    await fs.promises.rename(from, to);
  } catch {
    await fs.promises.copyFile(from, to);   // different drive
    await fs.promises.unlink(from).catch(() => {});
  }
}

ipcMain.handle('videos:list', () => readIndex()
  .filter((v) => fs.existsSync(v.file))
  .map((v) => ({ ...v, url: pathToFileURL(v.file).href })));

ipcMain.handle('videos:rename', (_e, id, title) => {
  const list = readIndex();
  const v = list.find((x) => x.id === id);
  if (v) { v.title = String(title).slice(0, 80) || v.title; writeIndex(list); }
});

ipcMain.handle('videos:delete', async (_e, id) => {
  const list = readIndex();
  const v = list.find((x) => x.id === id);
  if (!v) return;
  await shell.trashItem(v.file).catch(() => {});   // recycle bin, so a mis-click is recoverable
  writeIndex(list.filter((x) => x.id !== id));
});

ipcMain.handle('videos:export', async (_e, id) => {
  const v = readIndex().find((x) => x.id === id);
  if (!v) return { saved: false };
  const ext = path.extname(v.file).slice(1);
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: 'Export recording',
    defaultPath: path.join(app.getPath('downloads'), `${safeName(v.title)}.${ext}`),
    filters: [{ name: 'Video', extensions: [ext] }],
  });
  if (canceled || !filePath) return { saved: false };
  await fs.promises.copyFile(v.file, filePath);
  return { saved: true, filePath };
});

// ---------- recording: chunks are streamed to a temp file, then moved into the library ----------
ipcMain.handle('rec:start', (_e, ext) => {
  if (rec) { try { rec.stream.destroy(); } catch {} }
  const tmpPath = path.join(os.tmpdir(), `onstage-${Date.now()}.${ext}`);
  rec = { tmpPath, ext, stream: fs.createWriteStream(tmpPath) };
  return true;
});

ipcMain.handle('rec:chunk', (_e, chunk) => new Promise((resolve, reject) => {
  if (!rec) return resolve(false);
  rec.stream.write(Buffer.from(chunk), (err) => (err ? reject(err) : resolve(true)));
}));

// opts: { discard } | { exportAs: name } | { title, duration, thumb }
ipcMain.handle('rec:finish', async (_e, opts = {}) => {
  if (!rec) return { saved: false };
  const { tmpPath, ext, stream } = rec;
  rec = null;
  await new Promise((resolve) => stream.end(resolve));

  if (opts.discard) {
    await fs.promises.unlink(tmpPath).catch(() => {});
    return { saved: false };
  }

  if (opts.exportAs) {
    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      title: 'Export recording',
      defaultPath: path.join(app.getPath('downloads'), `${safeName(opts.exportAs)}.${ext}`),
      filters: [{ name: 'Video', extensions: [ext] }],
    });
    // Keep the temp file so a mis-click never loses an export.
    if (canceled || !filePath) return { saved: false, tmpPath };
    await moveFile(tmpPath, filePath);
    return { saved: true, filePath };
  }

  const now = new Date();
  const stamp = now.toLocaleString('sv').replace(/:/g, '-');   // local time, yyyy-mm-dd hh-mm-ss
  const title = opts.title || `Recording ${stamp}`;
  await fs.promises.mkdir(libraryDir(), { recursive: true });
  const file = path.join(libraryDir(), `${safeName(title)}.${ext}`);
  await moveFile(tmpPath, file);
  const id = String(now.getTime());
  writeIndex([{ id, title, file, date: now.toISOString(), duration: opts.duration || 0, thumb: opts.thumb || null }, ...readIndex()]);
  return { saved: true, filePath: file, id };
});

ipcMain.handle('shell:reveal', (_e, filePath) => shell.showItemInFolder(filePath));
