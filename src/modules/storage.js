/**
 * storage.js — LocalStorage + Firebase 동기화 퍼시스턴스
 *
 * 관심사: 데이터 저장/불러오기 및 Firebase push
 * 렌더링이나 UI 로직은 포함하지 않습니다.
 */

import { STORAGE_KEYS, LAST_RESET_KEY } from './config.js';
import { state } from './state.js';
import { emit } from './bus.js';

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
    if (!window.FirebaseSync?.isReady()) return;
    // 오프라인 캐시만 수신한 상태에서는 push 금지 — 네트워크 동기화 이전에
    // 낡은 로컬 데이터로 Firestore를 덮어쓰는 경쟁 조건을 방지합니다.
    if (!window.FirebaseSync?.isNetworkSyncReady()) return;
    window.FirebaseSync.push(buildSyncPayload());
}

/* ─────────────────────────── 저장 함수들 ──────────────────────────────── */

export function saveTodos() {
    saveToStorage(STORAGE_KEYS.TODOS, state.todos);
    pushToFirebase();

    // 로컬 작업 완료 후 3초 뒤 sync 플래그 해제
    if (state.remoteSyncInProgress) {
        if (state.remoteSyncTimer) clearTimeout(state.remoteSyncTimer);
        state.remoteSyncTimer = setTimeout(() => {
            state.remoteSyncInProgress = false;
            state.remoteSyncTimer = null;
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
    if (state.remoteSyncTimer) {
        clearTimeout(state.remoteSyncTimer);
        state.remoteSyncTimer = null;
    }

    // 메모리 상태 초기화
    state.todos = [];
    state.categories = [{ id: 'default', name: '기본' }];
    state.currentCategoryId = 'default';
    state.isFirstSync = true;  // 다음 로그인 때 원격 데이터를 강제 적용
    state.remoteSyncInProgress = false;
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

    // localStorage 초기화 (이전 계정 데이터가 다음 세션에 노출되지 않도록)
    const keysToRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith('todoApp_')) keysToRemove.push(key);
    }
    keysToRemove.forEach(key => localStorage.removeItem(key));
    localStorage.removeItem(LAST_RESET_KEY);

    // UI 갱신
    emit('categories:changed');
    emit('title:changed');
    emit('bg:changed');
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
