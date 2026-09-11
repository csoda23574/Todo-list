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

    // ── HoYoLAB (기기 로컬 설정·상태 확인) ─────────────────────────────────
    getHoyoConnections: () => ipcRenderer.invoke('hoyo:getConnections'),
    getHoyoCredentialStorageStatus: () => ipcRenderer.invoke('hoyo:getCredentialStorageStatus'),
    beginHoyoAuthentication: (game, rememberLogin) => ipcRenderer.invoke('hoyo:beginAuthentication', game, rememberLogin),
    completeHoyoConnection: (connectionId) => ipcRenderer.invoke('hoyo:completeConnection', connectionId),
    closeHoyoAuthentication: (connectionId) => ipcRenderer.invoke('hoyo:closeAuthentication', connectionId),
    getHoyoAuthState: (connectionId) => ipcRenderer.invoke('hoyo:getAuthState', connectionId),
    checkHoyoStatus: (connectionId) => ipcRenderer.invoke('hoyo:checkStatus', connectionId),
    onHoyoAuthState: (callback) => {
        const handler = (_, value) => callback(value);
        ipcRenderer.on('hoyo:authState', handler);
        return () => ipcRenderer.removeListener('hoyo:authState', handler);
    },

    // ── Notifications ────────────────────────────────────────────────────────
    showNotification: (title, body) => ipcRenderer.invoke('app:showNotification', title, body),

    // ── Platform ───────────────────────────────────────────────
    getPlatform: () => ipcRenderer.invoke('app:getPlatform'),
});
