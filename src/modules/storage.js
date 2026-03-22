/**
 * storage.js — LocalStorage + Firebase 동기화 퍼시스턴스
 *
 * 관심사: 데이터 저장/불러오기 및 Firebase push
 * 렌더링이나 UI 로직은 포함하지 않습니다.
 */

import { STORAGE_KEYS, getStorageKey, getGlobalResetKey, getItemResetKey, getResetTimestampKey } from './config.js';
import { state } from './state.js';
import { emit } from './bus.js';
import { saveToIDB, loadFromIDB, removeFromIDB } from './idb.js';

/* ─────────────────────── LocalStorage 기본 헬퍼 ───────────────────────── */

export function saveToStorage(key, value) {
    try {
        const actualKey = key === STORAGE_KEYS.THEME ? key : getStorageKey(state.uid, key);
        localStorage.setItem(actualKey, JSON.stringify(value));
    } catch {
        // 스토리지 쿼터 초과 — 무시
    }
}

export function loadFromStorage(key, fallback) {
    try {
        const actualKey = key === STORAGE_KEYS.THEME ? key : getStorageKey(state.uid, key);
        const item = localStorage.getItem(actualKey);
        return item !== null ? JSON.parse(item) : fallback;
    } catch {
        return fallback;
    }
}

/* ─────────────────────────── Firebase 동기화 ──────────────────────────── */

let prevTodosStr = null;
let prevCategoriesStr = null;
let prevSettingsStr = null;

export function updatePreviousState() {
    prevTodosStr = JSON.stringify(state.todos);
    prevCategoriesStr = JSON.stringify(state.categories);
    prevSettingsStr = JSON.stringify(buildSettingsPayload());
}

/** 로컬 배열 상태의 Diff를 추려냅니다 */
function computeArrayDiff(current, prevStr) {
    const prev = prevStr ? JSON.parse(prevStr) : [];
    const prevMap = new Map(prev.map(item => [item.id, item]));
    const currMap = new Map(current.map(item => [item.id, item]));
    const addedOrModified = [];
    const deleted = [];

    for (const item of current) {
        const p = prevMap.get(item.id);
        if (!p || JSON.stringify(p) !== JSON.stringify(item)) addedOrModified.push(item);
    }
    for (const id of prevMap.keys()) {
        if (!currMap.has(id)) deleted.push(id);
    }
    return (addedOrModified.length > 0 || deleted.length > 0) ? { addedOrModified, deleted } : null;
}

function buildSettingsPayload() {
    const resetHistory = {
        timestamp: parseInt(localStorage.getItem(getResetTimestampKey(state.uid)) || '0', 10),
        globalReset: localStorage.getItem(getGlobalResetKey(state.uid)),
        // map().filter() 대신 reduce로 중간 배열 없이 단일 순회
        itemResets: state.todos.reduce((acc, todo) => {
            const val = localStorage.getItem(getItemResetKey(state.uid, todo.id));
            if (val) acc[todo.id] = val;
            return acc;
        }, {}),
    };

    const { bgImage: _b, bgFileName: _f, ...settingsRest } = state.settings;

    return { settings: settingsRest, resetHistory };
}

function pushToFirebase() {
    if (!window.FirebaseSync?.isReady()) return;

    const todosDiff = computeArrayDiff(state.todos, prevTodosStr);
    const categoriesDiff = computeArrayDiff(state.categories, prevCategoriesStr);

    const currentSettings = buildSettingsPayload();
    const currentSettingsStr = JSON.stringify(currentSettings);
    let settingsData = null;
    if (currentSettingsStr !== prevSettingsStr) settingsData = currentSettings;

    if (todosDiff || categoriesDiff || settingsData) {
        window.FirebaseSync.pushDiffs(todosDiff, categoriesDiff, settingsData);
        if (todosDiff) prevTodosStr = JSON.stringify(state.todos);
        if (categoriesDiff) prevCategoriesStr = JSON.stringify(state.categories);
        if (settingsData) prevSettingsStr = currentSettingsStr;
    }
}

/* ─────────────────────────── 저장 함수들 ──────────────────────────────── */

