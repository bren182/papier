'use strict';
const { contextBridge, ipcRenderer } = require('electron');

// Expose a narrow Electron API to the renderer so the settings page can read
// and write the desktop app's configuration (e.g. which server to connect to).
// Only safe, explicit operations are exposed — no arbitrary Node/IPC access.
contextBridge.exposeInMainWorld('papierElectron', {
  /** @returns {Promise<{ serverUrl?: string }>} */
  getSettings: () => ipcRenderer.invoke('papier:get-settings'),
  /** @param {{ serverUrl?: string | null }} patch */
  setSettings: (patch) => ipcRenderer.invoke('papier:set-settings', patch),
});
