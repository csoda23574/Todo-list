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
import { migrateToRecurrence, calcNextDueAfter } from './recurrence.js';

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

/* ────────────────────────── 상태 초기화 (앱 시작) ─────────────────────── */

export function loadState() {
    const rawTodos = loadFromStorage(STORAGE_KEYS.TODOS, []);

    // 구버전 itemResetTime/itemResetSchedule → recurrence + nextDue 마이그레이션
    const now = new Date();
    state.todos = rawTodos.map(todo => {
        if (todo.recurrence !== undefined) return todo; // 이미 신규 포맷
        if (!todo.itemResetTime && !todo.itemResetSchedule) return todo; // 반복 없는 항목
        const migrated = migrateToRecurrence(todo);
        if (migrated.recurrence && !migrated.nextDue) {
            migrated.nextDue = calcNextDueAfter(migrated.recurrence, now, now)?.toISOString() ?? null;
        }
        return migrated;
    });

    const savedTheme = loadFromStorage(STORAGE_KEYS.THEME, 'light');
    document.documentElement.setAttribute('data-theme', savedTheme);

    const savedSettings = loadFromStorage(STORAGE_KEYS.SETTINGS, {});
    state.settings = { ...state.settings, ...savedSettings };

    // 구버전 lastGlobalResetAt → nextGlobalResetAt 마이그레이션: 삭제하고 applyResets에서 재계산
    if ('lastGlobalResetAt' in state.settings) {
        delete state.settings.lastGlobalResetAt;
        state.settings.nextGlobalResetAt = null;
    }

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

