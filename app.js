/**
 * Todo List App — app.js
 * Features: CRUD, LocalStorage, Reset Timer, Dark Mode, Custom Background
 */

'use strict';

/* ===================================================
   Constants & State
=================================================== */
const STORAGE_KEYS = {
    TODOS: 'todoApp_todos',
    THEME: 'todoApp_theme',
    SETTINGS: 'todoApp_settings',
    BG_IMAGE: 'todoApp_bgImage',
    TITLE: 'todoApp_title',
    CATEGORIES: 'todoApp_categories',
    CURRENT_CATEGORY: 'todoApp_currentCategory',
};

let state = {
    todos: [],
    filter: 'all',
    editingId: null,
    deleteTargetId: null,
    categories: [{ id: 'default', name: '기본' }],
    currentCategoryId: 'default',
    settings: {
        resetEnabled: false,
        resetTime: '00:00',
        resetRepeat: 'daily',
        bgOpacity: 50,
        bgBlur: 0,
        bgImage: null,   // base64 data URL
        bgFileName: '',
        appTitle: 'My Tasks',
    },
};

let resetTimerInterval = null;
let remoteSyncInProgress = false;

/* ===================================================
   LocalStorage Helpers
=================================================== */
function saveToStorage(key, value) {
    try {
        localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
        // Storage quota exceeded — skip silently
    }
}

function loadFromStorage(key, fallback) {
    try {
        const item = localStorage.getItem(key);
        return item !== null ? JSON.parse(item) : fallback;
    } catch (e) {
        return fallback;
    }
}

function saveTodos() {
    saveToStorage(STORAGE_KEYS.TODOS, state.todos);
    syncToCloud();
}

function saveSettings() {
    // Store bg image separately to avoid large JSON blobs in settings key
    const { bgImage, ...rest } = state.settings;
    saveToStorage(STORAGE_KEYS.SETTINGS, rest);
    if (bgImage) {
        saveToStorage(STORAGE_KEYS.BG_IMAGE, bgImage);
    } else {
        localStorage.removeItem(STORAGE_KEYS.BG_IMAGE);
    }
    syncToCloud();
}

function loadState() {
    state.todos = loadFromStorage(STORAGE_KEYS.TODOS, []);
    const savedTheme = loadFromStorage(STORAGE_KEYS.THEME, 'light');
    document.documentElement.setAttribute('data-theme', savedTheme);

    const savedSettings = loadFromStorage(STORAGE_KEYS.SETTINGS, {});
    state.settings = { ...state.settings, ...savedSettings };

    // bgImage is stored separately (large payload); loadFromStorage handles JSON.parse consistently
    state.settings.bgImage = loadFromStorage(STORAGE_KEYS.BG_IMAGE, null);

    const savedCategories = loadFromStorage(STORAGE_KEYS.CATEGORIES, null);
    if (savedCategories && savedCategories.length > 0) {
        state.categories = savedCategories;
    }
    state.currentCategoryId = loadFromStorage(STORAGE_KEYS.CURRENT_CATEGORY, 'default');
    if (!state.categories.find(c => c.id === state.currentCategoryId)) {
        state.currentCategoryId = state.categories[0].id;
    }

    applyAppTitle();
}

function applyAppTitle() {
    const title = state.settings.appTitle || 'My Tasks';
    if (DOM.headerTitle) DOM.headerTitle.textContent = title;
}