export function saveTodos() {
    saveToStorage(STORAGE_KEYS.TODOS, state.todos);
    pushToFirebase();
}

export function saveCategories() {
    saveToStorage(STORAGE_KEYS.CATEGORIES, state.categories);
    saveToStorage(STORAGE_KEYS.CURRENT_CATEGORY, state.currentCategoryId);
    pushToFirebase();
}

export function saveSettings() {
    const { bgImage, ...rest } = state.settings;
    saveToStorage(STORAGE_KEYS.SETTINGS, rest);

    const idbKey = getStorageKey(state.uid, STORAGE_KEYS.BG_IMAGE);
    if (bgImage) {
        saveToIDB(idbKey, bgImage);
    } else {
        removeFromIDB(idbKey);
    }

    pushToFirebase();
}

/* ───────────── 계정 전환 시 로컬 상태 초기화 ──────────────────────────── */

/**
 * 로그아웃 또는 계정 전환 시 호출.
 * 이전 계정 데이터가 새 계정 화면에 남아있는 문제를 방지합니다.
 */
export function clearUserData() {
    // 타이머 정리 (이전 계정의 초기화 인터벌이 새 계정에서 실행되지 않도록)
    if (state.resetTimerInterval) {
        clearInterval(state.resetTimerInterval);
        state.resetTimerInterval = null;
    }

    // 메모리 상태 초기화
    state.todos = [];
    state.categories = [{ id: 'default', name: '기본' }];
    state.currentCategoryId = 'default';
    state.isFirstSync = true;  // 다음 로그인 때 원격 데이터를 강제 적용
    state.settings = {
        resetEnabled: false,
        resetTime: '00:00',
        resetRepeat: 'daily',
        bgOpacity: 50,
        bgBlur: 0,
        bgImage: null,
        bgFileName: '',
        appTitle: 'My Tasks',
    };

    // 파괴적인 localStorage.removeItem은 제거합니다. UID 기반으로 이미 완벽히 격리되어 있습니다.

    // UI 갱신
    emit('categories:changed');
    emit('title:changed');
    emit('bg:changed');
    updatePreviousState(); // 상태 격리/초기화 시 현재 내역을 베이스라인으로 캐싱
}

/* ────────────────────────── 상태 초기화 (앱 시작) ─────────────────────── */

export function loadState() {
    state.todos = loadFromStorage(STORAGE_KEYS.TODOS, []);

    const savedTheme = loadFromStorage(STORAGE_KEYS.THEME, 'light');
    document.documentElement.setAttribute('data-theme', savedTheme);

    const savedSettings = loadFromStorage(STORAGE_KEYS.SETTINGS, {});
    state.settings = { ...state.settings, ...savedSettings };

    // Set an initial null state so the UI doesn't break
    state.settings.bgImage = null;

    const idbKey = getStorageKey(state.uid, STORAGE_KEYS.BG_IMAGE);
    loadFromIDB(idbKey).then(idbImage => {
        if (idbImage) {
            state.settings.bgImage = idbImage;
            emit('bg:changed');
        } else {
            // 마이그레이션: 구버전 공용 키 확인 후 현재 계정 전용 IDB로 이관
            const legacyImageStr = localStorage.getItem('todoApp_bgImage');
            if (legacyImageStr) {
                try {
                    const legacyImage = JSON.parse(legacyImageStr);
                    state.settings.bgImage = legacyImage;
                    emit('bg:changed');
                    saveToIDB(idbKey, legacyImage);
                    localStorage.removeItem('todoApp_bgImage');
                } catch { }
            }
        }
    });

    const savedCategories = loadFromStorage(STORAGE_KEYS.CATEGORIES, null);
    if (savedCategories?.length) state.categories = savedCategories;

    state.currentCategoryId = loadFromStorage(STORAGE_KEYS.CURRENT_CATEGORY, 'default');
    if (!state.categories.find(c => c.id === state.currentCategoryId)) {
        state.currentCategoryId = state.categories[0].id;
    }
    updatePreviousState(); // 시작 베이스라인 확보
}
