'use strict';

const {
    app, BrowserWindow, ipcMain,
    Tray, Menu, nativeImage, shell, Notification, session, safeStorage,
} = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { spawn } = require('child_process');
const { createHash, randomUUID } = require('crypto');

// ─── Local File Server ───────────────────────────────────────────────────────
// file:// 프로토콜 대신 localhost HTTP 서버로 서빙하여 로컬 스토리지 일관성을 보장합니다.
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
                res.writeHead(200, {
                    'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
                    'Content-Security-Policy': [
                        "default-src 'self'",
                        "script-src 'self' https://apis.google.com",
                        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
                        "font-src 'self' https://fonts.gstatic.com",
                        "img-src 'self' data: blob: https://lh3.googleusercontent.com",
                        "connect-src 'self' https://*.googleapis.com https://*.firebaseio.com wss://*.firebaseio.com https://securetoken.googleapis.com https://todo-ff76f.firebaseapp.com https://firestore.googleapis.com",
                        "frame-src 'self' https://todo-ff76f.firebaseapp.com https://accounts.google.com",
                        "object-src 'none'",
                        "base-uri 'self'",
                    ].join('; '),
                    'X-Content-Type-Options': 'nosniff',
                    'X-Frame-Options': 'DENY',
                });
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
            // 포트 충돌 시 임의 포트로 대체
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
const hoyoAuthWindows = new Map();
const hoyoAuthSessions = new Map();
const hoyoAuthPopups = new Map();
const hoyoPendingConnections = new Map();
let hoyoPythonEnvironmentPromise = null;

// ─── Paths ──────────────────────────────────────────────────────────────────
const IS_LINUX = process.platform === 'linux';
const ICON_PATH = IS_LINUX
    ? path.join(__dirname, 'assets', 'icon.png')
    : path.join(__dirname, 'src', 'assets', '헤르타.ico');
const WIN_STATE_FILE = path.join(app.getPath('userData'), 'window-state.json');
const FIRST_RUN_FLAG = path.join(app.getPath('userData'), '.autolaunch-set');
const APP_SETTINGS_FILE = path.join(app.getPath('userData'), 'app-settings.json');
const HOYO_REFRESH_INTERVALS = new Set([0, 15, 30, 60]);
const HOYOLAB_AUTH_URL = 'https://www.hoyolab.com/accountCenter/postList';
const HOYO_GAMES = new Set(['genshin', 'starrail', 'zzz']);
const HOYO_CONNECTION_ID_PATTERN = /^[a-z0-9-]{1,80}$/i;
const HOYO_ENCRYPTED_CREDENTIAL_VERSION = 1;
const HOYO_ENCRYPTED_CREDENTIAL_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;
const HOYO_ENCRYPTED_CREDENTIAL_MAX_LENGTH = 32 * 1024;
const HOYO_AUTH_COOKIE_NAMES = new Set([
    'ltuid', 'ltuid_v2', 'ltoken', 'ltoken_v2',
    'ltmid', 'ltmid_v2', 'account_id', 'account_id_v2',
    'cookie_token', 'cookie_token_v2', 'account_mid_v2',
]);

function createHoyoConnectionId() {
    return `hoyo-${randomUUID()}`;
}

function getHoyoAuthPartition(connectionId) {
    // 단일 원신 연동에서 업그레이드한 실행 중 세션은 끊지 않고 이어받는다.
    return connectionId === 'genshin-default' ? 'hoyo-auth' : `hoyo-auth-${connectionId}`;
}

function sanitizeHoyoConnection(value, fallbackId = null) {
    const game = value?.game;
    const uid = Number(value?.uid);
    const id = typeof value?.id === 'string' && HOYO_CONNECTION_ID_PATTERN.test(value.id)
        ? value.id
        : fallbackId;
    if (!id || !HOYO_GAMES.has(game) || !Number.isSafeInteger(uid) || uid <= 0) return null;
    return {
        id,
        game,
        uid,
        rememberLogin: value?.rememberLogin === true,
        refreshInterval: HOYO_REFRESH_INTERVALS.has(Number(value?.refreshInterval))
            ? Number(value.refreshInterval)
            : 15,
    };
}