/* ===================================================
   ID Generator
=================================================== */
function generateId() {
    return `todo_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

/* ===================================================
   DOM References
=================================================== */
const DOM = {
    get todoList() { return document.getElementById('todoList'); },
    get emptyState() { return document.getElementById('emptyState'); },
    get headerDate() { return document.getElementById('headerDate'); },
    get totalCount() { return document.getElementById('totalCount'); },
    get doneCount() { return document.getElementById('doneCount'); },
    get pendingCount() { return document.getElementById('pendingCount'); },
    get progressFill() { return document.getElementById('progressFill'); },
    get addBtn() { return document.getElementById('addBtn'); },
    get themeToggle() { return document.getElementById('themeToggle'); },
    get settingsBtn() { return document.getElementById('settingsBtn'); },
    get refreshBtn() { return document.getElementById('refreshBtn'); },
    get uiToggleBtn() { return document.getElementById('uiToggleBtn'); },
    // Task Modal
    get taskModal() { return document.getElementById('taskModal'); },
    get modalTitle() { return document.getElementById('modalTitle'); },
    get modalClose() { return document.getElementById('modalClose'); },
    get modalCancel() { return document.getElementById('modalCancel'); },
    get modalSave() { return document.getElementById('modalSave'); },
    get taskInput() { return document.getElementById('taskInput'); },
    get taskNote() { return document.getElementById('taskNote'); },
    get prioritySelector() { return document.getElementById('prioritySelector'); },
    // Settings Modal
    get settingsModal() { return document.getElementById('settingsModal'); },
    get settingsClose() { return document.getElementById('settingsClose'); },
    get settingsCancelBtn() { return document.getElementById('settingsCancelBtn'); },
    get settingsSaveBtn() { return document.getElementById('settingsSaveBtn'); },
    get resetEnabled() { return document.getElementById('resetEnabled'); },
    get resetTime() { return document.getElementById('resetTime'); },
    get resetRepeat() { return document.getElementById('resetRepeat'); },
    get resetSubGroup() { return document.getElementById('resetSubGroup'); },
    get resetNextInfo() { return document.getElementById('resetNextInfo'); },
    get bgFileInput() { return document.getElementById('bgFileInput'); },
    get bgPreviewWrap() { return document.getElementById('bgPreviewWrap'); },
    get bgPreviewImg() { return document.getElementById('bgPreviewImg'); },
    get bgPreviewName() { return document.getElementById('bgPreviewName'); },
    get bgRemoveBtn() { return document.getElementById('bgRemoveBtn'); },
    get bgOpacity() { return document.getElementById('bgOpacity'); },
    get bgOpacityValue() { return document.getElementById('bgOpacityValue'); },
    get bgBlur() { return document.getElementById('bgBlur'); },
    get bgBlurValue() { return document.getElementById('bgBlurValue'); },
    get clearAllBtn() { return document.getElementById('clearAllBtn'); },
    get headerTitle() { return document.getElementById('headerTitle'); },
    get appTitleInput() { return document.getElementById('appTitleInput'); },
    // Task reset time
    get taskResetTime() { return document.getElementById('taskResetTime'); },
    get taskResetClear() { return document.getElementById('taskResetClear'); },
    // Confirm Modal
    get confirmModal() { return document.getElementById('confirmModal'); },
    get confirmCancel() { return document.getElementById('confirmCancel'); },
    get confirmDelete() { return document.getElementById('confirmDelete'); },
    // Background overlay
    get bgOverlay() { return document.getElementById('bgOverlay'); },
    // Filter tabs
    get filterTabs() { return document.querySelectorAll('.filter-tab'); },
    // Toast container
    get toastContainer() { return document.getElementById('toastContainer'); },
};

/* ===================================================
   Toast Notifications
=================================================== */
function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `<span class="toast-dot"></span>${message}`;
    DOM.toastContainer.appendChild(toast);

    setTimeout(() => {
        toast.classList.add('leaving');
        toast.addEventListener('animationend', () => toast.remove());
    }, 2400);
}

/* ===================================================
   Header Date
=================================================== */
function updateHeaderDate() {
    const now = new Date();
    const dateOptions = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    const dateStr = now.toLocaleDateString('ko-KR', dateOptions);
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    const ss = String(now.getSeconds()).padStart(2, '0');
    DOM.headerDate.innerHTML = `${dateStr}<span class="header-time">${hh}:${mm}:${ss}</span>`;
}

/* ===================================================
   Stats & Progress
=================================================== */
function updateStats() {
    const catTodos = state.todos.filter(t => (t.categoryId || 'default') === state.currentCategoryId);
    const total = catTodos.length;
    const done = catTodos.filter(t => t.done).length;
    const pending = total - done;
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;

    DOM.totalCount.textContent = total;
    DOM.doneCount.textContent = done;
    DOM.pendingCount.textContent = pending;
    DOM.progressFill.style.width = `${pct}%`;
}

/* ===================================================
   Render Todos
=================================================== */
function getFilteredTodos() {
    const catTodos = state.todos.filter(t => (t.categoryId || 'default') === state.currentCategoryId);
    let list;
    switch (state.filter) {
        case 'done': return catTodos.filter(t => t.done);
        case 'pending': return catTodos.filter(t => !t.done);
        default: list = catTodos.slice(); break;
    }
    // 미완료 항목을 위로, 완료 항목을 아래로
    return list.sort((a, b) => (a.done ? 1 : 0) - (b.done ? 1 : 0));
}

function formatTime(isoStr) {
    if (!isoStr) return '';
    const d = new Date(isoStr);
    return d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
}

function createTodoElement(todo) {
    const li = document.createElement('li');
    li.className = `todo-item${todo.done ? ' done' : ''}`;
    li.dataset.id = todo.id;
    li.dataset.priority = todo.priority || 'medium';

    const priorityLabels = { low: '낮음', medium: '보통', high: '높음' };

    li.innerHTML = `
    <div class="todo-checkbox-wrap">
      <input type="checkbox" class="todo-checkbox" aria-label="완료 표시"
        ${todo.done ? 'checked' : ''} />
    </div>
    <div class="todo-content">
      <div class="todo-text">${escapeHtml(todo.text)}</div>
      ${todo.note ? `<div class="todo-note">${escapeHtml(todo.note)}</div>` : ''}
      <div class="todo-meta">
        <span class="todo-priority-badge ${todo.priority || 'medium'}">${priorityLabels[todo.priority] || '보통'}</span>
        ${todo.itemResetTime ? `<span class="todo-reset-badge">⏰ ${todo.itemResetTime}</span>` : ''}
      </div>
    </div>
    <div class="todo-actions">
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
  `;

    // Checkbox
    li.querySelector('.todo-checkbox').addEventListener('change', (e) => {
        toggleTodo(todo.id, e.target.checked);
    });

    // Edit
    li.querySelector('.edit-btn').addEventListener('click', () => {
        openEditModal(todo.id);
    });

    // Delete
    li.querySelector('.delete-btn').addEventListener('click', () => {
        openConfirmModal(todo.id);
    });

    return li;
}

function renderTodos() {
    const filtered = getFilteredTodos();
    DOM.todoList.innerHTML = '';

    if (filtered.length === 0) {
        DOM.emptyState.classList.add('visible');
    } else {
        DOM.emptyState.classList.remove('visible');
        filtered.forEach(todo => {
            DOM.todoList.appendChild(createTodoElement(todo));
        });
    }

    updateStats();
}

/* ===================================================
   Security: HTML Escape
=================================================== */
function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

/* ===================================================
   CRUD Operations
=================================================== */
function addTodo(text, note, priority, itemResetTime) {
    const todo = {
        id: generateId(),
        text: text.trim(),
        note: note.trim(),
        priority: priority || 'medium',
        done: false,
        createdAt: new Date().toISOString(),
        itemResetTime: itemResetTime || null,
        categoryId: state.currentCategoryId,
    };
    state.todos.unshift(todo);
    saveTodos();
    renderTodos();
    showToast('새 할 일이 추가되었습니다', 'success');
}

function editTodo(id, text, note, priority, itemResetTime) {
    const idx = state.todos.findIndex(t => t.id === id);
    if (idx === -1) return;
    state.todos[idx] = {
        ...state.todos[idx],
        text: text.trim(),
        note: note.trim(),
        priority: priority || 'medium',
        itemResetTime: itemResetTime || null,
    };
    saveTodos();
    renderTodos();
    showToast('할 일이 수정되었습니다', 'info');
}

function deleteTodo(id) {
    const el = document.querySelector(`[data-id="${id}"]`);
    if (el) {
        el.classList.add('removing');
        el.addEventListener('animationend', () => {
            state.todos = state.todos.filter(t => t.id !== id);
            saveTodos();
            renderTodos();
        }, { once: true });
    } else {
        state.todos = state.todos.filter(t => t.id !== id);
        saveTodos();
        renderTodos();
    }
    showToast('항목이 삭제되었습니다', 'error');
}

function toggleTodo(id, done) {
    const idx = state.todos.findIndex(t => t.id === id);
    if (idx === -1) return;
    state.todos[idx].done = done;
    saveTodos();
    renderTodos();
    if (done) showToast('완료 처리되었습니다!', 'success');
}

function clearAllTodos(silent = false) {
    state.todos = [];
    saveTodos();
    renderTodos();
    if (!silent) showToast('모든 할 일이 삭제되었습니다', 'info');
}

// 자동 초기화용: 항목은 유지하고 완료 체크만 해제
function resetAllTodos() {
    state.todos = state.todos.map(t => ({ ...t, done: false }));
    saveTodos();
    renderTodos();
}

/* ===================================================
   Modal Helpers
=================================================== */
function openModal(modalEl) {
    modalEl.classList.add('open');
    modalEl.addEventListener('click', backdropClickHandler);
    document.addEventListener('keydown', escKeyHandler);
}

function closeModal(modalEl) {
    modalEl.classList.remove('open');
    modalEl.removeEventListener('click', backdropClickHandler);
    document.removeEventListener('keydown', escKeyHandler);
}

function backdropClickHandler(e) {
    if (e.target === e.currentTarget) {
        closeModal(e.currentTarget);
    }
}

function escKeyHandler(e) {
    if (e.key === 'Escape') {
        const openModals = document.querySelectorAll('.modal-backdrop.open');
        openModals.forEach(m => closeModal(m));
    }
}

/* ===================================================
   Task Modal (Add / Edit)
=================================================== */
function getSelectedPriority() {
    const btn = DOM.prioritySelector.querySelector('.priority-btn.active');
    return btn ? btn.dataset.priority : 'medium';
}

function setSelectedPriority(priority) {
    DOM.prioritySelector.querySelectorAll('.priority-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.priority === priority);
    });
}

function openAddModal() {
    state.editingId = null;
    DOM.modalTitle.textContent = '새 할 일 추가';
    DOM.taskInput.value = '';
    DOM.taskNote.value = '';
    DOM.taskResetTime.value = '';
    setSelectedPriority('medium');
    openModal(DOM.taskModal);
    setTimeout(() => DOM.taskInput.focus(), 50);
}

function openEditModal(id) {
    const todo = state.todos.find(t => t.id === id);
    if (!todo) return;
    state.editingId = id;
    DOM.modalTitle.textContent = '할 일 수정';
    DOM.taskInput.value = todo.text;
    DOM.taskNote.value = todo.note || '';
    DOM.taskResetTime.value = todo.itemResetTime || '';
    setSelectedPriority(todo.priority || 'medium');
    openModal(DOM.taskModal);
    setTimeout(() => DOM.taskInput.focus(), 50);
}

function handleModalSave() {
    const text = DOM.taskInput.value.trim();
    if (!text) {
        DOM.taskInput.classList.add('error-shake');
        DOM.taskInput.focus();
        DOM.taskInput.addEventListener('animationend', () => {
            DOM.taskInput.classList.remove('error-shake');
        }, { once: true });
        return;
    }

    const note = DOM.taskNote.value;
    const priority = getSelectedPriority();
    const itemResetTime = DOM.taskResetTime.value || null;

    if (state.editingId) {
        editTodo(state.editingId, text, note, priority, itemResetTime);
    } else {
        addTodo(text, note, priority, itemResetTime);
    }

    closeModal(DOM.taskModal);
    state.editingId = null;
}

/* ===================================================
   Confirm Modal (범용)
=================================================== */
let _pendingConfirmAction = null;

function openConfirmModal(id) {
    _pendingConfirmAction = () => deleteTodo(id);
    state.deleteTargetId = id;
    const titleEl = DOM.confirmModal?.querySelector('.confirm-title');
    const subEl = DOM.confirmModal?.querySelector('.confirm-sub');
    if (titleEl) titleEl.textContent = '항목을 삭제하시겠습니까?';
    if (subEl) subEl.textContent = '이 작업은 되돌릴 수 없습니다.';
    openModal(DOM.confirmModal);
}

function openClearAllModal() {
    _pendingConfirmAction = () => clearAllTodos();
    state.deleteTargetId = null;
    const titleEl = DOM.confirmModal?.querySelector('.confirm-title');
    const subEl = DOM.confirmModal?.querySelector('.confirm-sub');
    if (titleEl) titleEl.textContent = '모든 할 일을 삭제하시겠습니까?';
    if (subEl) subEl.textContent = '모든 항목이 영구적으로 삭제됩니다.';
    openModal(DOM.confirmModal);
}

function handleConfirmDelete() {
    if (_pendingConfirmAction) {
        _pendingConfirmAction();
        _pendingConfirmAction = null;
    }
    state.deleteTargetId = null;
    closeModal(DOM.confirmModal);
}

/* ===================================================
   Settings Modal
=================================================== */
// Temporary settings state (applied only on save)
let tempSettings = {};
let tempBgImage = null;
let tempBgImageChanged = false;

function openSettingsModal() {
    // Re-sync state.settings from localStorage so form always shows the latest saved values
    const savedSettings = loadFromStorage(STORAGE_KEYS.SETTINGS, {});
    state.settings = { ...state.settings, ...savedSettings };
    state.settings.bgImage = loadFromStorage(STORAGE_KEYS.BG_IMAGE, null);

    // Clone current settings into temp
    tempSettings = { ...state.settings };
    tempBgImage = state.settings.bgImage;
    tempBgImageChanged = false;

    // Populate form
    DOM.resetEnabled.checked = tempSettings.resetEnabled;
    DOM.resetTime.value = tempSettings.resetTime || '00:00';
    DOM.resetRepeat.value = tempSettings.resetRepeat || 'daily';
    DOM.bgOpacity.value = tempSettings.bgOpacity;
    DOM.bgOpacityValue.textContent = `${tempSettings.bgOpacity}%`;
    DOM.bgOpacity.dispatchEvent(new Event('input'));

    DOM.bgBlur.value = tempSettings.bgBlur;
    DOM.bgBlurValue.textContent = `${tempSettings.bgBlur}px`;
    DOM.bgBlur.dispatchEvent(new Event('input'));

    DOM.resetSubGroup.classList.toggle('hidden', !tempSettings.resetEnabled);
    updateResetNextInfo();
    updateBgPreview(tempBgImage, tempSettings.bgFileName);

    const titleInput = DOM.appTitleInput;
    if (titleInput) titleInput.value = tempSettings.appTitle || 'My Tasks';

    // Show & load Electron-specific settings
    const electronSection = document.getElementById('electronSettingsSection');
    if (electronSection && window.electronAPI) {
        electronSection.style.display = '';
        window.electronAPI.getAppSettings().then((s) => {
            const autoEl = document.getElementById('autoLaunchEnabled');
            const topEl = document.getElementById('alwaysOnTopEnabled');
            if (autoEl) autoEl.checked = s.autoLaunch;
            if (topEl) topEl.checked = s.alwaysOnTop;
        }).catch(() => { });
    }

    openModal(DOM.settingsModal);
}

async function saveSettingsFromModal() {
    // Apply non-bg settings from temp state
    const { bgImage: _ignored, ...restTemp } = tempSettings;
    state.settings = { ...state.settings, ...restTemp };
    // Always use the dedicated bgImage temp variable (tracks user's add/remove)
    state.settings.bgImage = tempBgImage;

    const titleInput = DOM.appTitleInput;
    if (titleInput) {
        state.settings.appTitle = titleInput.value.trim() || 'My Tasks';
    }

    saveSettings();
    applyBackground();
    applyAppTitle();
    scheduleResetTimer();

    // Save Electron-specific settings via IPC
    if (window.electronAPI) {
        const autoEl = document.getElementById('autoLaunchEnabled');
        const topEl = document.getElementById('alwaysOnTopEnabled');
        try {
            if (autoEl) await window.electronAPI.setAutoLaunch(autoEl.checked);
            if (topEl) await window.electronAPI.setAlwaysOnTop(topEl.checked);
        } catch { /* IPC errors are non-critical */ }
    }

    showToast('설정이 저장되었습니다', 'success');
    closeModal(DOM.settingsModal);
}

/* ===================================================
   Background
=================================================== */
function applyBackground() {
    const { bgImage, bgOpacity, bgBlur } = state.settings;
    const overlay = DOM.bgOverlay;
    const container = document.querySelector('.app-container');

    if (bgImage) {
        overlay.style.backgroundImage = `url(${bgImage})`;
        overlay.style.filter = bgBlur > 0 ? `blur(${bgBlur}px)` : '';
        overlay.style.opacity = bgOpacity / 100;
        overlay.classList.add('has-bg');
        container?.classList.add('has-bg');
    } else {
        overlay.classList.remove('has-bg');
        container?.classList.remove('has-bg');
        overlay.style.backgroundImage = '';
        overlay.style.filter = '';
        overlay.style.opacity = '0';
    }
}

function updateBgPreview(dataUrl, filename) {
    if (dataUrl) {
        DOM.bgPreviewImg.src = dataUrl;
        DOM.bgPreviewName.textContent = filename || '배경 이미지';
        DOM.bgPreviewWrap.classList.add('visible');
    } else {
        DOM.bgPreviewWrap.classList.remove('visible');
        DOM.bgPreviewImg.src = '';
    }
}

/* ===================================================
   Image Crop Modal
=================================================== */
(function () {
    let _srcImage = null;   // HTMLImageElement (원본)
    let _fileName = '';
    // 캔버스 표시 크기 대비 원본 이미지 스케일
    let _scaleX = 1, _scaleY = 1;
    // 크롭 박스 (캔버스 표시 좌표, px)
    let _crop = { x: 0, y: 0, w: 0, h: 0 };
    let _vpW = 0, _vpH = 0;  // 뷰포트(캔버스 표시) 크기

    // 드래그 상태
    let _drag = null; // { type:'move'|'resize', dir, startX, startY, startCrop }

    const MIN_SIZE = 20;

    // ─── DOM refs ────────────────────────────────────────────────────────────
    function el(id) { return document.getElementById(id); }

    // ─── 크롭 박스 위치 적용 ─────────────────────────────────────────────────
    function applyCropBox() {
        const box = el('cropBox');
        if (!box) return;
        box.style.left = `${_crop.x}px`;
        box.style.top = `${_crop.y}px`;
        box.style.width = `${_crop.w}px`;
        box.style.height = `${_crop.h}px`;

        const infoEl = el('cropInfo');
        if (infoEl) {
            const rw = Math.round(_crop.w * _scaleX);
            const rh = Math.round(_crop.h * _scaleY);
            infoEl.textContent = `${rw} × ${rh} px`;
        }
    }

    // ─── 크롭 박스 경계 클램프 ───────────────────────────────────────────────
    function clamp(crop) {
        let { x, y, w, h } = crop;
        w = Math.max(MIN_SIZE, w);
        h = Math.max(MIN_SIZE, h);
        x = Math.max(0, Math.min(x, _vpW - w));
        y = Math.max(0, Math.min(y, _vpH - h));
        w = Math.min(w, _vpW - x);
        h = Math.min(h, _vpH - y);
        return { x, y, w, h };
    }

    // ─── 모달 열기 ───────────────────────────────────────────────────────────
    function openCropModal(dataUrl, fileName) {
        _fileName = fileName;
        const modal = el('cropModal');
        const canvas = el('cropCanvas');
        const viewport = el('cropViewport');
        if (!modal || !canvas || !viewport) return;

        const img = new Image();
        img.onload = () => {
            _srcImage = img;

            // 모달 열기
            openModal(modal);

            requestAnimationFrame(() => {
                _vpW = viewport.clientWidth;
                // 이미지 비율 유지하여 높이 결정 (최대 60vh)
                const maxH = Math.min(window.innerHeight * 0.6, img.height);
                const ratio = img.width / img.height;
                _vpH = Math.min(_vpW / ratio, maxH);

                canvas.width = img.width;
                canvas.height = img.height;
                canvas.style.height = `${_vpH}px`;

                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0);

                _scaleX = img.width / _vpW;
                _scaleY = img.height / _vpH;

                // 초기 크롭 박스: 전체 이미지의 80% 중앙
                const pw = _vpW * 0.8, ph = _vpH * 0.8;
                _crop = clamp({ x: (_vpW - pw) / 2, y: (_vpH - ph) / 2, w: pw, h: ph });
                applyCropBox();
            });
        };
        img.src = dataUrl;
    }

    // ─── 크롭 실행 → base64 반환 ─────────────────────────────────────────────
    function executeCrop() {
        if (!_srcImage) return null;
        const sx = _crop.x * _scaleX;
        const sy = _crop.y * _scaleY;
        const sw = _crop.w * _scaleX;
        const sh = _crop.h * _scaleY;

        const out = document.createElement('canvas');
        out.width = Math.round(sw);
        out.height = Math.round(sh);
        out.getContext('2d').drawImage(_srcImage, sx, sy, sw, sh, 0, 0, out.width, out.height);
        return out.toDataURL('image/jpeg', 0.92);
    }

    // ─── 포인터 이벤트 유틸 ──────────────────────────────────────────────────
    function getPointerPos(e) {
        const viewport = el('cropViewport');
        const rect = viewport.getBoundingClientRect();
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;
        return { x: clientX - rect.left, y: clientY - rect.top };
    }

    function onPointerDown(e) {
        e.preventDefault();
        const pos = getPointerPos(e);
        const dir = e.target.dataset.dir;  // 핸들이면 방향, 아니면 undefined
        const box = el('cropBox');
        if (!box) return;

        if (dir) {
            _drag = { type: 'resize', dir, startX: pos.x, startY: pos.y, startCrop: { ..._crop } };
        } else if (e.target === box || box.contains(e.target)) {
            _drag = { type: 'move', startX: pos.x, startY: pos.y, startCrop: { ..._crop } };
        }
    }

    function onPointerMove(e) {
        if (!_drag) return;
        e.preventDefault();
        const pos = getPointerPos(e);
        const dx = pos.x - _drag.startX;
        const dy = pos.y - _drag.startY;
        const sc = _drag.startCrop;

        if (_drag.type === 'move') {
            _crop = clamp({ x: sc.x + dx, y: sc.y + dy, w: sc.w, h: sc.h });
        } else {
            let { x, y, w, h } = sc;
            const dir = _drag.dir;
            if (dir.includes('e')) w += dx;
            if (dir.includes('s')) h += dy;
            if (dir.includes('w')) { x += dx; w -= dx; }
            if (dir.includes('n')) { y += dy; h -= dy; }
            _crop = clamp({ x, y, w, h });
        }
        applyCropBox();
    }

    function onPointerUp() { _drag = null; }

    // ─── 이벤트 바인딩 (DOMContentLoaded 이후) ───────────────────────────────
    window.openCropModal = openCropModal;

    document.addEventListener('DOMContentLoaded', () => {
        const overlay = el('cropViewport');
        const cropBox = el('cropBox');
        const closeBtn = el('cropModalClose');
        const cancelBtn = el('cropCancelBtn');
        const confirmBtn = el('cropConfirmBtn');
        if (!overlay) return;

        // 마우스
        overlay.addEventListener('mousedown', onPointerDown);
        document.addEventListener('mousemove', onPointerMove);
        document.addEventListener('mouseup', onPointerUp);
        // 터치
        overlay.addEventListener('touchstart', onPointerDown, { passive: false });
        document.addEventListener('touchmove', onPointerMove, { passive: false });
        document.addEventListener('touchend', onPointerUp);

        function closeCropModal() {
            closeModal(el('cropModal'));
            _srcImage = null;
        }

        closeBtn?.addEventListener('click', closeCropModal);
        cancelBtn?.addEventListener('click', closeCropModal);

        confirmBtn?.addEventListener('click', () => {
            const cropped = executeCrop();
            if (!cropped) return;
            // 설정 모달의 tempBgImage 업데이트
            tempBgImage = cropped;
            tempSettings.bgFileName = _fileName;
            tempBgImageChanged = true;
            updateBgPreview(cropped, _fileName);
            closeCropModal();
        });
    });
}());

/* ===================================================
   Reset Timer
=================================================== */
function getNextResetDate(timeStr, repeat) {
    const now = new Date();
    const [hours, minutes] = timeStr.split(':').map(Number);
    const target = new Date(now);
    target.setHours(hours, minutes, 0, 0);

    if (target <= now) {
        target.setDate(target.getDate() + 1);
    }

    if (repeat === 'weekly') {
        // Find next occurrence of same day-of-week
        const startDay = (new Date()).getDay();
        while (target.getDay() !== startDay) {
            target.setDate(target.getDate() + 1);
        }
    } else if (repeat === 'weekday') {
        // Skip to next weekday
        while (target.getDay() === 0 || target.getDay() === 6) {
            target.setDate(target.getDate() + 1);
        }
    }

    return target;
}

function updateResetNextInfo() {
    if (!DOM.resetEnabled.checked) {
        DOM.resetNextInfo.textContent = '';
        return;
    }
    const time = DOM.resetTime.value || '00:00';
    const repeat = DOM.resetRepeat.value || 'daily';
    const next = getNextResetDate(time, repeat);
    const opts = { weekday: 'short', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' };
    DOM.resetNextInfo.textContent = `다음 초기화: ${next.toLocaleDateString('ko-KR', opts)}`;
}

function scheduleResetTimer() {
    if (resetTimerInterval) {
        clearInterval(resetTimerInterval);
        resetTimerInterval = null;
    }

    if (!state.settings.resetEnabled) return;

    const LAST_RESET_KEY = 'todoApp_lastReset';

    // 중복 방지용 키 생성 (weekly/daily/weekday 고려)
    function buildResetKey(now, h, m) {
        const repeat = state.settings.resetRepeat;
        if (repeat === 'weekly') {
            const d = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
            const dayNum = d.getUTCDay() || 7;
            d.setUTCDate(d.getUTCDate() + 4 - dayNum);
            const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
            const weekNum = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
            return `${d.getUTCFullYear()}-W${weekNum}-${h}-${m}`;
        }
        return `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}-${h}-${m}`;
    }

    function isWeekdayBlocked(now) {
        const repeat = state.settings.resetRepeat;
        const day = now.getDay();
        return repeat === 'weekday' && (day === 0 || day === 6);
    }

    // 전역 초기화: itemResetTime 없는 항목만 체크 해제
    function doGlobalReset(now, h, m) {
        if (isWeekdayBlocked(now)) return;

        const resetKey = buildResetKey(now, h, m);
        if (localStorage.getItem(LAST_RESET_KEY) === resetKey) return;
        localStorage.setItem(LAST_RESET_KEY, resetKey);

        state.todos = state.todos.map(t => t.itemResetTime ? t : { ...t, done: false });
        saveTodos();
        renderTodos();
        showToast('할 일 목록이 자동으로 초기화되었습니다', 'info');
    }

    // 개별 초기화: itemResetTime이 hh:mm인 항목만 체크 해제
    function doItemResets(now, hh, mm) {
        if (isWeekdayBlocked(now)) return;

        let anyChanged = false;
        state.todos = state.todos.map(t => {
            if (!t.itemResetTime) return t;
            const [th, tm] = t.itemResetTime.split(':').map(Number);
            if (th !== hh || tm !== mm) return t;

            // 항목별 중복 방지 키
            const itemKey = `todoApp_itemLastReset_${t.id}`;
            const resetKey = buildResetKey(now, hh, mm);
            if (localStorage.getItem(itemKey) === resetKey) return t;
            localStorage.setItem(itemKey, resetKey);

            anyChanged = true;
            return { ...t, done: false };
        });

        if (anyChanged) {
            saveTodos();
            renderTodos();
            showToast('일부 할 일이 자동으로 초기화되었습니다', 'info');
        }
    }

    // ① 앱 시작 시 catch-up: 오늘 초기화 시각이 이미 지났으면 즉시 실행
    (function catchUpReset() {
        const now = new Date();
        const nowMins = now.getHours() * 60 + now.getMinutes();

        // 전역 catch-up
        const [h, m] = (state.settings.resetTime || '00:00').split(':').map(Number);
        if (nowMins >= h * 60 + m) doGlobalReset(now, h, m);

        // 개별 항목 catch-up
        const uniqueTimes = [...new Set(
            state.todos.filter(t => t.itemResetTime).map(t => t.itemResetTime)
        )];
        uniqueTimes.forEach(timeStr => {
            const [th, tm] = timeStr.split(':').map(Number);
            if (nowMins >= th * 60 + tm) doItemResets(now, th, tm);
        });
    })();

    // ② 실시간 정각 체크: 1초 인터벌로 hh:mm:00 정확히 일치할 때만 실행
    resetTimerInterval = setInterval(() => {
        const now = new Date();
        const hh = now.getHours();
        const mm = now.getMinutes();
        const ss = now.getSeconds();
        if (ss !== 0) return;

        // 전역 초기화
        const [h, m] = (state.settings.resetTime || '00:00').split(':').map(Number);
        if (hh === h && mm === m) doGlobalReset(now, h, m);

        // 개별 초기화
        doItemResets(now, hh, mm);
    }, 1000);
}

/* ===================================================
   Category Management
=================================================== */
function saveCategories() {
    saveToStorage(STORAGE_KEYS.CATEGORIES, state.categories);
    saveToStorage(STORAGE_KEYS.CURRENT_CATEGORY, state.currentCategoryId);
    syncToCloud();
}

/* ===================================================
   Cloud Sync
=================================================== */
function syncToCloud() {
    if (remoteSyncInProgress) return;
    if (!window.FirebaseSync?.isReady()) return;
    // bgImage는 용량이 커서 동기화 제외
    const { bgImage, bgFileName, ...settingsForSync } = state.settings;
    window.FirebaseSync.push({
        todos: state.todos,
        categories: state.categories,
        settings: settingsForSync,
    });
}

function toggleUI() {
    const container = document.querySelector('.app-container');
    if (!container) return;
    container.classList.toggle('ui-hidden');
}

function manualRefresh() {
    const btn = DOM.refreshBtn;
    if (!btn || btn.classList.contains('spinning')) return;
    btn.classList.add('spinning');
    // Firebase 재연결 — 기존 구독을 끊고 다시 연결
    if (window.FirebaseSync?.isReady()) {
        window.FirebaseSync.startSync(applyRemoteData);
    } else if (window.FirebaseSync?.init()) {
        window.FirebaseSync.startSync(applyRemoteData);
    }
    setTimeout(() => btn.classList.remove('spinning'), 1000);
}

function applyRemoteData(cloudData) {
    remoteSyncInProgress = true;
    try {
        let changed = false;

        if (cloudData.todos &&
            JSON.stringify(cloudData.todos) !== JSON.stringify(state.todos)) {
            state.todos = cloudData.todos;
            saveToStorage(STORAGE_KEYS.TODOS, state.todos);
            changed = true;
        }

        if (cloudData.categories?.length &&
            JSON.stringify(cloudData.categories) !== JSON.stringify(state.categories)) {
            state.categories = cloudData.categories;
            saveToStorage(STORAGE_KEYS.CATEGORIES, state.categories);
            // currentCategoryId 유효성 확인
            if (!state.categories.find(c => c.id === state.currentCategoryId)) {
                state.currentCategoryId = state.categories[0].id;
                saveToStorage(STORAGE_KEYS.CURRENT_CATEGORY, state.currentCategoryId);
            }
            changed = true;
        }

        if (cloudData.settings) {
            // bgImage·bgFileName은 로컬 디바이스 전용 — 덮어쓰지 않음
            const { bgImage, bgFileName } = state.settings;
            state.settings = { ...state.settings, ...cloudData.settings, bgImage, bgFileName };
            const { bgImage: _b, bgFileName: _f, ...rest } = state.settings;
            saveToStorage(STORAGE_KEYS.SETTINGS, rest);
            applyAppTitle();
            changed = true;
        }

        if (changed) {
            renderCategoryTabs();
            renderTodos();
            applyBackground();
        }
    } finally {
        remoteSyncInProgress = false;
    }
}

function addCategory(name) {
    const id = `cat_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`;
    state.categories.push({ id, name: name.trim() });
    saveCategories();
    renderCategoryTabs();
    switchCategory(id);
}

function renameCategory(id, newName) {
    const cat = state.categories.find(c => c.id === id);
    if (!cat || !newName.trim()) return;
    cat.name = newName.trim();
    saveCategories();
    renderCategoryTabs();
}

function deleteCategory(id) {
    if (id === 'default') return;
    if (state.categories.length <= 1) return;

    const cat = state.categories.find(c => c.id === id);
    const catName = cat ? cat.name : '';

    // 해당 카테고리의 할 일 백업 (undo용)
    const removedTodos = state.todos.filter(t => (t.categoryId || 'default') === id);
    const removedCat = { ...cat };

    state.todos = state.todos.filter(t => (t.categoryId || 'default') !== id);
    saveTodos();
    state.categories = state.categories.filter(c => c.id !== id);
    saveCategories();
    if (state.currentCategoryId === id) {
        state.currentCategoryId = state.categories[0].id;
        saveToStorage(STORAGE_KEYS.CURRENT_CATEGORY, state.currentCategoryId);
    }
    renderCategoryTabs();
    renderTodos();

    // 실행 취소 토스트
    let undone = false;
    const toast = document.createElement('div');
    toast.className = 'toast toast-error';
    toast.innerHTML = `<span class="toast-dot"></span>"${escapeHtml(catName)}" 탭 삭제됨 <button class="toast-undo-btn">실행취소</button>`;
    DOM.toastContainer.appendChild(toast);

    toast.querySelector('.toast-undo-btn').addEventListener('click', () => {
        if (undone) return;
        undone = true;
        // 복원
        state.categories.push(removedCat);
        state.categories.sort((a, b) => (a.id === 'default' ? -1 : 0));
        state.todos = state.todos.concat(removedTodos);
        saveTodos();
        saveCategories();
        switchCategory(removedCat.id);
        toast.classList.add('leaving');
    });

    setTimeout(() => {
        if (!undone) {
            toast.classList.add('leaving');
            toast.addEventListener('animationend', () => toast.remove());
        }
    }, 4000);
}

function switchCategory(id) {
    state.currentCategoryId = id;
    saveToStorage(STORAGE_KEYS.CURRENT_CATEGORY, id);
    renderCategoryTabs();
    renderTodos();
}

function renderCategoryTabs() {
    const container = document.getElementById('categoryTabsBar');
    if (!container) return;
    container.innerHTML = '';

    state.categories.forEach(cat => {
        const isActive = cat.id === state.currentCategoryId;
        const tab = document.createElement('div');
        tab.className = `category-tab${isActive ? ' active' : ''}`;
        tab.dataset.id = cat.id;

        const nameSpan = document.createElement('span');
        nameSpan.className = 'category-tab-name';
        nameSpan.textContent = cat.name;
        nameSpan.title = '활성 탭 클릭하여 이름 변경';

        tab.appendChild(nameSpan);

        // 탭 삭제 버튼 (기본 탭 제외)
        if (cat.id !== 'default') {
            const delBtn = document.createElement('button');
            delBtn.className = 'category-tab-del';
            delBtn.title = '탭 삭제';
            delBtn.innerHTML = `<svg viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><line x1="2" y1="2" x2="8" y2="8"/><line x1="8" y1="2" x2="2" y2="8"/></svg>`;
            delBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                deleteCategory(cat.id);
            });
            tab.appendChild(delBtn);
        }

        tab.addEventListener('click', (e) => {
            // 삭제 버튼 클릭은 무시
            if (e.target.closest('.category-tab-del')) return;
            // 이미 활성 탭이면 이름 변경 시작
            if (state.currentCategoryId === cat.id) {
                startCategoryRename(tab, cat.id, cat.name);
            } else {
                switchCategory(cat.id);
            }
        });

        container.appendChild(tab);
    });

    // 탭 추가 버튼
    const addBtn = document.createElement('button');
    addBtn.className = 'category-tab-add';
    addBtn.title = '새 탭 추가';
    addBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`;
    addBtn.addEventListener('click', () => {
        startCategoryAdd(container, addBtn);
    });
    container.appendChild(addBtn);
}

