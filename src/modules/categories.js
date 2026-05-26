/**
 * categories.js — 카테고리 CRUD 및 탭 UI
 *
 * 이벤트 위임: 카테고리 탭의 클릭/삭제/추가 이벤트는 events.js에서 처리합니다.
 * 이 모듈은 DOM 구조 생성과 데이터 조작만 담당합니다.
 */

import { state } from './state.js';
import { STORAGE_KEYS } from './config.js';
import { saveToStorage, saveCategories, saveTodos } from './storage.js';
import { emit } from './bus.js'; // renderer 직접 의존 제거 — DIP
import { showToast, escapeHtml } from './utils.js';
import { DOM } from './dom.js';

/* ──────────────────────── 카테고리 CRUD ───────────────────────────────── */

/* ──────────────────────── 카테고리 CRUD ───────────────────────────────── */

export function addCategory(name) {
    const id = `cat_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`;
    state.categories.push({ id, name: name.trim() });
    saveCategories();
    renderCategoryTabs();
    switchCategory(id);
}

export function renameCategory(id, newName) {
    const cat = state.categories.find(c => c.id === id);
    if (!cat || !newName.trim()) return;
    cat.name = newName.trim();
    saveCategories();
    renderCategoryTabs();
}

export function deleteCategory(id) {
    if (id === 'default' || state.categories.length <= 1) return;

    const cat = state.categories.find(c => c.id === id);
    const catName = cat?.name ?? '';
    const removedCat = { ...cat };

    // 할 일 분리 (불필요한 배열 순회 최소화 - 단일 순회로 처리)
    const keptTodos = [];
    const removedTodos = [];
    for (let i = 0; i < state.todos.length; i++) {
        const t = state.todos[i];
        if ((t.categoryId || 'default') === id) {
            removedTodos.push(t);
        } else {
            keptTodos.push(t);
        }
    }

    state.todos = keptTodos;
    state.categories = state.categories.filter(c => c.id !== id);
    saveTodos();
    saveCategories();

    if (state.currentCategoryId === id) {
        state.currentCategoryId = state.categories[0].id;
        saveToStorage(STORAGE_KEYS.CURRENT_CATEGORY, state.currentCategoryId);
    }
    renderCategoryTabs();
    emit('todos:changed');

    // 실행 취소 토스트
    _showUndoToast(catName, () => {
        state.categories.push(removedCat);
        state.categories.sort((a, b) => (a.id === 'default' ? -1 : 0));
        state.todos = state.todos.concat(removedTodos);
        saveTodos();
        saveCategories();
        switchCategory(removedCat.id);
    });
}

export function switchCategory(id) {
    state.currentCategoryId = id;
    saveToStorage(STORAGE_KEYS.CURRENT_CATEGORY, id);
    renderCategoryTabs();
    emit('todos:changed');
}

/* ────────────────────── 카테고리 탭 렌더링 ─────────────────────────────── */

const createCategoryTab = (cat, isActive) => {
    const tab = document.createElement('div');
    tab.className = `category-tab${isActive ? ' active' : ''}`;
    tab.dataset.id = cat.id;
    tab.draggable = true;

    const nameSpan = document.createElement('span');
    nameSpan.className = 'category-tab-name';
    nameSpan.textContent = cat.name;
    nameSpan.title = '활성 탭 클릭하여 이름 변경';
    tab.appendChild(nameSpan);

    return tab;
};

const createTrashButton = () => {
    const btn = document.createElement('button');
    btn.className = 'category-tab-trash';
    btn.title = '현재 탭 삭제';
    btn.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
             stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="3 6 5 6 21 6"/>
          <path d="M19 6l-1 14H6L5 6"/>
          <path d="M10 11v6M14 11v6"/>
          <path d="M9 6V4h6v2"/>
        </svg>`;
    return btn;
};

const createAddTabButton = () => {
    const addBtn = document.createElement('button');
    addBtn.className = 'category-tab-add';
    addBtn.title = '새 탭 추가';
    addBtn.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
             stroke-width="2.5" stroke-linecap="round">
          <line x1="12" y1="5" x2="12" y2="19"/>
          <line x1="5" y1="12" x2="19" y2="12"/>
        </svg>`;
    return addBtn;
};

