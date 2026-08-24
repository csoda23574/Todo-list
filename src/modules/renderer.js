/**
 * renderer.js — UI 렌더링 함수 모음
 *
 * 주의: createTodoElement는 이벤트 리스너를 직접 등록하지 않습니다.
 * 체크박스·수정·삭제 이벤트는 events.js에서 이벤트 위임으로 처리합니다.
 */

import { state } from './state.js';
import { DOM } from './dom.js';
import { escapeHtml, formatRecurrenceBadge } from './utils.js';
import { settingsToRecurrence } from './recurrence.js';

/* ─────────────────────────── 팔레트 (상단바 색상) ─────────────────────── */

/**
 * state.settings.uiBaseColor 를 CSS 변수에 반영합니다.
 * 이 하나의 변수만 바꾸면 상단바 / 탭 / 그림자 색상이 자동으로 따라옵니다.
 * 밝기(Luminance)를 계산해 글씨 색상(--ui-fg-base)도 자동 조절합니다.
 */
export function applyUiPalette() {
    const color = state.settings.uiBaseColor || '#3a6491';
    document.documentElement.style.setProperty('--ui-base-color', color);

    // 밝기 계산 (hex -> rgb)
    const hex = color.replace('#', '');
    const r = parseInt(hex.substr(0, 2), 16);
    const g = parseInt(hex.substr(2, 2), 16);
    const b = parseInt(hex.substr(4, 2), 16);
    
    // 단순화된 밝기 공식 (YIQ)
    const yiq = ((r * 299) + (g * 587) + (b * 114)) / 1000;
    
    // 128 이상이면 밝은 배경이므로 어두운 텍스트(0,0,0), 아니면 흰색 텍스트(255,255,255)
    const fgBase = (yiq >= 140) ? '10, 10, 10' : '255, 255, 255';
    document.documentElement.style.setProperty('--ui-fg-base', fgBase);
}

/* ─────────────────────────── 앱 타이틀 ────────────────────────────────── */

export function applyAppTitle() {
    const title = state.settings.appTitle || 'My Tasks';
    if (DOM.headerTitle) DOM.headerTitle.textContent = title;
}

/* ─────────────────────────── 헤더 날짜/시계 ───────────────────────────── */

export function updateHeaderDate() {
    if (!DOM.headerDate) return;
    const now = new Date();
    const dateStr = now.toLocaleDateString('ko-KR', {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    });
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    const ss = String(now.getSeconds()).padStart(2, '0');
    DOM.headerDate.innerHTML = `${dateStr}<span class="header-time">${hh}:${mm}:${ss}</span>`;
}

/* ────────────────────────────── 통계 바 ───────────────────────────────── */

/**
 * @param {Array} [catTodos] — 이미 필터된 카테고리 배열 (없으면 내부에서 계산)
 */
export function updateStats(catTodos) {
    if (!DOM.totalCount || !DOM.progressFill) return;
    const todos = catTodos ?? _catTodos();
    const total = todos.length;

    // 임시 배열 생성(.filter) 없이 직접 카운트하여 메모리 낭비 방지
    let done = 0;
    for (let i = 0; i < total; i++) {
        if (todos[i].done) done++;
    }
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;

    DOM.totalCount.textContent = total;
    DOM.doneCount.textContent = done;
    DOM.pendingCount.textContent = total - done;
    DOM.progressFill.style.width = `${pct}%`;
}


/* ─────────────────────── 할 일 필터링 (함수형) ─────────────────────────── */

/** 현재 카테고리의 할 일만 반환합니다 (done/pending 필터 미적용). */
function _catTodos() {
    return state.todos.filter(
        t => (t.categoryId || 'default') === state.currentCategoryId
    );
}

/** done/pending/all 필터를 catTodos 배열에 적용합니다. */
function _applyStateFilter(catTodos) {
    if (state.filter === 'done') return catTodos.filter(t => t.done);
    if (state.filter === 'pending') return catTodos.filter(t => !t.done);
    return catTodos.slice().sort((a, b) => (a.done ? 1 : 0) - (b.done ? 1 : 0));
}

export function getFilteredTodos() {
    return _applyStateFilter(_catTodos());
}

/* ──────────────────────── 할 일 DOM 요소 생성 ──────────────────────────── */

/**
 * 할 일 항목 DOM 요소를 생성합니다.
 * 이벤트 리스너는 등록하지 않습니다 — events.js의 위임 처리기를 사용합니다.
 */