function startCategoryAdd(container, addBtn) {
    // 이미 입력 중이면 무시
    if (container.querySelector('.category-tab-new')) return;

    const inputTab = document.createElement('div');
    inputTab.className = 'category-tab category-tab-new';

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'category-tab-rename-input';
    input.placeholder = '탭 이름';
    input.maxLength = 20;

    inputTab.appendChild(input);
    container.insertBefore(inputTab, addBtn);

    // focus를 약간 지연 (Electron sandbox 이슈 방지)
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
    const onOutsideClick = (e) => {
        if (!inputTab.contains(e.target)) commit();
    };

    // 외부 클릭 감지는 약간 지연 등록 (현재 클릭 이벤트가 먼저 처리되도록)
    setTimeout(() => {
        document.addEventListener('mousedown', onOutsideClick, true);
    }, 100);

    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); commit(); }
        if (e.key === 'Escape') { e.preventDefault(); cancel(); }
    });
}

function startCategoryRename(tabEl, id, currentName) {
    const nameSpan = tabEl.querySelector('.category-tab-name');
    if (!nameSpan) return;

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'category-tab-rename-input';
    input.value = currentName;
    input.maxLength = 20;

    nameSpan.replaceWith(input);
    setTimeout(() => { input.focus(); input.select(); }, 50);

    let committed = false;
    const commit = () => {
        if (committed) return;
        committed = true;
        document.removeEventListener('mousedown', onOutsideClick, true);
        const newName = input.value.trim() || currentName;
        renameCategory(id, newName);
    };
    const onOutsideClick = (e) => {
        if (!tabEl.contains(e.target)) commit();
    };
    setTimeout(() => {
        document.addEventListener('mousedown', onOutsideClick, true);
    }, 100);

    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); commit(); }
        if (e.key === 'Escape') { e.preventDefault(); committed = true; document.removeEventListener('mousedown', onOutsideClick, true); renameCategory(id, currentName); }
    });
}

