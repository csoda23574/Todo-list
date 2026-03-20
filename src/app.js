/**
 * app.js — 앱 진입점 (ES Module)
 *
 * SOLID 리팩토링 후 이 파일은 초기화 오케스트레이션만 담당합니다.
 * 각 도메인 로직은 src/modules/ 의 개별 모듈로 분리되어 있습니다.
 */

import { loadState, clearUserData } from './modules/storage.js';
import {
    applyAppTitle, updateHeaderDate, renderTodos,
    applyBackground
} from './modules/renderer.js';
import { renderCategoryTabs } from './modules/categories.js';
import { bindEvents, bindElectronEvents } from './modules/events.js';
import { DOM } from './modules/dom.js';
import { applyRemoteData } from './modules/sync.js';
import { scheduleResetTimer } from './modules/reset.js';
import { on } from './modules/bus.js';

/* ── Composition Root: 이벤트 버스 구독 ──────────────────────────────────
 * 데이터·도메인 레이어는 emit()만 호출하고, 실제 렌더러·타이머 함수는
 * 이 곳에서만 참조합니다. — DIP (의존성 역전 원칙)
 * ────────────────────────────────────────────────────────────────────── */
on('todos:changed', renderTodos);
on('categories:changed', () => { renderCategoryTabs(); renderTodos(); });
on('bg:changed', applyBackground);
on('title:changed', applyAppTitle);
on('reset:reschedule', scheduleResetTimer);

/* ─────────────────────────── 앱 초기화 ────────────────────────────────── */

function init() {
    loadState();
    bindEvents();
    bindElectronEvents();
    updateHeaderDate();
    renderCategoryTabs();
    renderTodos();
    applyBackground();
    applyAppTitle();

    // 헤더 시계: 1초 간격 업데이트
    setInterval(updateHeaderDate, 1000);

    // Firebase 클라우드 동기화 — Google Auth 기반
    if (!window.FirebaseSync?.init()) return;

    // 인증 상태가 확인되기 전까지 로그인 오버레이를 숨겨둠 (이미 로그인된 경우 깜빡임 방지)
    DOM.userAvatarBtn?.classList.add('hidden');

    let _lastSignedInUid = null;

    window.FirebaseSync.listenAuth(
        // onSignIn: 로그인 성공 시
        user => {
            // 계정이 전환된 경우(명시적 로그아웃 없이 UID가 바뀐 경우) 이전 데이터 초기화
            if (_lastSignedInUid && _lastSignedInUid !== user.uid) {
                clearUserData();
            }
            _lastSignedInUid = user.uid;
            DOM.loginOverlay?.classList.add('hidden');

            const avatarImg = DOM.userAvatarImg;
            if (avatarImg) {
                avatarImg.src = user.photoURL ?? '';
                avatarImg.alt = user.displayName ?? user.email ?? '';
                avatarImg.onerror = () => { avatarImg.src = ''; };
            }
            DOM.userAvatarBtn?.classList.remove('hidden');
            DOM.logoutBtn?.classList.remove('hidden');

            if (DOM.accountName) DOM.accountName.textContent = user.displayName ?? '';
            if (DOM.accountEmail) DOM.accountEmail.textContent = user.email ?? '';

            // 동기화 시작
            window.FirebaseSync.startSync(applyRemoteData);
        },
        // onSignOut: 로그아웃 또는 초기 미로그인 상태
        () => {
            _lastSignedInUid = null;
            clearUserData();  // 이전 계정 데이터 초기화 (todos, categories 메모리+localStorage)
            DOM.loginOverlay?.classList.remove('hidden');
            DOM.userAvatarBtn?.classList.add('hidden');
            DOM.logoutBtn?.classList.add('hidden');
            if (DOM.accountName) DOM.accountName.textContent = '로그인되지 않음';
            if (DOM.accountEmail) DOM.accountEmail.textContent = '';
        }
    );
}

document.addEventListener('DOMContentLoaded', init);
