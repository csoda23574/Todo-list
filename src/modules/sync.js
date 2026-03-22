/**
 * sync.js — Firebase 원격 데이터 동기화 처리
 *
 * applyRemoteData: Firebase에서 수신한 cloudData를 로컬 state에 반영
 * manualRefresh:   새로고침 버튼 — Firebase 연결 재시도
 */

import { state } from './state.js';
import { STORAGE_KEYS, getGlobalResetKey, getItemResetKey, getResetTimestampKey } from './config.js';
import { saveToStorage, updatePreviousState } from './storage.js';
import { emit } from './bus.js'; // renderer·categories·reset 직접 의존 제거 — DIP
import { logResetStatus } from './debug.js';
import { DOM } from './dom.js';

let fallbackTimer = null;

/* ──────────────────────── 원격 데이터 적용 ─────────────────────────────── */

export function applyRemoteData(cloudData) {
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
    if (cloudData.settingsDoc) {
        const { settings, resetHistory } = cloudData.settingsDoc;

        // 리셋 내역 타임스탬프 기반 병합 (충돌 롤백 및 에러 해결)
        if (resetHistory) {
            const localTsKey = getResetTimestampKey(state.uid);
            const localTs = parseInt(localStorage.getItem(localTsKey) || '0', 10);
            const remoteTs = resetHistory.timestamp || 0;

            // 원격 데이터가 명확하게 최신이거나, 첫 동기화인데 로컬이 아예 비어있을 때만 수용
            const needsUpdate = remoteTs > localTs || (state.isFirstSync && localTs === 0 && Object.keys(resetHistory).length > 0);

            if (needsUpdate) {
                if (resetHistory.globalReset) {
                    localStorage.setItem(getGlobalResetKey(state.uid), resetHistory.globalReset);
                }
                if (resetHistory.itemResets) {
                    Object.entries(resetHistory.itemResets).forEach(([itemId, val]) => {
                        localStorage.setItem(getItemResetKey(state.uid, itemId), val);
                    });
                }
                localStorage.setItem(localTsKey, remoteTs.toString());
                resetHistoryChanged = true;
            }
        }

        // 설정 병합
        if (settings) {
            const localStr = JSON.stringify({ ...state.settings, bgImage: null, bgFileName: null });
            const remoteStr = JSON.stringify({ ...settings, bgImage: null, bgFileName: null });

            if (state.isFirstSync || localStr !== remoteStr) {
                const { bgImage, bgFileName } = state.settings;
                state.settings = { ...state.settings, ...settings, bgImage, bgFileName };
                const { bgImage: _b, bgFileName: _f, ...rest } = state.settings;
                saveToStorage(STORAGE_KEYS.SETTINGS, rest);
                emit('title:changed');
                changed = true;
            }
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

    if (changed) {
        updatePreviousState();      // Diff 캐시 강제 갱신 -> 수신한 데이터를 재전송(Echo)하는 것 완벽 방지
        emit('categories:changed'); // renderCategoryTabs + renderTodos 모두 처리
        emit('bg:changed');
    }

    // ── 초기화 시스템 재시작 조건 ──
    const isNetworkReady = window.FirebaseSync?.isNetworkSyncReady?.() ?? true;

    if (state.isFirstSync) {
        if (isNetworkReady) {
            state.isFirstSync = false;
            if (fallbackTimer) { clearTimeout(fallbackTimer); fallbackTimer = null; }
            emit('reset:reschedule');
        } else if (!fallbackTimer) {
            // 오프라인/캐시 상태에서 무한 대기를 방지하기 위해 3초 후 강제 타이머 시작
            fallbackTimer = setTimeout(() => {
                if (state.isFirstSync) {
                    state.isFirstSync = false;
                    emit('reset:reschedule');
                }
            }, 3000);
        }
    } else if (todosChanged || resetHistoryChanged) {
        emit('reset:reschedule');
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