/* ===================================================
   Theme
=================================================== */
function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme');
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    saveToStorage(STORAGE_KEYS.THEME, next);
    showToast(next === 'dark' ? '다크모드 활성화' : '라이트모드 활성화', 'info');
}

/* ===================================================
   Filter
=================================================== */
function setFilter(filter) {
    state.filter = filter;
    DOM.filterTabs.forEach(tab => {
        tab.classList.toggle('active', tab.dataset.filter === filter);
    });
    renderTodos();
}

/* ===================================================
   Event Listeners
=================================================== */
function bindEvents() {
    // Theme toggle
    DOM.themeToggle.addEventListener('click', toggleTheme);

    // Add button
    DOM.addBtn.addEventListener('click', openAddModal);

    // Settings button
    DOM.settingsBtn.addEventListener('click', openSettingsModal);

    // Refresh button
    DOM.refreshBtn?.addEventListener('click', manualRefresh);

    // UI toggle button
    DOM.uiToggleBtn?.addEventListener('click', toggleUI);

    // Task modal
    DOM.modalClose.addEventListener('click', () => closeModal(DOM.taskModal));
    DOM.modalCancel.addEventListener('click', () => closeModal(DOM.taskModal));
    DOM.modalSave.addEventListener('click', handleModalSave);
    DOM.taskInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleModalSave();
        }
    });
    DOM.taskResetClear.addEventListener('click', () => {
        DOM.taskResetTime.value = '';
    });

    // Priority selector
    DOM.prioritySelector.addEventListener('click', (e) => {
        const btn = e.target.closest('.priority-btn');
        if (!btn) return;
        DOM.prioritySelector.querySelectorAll('.priority-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
    });

    // Settings modal
    DOM.settingsClose.addEventListener('click', () => closeModal(DOM.settingsModal));
    DOM.settingsCancelBtn.addEventListener('click', () => closeModal(DOM.settingsModal));
    DOM.settingsSaveBtn.addEventListener('click', saveSettingsFromModal);
    DOM.clearAllBtn.addEventListener('click', () => {
        closeModal(DOM.settingsModal);
        setTimeout(() => openClearAllModal(), 200);
    });

    // Reset timer form — keep tempSettings in sync with DOM
    DOM.resetEnabled.addEventListener('change', () => {
        tempSettings.resetEnabled = DOM.resetEnabled.checked;
        DOM.resetSubGroup.classList.toggle('hidden', !DOM.resetEnabled.checked);
        updateResetNextInfo();
    });
    DOM.resetTime.addEventListener('change', () => {
        tempSettings.resetTime = DOM.resetTime.value;
        updateResetNextInfo();
    });
    DOM.resetRepeat.addEventListener('change', () => {
        tempSettings.resetRepeat = DOM.resetRepeat.value;
        updateResetNextInfo();
    });

    // Background file input → 크롭 모달 열기
    DOM.bgFileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
        if (!allowedTypes.includes(file.type)) {
            showToast('지원하지 않는 파일 형식입니다', 'error');
            return;
        }
        if (file.size > 10 * 1024 * 1024) {
            showToast('파일 크기는 10MB 이하여야 합니다', 'error');
            return;
        }

        const reader = new FileReader();
        reader.onload = (evt) => {
            openCropModal(evt.target.result, file.name);
        };
        reader.readAsDataURL(file);
        e.target.value = '';
    });

    // Background remove
    DOM.bgRemoveBtn.addEventListener('click', () => {
        tempBgImage = null;
        tempSettings.bgFileName = '';
        tempBgImageChanged = true;
        updateBgPreview(null, '');
    });

    // Range inputs
    DOM.bgOpacity.addEventListener('input', () => {
        tempSettings.bgOpacity = parseInt(DOM.bgOpacity.value, 10);
        DOM.bgOpacityValue.textContent = `${tempSettings.bgOpacity}%`;
    });

    DOM.bgBlur.addEventListener('input', () => {
        tempSettings.bgBlur = parseInt(DOM.bgBlur.value, 10);
        DOM.bgBlurValue.textContent = `${tempSettings.bgBlur}px`;
    });

    // Confirm modal
    DOM.confirmCancel.addEventListener('click', () => closeModal(DOM.confirmModal));
    DOM.confirmDelete.addEventListener('click', handleConfirmDelete);

    // Filter tabs
    DOM.filterTabs.forEach(tab => {
        tab.addEventListener('click', () => setFilter(tab.dataset.filter));
    });
}

