const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  platform: process.platform,
  listSources: () => ipcRenderer.invoke('sources:list'),
  selectSource: (id) => ipcRenderer.invoke('sources:select', id),
  openScreenSettings: () => ipcRenderer.invoke('system:openScreenSettings'),
  cursor: () => ipcRenderer.invoke('cursor:pos'),
  onCamLive: (fn) => ipcRenderer.on('vcam:live', (_e, live) => fn(live)),
  sendFrame: (pixels, width, height) => ipcRenderer.send('vcam:frame', pixels, width, height),
  setTheme: (color, symbolColor) => ipcRenderer.send('theme:set', color, symbolColor),
  recStart: (ext) => ipcRenderer.invoke('rec:start', ext),
  recChunk: (arrayBuffer) => ipcRenderer.invoke('rec:chunk', arrayBuffer),
  recFinish: (opts) => ipcRenderer.invoke('rec:finish', opts),
  reveal: (filePath) => ipcRenderer.invoke('shell:reveal', filePath),
  videos: {
    list: () => ipcRenderer.invoke('videos:list'),
    rename: (id, title) => ipcRenderer.invoke('videos:rename', id, title),
    remove: (id) => ipcRenderer.invoke('videos:delete', id),
    exportCopy: (id) => ipcRenderer.invoke('videos:export', id),
  },
  // studio window <-> floating remote
  toggleRemote: () => ipcRenderer.invoke('remote:toggle'),
  closeRemote: () => ipcRenderer.send('remote:close'),
  sendState: (state) => ipcRenderer.send('remote:state', state),
  sendCommand: (cmd) => ipcRenderer.send('remote:command', cmd),
  onState: (fn) => ipcRenderer.on('remote:state', (_e, state) => fn(state)),
  onCommand: (fn) => ipcRenderer.on('command', (_e, cmd) => fn(cmd)),
  onRemoteOpen: (fn) => ipcRenderer.on('remote:open', (_e, open) => fn(open)),
});
