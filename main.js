'use strict';

const {
    app, BrowserWindow, ipcMain,
    Tray, Menu, nativeImage, shell, Notification,
} = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');

// ─── Local File Server (Firebase Auth requires http:// origin, not file://) ───
// file:// 프로토콜에서는 Firebase signInWithPopup의 결과가
// window.opener.postMessage로 전달되지 않아 로그인이 먹통이 됨.
// localhost HTTP 서버로 서빙하면 일반 브라우저와 동일하게 동작함.
const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json',
    '.png': 'image/png',
    '.ico': 'image/x-icon',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
};

let localServer = null;
let localServerPort = 0;

// localStorage가 세션 간 유지되도록 포트를 고정
const PORT_FILE = path.join(app.getPath('userData'), '.server-port');

function getSavedPort() {
    try {
        const p = parseInt(fs.readFileSync(PORT_FILE, 'utf8'), 10);
        if (p > 1024 && p < 65535) return p;
    } catch { /* no saved port */ }
    return 27427; // 기본 포트
}

function startLocalServer() {
    return new Promise((resolve, reject) => {
        const serveDir = path.join(__dirname, 'src');
        localServer = http.createServer((req, res) => {
            const reqPath = decodeURIComponent(req.url.split('?')[0].split('#')[0]);
            const filePath = path.normalize(path.join(serveDir, reqPath === '/' ? 'index.html' : reqPath));

            // 경로 탐색 공격 방지
            const rel = path.relative(serveDir, filePath);
            if (rel.startsWith('..') || path.isAbsolute(rel)) {
                res.writeHead(403); res.end('Forbidden'); return;
            }

            const ext = path.extname(filePath).toLowerCase();
            try {
                const data = fs.readFileSync(filePath);
                res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
                res.end(data);
            } catch {
                res.writeHead(404); res.end('Not found');
            }
        });

        const preferred = getSavedPort();
        localServer.listen(preferred, 'localhost', () => {
            localServerPort = preferred;
            try { fs.writeFileSync(PORT_FILE, String(preferred)); } catch { /* ignore */ }
            console.log('[Main] Local server on http://localhost:' + localServerPort);
            resolve(localServerPort);
        });

        localServer.once('error', () => {
            // 포트 충돌 시 임의 포트로 대체 (localStorage는 리셋되지만 Firebase 로그인 후 복원)
            localServer.listen(0, 'localhost', () => {
                localServerPort = localServer.address().port;
                console.warn('[Main] Preferred port in use, using random port:', localServerPort);
                resolve(localServerPort);
            });
            localServer.once('error', reject);
        });
    });
}

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
const IS_LINUX = process.platform === 'linux';
const ICON_PATH = IS_LINUX
    ? path.join(__dirname, 'assets', 'icon.png')
    : path.join(__dirname, 'src', 'assets', '헤르타.ico');
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
function createWindow(port) {
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

    mainWindow.loadURL(`http://localhost:${port}/index.html`);

    // Firebase Auth signInWithPopup이 여는 팝업창 허용
    // 차단 시 Google 로그인 버튼이 완전히 먹통이 됨
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        const allowed = [
            'https://accounts.google.com/',
            'https://todo-list-2695f.firebaseapp.com/',
        ];
        if (allowed.some(prefix => url.startsWith(prefix))) {
            return {
                action: 'allow',
                overrideBrowserWindowOptions: {
                    width: 500,
                    height: 680,
                    webPreferences: {
                        contextIsolation: true,
                        nodeIntegration: false,
                        sandbox: true,
                    },
                },
            };
        }
        // 그 외 외부 링크는 기본 브라우저에서 열기
        if (url.startsWith('https://') || url.startsWith('http://')) {
            shell.openExternal(url);
        }
        return { action: 'deny' };
    });

    // Enable DevTools in development mode
    if (!app.isPackaged) {
        mainWindow.webContents.openDevTools();
    }

    // Register F12 shortcut for DevTools
    mainWindow.webContents.on('before-input-event', (event, input) => {
        if (input.key === 'F12') {
            mainWindow.webContents.toggleDevTools();
        }
    });

    // Right-click context menu (dev tools)
    mainWindow.webContents.on('context-menu', (e, params) => {
        const contextMenu = Menu.buildFromTemplate([
            { label: '개발자 도구', click: () => mainWindow.webContents.toggleDevTools() },
            { type: 'separator' },
            { label: '새로고침', role: 'reload' },
        ]);
        contextMenu.popup();
    });

    // Sync maximize state to renderer
    mainWindow.on('maximize', () => mainWindow.webContents.send('window:maximize-change', true));
    mainWindow.on('unmaximize', () => mainWindow.webContents.send('window:maximize-change', false));

    // Save position/size on move or resize
    // 'moved'/'resized' are Windows-only; 'move'/'resize' work cross-platform
    mainWindow.on('move', saveWindowState);
    mainWindow.on('resize', saveWindowState);

    // Hide to tray instead of quitting
    mainWindow.on('close', (e) => {
        if (!isQuitting) {
            e.preventDefault();
            mainWindow.hide();
            // Show balloon hint on first hide (Windows only)
            if (tray && !global.trayHintShown && process.platform === 'win32') {
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

// ─── IPC: Notifications ──────────────────────────────────────────────────────
ipcMain.handle('app:showNotification', (_, title, body) => {
    if (!Notification.isSupported()) return;

    try {
        const iconExists = fs.existsSync(ICON_PATH);
        const notificationOptions = {
            title: title,
            body: body,
            silent: false,
            urgency: 'normal',
        };

        if (iconExists) {
            notificationOptions.icon = ICON_PATH;
        }

        const notification = new Notification(notificationOptions);

        notification.on('click', () => {
            if (mainWindow) {
                if (mainWindow.isMinimized()) mainWindow.restore();
                if (!mainWindow.isVisible()) mainWindow.show();
                mainWindow.focus();
            }
        });

        notification.show();
    } catch (err) {
        console.error('[Notification Error]', err);
    }
});

// ─── Second Instance → Focus Existing Window ─────────────────────────────────
app.on('second-instance', () => {
    if (mainWindow) showWindow();
});

// ─── App Lifecycle ───────────────────────────────────────────────────────────
app.whenReady().then(async () => {
    console.log('[Main] App ready, isPackaged:', app.isPackaged);
    console.log('[Main] Notification supported:', Notification.isSupported());
    // Windows taskbar grouping & notifications
    app.setAppUserModelId('com.personal.todolist');

    // Remove default menu (File, Edit, View …)
    Menu.setApplicationMenu(null);

    // Register auto-start on Windows (first run only)
    ensureAutoLaunchOnFirstRun();

    // 로컬 파일 서버 시작 후 윈도우 생성 (Firebase Auth를 위해 localhost origin 필요)
    const port = await startLocalServer();
    createWindow(port);
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
    localServer?.close();
});
