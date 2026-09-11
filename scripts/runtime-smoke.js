/* eslint-disable no-console */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { app, BrowserWindow, safeStorage } = require('electron');

const smokeDataDir = path.join(os.tmpdir(), 'todo-app-runtime-smoke');
fs.mkdirSync(smokeDataDir, { recursive: true });
app.setPath('userData', smokeDataDir);
app.commandLine.appendSwitch('disk-cache-dir', path.join(smokeDataDir, 'cache'));

function loadPolicy() {
    const policyPath = path.join(__dirname, 'smoke-policy.json');
    const raw = JSON.parse(fs.readFileSync(policyPath, 'utf8'));
    const selected = process.env.SMOKE_ENV || (process.env.CI ? 'prod' : 'dev');
    if (!raw[selected]) {
        throw new Error(`Unknown smoke policy environment: ${selected}`);
    }
    return { env: selected, policy: raw[selected] };
}

function assert(condition, message) {
    if (!condition) throw new Error(message);
    console.log(`PASS: ${message}`);
}

async function waitForDebugApi(win, timeoutMs = 10000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
        const ready = await win.webContents.executeJavaScript('Boolean(window.todoDebug)');
        if (ready) return;
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error('window.todoDebug 준비 시간 초과');
}

async function run() {
    const { env: policyEnv, policy } = loadPolicy();

    const safeStorageAvailable = safeStorage.isEncryptionAvailable()
        && (process.platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text');
    if (safeStorageAvailable) {
        const encrypted = safeStorage.encryptString('hoyo-runtime-smoke');
        assert(safeStorage.decryptString(encrypted) === 'hoyo-runtime-smoke', 'OS credential encryption round trip');
    } else {
        console.log('SKIP: OS credential encryption is unavailable on this platform');
    }

    const win = new BrowserWindow({
        show: false,
        width: 1100,
        height: 800,
        webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
        },
    });

    await win.loadFile(path.join(__dirname, '..', 'src', 'index.html'));
    await waitForDebugApi(win);

    const result = await win.webContents.executeJavaScript(`(() => {
        const dbg = window.todoDebug;
        const login = dbg.simulateLoginRenderScenario();
        const categorySwitch = dbg.simulateCategorySwitchScenario();

        const settingsOnlyReset = dbg.settingsChangeScenario(
            {
                bgOpacity: 50,
                bgBlur: 0,
                appTitle: 'A',
                resetEnabled: false,
                resetTime: '00:00',
                resetRepeat: 'daily',
                nextGlobalResetAt: null,
                resetCalendarDate: null,
            },
            {
                bgOpacity: 50,
                bgBlur: 0,
                appTitle: 'A',
                resetEnabled: true,
                resetTime: '06:30',
                resetRepeat: 'every3',
                nextGlobalResetAt: '2026-09-04T06:30:00.000Z',
                resetCalendarDate: null,
            }
        );

        const settingsBgTitle = dbg.settingsChangeScenario(
            {
                bgOpacity: 50,
                bgBlur: 0,
                appTitle: 'A',
                resetEnabled: true,
                resetTime: '06:30',
                resetRepeat: 'every3',
                nextGlobalResetAt: '2026-09-04T06:30:00.000Z',
                resetCalendarDate: null,
            },
            {
                bgOpacity: 65,
                bgBlur: 3,
                appTitle: 'B',
                resetEnabled: true,
                resetTime: '06:30',
                resetRepeat: 'every3',
                nextGlobalResetAt: '2026-09-04T06:30:00.000Z',
                resetCalendarDate: null,
            }
        );

        const hoyoAuth = {
            hasNoConnectUid: !document.getElementById('hoyoConnectUid'),
            hasGamePicker: document.getElementById('hoyoConnectGame')?.value === 'genshin',
            hasStarRailOption: Array.from(document.getElementById('hoyoConnectGame')?.options || [])
                .some(option => option.value === 'starrail'),
            hasZenlessZoneZeroOption: Array.from(document.getElementById('hoyoConnectGame')?.options || [])
                .some(option => option.value === 'zzz'),
            hasZenlessZoneZeroCondition: Array.from(document.getElementById('taskExternalCondition')?.options || [])
                .some(option => option.value === 'hoyolab.zzz.dailyEngagementCompleted'),
            hasTaskConnectionPicker: Boolean(document.getElementById('taskExternalConnection')),
            hasNoBrowserPicker: !document.getElementById('hoyoBrowser'),
            hasSettingsConnectButton: Boolean(document.getElementById('hoyoOpenConnectBtn')),
            hasNoVerifyButton: !document.getElementById('hoyoVerifyBtn'),
            hasRememberLoginOption: Boolean(document.getElementById('hoyoRememberLogin')),
            rememberLoginDefaultsOff: document.getElementById('hoyoRememberLogin')?.checked === false,
        };

        return { login, categorySwitch, settingsOnlyReset, settingsBgTitle, hoyoAuth };
    })()`);

    const loginBudget = policy.renderBudget.login;
    assert(result.login.categories <= loginBudget.categories, `login render budget(${policyEnv}): categories <= ${loginBudget.categories}`);
    assert(result.login.todos <= loginBudget.todos, `login render budget(${policyEnv}): todos <= ${loginBudget.todos}`);
    assert(result.login.bg <= loginBudget.bg, `login render budget(${policyEnv}): bg <= ${loginBudget.bg}`);
    assert(result.login.title <= loginBudget.title, `login render budget(${policyEnv}): title <= ${loginBudget.title}`);

    const switchBudget = policy.renderBudget.categorySwitch;
    assert(result.categorySwitch.categories <= switchBudget.categories, `category switch budget(${policyEnv}): categories <= ${switchBudget.categories}`);
    assert(result.categorySwitch.todos <= switchBudget.todos, `category switch budget(${policyEnv}): todos <= ${switchBudget.todos}`);
    assert(result.categorySwitch.bg <= switchBudget.bg, `category switch budget(${policyEnv}): bg <= ${switchBudget.bg}`);
    assert(result.categorySwitch.title <= switchBudget.title, `category switch budget(${policyEnv}): title <= ${switchBudget.title}`);

    assert(result.settingsOnlyReset.resetChanged === true, 'remote settings: reset change detected');
    assert(result.settingsOnlyReset.bgChanged === false, 'remote settings: bg unchanged detected');
    assert(result.settingsOnlyReset.titleChanged === false, 'remote settings: title unchanged detected');

    assert(result.settingsBgTitle.resetChanged === false, 'remote settings: reset unchanged detected');
    assert(result.settingsBgTitle.bgChanged === true, 'remote settings: bg change detected');
    assert(result.settingsBgTitle.titleChanged === true, 'remote settings: title change detected');

    assert(result.hoyoAuth.hasNoConnectUid, 'HoYoLAB connection dialog gets UID after login');
    assert(result.hoyoAuth.hasGamePicker, 'HoYoLAB connection dialog has a game picker');
    assert(result.hoyoAuth.hasStarRailOption, 'HoYoLAB connection dialog supports Star Rail');
    assert(result.hoyoAuth.hasZenlessZoneZeroOption, 'HoYoLAB connection dialog supports Zenless Zone Zero');
    assert(result.hoyoAuth.hasZenlessZoneZeroCondition, 'Todo external-condition UI supports Zenless Zone Zero');
    assert(result.hoyoAuth.hasTaskConnectionPicker, 'Todo external-condition UI selects a HoYoLAB connection');
    assert(result.hoyoAuth.hasNoBrowserPicker, 'HoYoLAB auth UI does not read an external browser');
    assert(result.hoyoAuth.hasSettingsConnectButton, 'HoYoLAB settings UI has only a connect button');
    assert(result.hoyoAuth.hasNoVerifyButton, 'HoYoLAB auth UI does not require manual verification');
    assert(result.hoyoAuth.hasRememberLoginOption, 'HoYoLAB auth UI offers encrypted login retention');
    assert(result.hoyoAuth.rememberLoginDefaultsOff, 'HoYoLAB login retention is opt-in');

    await win.close();
    console.log(`\nRuntime smoke checks passed. policy=${policyEnv}`);
}

app.commandLine.appendSwitch('disable-gpu');
app.whenReady()
    .then(run)
    .then(() => app.exit(0))
    .catch((err) => {
        console.error(`FAIL: ${err.message}`);
        app.exit(1);
    });