/**
 * 카테고리 탭을 렌더링합니다.
 * data-id 속성을 통해 events.js의 위임 처리기가 클릭 이벤트를 선별합니다.
 * 탭들은 내부 스크롤 영역에 배치하고, 쓰레기통 버튼은 우측에 고정합니다.
 */
export function renderCategoryTabs() {
    const container = document.getElementById('categoryTabsBar');
    if (!container) return;

    container.innerHTML = '';

    // 탭 + 추가 버튼은 스크롤 래퍼 안에
    const scrollWrapper = document.createElement('div');
    scrollWrapper.className = 'category-tabs-scroll';

    const fragment = document.createDocumentFragment();
    for (let i = 0; i < state.categories.length; i++) {
        const cat = state.categories[i];
        fragment.appendChild(createCategoryTab(cat, cat.id === state.currentCategoryId));
    }
    fragment.appendChild(createAddTabButton());
    scrollWrapper.appendChild(fragment);
    container.appendChild(scrollWrapper);

    // 쓰레기통 버튼은 스크롤 래퍼 외부 (항상 우측에 고정)
    const trashBtn = createTrashButton();
    const activeCat = state.categories.find(c => c.id === state.currentCategoryId);
    trashBtn.disabled = !activeCat || activeCat.id === 'default';
    container.appendChild(trashBtn);
}

/* ──────────────────── 탭 드래그 정렬 ──────────────────────────────────── */

let _dragSrcId = null;
let _dragEndTime = 0;
export const wasCategoryDragged = () => Date.now() - _dragEndTime < 200;

/**
 * categoryTabsBar에 드래그 정렬 이벤트를 1회만 바인딩합니다.
 * renderCategoryTabs()가 innerHTML을 갱신해도 container 리스너는 유지됩니다.
 */
export function initCategoryDragSort() {
    const container = document.getElementById('categoryTabsBar');
    if (!container || container._dragBound) return;
    container._dragBound = true;

    container.addEventListener('dragstart', e => {
        const tab = e.target.closest('.category-tab');
        if (!tab) return;
        _dragSrcId = tab.dataset.id;
        e.dataTransfer.effectAllowed = 'move';
        requestAnimationFrame(() => tab.classList.add('dragging'));
    });

    container.addEventListener('dragend', () => {
        _dragEndTime = Date.now();
        _dragSrcId = null;
        container.querySelectorAll('.category-tab')
            .forEach(t => t.classList.remove('dragging', 'drag-over'));
    });

    container.addEventListener('dragover', e => {
        const tab = e.target.closest('.category-tab');
        if (!tab || tab.dataset.id === _dragSrcId) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        container.querySelectorAll('.category-tab').forEach(t => t.classList.remove('drag-over'));
        tab.classList.add('drag-over');
    });

    container.addEventListener('dragleave', e => {
        if (!container.contains(e.relatedTarget)) {
            container.querySelectorAll('.category-tab').forEach(t => t.classList.remove('drag-over'));
        }
    });

    container.addEventListener('drop', e => {
        e.preventDefault();
        e.stopPropagation();
        const tab = e.target.closest('.category-tab');
        if (!tab) return;
        const targetId = tab.dataset.id;
        if (!_dragSrcId || _dragSrcId === targetId) return;

        const srcIdx = state.categories.findIndex(c => c.id === _dragSrcId);
        const tgtIdx = state.categories.findIndex(c => c.id === targetId);
        if (srcIdx === -1 || tgtIdx === -1) return;

        const [moved] = state.categories.splice(srcIdx, 1);
        state.categories.splice(tgtIdx, 0, moved);

        saveCategories();
        renderCategoryTabs();
    });
}

