/**
 * storage.js — LocalStorage + Firebase 동기화 퍼시스턴스
 *
 * 관심사: 데이터 저장/불러오기 및 Firebase push
 * 렌더링이나 UI 로직은 포함하지 않습니다.
 */

import { STORAGE_KEYS, LAST_RESET_KEY } from './config.js';
import { state } from './state.js';

/* ─────────────────────── LocalStorage 기본 헬퍼 ───────────────────────── */

export function saveToStorage(key, value) {
    try {
        localStorage.setItem(key, JSON.stringify(value));
    } catch {
        // 스토리지 쿼터 초과 — 무시
    }
}

export function loadFromStorage(key, fallback) {
    try {
        const item = localStorage.getItem(key);
        return item !== null ? JSON.parse(item) : fallback;
    } catch {
        return fallback;
    }
}

/* ─────────────────────────── Firebase 동기화 ──────────────────────────── */

/** 현재 앱 데이터로 Firebase 동기화 페이로드를 빌드합니다. */
function buildSyncPayload() {
    const resetHistory = {
        globalReset: localStorage.getItem(LAST_RESET_KEY),
        // map().filter() 대신 reduce로 중간 배열 없이 단일 순회
        itemResets: state.todos.reduce((acc, todo) => {
            const val = localStorage.getItem(`todoApp_itemLastReset_${todo.id}`);
            if (val) acc[todo.id] = val;
            return acc;
        }, {}),
    };

    const { bgImage: _b, bgFileName: _f, ...settingsRest } = state.settings;

    return {
        todos: state.todos,
        categories: state.categories,
        resetHistory,
        settings: settingsRest,
    };
}

function pushToFirebase() {
    if (window.FirebaseSync?.isReady()) {
        window.FirebaseSync.push(buildSyncPayload());
    }
}

/* ─────────────────────────── 저장 함수들 ──────────────────────────────── */

export function saveTodos() {
    console.log('[saveTodos] 저장 시작 — remoteSyncInProgress:', state.remoteSyncInProgress);
    saveToStorage(STORAGE_KEYS.TODOS, state.todos);
    pushToFirebase();

    // 로컬 작업 완료 후 3초 뒤 sync 플래그 해제
    if (state.remoteSyncInProgress) {
        if (state.remoteSyncTimer) clearTimeout(state.remoteSyncTimer);
        state.remoteSyncTimer = setTimeout(() => {
            state.remoteSyncInProgress = false;
            state.remoteSyncTimer = null;
            console.log('[saveTodos] remoteSyncInProgress 해제');
        }, 3000);
    }
}

export function saveCategories() {
    saveToStorage(STORAGE_KEYS.CATEGORIES, state.categories);
    saveToStorage(STORAGE_KEYS.CURRENT_CATEGORY, state.currentCategoryId);
    pushToFirebase();
}

export function saveSettings() {
    const { bgImage, ...rest } = state.settings;
    saveToStorage(STORAGE_KEYS.SETTINGS, rest);

    if (bgImage) {
        saveToStorage(STORAGE_KEYS.BG_IMAGE, bgImage);
    } else {
        localStorage.removeItem(STORAGE_KEYS.BG_IMAGE);
    }

    pushToFirebase();
}

/* ────────────────────────── 상태 초기화 (앱 시작) ─────────────────────── */

export function loadState() {
    state.todos = loadFromStorage(STORAGE_KEYS.TODOS, []);

    const savedTheme = loadFromStorage(STORAGE_KEYS.THEME, 'light');
    document.documentElement.setAttribute('data-theme', savedTheme);

    const savedSettings = loadFromStorage(STORAGE_KEYS.SETTINGS, {});
    state.settings = { ...state.settings, ...savedSettings };
    state.settings.bgImage = loadFromStorage(STORAGE_KEYS.BG_IMAGE, null);

    const savedCategories = loadFromStorage(STORAGE_KEYS.CATEGORIES, null);
    if (savedCategories?.length) state.categories = savedCategories;

    state.currentCategoryId = loadFromStorage(STORAGE_KEYS.CURRENT_CATEGORY, 'default');
    if (!state.categories.find(c => c.id === state.currentCategoryId)) {
        state.currentCategoryId = state.categories[0].id;
    }
}
