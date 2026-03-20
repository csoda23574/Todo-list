/**
 * sync.js — Firebase 원격 데이터 동기화 처리
 *
 * applyRemoteData: Firebase에서 수신한 cloudData를 로컬 state에 반영
 * manualRefresh:   새로고침 버튼 — Firebase 연결 재시도
 */

import { state } from './state.js';
import { STORAGE_KEYS, LAST_RESET_KEY } from './config.js';
import { saveToStorage } from './storage.js';
import { emit } from './bus.js'; // renderer·categories·reset 직접 의존 제거 — DIP
import { logResetStatus } from './debug.js';
import { DOM } from './dom.js';

/* ──────────────────────── 원격 데이터 적용 ─────────────────────────────── */

export function applyRemoteData(cloudData) {
    if (state.remoteSyncInProgress) return;

    let changed = false;
    let todosChanged = false;
    let resetHistoryChanged = false;

    // ── todos ──
    if (cloudData.todos) {
        const localJson = JSON.stringify(state.todos);
        const remoteJson = JSON.stringify(cloudData.todos);
        const isDiff = localJson !== remoteJson;

        if (state.isFirstSync || isDiff) {
            state.todos = cloudData.todos;
            saveToStorage(STORAGE_KEYS.TODOS, state.todos);
            changed = true;
            todosChanged = true;
        }
    }

    // ── resetHistory ──
    if (cloudData.resetHistory) {
        const rh = cloudData.resetHistory;

        if (rh.globalReset) {
            const current = localStorage.getItem(LAST_RESET_KEY);
            if (state.isFirstSync || current !== rh.globalReset) {
                localStorage.setItem(LAST_RESET_KEY, rh.globalReset);
                resetHistoryChanged = true;
            }
        }

        if (rh.itemResets) {
            Object.entries(rh.itemResets).forEach(([itemId, val]) => {
                const key = `todoApp_itemLastReset_${itemId}`;
                const current = localStorage.getItem(key);
                if (state.isFirstSync || current !== val) {
                    localStorage.setItem(key, val);
                    resetHistoryChanged = true;
                }
            });
        }
    }

    // ── categories ──
    if (cloudData.categories?.length &&
        JSON.stringify(cloudData.categories) !== JSON.stringify(state.categories)) {
        state.categories = cloudData.categories;
        saveToStorage(STORAGE_KEYS.CATEGORIES, state.categories);
        if (!state.categories.find(c => c.id === state.currentCategoryId)) {
            state.currentCategoryId = state.categories[0].id;
            saveToStorage(STORAGE_KEYS.CURRENT_CATEGORY, state.currentCategoryId);
        }
        changed = true;
    }

    // ── settings (bgImage/bgFileName은 로컬 디바이스 전용) ──
    if (cloudData.settings) {
        const { bgImage, bgFileName } = state.settings;
        state.settings = { ...state.settings, ...cloudData.settings, bgImage, bgFileName };
        const { bgImage: _b, bgFileName: _f, ...rest } = state.settings;
        saveToStorage(STORAGE_KEYS.SETTINGS, rest);
        emit('title:changed');
        changed = true;
    }

    // ── 초기화 시스템 재시작 조건 ──
    if (state.isFirstSync || todosChanged || resetHistoryChanged) {
        emit('reset:reschedule');
        state.isFirstSync = false;
    }

    if (changed) {
        emit('categories:changed'); // renderCategoryTabs + renderTodos 모두 처리
        emit('bg:changed');
    }
}

/* ──────────────────────── 수동 새로고침 ────────────────────────────────── */

export function manualRefresh() {
    const btn = DOM.refreshBtn;
    if (!btn || btn.classList.contains('spinning')) return;
    btn.classList.add('spinning');

    if (window.FirebaseSync?.isReady()) {
        window.FirebaseSync.startSync(applyRemoteData);
    } else if (window.FirebaseSync?.init()) {
        window.FirebaseSync.startSync(applyRemoteData);
    }

    setTimeout(() => {
        btn.classList.remove('spinning');
        logResetStatus();
    }, 1000);
}
