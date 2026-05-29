/**
 * app.js — 앱 진입점 (ES Module)
 *
 * 이 파일은 초기화 오케스트레이션만 담당합니다.
 * 각 도메인 로직은 src/modules/ 의 개별 모듈로 분리되어 있습니다.
 */

import { loadState } from './modules/storage.js';
import {
    applyAppTitle, updateHeaderDate, renderTodos,
    applyBackground
} from './modules/renderer.js';
import { renderCategoryTabs, addCategory, switchCategory } from './modules/categories.js';
import { bindEvents, bindElectronEvents } from './modules/events.js';
import {
    scheduleResetTimer,
    checkMissedResetsAfterSync,
    buildMinuteTickKey,
    shouldHandleMinuteTick,
} from './modules/reset.js';
import { on, emit } from './modules/bus.js';
import { state } from './modules/state.js';
import { auth } from './modules/firebase.js';
import { initialMerge, startListeners, stopListeners, getSettingsChangeFlags } from './modules/sync.js';
import { DOM } from './modules/dom.js';
import { getStorageKey, STORAGE_KEYS } from './modules/config.js';
import { loadFromIDB } from './modules/idb.js';
import {
    recordRender,
    withRenderMetric,
    getRenderMetrics,
    resetRenderMetrics,
} from './modules/perf.js';

/* ── Composition Root: 이벤트 버스 구독 ──────────────────────────────────
 * 데이터·도메인 레이어는 emit()만 호출하고, 실제 렌더러·타이머 함수는
 * 이 곳에서만 참조합니다. — DIP (의존성 역전 원칙)
 * ────────────────────────────────────────────────────────────────────── */
const renderTodosTracked = withRenderMetric('todos', renderTodos);
const applyBackgroundTracked = withRenderMetric('bg', applyBackground);
const applyAppTitleTracked = withRenderMetric('title', applyAppTitle);

on('todos:changed', renderTodosTracked);
on('categories:changed', () => {
    recordRender('categories');
    renderCategoryTabs();
    renderTodosTracked();
});
on('bg:changed', applyBackgroundTracked);
on('title:changed', applyAppTitleTracked);
on('reset:reschedule', scheduleResetTimer);

/* ─────────────────────────── 헤더 유저 UI 업데이트 ────────────────────── */

function updateUserUI(user) {
    const wrap = document.getElementById('userInfoWrap');
    if (!wrap) return;

    if (user) {
        if (DOM.userAvatar) {
            DOM.userAvatar.src = user.photoURL || '';
            DOM.userAvatar.style.display = user.photoURL ? 'block' : 'none';
        }
        if (DOM.userDisplayName) DOM.userDisplayName.textContent = user.displayName || user.email || '';
        wrap.style.display = 'flex';
    } else {
        wrap.style.display = 'none';
    }
}

function showLoginOverlay() {
    if (DOM.loginOverlay) {
        DOM.loginOverlay.style.display = 'flex';
        // 에러 메시지 초기화
        if (DOM.loginErrorMsg) DOM.loginErrorMsg.style.display = 'none';
        const btn = DOM.googleLoginBtn;
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = `<svg viewBox="0 0 24 24" width="20" height="20">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
            </svg> Google로 로그인`;
        }
    }
}

function hideLoginOverlay() {
    if (DOM.loginOverlay) DOM.loginOverlay.style.display = 'none';
}

/* ─────────────────────────── syncDot 표시 헬퍼 ───────────────────────── */

export function showSyncDot(visible) {
    if (DOM.syncDot) DOM.syncDot.classList.toggle('active', visible);
}

/* ─────────────────────────── 앱 초기화 ────────────────────────────────── */

function init() {
    loadState();
    bindEvents();
    bindElectronEvents();
    updateHeaderDate();
    renderCategoryTabs();
    recordRender('categories');
    renderTodosTracked();
    applyBackgroundTracked();
    applyAppTitleTracked();

    // 헤더 시계: 1초 간격 업데이트
    setInterval(updateHeaderDate, 1000);

    // 자동 초기화 타이머 시작
    scheduleResetTimer();

    // Firebase Auth 상태 감지
    auth.onAuthStateChanged(async (user) => {
        if (user) {
            // ── 로그인 성공 ──
            state.uid       = user.uid;
            state.user      = user;
            state.isSignedIn = true;

            hideLoginOverlay();
            updateUserUI(user);

            // 로컬 스토리지 키가 uid 기반으로 바뀌었으므로 IDB 배경 이미지 재로드
            const idbKey = getStorageKey(state.uid, STORAGE_KEYS.BG_IMAGE);
            const idbImage = await loadFromIDB(idbKey);
            if (idbImage) {
                state.settings.bgImage = idbImage;
                applyBackgroundTracked();
            }

            // Firestore 초기 병합 → 실시간 리스너 시작
            await initialMerge();
            startListeners();
            // Firestore 데이터 수신 후 놓친 초기화 소급 적용
            checkMissedResetsAfterSync();
        } else {
            // ── 로그아웃 ──
            stopListeners();

            state.uid        = 'guest';
            state.user       = null;
            state.isSignedIn = false;

            updateUserUI(null);
            showLoginOverlay();
        }
    });
}

if (typeof window !== 'undefined') {
    const prev = window.todoDebug || {};
    window.todoDebug = {
        ...prev,
        getRenderMetrics,
        resetRenderMetrics,
        simulateLoginRenderScenario: () => {
            resetRenderMetrics();
            emit('title:changed');
            emit('bg:changed');
            emit('categories:changed');
            return getRenderMetrics();
        },
        simulateCategorySwitchScenario: () => {
            // 기존 카테고리가 2개 미만이면 switch 없이 계측값만 반환 (데이터 생성 방지)
            resetRenderMetrics();
            const current = state.currentCategoryId;
            const target = state.categories.find(c => c.id !== current)?.id;
            if (!target) return getRenderMetrics();
            switchCategory(target);
            return getRenderMetrics();
        },
        minuteTickScenario: (isoNow) => {
            const now = new Date(isoNow);
            const key = buildMinuteTickKey(now);
            return {
                key,
                first: shouldHandleMinuteTick(null, now),
                second: shouldHandleMinuteTick(key, now),
            };
        },
        settingsChangeScenario: (prevSettings, nextSettings) =>
            getSettingsChangeFlags(prevSettings, nextSettings),
    };
}

document.addEventListener('DOMContentLoaded', init);
