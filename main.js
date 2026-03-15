'use strict';

const {
    app, BrowserWindow, ipcMain,
    Tray, Menu, nativeImage, shell,
} = require('electron');
const path = require('path');
const fs = require('fs');

// ─── Single Instance Lock ────────────────────────────────────────────────────
if (!app.requestSingleInstanceLock()) {
    app.quit();
    process.exit(0);
}

// ─── State ──────────────────────────────────────────────────────────────────
let mainWindow = null;
let tray = null;
let isQuitting = false;

// ─── Paths ──────────────────────────────────────────────────────────────────
const ICON_PATH = path.join(__dirname, 'assets', '헤르타.ico');
const WIN_STATE_FILE = path.join(app.getPath('userData'), 'window-state.json');
const FIRST_RUN_FLAG = path.join(app.getPath('userData'), '.autolaunch-set');
const APP_SETTINGS_FILE = path.join(app.getPath('userData'), 'app-settings.json');

// ─── Persistent App Settings (alwaysOnTop etc.) ──────────────────────────────
function loadPersistedSettings() {
    try {
        return JSON.parse(fs.readFileSync(APP_SETTINGS_FILE, 'utf8'));
    } catch {
        return {};
    }
}

function persistSettings(updates) {
    try {
        const current = loadPersistedSettings();
        fs.writeFileSync(APP_SETTINGS_FILE, JSON.stringify({ ...current, ...updates }, null, 2));
    } catch { /* ignore write errors */ }
}

// ─── Auto-Launch on First Run ────────────────────────────────────────────────
// On the very first launch, register the app to start with Windows.
// After that, respect whatever the user sets in Settings.
function ensureAutoLaunchOnFirstRun() {
    // Only applies to packaged (installed/portable) builds, not dev mode.
    if (!app.isPackaged) return;
    if (fs.existsSync(FIRST_RUN_FLAG)) return; // already configured before

    try {
        app.setLoginItemSettings({
            openAtLogin: true,
            name: app.getName(),
        });
        fs.writeFileSync(FIRST_RUN_FLAG, '1');
    } catch { /* non-critical */ }
}

// ─── Window State Persistence ────────────────────────────────────────────────
function loadWindowState() {
    try {
        return JSON.parse(fs.readFileSync(WIN_STATE_FILE, 'utf8'));
    } catch {
        return {};
    }
}

function saveWindowState() {
    if (!mainWindow) return;
    try {
        const state = mainWindow.isMaximized()
            ? { maximized: true }
            : { ...mainWindow.getBounds(), maximized: false };
        fs.writeFileSync(WIN_STATE_FILE, JSON.stringify(state));
    } catch { /* ignore write errors */ }
}

// ─── Create Main Window ──────────────────────────────────────────────────────
function createWindow() {
    const saved = loadWindowState();
    const iconExists = fs.existsSync(ICON_PATH);

    mainWindow = new BrowserWindow({
        width: saved.width ?? 580,
        height: saved.height ?? 760,
        x: saved.x ?? undefined,
        y: saved.y ?? undefined,
        minWidth: 420,
        minHeight: 500,
        frame: false,
        backgroundColor: '#f0f2f7',
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
        },
        icon: iconExists ? ICON_PATH : undefined,
        show: false,
        autoHideMenuBar: true,
        center: !saved.x,
    });

    mainWindow.loadFile('index.html');

    // Sync maximize state to renderer
    mainWindow.on('maximize', () => mainWindow.webContents.send('window:maximize-change', true));
    mainWindow.on('unmaximize', () => mainWindow.webContents.send('window:maximize-change', false));

    // Save position/size on move or resize
    mainWindow.on('moved', saveWindowState);
    mainWindow.on('resized', saveWindowState);

    // Hide to tray instead of quitting
    mainWindow.on('close', (e) => {
        if (!isQuitting) {
            e.preventDefault();
            mainWindow.hide();
            // Show balloon hint on first hide
            if (tray && !global.trayHintShown) {
                global.trayHintShown = true;
                tray.displayBalloon({
                    title: 'Todo List',
                    content: '앱이 시스템 트레이에서 계속 실행 중입니다.',
                    iconType: 'info',
                });
            }
        }
    });

    // Restore alwaysOnTop preference
    const persistedSettings = loadPersistedSettings();
    if (persistedSettings.alwaysOnTop) {
        mainWindow.setAlwaysOnTop(true, 'normal');
    }

    // Show window after first paint (prevent white flash)
    mainWindow.once('ready-to-show', () => {
        mainWindow.show();
        if (saved.maximized) mainWindow.maximize();
    });
}