function sanitizeHoyoAuthCookies(value) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
    const cookies = Object.create(null);
    for (const [name, cookieValue] of Object.entries(value)) {
        if (!HOYO_AUTH_COOKIE_NAMES.has(name) || typeof cookieValue !== 'string') continue;
        if (cookieValue.length === 0 || cookieValue.length > 8192) continue;
        cookies[name] = cookieValue;
    }
    return cookies;
}

function sanitizeHoyoEncryptedCredentials(value, connections) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
    const availableIds = new Set(connections
        .filter(connection => connection.rememberLogin)
        .map(connection => connection.id));
    const credentials = Object.create(null);
    for (const [connectionId, credential] of Object.entries(value)) {
        if (!availableIds.has(connectionId) || typeof credential !== 'object' || credential === null) continue;
        const ciphertext = credential.ciphertext;
        if (credential.version !== HOYO_ENCRYPTED_CREDENTIAL_VERSION || typeof ciphertext !== 'string') continue;
        if (ciphertext.length === 0 || ciphertext.length > HOYO_ENCRYPTED_CREDENTIAL_MAX_LENGTH) continue;
        if (ciphertext.length % 4 !== 0 || !HOYO_ENCRYPTED_CREDENTIAL_PATTERN.test(ciphertext)) continue;
        credentials[connectionId] = { version: HOYO_ENCRYPTED_CREDENTIAL_VERSION, ciphertext };
    }
    return credentials;
}

function sanitizeHoyoSettings(value) {
    const rawConnections = Array.isArray(value?.connections)
        ? value.connections
        : (value?.uid ? [{ ...value, id: 'genshin-default', game: 'genshin' }] : []);
    const ids = new Set();
    const connections = [];
    for (const rawConnection of rawConnections) {
        const connection = sanitizeHoyoConnection(rawConnection, createHoyoConnectionId());
        if (!connection || ids.has(connection.id)) continue;
        ids.add(connection.id);
        connections.push(connection);
    }
    return {
        connections,
        encryptedCredentials: sanitizeHoyoEncryptedCredentials(value?.encryptedCredentials, connections),
    };
}

// ─── Persistent App Settings (alwaysOnTop etc.) ──────────────────────────────
function loadPersistedSettings() {
    try {
        const raw = JSON.parse(fs.readFileSync(APP_SETTINGS_FILE, 'utf8'));
        if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
            return { hoyo: sanitizeHoyoSettings(null) };
        }
        // 허용 속성만 명시적으로 추출 (prototype pollution 및 임의 속성 주입 방지)
        return {
            alwaysOnTop: raw.alwaysOnTop === true,
            autoLaunch: raw.autoLaunch === true,
            hoyo: sanitizeHoyoSettings(raw.hoyo),
        };
    } catch {
        return { hoyo: sanitizeHoyoSettings(null) };
    }
}

function persistSettings(updates) {
    try {
        const current = loadPersistedSettings();
        fs.writeFileSync(APP_SETTINGS_FILE, JSON.stringify({ ...current, ...updates }, null, 2));
    } catch { /* ignore write errors */ }
}

function getHoyoConnection(connectionId) {
    if (typeof connectionId !== 'string') return null;
    return loadPersistedSettings().hoyo.connections.find(connection => connection.id === connectionId) || null;
}

function getHoyoProfile(connectionId) {
    return getHoyoConnection(connectionId) || hoyoPendingConnections.get(connectionId) || null;
}

function getHoyoCredentialStorageStatus() {
    try {
        if (!safeStorage.isEncryptionAvailable()) {
            return { available: false, message: '이 기기에서는 안전한 로그인 저장을 사용할 수 없습니다.' };
        }
        if (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text') {
            return { available: false, message: '이 Linux 환경에서는 안전한 로그인 저장을 사용할 수 없습니다.' };
        }
        return { available: true, message: '로그인 정보는 이 기기의 운영체제 계정으로 암호화됩니다.' };
    } catch {
        return { available: false, message: '이 기기에서는 안전한 로그인 저장을 사용할 수 없습니다.' };
    }
}

function getSavedHoyoAuthCookies(connectionId) {
    const credential = loadPersistedSettings().hoyo.encryptedCredentials[connectionId];
    if (!credential || !getHoyoCredentialStorageStatus().available) return {};
    try {
        const stored = JSON.parse(safeStorage.decryptString(Buffer.from(credential.ciphertext, 'base64')));
        if (stored?.version !== HOYO_ENCRYPTED_CREDENTIAL_VERSION) return {};
        return sanitizeHoyoAuthCookies(stored.cookies);
    } catch {
        return {};
    }
}