/* ===================================================
   Electron Integration
=================================================== */
function updateWinMaximizeBtn(isMaximized) {
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

function bindElectronEvents() {
    if (!window.electronAPI) return;

    // Add class to enable Electron-specific CSS (titlebar, drag regions, etc.)
    document.body.classList.add('electron-mode');

    document.getElementById('winMinimize')?.addEventListener('click', () => window.electronAPI.minimize());
    document.getElementById('winMaximize')?.addEventListener('click', () => window.electronAPI.maximize());
    document.getElementById('winClose')?.addEventListener('click', () => window.electronAPI.close());

    // Keep maximize/restore button icon in sync with window state
    window.electronAPI.onMaximizeChange(updateWinMaximizeBtn);
    window.electronAPI.isMaximized().then(updateWinMaximizeBtn).catch(() => { });
}

/* ===================================================
   Init
=================================================== */
function init() {
    loadState();
    bindEvents();
    bindElectronEvents();
    updateHeaderDate();
    renderCategoryTabs();
    renderTodos();
    applyBackground();
    scheduleResetTimer();

    // Update date+time every second
    setInterval(updateHeaderDate, 1000);

    // Firebase 클라우드 동기화 시작
    if (window.FirebaseSync?.init()) {
        window.FirebaseSync.startSync(applyRemoteData);
    }
}

document.addEventListener('DOMContentLoaded', init);
