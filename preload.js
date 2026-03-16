'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// Expose a safe, narrow API to the renderer process.
// No Node.js or Electron internals are directly exposed.
contextBridge.exposeInMainWorld('electronAPI', {

    // ── Window Controls ──────────────────────────────────────────────────────
    minimize: () => ipcRenderer.send('window:minimize'),
    maximize: () => ipcRenderer.send('window:maximize'),
    close: () => ipcRenderer.send('window:close'),

    isMaximized: () => ipcRenderer.invoke('window:isMaximized'),

    /** Register a callback for maximize/unmaximize events.
     *  Returns an unsubscribe function. */
    onMaximizeChange: (callback) => {
        const handler = (_, value) => callback(value);
        ipcRenderer.on('window:maximize-change', handler);
        return () => ipcRenderer.removeListener('window:maximize-change', handler);
    },

    // ── App Settings ─────────────────────────────────────────────────────────
    getAppSettings: () => ipcRenderer.invoke('app:getSettings'),
    setAutoLaunch: (value) => ipcRenderer.invoke('app:setAutoLaunch', value),
    setAlwaysOnTop: (value) => ipcRenderer.invoke('app:setAlwaysOnTop', value),

    // ── Notifications ────────────────────────────────────────────────────────
    showNotification: (title, body) => ipcRenderer.invoke('app:showNotification', title, body),
});