function encryptHoyoAuthCookies(cookies) {
    const safeCookies = sanitizeHoyoAuthCookies(cookies);
    if (!isHoyoAuthenticated(safeCookies) || !getHoyoCredentialStorageStatus().available) return null;
    try {
        return {
            version: HOYO_ENCRYPTED_CREDENTIAL_VERSION,
            ciphertext: safeStorage.encryptString(JSON.stringify({
                version: HOYO_ENCRYPTED_CREDENTIAL_VERSION,
                cookies: safeCookies,
            })).toString('base64'),
        };
    } catch {
        return null;
    }
}

function beginHoyoAuthentication(game, rememberLogin = false) {
    if (!HOYO_GAMES.has(game)) {
        return { ok: false, code: 'invalid_game', message: '지원하지 않는 HoYoLAB 게임입니다.' };
    }
    if (rememberLogin && !getHoyoCredentialStorageStatus().available) {
        return { ok: false, code: 'credential_storage_unavailable', message: getHoyoCredentialStorageStatus().message };
    }
    const connectionId = createHoyoConnectionId();
    hoyoPendingConnections.set(connectionId, { id: connectionId, game, rememberLogin: rememberLogin === true });
    return openHoyoAuthWindow(connectionId);
}

async function saveHoyoConnection(connectionId, account) {
    const profile = getHoyoProfile(connectionId);
    const uid = Number(account?.uid);
    if (!profile || !Number.isSafeInteger(uid) || uid <= 0) return null;

    const settings = loadPersistedSettings();
    const existing = settings.hoyo.connections.find(connection => connection.game === profile.game && connection.uid === uid);
    const connection = sanitizeHoyoConnection(existing
        ? { ...existing, rememberLogin: profile.rememberLogin === true }
        : { id: connectionId, game: profile.game, uid, refreshInterval: 15, rememberLogin: profile.rememberLogin === true });
    if (!connection) return null;

    if (connection.rememberLogin) {
        const credential = encryptHoyoAuthCookies(await getHoyoAuthCookies(connectionId));
        if (!credential) return null;
        settings.hoyo.encryptedCredentials[connection.id] = credential;
    } else {
        delete settings.hoyo.encryptedCredentials[connection.id];
    }
    if (existing) {
        settings.hoyo.connections = settings.hoyo.connections.map(item => item.id === connection.id ? connection : item);
    } else {
        settings.hoyo.connections.push(connection);
    }
    persistSettings({ hoyo: settings.hoyo });

    const authSession = hoyoAuthSessions.get(connectionId);
    if (authSession && connection.id !== connectionId) {
        hoyoAuthSessions.set(connection.id, authSession);
        authSession.cookies.on('changed', () => { broadcastHoyoAuthState(connection.id); });
    }
    hoyoPendingConnections.delete(connectionId);
    return connection;
}

function getHoyoAuthSession(connectionId) {
    const existing = hoyoAuthSessions.get(connectionId);
    if (existing) return existing;
    // `persist:` 접두사 없는 partition은 앱 실행 중에만 존재하며 디스크에 저장되지 않는다.
    const authSession = session.fromPartition(getHoyoAuthPartition(connectionId));
    authSession.cookies.on('changed', () => { broadcastHoyoAuthState(connectionId); });
    hoyoAuthSessions.set(connectionId, authSession);
    return authSession;
}

async function getHoyoAuthCookies(connectionId) {
    const sessionCookies = await getHoyoAuthSession(connectionId).cookies.get({});
    const cookies = {};
    for (const cookie of sessionCookies) {
        if (!HOYO_AUTH_COOKIE_NAMES.has(cookie.name)) continue;
        if (!/(^|\.)(hoyolab|hoyoverse|mihoyo)\.com$/.test(cookie.domain)) continue;
        cookies[cookie.name] = cookie.value;
    }
    return isHoyoAuthenticated(cookies) ? cookies : getSavedHoyoAuthCookies(connectionId);
}

function isHoyoAuthenticated(cookies) {
    return Boolean(
        (cookies.ltuid || cookies.ltuid_v2)
        && (cookies.ltoken || cookies.ltoken_v2)
    );
}