/* ──────────────────── 인라인 입력 UI 헬퍼 ─────────────────────────────── */

export function autoSizeInput(input) {
    const measure = () => {
        const sizer = document.createElement('span');
        sizer.style.cssText =
            'position:absolute;visibility:hidden;pointer-events:none;' +
            'font-size:12px;font-weight:500;font-family:inherit;white-space:pre';
        sizer.textContent = input.value || input.placeholder || '';
        document.body.appendChild(sizer);
        input.style.width = Math.max(24, sizer.offsetWidth + 4) + 'px';
        sizer.remove();
    };
    measure();
    input.addEventListener('input', measure);
}

export function startCategoryAdd(container, addBtn) {
    if (container.querySelector('.category-tab-new')) return;

    const inputTab = document.createElement('div');
    inputTab.className = 'category-tab category-tab-new';

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'category-tab-rename-input';
    input.placeholder = '탭 이름';
    input.maxLength = 20;
    autoSizeInput(input);
    inputTab.appendChild(input);
    container.insertBefore(inputTab, addBtn);

    setTimeout(() => input.focus(), 50);

    let committed = false;
    const commit = () => {
        if (committed) return;
        committed = true;
        document.removeEventListener('mousedown', onOutsideClick, true);
        const name = input.value.trim();
        inputTab.remove();
        if (name) addCategory(name);
    };
    const cancel = () => {
        if (committed) return;
        committed = true;
        document.removeEventListener('mousedown', onOutsideClick, true);
        inputTab.remove();
    };
    const onOutsideClick = e => { if (!inputTab.contains(e.target)) commit(); };

    setTimeout(() => document.addEventListener('mousedown', onOutsideClick, true), 100);
    input.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); commit(); }
        if (e.key === 'Escape') { e.preventDefault(); cancel(); }
    });
}

export function startCategoryRename(tabEl, id, currentName) {
    const nameSpan = tabEl.querySelector('.category-tab-name');
    if (!nameSpan) return;

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'category-tab-rename-input';
    input.value = currentName;
    input.maxLength = 20;
    autoSizeInput(input);
    nameSpan.replaceWith(input);

    setTimeout(() => { input.focus(); input.select(); }, 50);

    let committed = false;
    const commit = () => {
        if (committed) return;
        committed = true;
        document.removeEventListener('mousedown', onOutsideClick, true);
        renameCategory(id, input.value.trim() || currentName);
    };
    const onOutsideClick = e => { if (!tabEl.contains(e.target)) commit(); };
    setTimeout(() => document.addEventListener('mousedown', onOutsideClick, true), 100);

    input.addEventListener('keydown', e => {
        if (e.key === 'Enter') {
            e.preventDefault();
            commit();
        }
        if (e.key === 'Escape') {
            e.preventDefault();
            committed = true;
            document.removeEventListener('mousedown', onOutsideClick, true);
            renameCategory(id, currentName);
        }
    });
}

/* ────────────────────────── 실행 취소 토스트 ──────────────────────────── */

function _showUndoToast(catName, onUndo) {
    let undone = false;
    const toast = document.createElement('div');
    toast.className = 'toast toast-error';
    toast.innerHTML =
        `<span class="toast-dot"></span>"${escapeHtml(catName)}" 탭 삭제됨` +
        ` <button class="toast-undo-btn">실행취소</button>`;
    DOM.toastContainer.appendChild(toast);

    toast.querySelector('.toast-undo-btn').addEventListener('click', () => {
        if (undone) return;
        undone = true;
        onUndo();
        toast.classList.add('leaving');
    });

    setTimeout(() => {
        if (!undone) {
            toast.classList.add('leaving');
            toast.addEventListener('animationend', () => toast.remove());
        }
    }, 4000);
}
