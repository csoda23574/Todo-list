/**
 * ui.js — 테마, 필터, UI 토글
 */

import { state } from './state.js';
import { STORAGE_KEYS } from './config.js';
import { saveToStorage } from './storage.js';
import { emit } from './bus.js'; // renderer 직접 의존 제거 — DIP
import { showToast } from './utils.js';

/* ─────────────────────────── 테마 전환 ────────────────────────────────── */

export function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme');
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    saveToStorage(STORAGE_KEYS.THEME, next);
    showToast(next === 'dark' ? '다크모드 활성화' : '라이트모드 활성화', 'info');
}

/* ────────────────────── 할 일 필터 변경 ───────────────────────────────── */

export function setFilter(filter) {
    state.filter = filter;
    document.querySelectorAll('.filter-tab').forEach(tab => {
        tab.classList.toggle('active', tab.dataset.filter === filter);
    });
    emit('todos:changed');
}

/* ─────────────────────── UI 토글 (숨기기/보임) ────────────────────────── */

export function toggleUI() {
    document.querySelector('.app-container')?.classList.toggle('ui-hidden');
}

/* ──────────────────────── Windows 최대화 버튼 ──────────────────────────── */

export function updateWinMaximizeBtn(isMaximized) {
    const btn = document.getElementById('winMaximize');
    if (!btn) return;
    if (isMaximized) {
        btn.title = '이전 크기로';
        btn.innerHTML = `
            <svg viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.5">
              <rect x="0.75" y="2.75" width="6.5" height="6.5"/>
              <path d="M3 2.75V0.75H9.25V7H7.25" fill="none"/>
            </svg>`;
    } else {
        btn.title = '최대화';
        btn.innerHTML = `
            <svg viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.5">
              <rect x="0.75" y="0.75" width="8.5" height="8.5"/>
            </svg>`;
    }
}
