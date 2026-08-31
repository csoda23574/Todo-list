/**
 * storage.js — LocalStorage 퍼시스턴스
 *
 * 관심사: 데이터 저장/불러오기
 * 렌더링이나 UI 로직은 포함하지 않습니다.
 */

import { STORAGE_KEYS, getStorageKey } from './config.js';
import { state } from './state.js';
import { emit } from './bus.js';
import { saveToIDB, loadFromIDB, removeFromIDB } from './idb.js';
import { pushTodo, pushCategories, pushSettings, setLocalWritePending } from './sync.js';
import { calcNextDueAfter } from './recurrence.js';

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

/* ─────────────────────────── 저장 함수들 ──────────────────────────────── */

export function saveTodos(changedTodo = null) {
    saveToStorage(STORAGE_KEYS.TODOS, state.todos);
    // Firestore 동기화 — 변경된 단일 todo만 push (성능 최적화)
    if (state.isSignedIn) {
        setLocalWritePending(true);
        const target = changedTodo
            ? Promise.resolve(pushTodo({ ...changedTodo, updatedAt: new Date().toISOString() }))
            : Promise.all(state.todos.map(t => pushTodo({ ...t, updatedAt: new Date().toISOString() })));
        target.finally(() => setLocalWritePending(false));
    }
}

export function saveCategories() {
    // order 인덱스를 현재 배열 순서 기준으로 갱신
    state.categories = state.categories.map((c, i) => ({ ...c, order: i }));
    saveToStorage(STORAGE_KEYS.CATEGORIES, state.categories);
    saveToStorage(STORAGE_KEYS.CURRENT_CATEGORY, state.currentCategoryId);
    if (state.isSignedIn) {
        setLocalWritePending(true);
        pushCategories(state.categories, state.currentCategoryId)
            .finally(() => setLocalWritePending(false));
    }
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

    // bgImage 제외하고 Firestore 동기화
    if (state.isSignedIn) {
        setLocalWritePending(true);
        pushSettings(state.settings).finally(() => setLocalWritePending(false));
    }
}

export function saveCategoryBg(catId, bgImage, meta) {
    if (!state.settings.categoryBgSettings) state.settings.categoryBgSettings = {};
    const idbKey = getStorageKey(state.uid, `${STORAGE_KEYS.CAT_BG_IMAGE}_${catId}`);
    
    if (bgImage) {
        state.settings.categoryBgSettings[catId] = { ...meta, hasBg: true };
        state._catBgCache[catId] = bgImage;
        saveToIDB(idbKey, bgImage);
    } else {
        delete state.settings.categoryBgSettings[catId];
        delete state._catBgCache[catId];
        removeFromIDB(idbKey);
    }
    saveSettings(); // Push metadata to sync
}

export function removeCategoryBg(catId) {
    saveCategoryBg(catId, null);
}

/* ────────────────────────── 상태 초기화 (앱 시작) ─────────────────────── */

export function loadState() {
    const savedTheme = loadFromStorage(STORAGE_KEYS.THEME, 'light');
    document.documentElement.setAttribute('data-theme', savedTheme);

    // 테마만 guest uid 무관하게 로드. todos/settings는 loadUserState()에서 uid 확정 후 로드.
}

/**
 * 로그인 후 uid가 확정된 시점에 호출합니다.
 * localStorage에서 해당 계정의 todos·settings·categories를 로드합니다.
 */
export function loadUserState() {
    const rawTodos = loadFromStorage(STORAGE_KEYS.TODOS, []);

    // order 필드 배열 인덱스 기반 부여 및 과거(deprecated) 필드 삭제
    state.todos = rawTodos.map((todo, i) => {
        const withOrder = todo.order !== undefined ? todo : { ...todo, order: i };
        if ('itemResetTime' in withOrder) delete withOrder.itemResetTime;
        if ('itemResetSchedule' in withOrder) delete withOrder.itemResetSchedule;
        if ('itemResetDatetime' in withOrder) delete withOrder.itemResetDatetime;
        return withOrder;
    });

    const savedSettings = loadFromStorage(STORAGE_KEYS.SETTINGS, {});
    state.settings = { ...state.settings, ...savedSettings };

    // 구버전 lastGlobalResetAt 마이그레이션 삭제 (전역 리셋 기능 제거)
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

    // 앱 시작 시 항상 첫 번째(가장 왼쪽) 카테고리를 선택
    state.currentCategoryId = state.categories[0]?.id ?? 'default';
}