async function getHoyoAuthState(connectionId) {
    const cookies = await getHoyoAuthCookies(connectionId);
    return {
        connectionId,
        signedIn: isHoyoAuthenticated(cookies),
        windowOpen: Boolean(hoyoAuthWindows.get(connectionId) && !hoyoAuthWindows.get(connectionId).isDestroyed()),
    };
}

function closeHoyoAuthWindows(connectionId) {
    const popups = hoyoAuthPopups.get(connectionId);
    if (popups) {
        for (const popup of popups) {
            if (!popup.isDestroyed()) popup.close();
        }
        hoyoAuthPopups.delete(connectionId);
    }
    const authWindow = hoyoAuthWindows.get(connectionId);
    if (authWindow && !authWindow.isDestroyed()) authWindow.close();
}

async function broadcastHoyoAuthState(connectionId) {
    try {
        const authState = await getHoyoAuthState(connectionId);
        mainWindow?.webContents.send('hoyo:authState', authState);
    } catch {
        /* 로그인 상태 표시는 상태 조회를 방해하지 않는다. */
    }
}

async function openHoyoAuthWindow(connectionId) {
    if (!getHoyoProfile(connectionId)) {
        return { ok: false, code: 'not_configured', message: 'HoYoLAB 연동 정보를 찾지 못했습니다.' };
    }
    const existingWindow = hoyoAuthWindows.get(connectionId);
    if (existingWindow && !existingWindow.isDestroyed()) {
        existingWindow.show();
        existingWindow.focus();
        return { ok: true, ...(await getHoyoAuthState(connectionId)) };
    }

    const authWindow = new BrowserWindow({
        width: 480,
        height: 760,
        minWidth: 420,
        minHeight: 600,
        parent: mainWindow || undefined,
        title: 'HoYoLAB 인증',
        autoHideMenuBar: true,
        show: false,
        webPreferences: {
            partition: getHoyoAuthPartition(connectionId),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
        },
    });

    hoyoAuthWindows.set(connectionId, authWindow);
    authWindow.once('ready-to-show', () => authWindow.show());
    authWindow.webContents.on('did-finish-load', () => broadcastHoyoAuthState(connectionId));
    authWindow.webContents.on('did-navigate', () => broadcastHoyoAuthState(connectionId));
    authWindow.webContents.on('did-create-window', popup => {
        const popups = hoyoAuthPopups.get(connectionId) || new Set();
        popups.add(popup);
        hoyoAuthPopups.set(connectionId, popups);
        popup.on('closed', () => {
            popups.delete(popup);
            if (popups.size === 0) hoyoAuthPopups.delete(connectionId);
        });
        popup.webContents.on('did-finish-load', () => broadcastHoyoAuthState(connectionId));
        popup.webContents.on('did-navigate', () => broadcastHoyoAuthState(connectionId));
    });
    authWindow.on('closed', () => {
        if (hoyoAuthWindows.get(connectionId) === authWindow) hoyoAuthWindows.delete(connectionId);
        if (!getHoyoConnection(connectionId)) hoyoPendingConnections.delete(connectionId);
        broadcastHoyoAuthState(connectionId);
    });
    authWindow.loadURL(HOYOLAB_AUTH_URL).catch(() => {
        if (!authWindow.isDestroyed()) authWindow.close();
    });

    return { ok: true, ...(await getHoyoAuthState(connectionId)) };
}

function getHoyoHelperDir() {
    return app.isPackaged
        ? path.join(process.resourcesPath, 'app.asar.unpacked', '호요 일퀘 수령')
        : path.join(__dirname, '호요 일퀘 수령');
}

function getHoyoVirtualEnvPythonPath(virtualEnvDir) {
    return process.platform === 'win32'
        ? path.join(virtualEnvDir, 'Scripts', 'python.exe')
        : path.join(virtualEnvDir, 'bin', 'python3');
}

function getHoyoPythonEnvironmentDir() {
    return path.join(app.getPath('userData'), 'hoyo-python');
}