// ─── System Tray ─────────────────────────────────────────────────────────────
function createTray() {
    let icon;
    try {
        icon = nativeImage.createFromPath(ICON_PATH).resize({ width: 16, height: 16 });
    } catch {
        icon = nativeImage.createEmpty();
    }

    tray = new Tray(icon);
    tray.setToolTip('Todo List — 실행 중');

    const contextMenu = Menu.buildFromTemplate([
        {
            label: 'Todo List 열기',
            click: showWindow,
        },
        { type: 'separator' },
        {
            label: '종료',
            click: () => {
                isQuitting = true;
                app.quit();
            },
        },
    ]);

    tray.setContextMenu(contextMenu);

    // Left-click: toggle window
    tray.on('click', () => (mainWindow?.isVisible() ? mainWindow.hide() : showWindow()));
    tray.on('double-click', showWindow);
}

function showWindow() {
    if (!mainWindow) return;
    mainWindow.show();
    mainWindow.focus();
    if (mainWindow.isMinimized()) mainWindow.restore();
}

// ─── IPC: Window Controls ────────────────────────────────────────────────────
ipcMain.on('window:minimize', () => mainWindow?.minimize());

ipcMain.on('window:maximize', () => {
    mainWindow?.isMaximized() ? mainWindow.unmaximize() : mainWindow?.maximize();
});

ipcMain.on('window:close', () => mainWindow?.hide());

ipcMain.handle('window:isMaximized', () => mainWindow?.isMaximized() ?? false);

// ─── IPC: App Settings ───────────────────────────────────────────────────────
ipcMain.handle('app:getSettings', () => {
    const loginSettings = app.getLoginItemSettings();
    const saved = loadPersistedSettings();
    return {
        autoLaunch: loginSettings.openAtLogin,
        alwaysOnTop: saved.alwaysOnTop ?? (mainWindow?.isAlwaysOnTop() ?? false),
    };
});

ipcMain.handle('app:setAutoLaunch', (_, enabled) => {
    app.setLoginItemSettings({
        openAtLogin: !!enabled,
        name: app.getName(),
    });
    persistSettings({ autoLaunch: !!enabled });
});

ipcMain.handle('app:setAlwaysOnTop', (_, enabled) => {
    mainWindow?.setAlwaysOnTop(!!enabled, 'normal');
    persistSettings({ alwaysOnTop: !!enabled });
});

// ─── Second Instance → Focus Existing Window ─────────────────────────────────
app.on('second-instance', () => {
    if (mainWindow) showWindow();
});

// ─── App Lifecycle ───────────────────────────────────────────────────────────
app.whenReady().then(() => {
    // Windows taskbar grouping & notifications
    app.setAppUserModelId('com.personal.todolist');

    // Remove default menu (File, Edit, View …)
    Menu.setApplicationMenu(null);

    // Register auto-start on Windows (first run only)
    ensureAutoLaunchOnFirstRun();

    createWindow();
    createTray();
});

// Prevent all windows closing from quitting (stay in tray)
app.on('window-all-closed', (e) => e.preventDefault());

// macOS: re-show on dock click
app.on('activate', showWindow);

// Save window state before quitting
app.on('before-quit', () => {
    isQuitting = true;
    saveWindowState();
});