export function createTodoElement(todo) {
    const priorityLabels = { low: '낮음', medium: '보통', high: '높음' };
    const priority = todo.priority || 'medium';
    const checklist = todo.checklist || [];
    const clTotal = checklist.length;
    const clDone = checklist.filter(c => c.done).length;
    const hasChecklist = clTotal > 0;

    // 다음 초기화 시간 배지 계산
    const showBadge = state.settings.showNextResetTime !== false;
    let nextResetBadgeHtml = '';
    if (showBadge && todo.done) {
        const weekdayLabels = ['일', '월', '화', '수', '목', '금', '토'];
        const formatResetTime = (isoStr) => {
            if (!isoStr) return null;
            const d = new Date(isoStr);
            if (isNaN(d.getTime())) return null;
            const m = d.getMonth() + 1;
            const day = d.getDate();
            const wd = weekdayLabels[d.getDay()];
            const hh = String(d.getHours()).padStart(2, '0');
            const mm = String(d.getMinutes()).padStart(2, '0');
            return `${m}/${day}(${wd}) ${hh}:${mm}`;
        };

        // neverReset 항목은 초기화 시간 표시 안 함
        const isNeverReset = todo.recurrence?.type === 'neverReset';
        // 개별 초기화가 있으면 nextDue 우선, 없으면 전역 nextGlobalResetAt (neverReset 제외)
        const timeStr = !isNeverReset && (todo.nextDue
            ? formatResetTime(todo.nextDue)
            : (state.settings.resetEnabled ? formatResetTime(state.settings.nextGlobalResetAt) : null));

        if (timeStr) {
            nextResetBadgeHtml = `<div class="todo-next-reset-badge"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="11" height="11"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>다음 초기화: ${timeStr}</div>`;
        }
    }

    const li = document.createElement('li');
    li.className = `todo-item${todo.done ? ' done' : ''}`;
    li.dataset.id = todo.id;
    li.dataset.priority = priority;
    li.draggable = true;

    li.innerHTML = `
    <div class="todo-checkbox-wrap">
      <input type="checkbox" class="todo-checkbox" aria-label="완료 표시"
        ${todo.done ? 'checked' : ''} />
    </div>
    <div class="todo-content">
      <div class="todo-text">${escapeHtml(todo.text)}</div>
      ${todo.note ? `<div class="todo-note">${escapeHtml(todo.note)}</div>` : ''}
      ${nextResetBadgeHtml}
      <div class="todo-meta">
        <span class="todo-priority-badge ${priority}">${priorityLabels[priority] || '보통'}</span>
        ${(todo.recurrence || (state.settings.resetEnabled ? settingsToRecurrence(state.settings) : null))
            ? `<span class="todo-reset-badge">${escapeHtml(formatRecurrenceBadge(todo.recurrence || settingsToRecurrence(state.settings)))}</span>`
            : ''}
        ${hasChecklist
            ? `<span class="checklist-progress-badge ${clDone === clTotal ? 'all-done' : ''}">✓ ${clDone}/${clTotal}</span>`
            : ''}
      </div>
    </div>
    <div class="todo-actions">
      ${hasChecklist ? `
      <button class="todo-action-btn checklist-toggle-btn" title="체크리스트 펼침/숨김" aria-label="체크리스트 펼침/숨김" aria-expanded="false">
        <svg class="icon-chevron-down" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </button>` : ''}
      <button class="todo-action-btn edit-btn" title="수정" aria-label="항목 수정">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
        </svg>
      </button>
      <button class="todo-action-btn delete-btn" title="삭제" aria-label="항목 삭제">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="3 6 5 6 21 6"/>
          <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
          <path d="M10 11v6M14 11v6"/>
          <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
        </svg>
      </button>
    </div>
    ${hasChecklist ? `
    <div class="checklist-area" role="list" aria-label="체크리스트">
      ${checklist.map(item => `
        <div class="checklist-item ${item.done ? 'done' : ''}" data-checklist-id="${item.id}" role="listitem">
          <input type="checkbox" class="checklist-item-check" ${item.done ? 'checked' : ''}
            aria-label="${escapeHtml(item.text)}" />
          <span class="checklist-item-text">${escapeHtml(item.text)}</span>
        </div>
      `).join('')}
    </div>` : ''}
  `;

    return li;
}

/* ───────────────────────── 할 일 목록 렌더링 ───────────────────────────── */

export function renderTodos() {
    // 카테고리 필터를 한 번만 수행 → updateStats에 재사용
    const catTodos = _catTodos();
    const filtered = _applyStateFilter(catTodos);

    const fragment = document.createDocumentFragment();
    // 콜백 함수 할당 오버헤드 방지
    for (let i = 0; i < filtered.length; i++) {
        fragment.appendChild(createTodoElement(filtered[i]));
    }

    if (!DOM.todoList || !DOM.emptyState) return;
    DOM.todoList.innerHTML = '';
    DOM.emptyState.classList.toggle('visible', filtered.length === 0);
    if (filtered.length > 0) DOM.todoList.appendChild(fragment);

    updateStats(catTodos); // 이미 계산된 배열 전달 — 이중 순회 방지
}

/* ─────────────────────────── 배경 이미지 ──────────────────────────────── */

// 배경이미지 data URL 허용 패턴: data:image/{type};base64,...
// 외부 URL, javascript: 스킴 등 CSS Injection 원체 차단
const BG_DATA_URL_RE = /^data:image\/(jpeg|png|webp|gif);base64,[A-Za-z0-9+/]+=*$/;

export function applyBackground() {
    const { bgImage, bgOpacity, bgBlur } = state.settings;
    const overlay = DOM.bgOverlay;
    if (!overlay) return;
    const container = document.querySelector('.app-container');

    if (bgImage && BG_DATA_URL_RE.test(bgImage)) {
        overlay.style.backgroundImage = `url(${bgImage})`;
        overlay.style.filter = bgBlur > 0 ? `blur(${bgBlur}px)` : '';
        overlay.style.opacity = bgOpacity / 100;
        overlay.classList.add('has-bg');
        container?.classList.add('has-bg');
        if (container) container.style.background = 'transparent';
    } else {
        overlay.classList.remove('has-bg');
        container?.classList.remove('has-bg');
        overlay.style.backgroundImage = '';
        overlay.style.filter = '';
        overlay.style.opacity = '0';
        if (container) container.style.background = '';
    }
}

export function updateBgPreview(dataUrl, filename) {
    if (dataUrl) {
        DOM.bgPreviewImg.src = dataUrl;
        DOM.bgPreviewName.textContent = filename || '배경 이미지';
        DOM.bgPreviewWrap.classList.add('visible');
    } else {
        DOM.bgPreviewWrap.classList.remove('visible');
        DOM.bgPreviewImg.src = '';
    }
}