function getHoyoPythonPath(helperDir) {
    const candidates = [
        getHoyoVirtualEnvPythonPath(getHoyoPythonEnvironmentDir()),
        getHoyoVirtualEnvPythonPath(path.join(helperDir, '.venv')),
    ];
    const virtualEnvPython = candidates.find(candidate => fs.existsSync(candidate));
    if (virtualEnvPython) return virtualEnvPython;
    // 가상환경을 처음 만들 때만 시스템 Python을 사용한다.
    return app.isPackaged ? (process.platform === 'win32' ? 'python' : 'python3') : null;
}

function getHoyoRequirementsHash(requirementsPath) {
    return createHash('sha256').update(fs.readFileSync(requirementsPath)).digest('hex');
}

function readHoyoPythonEnvironmentMarker(markerPath) {
    try {
        const marker = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
        return typeof marker?.requirementsHash === 'string' ? marker : null;
    } catch {
        return null;
    }
}

function runHoyoPythonCommand(command, argumentsList, options) {
    return new Promise(resolve => {
        const child = spawn(command, argumentsList, {
            cwd: options.cwd,
            env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
            windowsHide: true,
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        let output = '';
        let settled = false;
        const finish = result => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            resolve(result);
        };
        const append = chunk => { output = (output + chunk.toString()).slice(-8 * 1024); };
        const timeout = setTimeout(() => {
            child.kill();
            finish({ ok: false, timedOut: true, output });
        }, 120_000);

        child.stdout.on('data', append);
        child.stderr.on('data', append);
        child.on('error', () => finish({ ok: false, output }));
        child.on('close', code => finish({ ok: code === 0, output }));
    });
}

async function installHoyoPythonEnvironment(helperDir, requirementsPath, requirementsHash) {
    const virtualEnvDir = getHoyoPythonEnvironmentDir();
    const virtualEnvPython = getHoyoVirtualEnvPythonPath(virtualEnvDir);
    const markerPath = path.join(virtualEnvDir, 'requirements.json');
    const marker = readHoyoPythonEnvironmentMarker(markerPath);
    if (fs.existsSync(virtualEnvPython) && marker?.requirementsHash === requirementsHash) {
        return { ok: true };
    }

    if (!fs.existsSync(virtualEnvPython)) {
        const bootstrapPython = process.platform === 'win32' ? 'python' : 'python3';
        const createResult = await runHoyoPythonCommand(bootstrapPython, ['-m', 'venv', virtualEnvDir], { cwd: helperDir });
        if (!createResult.ok || !fs.existsSync(virtualEnvPython)) {
            return {
                ok: false,
                code: 'python_unavailable',
                message: 'HoYoLAB 기능을 준비하지 못했습니다. Python 3를 설치한 뒤 앱을 다시 실행해 주세요.',
            };
        }
    }

    const installResult = await runHoyoPythonCommand(
        virtualEnvPython,
        ['-m', 'pip', 'install', '--disable-pip-version-check', '--no-input', '--upgrade', '-r', requirementsPath],
        { cwd: helperDir }
    );
    if (!installResult.ok) {
        return {
            ok: false,
            code: 'dependency_install_failed',
            message: 'HoYoLAB 기능을 준비하지 못했습니다. 인터넷 연결을 확인한 뒤 다시 시도해 주세요.',
        };
    }

    try {
        fs.writeFileSync(markerPath, JSON.stringify({ requirementsHash }, null, 2));
    } catch {
        return {
            ok: false,
            code: 'dependency_install_failed',
            message: 'HoYoLAB 기능 준비 정보를 저장하지 못했습니다.',
        };
    }
    return { ok: true };
}

async function ensureHoyoPythonEnvironment(helperDir) {
    if (!app.isPackaged) return { ok: true };

    const requirementsPath = path.join(helperDir, 'requirements.txt');
    if (!fs.existsSync(requirementsPath)) {
        return { ok: false, code: 'helper_unavailable', message: 'HoYoLAB 확인기를 찾지 못했습니다.' };
    }

    let requirementsHash;
    try {
        requirementsHash = getHoyoRequirementsHash(requirementsPath);
    } catch {
        return { ok: false, code: 'helper_unavailable', message: 'HoYoLAB 확인기를 읽지 못했습니다.' };
    }

    if (!hoyoPythonEnvironmentPromise) {
        hoyoPythonEnvironmentPromise = installHoyoPythonEnvironment(helperDir, requirementsPath, requirementsHash)
            .finally(() => { hoyoPythonEnvironmentPromise = null; });
    }
    return hoyoPythonEnvironmentPromise;
}

async function runHoyoHelper(connectionId, game, argumentsList) {
    const cookies = await getHoyoAuthCookies(connectionId);
    if (!isHoyoAuthenticated(cookies)) {
        return {
            ok: false,
            code: 'authentication',
            message: 'HoYoLAB 연결 창에서 다시 로그인해 주세요.',
        };
    }

    const helperDir = getHoyoHelperDir();
    const scriptPath = path.join(helperDir, 'daily_commission_status.py');
    const environment = await ensureHoyoPythonEnvironment(helperDir);
    if (!environment.ok) return environment;
    const pythonPath = getHoyoPythonPath(helperDir);
    if (!pythonPath || !fs.existsSync(scriptPath)) {
        return {
            ok: false,
            code: 'helper_unavailable',
            message: 'HoYoLAB 확인기를 찾지 못했습니다.',
        };
    }

    return new Promise(resolve => {
        const child = spawn(pythonPath, [
            scriptPath, '--json', '--game', game, ...argumentsList, '--cookies-stdin',
        ], {
            cwd: helperDir,
            // Windows Python의 콘솔 코드페이지 대신 UTF-8로 JSON 오류 메시지를 전달한다.
            env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
            windowsHide: true,
            stdio: ['pipe', 'pipe', 'pipe'],
        });
        let stdout = '';
        let stderr = '';
        const maxOutputLength = 16 * 1024;
        const append = (target, chunk) => (target + chunk.toString()).slice(0, maxOutputLength);
        const timeout = setTimeout(() => child.kill(), 30_000);

        child.stdout.on('data', chunk => { stdout = append(stdout, chunk); });
        child.stderr.on('data', chunk => { stderr = append(stderr, chunk); });
        child.stdin.on('error', () => { /* 자식 종료 중 stdin 오류는 무시한다. */ });
        child.stdin.end(JSON.stringify({ cookies }));
        child.on('error', () => {
            clearTimeout(timeout);
            resolve({ ok: false, code: 'helper_unavailable', message: 'HoYoLAB 확인기를 실행하지 못했습니다.' });
        });
        child.on('close', code => {
            clearTimeout(timeout);
            try {
                if (code === 0) {
                    resolve({ ok: true, value: JSON.parse(stdout) });
                    return;
                }
                const error = JSON.parse(stderr);
                resolve({ ok: false, code: error.code || 'check_failed', message: error.message || 'HoYoLAB 상태를 확인하지 못했습니다.' });
            } catch {
                resolve({ ok: false, code: 'check_failed', message: 'HoYoLAB 응답을 해석하지 못했습니다.' });
            }
        });
    });
}

async function runHoyoStatusCheck(connectionId) {
    const config = getHoyoConnection(connectionId);
    if (!config) {
        return { ok: false, code: 'not_configured', message: 'HoYoLAB 연동 정보를 찾지 못했습니다.' };
    }
    const result = await runHoyoHelper(connectionId, config.game, ['--uid', String(config.uid)]);
    if (!result.ok) return result;

    const status = result.value;
    const condition = config.game === 'genshin'
        ? status?.conditions?.catherine_reward_claimed
        : config.game === 'starrail'
            ? status?.conditions?.daily_training_completed
            : status?.conditions?.daily_engagement_completed;
    if (status?.game !== config.game || typeof condition !== 'boolean') {
        return { ok: false, code: 'check_failed', message: 'HoYoLAB 응답을 해석하지 못했습니다.' };
    }
    return { ok: true, status };
}

async function completeHoyoConnection(connectionId) {
    const profile = getHoyoProfile(connectionId);
    if (!profile) {
        return { ok: false, code: 'not_configured', message: 'HoYoLAB 연동 정보를 찾지 못했습니다.' };
    }
    const result = await runHoyoHelper(connectionId, profile.game, ['--account']);
    if (!result.ok) return result;

    const account = result.value;
    if (!Number.isSafeInteger(Number(account?.uid)) || Number(account.uid) <= 0) {
        return { ok: false, code: 'check_failed', message: 'HoYoLAB 계정 정보를 해석하지 못했습니다.' };
    }
    const connection = await saveHoyoConnection(connectionId, account);
    if (!connection) {
        return { ok: false, code: 'save_failed', message: 'HoYoLAB 연동 정보를 저장하지 못했습니다.' };
    }
    return { ok: true, connection, account };
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
        const raw = JSON.parse(fs.readFileSync(WIN_STATE_FILE, 'utf8'));
        if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
        // 허용 속성만 명시적으로 추출 (prototype pollution 및 임의 속성 주입 방지)
        return {
            width: Number.isInteger(raw.width) ? Math.max(420, Math.min(raw.width, 7680)) : undefined,
            height: Number.isInteger(raw.height) ? Math.max(500, Math.min(raw.height, 4320)) : undefined,
            x: Number.isInteger(raw.x) ? raw.x : undefined,
            y: Number.isInteger(raw.y) ? raw.y : undefined,
            maximized: raw.maximized === true,
        };
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

    // Google 로그인 팝업(signInWithPopup) 허용
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        const allowed = [
            'https://accounts.google.com/',
            'https://todo-ff76f.firebaseapp.com/',
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
        // 렌더러 콘솔 출력을 메인 프로세스 터미널에도 표시 (개발용)
        mainWindow.webContents.on('console-message', (_e, level, msg, line, src) => {
            const labels = ['LOG', 'WARN', 'ERROR', 'DEBUG'];
            console.log(`[Renderer][${labels[level] ?? level}] ${msg}  (${src}:${line})`);
        });
    }

    // Register F12 shortcut for DevTools
    // Register F12 shortcut for DevTools (개발 환경 전용)
    mainWindow.webContents.on('before-input-event', (event, input) => {
        if (input.key === 'F12' && !app.isPackaged) {
            mainWindow.webContents.toggleDevTools();
        }
    });

    // Right-click context menu (개발 환경 전용)
    if (!app.isPackaged) {
        mainWindow.webContents.on('context-menu', () => {
            const contextMenu = Menu.buildFromTemplate([
                { label: '개발자 도구', click: () => mainWindow.webContents.toggleDevTools() },
                { type: 'separator' },
                { label: '새로고침', role: 'reload' },
            ]);
            contextMenu.popup();
        });
    }

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
        autoLaunch: saved.autoLaunch ?? loginSettings.openAtLogin,
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

// ─── IPC: HoYoLAB temporary-session integration ────────────────────────────
ipcMain.handle('hoyo:getConnections', () => loadPersistedSettings().hoyo.connections);
ipcMain.handle('hoyo:getCredentialStorageStatus', () => getHoyoCredentialStorageStatus());
ipcMain.handle('hoyo:beginAuthentication', (_, game, rememberLogin) => beginHoyoAuthentication(game, rememberLogin));
ipcMain.handle('hoyo:completeConnection', (_, connectionId) => completeHoyoConnection(connectionId));
ipcMain.handle('hoyo:closeAuthentication', (_, connectionId) => closeHoyoAuthWindows(connectionId));
ipcMain.handle('hoyo:getAuthState', (_, connectionId) => getHoyoAuthState(connectionId));
ipcMain.handle('hoyo:checkStatus', (_, connectionId) => runHoyoStatusCheck(connectionId));

// ─── IPC: Notifications ──────────────────────────────────────────────────────
ipcMain.handle('app:showNotification', (_, title, body) => {
    if (!Notification.isSupported()) return;

    // 입력값 검증: 타입 강제 변환, 길이 제한, 제어 문자 제거
    const safeTitle = String(title ?? '').replace(/[\x00-\x1F\x7F]/g, '').slice(0, 100);
    const safeBody = String(body ?? '').replace(/[\x00-\x1F\x7F]/g, '').slice(0, 300);
    if (!safeTitle) return;

    try {
        const iconExists = fs.existsSync(ICON_PATH);
        const notificationOptions = {
            title: safeTitle,
            body: safeBody,
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

// ─── IPC: Platform ───────────────────────────────────────────────────────────
ipcMain.handle('app:getPlatform', () => process.platform);

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

    // 업데이트로 requirements.txt가 바뀌면 전용 Python 환경도 백그라운드에서 갱신한다.
    ensureHoyoPythonEnvironment(getHoyoHelperDir()).catch(() => { });

    // 로컬 파일 서버 시작 후 윈도우 생성
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
    for (const authSession of hoyoAuthSessions.values()) {
        authSession.clearStorageData({ storages: ['cookies'] }).catch(() => { });
    }
});
