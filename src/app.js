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
   Platform Detection & Notification Helpers
=================================================== */
function isElectron() {
    return typeof window !== 'undefined' && window.electronAPI;
}

function isCapacitor() {
    return typeof window !== 'undefined' && window.CapacitorCore && window.CapacitorCore.Capacitor.isNativePlatform();
}

async function showSystemNotification(title, body) {
    try {
        // Electron 환경
        if (isElectron()) {
            await window.electronAPI.showNotification(title, body);
            return;
        }

        // Capacitor 모바일 환경
        if (isCapacitor()) {
            const { LocalNotifications } = window.CapacitorCore;

            // 권한 확인 및 요청
            const permission = await LocalNotifications.checkPermissions();
            if (permission.display !== 'granted') {
                const result = await LocalNotifications.requestPermissions();
                if (result.display !== 'granted') {
                    console.log('[Notification] Permission denied');
                    return;
                }
            }

            // 알림 발송
            await LocalNotifications.schedule({
                notifications: [
                    {
                        title: title,
                        body: body,
                        id: Date.now(),
                        schedule: { at: new Date(Date.now() + 1000) }, // 1초 후
                        sound: undefined,
                        attachments: undefined,
                        actionTypeId: '',
                        extra: null
                    }
                ]
            });
            return;
        }

        // 브라우저 Web Notification API
        if ('Notification' in window) {
            if (Notification.permission === 'granted') {
                new Notification(title, { body });
            } else if (Notification.permission !== 'denied') {
                const permission = await Notification.requestPermission();
                if (permission === 'granted') {
                    new Notification(title, { body });
                }
            }
        }
    } catch (err) {
        console.error('[Notification Error]', err);
    }
}

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
    console.log('[saveTodos] 호출됨 - remoteSyncInProgress:', remoteSyncInProgress);
    saveToStorage(STORAGE_KEYS.TODOS, state.todos);
    // Firebase 동기화
    if (window.FirebaseSync?.isReady()) {
        window.FirebaseSync.push({
            todos: state.todos,
            categories: state.categories,
            settings: (() => {
                const { bgImage, bgFileName, ...rest } = state.settings;
                return rest;
            })(),
        });
    }
    // 동기화 완료 후 플래그 해제 (1초 후 - Firebase push 디바운스 800ms 고려)
    setTimeout(() => {
        remoteSyncInProgress = false;
        console.log('[saveTodos] remoteSyncInProgress 해제');
    }, 1200);
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
    // Firebase 동기화
    if (window.FirebaseSync?.isReady()) {
        window.FirebaseSync.push({
            todos: state.todos,
            categories: state.categories,
            settings: rest,
        });
    }
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
    // Developer tools
    get devToolsSection() { return document.getElementById('devToolsSection'); },
    get testNotificationBtn() { return document.getElementById('testNotificationBtn'); },
    // Task reset
    get taskResetType() { return document.getElementById('taskResetType'); },
    get taskResetTime() { return document.getElementById('taskResetTime'); },
    get taskResetDatetime() { return document.getElementById('taskResetDatetime'); },
    get taskResetTimeRow() { return document.getElementById('taskResetTimeRow'); },
    get taskResetDatetimeRow() { return document.getElementById('taskResetDatetimeRow'); },
    get taskResetWeeklyRow() { return document.getElementById('taskResetWeeklyRow'); },
    get taskResetMonthlyRow() { return document.getElementById('taskResetMonthlyRow'); },
    get taskResetYearlyRow() { return document.getElementById('taskResetYearlyRow'); },
    get taskResetWeeklyTime() { return document.getElementById('taskResetWeeklyTime'); },
    get taskResetMonthlyTime() { return document.getElementById('taskResetMonthlyTime'); },
    get taskResetYearlyTime() { return document.getElementById('taskResetYearlyTime'); },
    get monthDayGrid() { return document.getElementById('monthDayGrid'); },
    get yearlyDateList() { return document.getElementById('yearlyDateList'); },
    get addYearlyDateBtn() { return document.getElementById('addYearlyDateBtn'); },
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
function formatItemDatetime(dt) {
    if (!dt) return '';
    return new Date(dt).toLocaleString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

const WEEKDAY_NAMES = ['일', '월', '화', '수', '목', '금', '토'];

function formatScheduleBadge(s) {
    if (!s) return '';
    const time = s.time || '';
    if (s.type === 'weekly') {
        const days = (s.weekdays || []).map(d => WEEKDAY_NAMES[d]).join('·');
        return `🔄 매주 ${days} ${time}`;
    }
    if (s.type === 'monthly') {
        const days = (s.days || []).join('·');
        return `🔄 매월 ${days}일 ${time}`;
    }
    if (s.type === 'yearly') {
        const dates = (s.dates || []).map(d => `${d.month}/${d.day}`).join('·');
        return `🔄 매년 ${dates} ${time}`;
    }
    return '';
}

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
        ${todo.itemResetTime ? `<span class="todo-reset-badge">⏰ ${todo.itemResetTime} 매일</span>` : ''}
        ${todo.itemResetDatetime ? `<span class="todo-reset-badge">📅 ${formatItemDatetime(todo.itemResetDatetime)}</span>` : ''}
        ${todo.itemResetSchedule ? `<span class="todo-reset-badge">${escapeHtml(formatScheduleBadge(todo.itemResetSchedule))}</span>` : ''}
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
function addTodo(text, note, priority, itemResetTime, itemResetDatetime, itemResetSchedule) {
    const todo = {
        id: generateId(),
        text: text.trim(),
        note: note.trim(),
        priority: priority || 'medium',
        done: false,
        createdAt: new Date().toISOString(),
        itemResetTime: itemResetTime || null,
        itemResetDatetime: itemResetDatetime || null,
        itemResetSchedule: itemResetSchedule || null,
        categoryId: state.currentCategoryId,
    };
    state.todos.unshift(todo);
    saveTodos();
    renderTodos();
    showToast('새 할 일이 추가되었습니다', 'success');
}

function editTodo(id, text, note, priority, itemResetTime, itemResetDatetime, itemResetSchedule) {
    const idx = state.todos.findIndex(t => t.id === id);
    if (idx === -1) return;
    state.todos[idx] = {
        ...state.todos[idx],
        text: text.trim(),
        note: note.trim(),
        priority: priority || 'medium',
        itemResetTime: itemResetTime || null,
        itemResetDatetime: itemResetDatetime || null,
        itemResetSchedule: itemResetSchedule || null,
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
    DOM.taskResetDatetime.value = '';
    DOM.taskResetWeeklyTime.value = '';
    DOM.taskResetMonthlyTime.value = '';
    DOM.taskResetYearlyTime.value = '';
    document.querySelectorAll('.weekday-btn').forEach(b => b.classList.remove('active'));
    if (DOM.monthDayGrid) DOM.monthDayGrid.querySelectorAll('.day-number-btn').forEach(b => b.classList.remove('active'));
    DOM.yearlyDateList.innerHTML = '';
    setSelectedPriority('medium');
    updateTaskResetTypeUI('none');
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
    setSelectedPriority(todo.priority || 'medium');
    // reset all fields first
    DOM.taskResetTime.value = '';
    DOM.taskResetDatetime.value = '';
    DOM.taskResetWeeklyTime.value = '';
    DOM.taskResetMonthlyTime.value = '';
    DOM.taskResetYearlyTime.value = '';
    document.querySelectorAll('.weekday-btn').forEach(b => b.classList.remove('active'));
    if (DOM.monthDayGrid) DOM.monthDayGrid.querySelectorAll('.day-number-btn').forEach(b => b.classList.remove('active'));
    DOM.yearlyDateList.innerHTML = '';

    const s = todo.itemResetSchedule;
    if (s) {
        updateTaskResetTypeUI(s.type);
        if (s.type === 'weekly') {
            DOM.taskResetWeeklyTime.value = s.time || '';
            document.querySelectorAll('.weekday-btn').forEach(b => {
                b.classList.toggle('active', (s.weekdays || []).includes(parseInt(b.dataset.day, 10)));
            });
        } else if (s.type === 'monthly') {
            initMonthDayGrid();
            DOM.taskResetMonthlyTime.value = s.time || '';
            DOM.monthDayGrid.querySelectorAll('.day-number-btn').forEach(b => {
                b.classList.toggle('active', (s.days || []).includes(parseInt(b.dataset.day, 10)));
            });
        } else if (s.type === 'yearly') {
            DOM.taskResetYearlyTime.value = s.time || '';
            (s.dates || []).forEach(d => addYearlyDateEntry(d.month, d.day));
        }
    } else if (todo.itemResetDatetime) {
        DOM.taskResetDatetime.value = todo.itemResetDatetime;
        updateTaskResetTypeUI('datetime');
    } else if (todo.itemResetTime) {
        DOM.taskResetTime.value = todo.itemResetTime;
        updateTaskResetTypeUI('time');
    } else {
        updateTaskResetTypeUI('none');
    }
    openModal(DOM.taskModal);
    setTimeout(() => DOM.taskInput.focus(), 50);
}

function handleModalSave() {
    console.log('[handleModalSave] 저장 버튼 클릭됨');

    const text = DOM.taskInput.value.trim();
    console.log('[handleModalSave] 입력 텍스트:', text);

    if (!text) {
        console.log('[handleModalSave] 텍스트가 비어있음 - 에러 표시');
        DOM.taskInput.classList.add('error-shake');
        DOM.taskInput.focus();
        DOM.taskInput.addEventListener('animationend', () => {
            DOM.taskInput.classList.remove('error-shake');
        }, { once: true });
        return;
    }

    const note = DOM.taskNote.value;
    const priority = getSelectedPriority();
    const resetType = DOM.taskResetType.value;
    const itemResetTime = resetType === 'time' ? (DOM.taskResetTime.value || null) : null;
    const itemResetDatetime = resetType === 'datetime' ? (DOM.taskResetDatetime.value || null) : null;
    let itemResetSchedule = null;
    if (resetType === 'weekly') {
        const weekdays = Array.from(document.querySelectorAll('.weekday-btn.active'))
            .map(b => parseInt(b.dataset.day, 10));
        itemResetSchedule = { type: 'weekly', weekdays, time: DOM.taskResetWeeklyTime.value || '00:00' };
    } else if (resetType === 'monthly') {
        const days = Array.from(DOM.monthDayGrid.querySelectorAll('.day-number-btn.active'))
            .map(b => parseInt(b.dataset.day, 10));
        itemResetSchedule = { type: 'monthly', days, time: DOM.taskResetMonthlyTime.value || '00:00' };
    } else if (resetType === 'yearly') {
        const dates = getYearlyDatesFromDOM();
        itemResetSchedule = { type: 'yearly', dates, time: DOM.taskResetYearlyTime.value || '00:00' };
    }

    console.log('[handleModalSave] 저장 준비 완료 - editingId:', state.editingId);

    if (state.editingId) {
        editTodo(state.editingId, text, note, priority, itemResetTime, itemResetDatetime, itemResetSchedule);
    } else {
        addTodo(text, note, priority, itemResetTime, itemResetDatetime, itemResetSchedule);
    }

    console.log('[handleModalSave] 저장 완료 - 모달 닫기');
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

function openConfirmCategoryModal(id, name) {
    _pendingConfirmAction = () => deleteCategory(id);
    const titleEl = DOM.confirmModal?.querySelector('.confirm-title');
    const subEl = DOM.confirmModal?.querySelector('.confirm-sub');
    if (titleEl) titleEl.textContent = `'${name}' 탭을 삭제하시겠습니까?`;
    if (subEl) subEl.textContent = '탭 안의 모든 할 일도 함께 삭제됩니다.';
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

    // Show developer tools section (for Electron)
    // if (DOM.devToolsSection && window.electronAPI) {
    //     DOM.devToolsSection.style.display = '';
    // }

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
        const startDay = (new Date()).getDay();
        while (target.getDay() !== startDay) {
            target.setDate(target.getDate() + 1);
        }
    } else if (repeat === 'monthly') {
        // 다음 달, 같은 날짜
        target.setMonth(target.getMonth() + 1);
    } else if (repeat === 'yearly') {
        // 내년, 같은 월일
        target.setFullYear(target.getFullYear() + 1);
    } else if (repeat === 'weekday') {
        while (target.getDay() === 0 || target.getDay() === 6) {
            target.setDate(target.getDate() + 1);
        }
    } else if (repeat && repeat.startsWith('every')) {
        // everyN: 마지막 실행일에서 N일 후
        const n = parseInt(repeat.slice(5), 10);
        const lastKey = localStorage.getItem('todoApp_lastReset');
        if (lastKey) {
            // 마지막 리셋 날짜를 파싱해 N일 후를 계산
            const parts = lastKey.split('-');
            if (parts.length >= 3) {
                const lastDate = new Date(Number(parts[0]), Number(parts[1]), Number(parts[2]));
                lastDate.setHours(hours, minutes, 0, 0);
                const nextDate = new Date(lastDate);
                nextDate.setDate(nextDate.getDate() + n);
                if (nextDate > now) return nextDate;
            }
        }
        // 마지막 리셋 기록 없으면 다음 N일 후
        target.setDate(target.getDate() + n - 1);
    }

    return target;
}

function initMonthDayGrid() {
    const grid = DOM.monthDayGrid;
    if (!grid || grid.dataset.initialized) return;
    grid.dataset.initialized = '1';
    for (let i = 1; i <= 31; i++) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'day-number-btn';
        btn.dataset.day = i;
        btn.textContent = i;
        btn.addEventListener('click', () => btn.classList.toggle('active'));
        grid.appendChild(btn);
    }
}

function addYearlyDateEntry(month = 1, day = 1) {
    const list = DOM.yearlyDateList;
    const row = document.createElement('div');
    row.className = 'yearly-date-row';
    const monthSel = document.createElement('select');
    monthSel.className = 'form-input yearly-month-sel';
    for (let m = 1; m <= 12; m++) {
        const opt = document.createElement('option');
        opt.value = m;
        opt.textContent = `${m}월`;
        if (m === month) opt.selected = true;
        monthSel.appendChild(opt);
    }
    const daySel = document.createElement('select');
    daySel.className = 'form-input yearly-day-sel';
    for (let d = 1; d <= 31; d++) {
        const opt = document.createElement('option');
        opt.value = d;
        opt.textContent = `${d}일`;
        if (d === day) opt.selected = true;
        daySel.appendChild(opt);
    }
    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'yearly-remove-btn';
    removeBtn.textContent = '✕';
    removeBtn.addEventListener('click', () => row.remove());
    row.appendChild(monthSel);
    row.appendChild(daySel);
    row.appendChild(removeBtn);
    list.appendChild(row);
}

function getYearlyDatesFromDOM() {
    return Array.from(DOM.yearlyDateList.querySelectorAll('.yearly-date-row')).map(row => ({
        month: parseInt(row.querySelector('.yearly-month-sel').value, 10),
        day: parseInt(row.querySelector('.yearly-day-sel').value, 10),
    }));
}

function updateTaskResetTypeUI(type) {
    DOM.taskResetType.value = type;
    DOM.taskResetTimeRow.style.display = type === 'time' ? '' : 'none';
    DOM.taskResetWeeklyRow.style.display = type === 'weekly' ? '' : 'none';
    DOM.taskResetMonthlyRow.style.display = type === 'monthly' ? '' : 'none';
    DOM.taskResetYearlyRow.style.display = type === 'yearly' ? '' : 'none';
    DOM.taskResetDatetimeRow.style.display = type === 'datetime' ? '' : 'none';
    if (type === 'monthly') initMonthDayGrid();
    if (type === 'yearly' && DOM.yearlyDateList.children.length === 0) addYearlyDateEntry();
}

function updateResetNextInfo() {
    if (!DOM.resetEnabled.checked) {
        DOM.resetNextInfo.textContent = '';
        return;
    }
    const time = DOM.resetTime.value || '00:00';
    const repeat = DOM.resetRepeat.value || 'daily';
    const next = getNextResetDate(time, repeat);
    if (!next) {
        DOM.resetNextInfo.textContent = '지정된 일시가 이미 지났습니다';
        return;
    }
    const opts = { weekday: 'short', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' };
    DOM.resetNextInfo.textContent = `다음 초기화: ${next.toLocaleDateString('ko-KR', opts)}`;
}

/* ===================================================
   Reset Timer Logic (초기화 로직)
=================================================== */
const LAST_RESET_KEY = 'todoApp_lastReset';

// 중복 방지용 키 생성 (weekly/daily/weekday/everyN 고려)
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
    if (repeat === 'monthly') {
        return `${now.getFullYear()}-M${now.getMonth()}-${h}-${m}`;
    }
    if (repeat === 'yearly') {
        return `${now.getFullYear()}-Y-${h}-${m}`;
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

    const repeat = state.settings.resetRepeat;

    if (repeat && repeat.startsWith('every')) {
        // everyN: 마지막 리셋 날짜 기준으로 N일 경과 여부를 직접 비교
        const n = parseInt(repeat.slice(5), 10);
        const lastKey = localStorage.getItem(LAST_RESET_KEY);
        if (lastKey) {
            const parts = lastKey.split('-');
            if (parts.length >= 3) {
                const lastDate = new Date(Number(parts[0]), Number(parts[1]), Number(parts[2]));
                lastDate.setHours(h, m, 0, 0);
                const nextDate = new Date(lastDate);
                nextDate.setDate(nextDate.getDate() + n);
                if (now < nextDate) return; // 아직 N일 미경과
            }
        }
        // N일 이상 경과 → 오늘 날짜를 키로 저장
        const todayKey = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}-${h}-${m}`;
        if (localStorage.getItem(LAST_RESET_KEY) === todayKey) return; // 오늘 이미 실행
        localStorage.setItem(LAST_RESET_KEY, todayKey);
    } else {
        const resetKey = buildResetKey(now, h, m);
        if (localStorage.getItem(LAST_RESET_KEY) === resetKey) return;
        localStorage.setItem(LAST_RESET_KEY, resetKey);
    }

    // 디버깅: 초기화 전 상태
    const targetItems = state.todos.filter(t => !t.itemResetTime);
    const completedBefore = targetItems.filter(t => t.done);
    console.log(`[전역 초기화] 대상 항목: ${targetItems.length}개, 완료 상태: ${completedBefore.length}개`);
    if (completedBefore.length > 0) {
        console.log('  완료→미완료 변경:', completedBefore.map(t => `"${t.text}"`).join(', '));
    }

    remoteSyncInProgress = true;
    console.log('[전역 초기화] remoteSyncInProgress = true 설정');

    state.todos = state.todos.map(t => t.itemResetTime ? t : { ...t, done: false });
    saveTodos();
    renderTodos();
    showToast('할 일 목록이 자동으로 초기화되었습니다', 'info');

    // 시스템 알림
    showSystemNotification(
        '✅ 체크리스트 초기화',
        '할 일 목록이 자동으로 초기화되었습니다.'
    );
}

// 개별 초기화: itemResetTime이 hh:mm인 항목만 체크 해제
function doItemResets(now, hh, mm) {
    if (isWeekdayBlocked(now)) return;

    let anyChanged = false;
    const changedItems = [];
    state.todos = state.todos.map(t => {
        if (!t.itemResetTime || t.itemResetDatetime || t.itemResetSchedule) return t;
        const [th, tm] = t.itemResetTime.split(':').map(Number);
        if (th !== hh || tm !== mm) return t;

        // 항목별 중복 방지 키
        const itemKey = `todoApp_itemLastReset_${t.id}`;
        const resetKey = buildResetKey(now, hh, mm);
        if (localStorage.getItem(itemKey) === resetKey) return t;
        localStorage.setItem(itemKey, resetKey);

        anyChanged = true;
        if (t.done) {
            changedItems.push(t.text);
        }
        return { ...t, done: false };
    });

    if (anyChanged) {
        console.log(`[개별 초기화 ${hh}:${String(mm).padStart(2, '0')}] 완료→미완료 변경: ${changedItems.length}개`);
        if (changedItems.length > 0) {
            console.log('  변경된 항목:', changedItems.map(t => `"${t}"`).join(', '));
        }

        console.log('[개별 초기화] state.todos 업데이트 전체 건수:', state.todos.length);
        console.log('[개별 초기화] 변경된 항목들의 done 상태:',
            state.todos.filter(t => changedItems.includes(t.text)).map(t => ({ text: t.text, done: t.done })));

        remoteSyncInProgress = true;
        console.log('[개별 초기화] remoteSyncInProgress = true 설정');

        saveTodos();
        renderTodos();

        console.log('[개별 초기화] saveTodos() 완료, renderTodos() 완료');

        showToast('일부 할 일이 자동으로 초기화되었습니다', 'info');

        // 시스템 알림
        showSystemNotification(
            '🔄 항목 초기화',
            '일부 할 일이 자동으로 초기화되었습니다.'
        );
    }
}

// 날짜 지정 1회 초기화
function doItemDatetimeResets(now) {
    let anyChanged = false;
    const changedItems = [];
    state.todos = state.todos.map(t => {
        if (!t.itemResetDatetime) return t;
        const itemKey = `todoApp_itemLastReset_${t.id}`;
        if (localStorage.getItem(itemKey) === t.itemResetDatetime) return t; // 이미 실행
        const targetDate = new Date(t.itemResetDatetime);
        if (now < targetDate) return t; // 아직 시각 안 될
        localStorage.setItem(itemKey, t.itemResetDatetime);
        anyChanged = true;
        if (t.done) {
            changedItems.push(t.text);
        }
        return { ...t, done: false };
    });
    if (anyChanged) {
        console.log(`[날짜/시간 초기화] 완료→미완료 변경: ${changedItems.length}개`);
        if (changedItems.length > 0) {
            console.log('  변경된 항목:', changedItems.map(t => `"${t}"`).join(', '));
        }

        remoteSyncInProgress = true;
        console.log('[날짜/시간 초기화] remoteSyncInProgress = true 설정');

        saveTodos();
        renderTodos();
        showToast('일부 할 일이 자동으로 초기화되었습니다', 'info');

        // 시스템 알림
        showSystemNotification(
            '🔄 항목 초기화',
            '일부 할 일이 자동으로 초기화되었습니다.'
        );
    }
}

// 주간/월간/연간 스케줄 초기화
function doItemScheduleResets(now, catchUp = false) {
    const hh = now.getHours();
    const mm = now.getMinutes();
    let anyChanged = false;
    const changedItems = [];
    state.todos = state.todos.map(t => {
        if (!t.itemResetSchedule) return t;
        const s = t.itemResetSchedule;
        const [sh, sm] = (s.time || '00:00').split(':').map(Number);
        if (catchUp) {
            if (hh * 60 + mm < sh * 60 + sm) return t;
        } else {
            if (hh !== sh || mm !== sm) return t;
        }
        let matched = false;
        if (s.type === 'weekly') matched = (s.weekdays || []).includes(now.getDay());
        else if (s.type === 'monthly') matched = (s.days || []).includes(now.getDate());
        else if (s.type === 'yearly') matched = (s.dates || []).some(d => d.month === (now.getMonth() + 1) && d.day === now.getDate());
        if (!matched) return t;
        const itemKey = `todoApp_itemLastReset_${t.id}`;
        const occKey = `${s.type}-${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`;
        if (localStorage.getItem(itemKey) === occKey) return t;
        localStorage.setItem(itemKey, occKey);
        anyChanged = true;
        if (t.done) {
            changedItems.push(t.text);
        }
        return { ...t, done: false };
    });
    if (anyChanged) {
        console.log(`[스케줄 초기화] 완료→미완료 변경: ${changedItems.length}개`);
        if (changedItems.length > 0) {
            console.log('  변경된 항목:', changedItems.map(t => `"${t}"`).join(', '));
        }

        remoteSyncInProgress = true;
        console.log('[스케줄 초기화] remoteSyncInProgress = true 설정');

        saveTodos();
        renderTodos();
        showToast('일부 할 일이 자동으로 초기화되었습니다', 'info');

        // 시스템 알림
        showSystemNotification(
            '🔄 스케줄 초기화',
            '일부 할 일이 자동으로 초기화되었습니다.'
        );
    }
}

function scheduleResetTimer() {
    // 기존 타이머 정리
    if (resetTimerInterval) {
        clearInterval(resetTimerInterval);
        resetTimerInterval = null;
    }

    // 타이머 재시작
    initializeResetSystem();
}

// 초기화 시스템 초기화 함수
function initializeResetSystem() {
    // Catch-up 실행
    const now = new Date();
    const nowMins = now.getHours() * 60 + now.getMinutes();

    // 전역 catch-up (resetEnabled인 경우만)
    if (state.settings.resetEnabled) {
        const repeat = state.settings.resetRepeat;
        const [h, m] = (state.settings.resetTime || '00:00').split(':').map(Number);

        if (repeat && (repeat.startsWith('every') || repeat === 'calendar')) {
            doGlobalReset(now, h, m);
        } else if (nowMins >= h * 60 + m) {
            doGlobalReset(now, h, m);
        }
    }

    // 개별 항목 catch-up (항상 실행)
    const uniqueTimes = [...new Set(
        state.todos.filter(t => t.itemResetTime).map(t => t.itemResetTime)
    )];
    uniqueTimes.forEach(timeStr => {
        const [th, tm] = timeStr.split(':').map(Number);
        if (nowMins >= th * 60 + tm) doItemResets(now, th, tm);
    });

    doItemDatetimeResets(now);
    doItemScheduleResets(now, true);

    // 타이머 시작
    resetTimerInterval = setInterval(() => {
        const now = new Date();
        const hh = now.getHours();
        const mm = now.getMinutes();

        // 전역 초기화 (resetEnabled인 경우만)
        if (state.settings.resetEnabled) {
            const [h, m] = (state.settings.resetTime || '00:00').split(':').map(Number);
            const repeat = state.settings.resetRepeat;
            if (repeat === 'calendar') {
                const cd = state.settings.resetCalendarDate;
                if (cd) {
                    const calDate = new Date(cd);
                    if (hh === calDate.getHours() && mm === calDate.getMinutes()) {
                        doGlobalReset(now, h, m);
                    }
                }
            } else if (hh === h && mm === m) {
                doGlobalReset(now, h, m);
            }
        }

        // 개별 초기화 (항상 실행)
        doItemResets(now, hh, mm);
        doItemDatetimeResets(now);
        doItemScheduleResets(now, false);
    }, 1000);
}

/* ===================================================
   Category Management
=================================================== */
function saveCategories() {
    saveToStorage(STORAGE_KEYS.CATEGORIES, state.categories);
    saveToStorage(STORAGE_KEYS.CURRENT_CATEGORY, state.currentCategoryId);
    // Firebase 동기화
    if (window.FirebaseSync?.isReady()) {
        window.FirebaseSync.push({
            todos: state.todos,
            categories: state.categories,
            settings: (() => {
                const { bgImage, bgFileName, ...rest } = state.settings;
                return rest;
            })(),
        });
    }
}

/* ===================================================
   UI Toggle
=================================================== */
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
    setTimeout(() => {
        btn.classList.remove('spinning');
        logResetStatus(); // 디버깅: 새로고침 시 초기화 상태 출력
    }, 1000);
}

function applyRemoteData(cloudData) {
    console.log('[applyRemoteData] 호출됨 - remoteSyncInProgress:', remoteSyncInProgress);

    if (remoteSyncInProgress) {
        console.log('[applyRemoteData] 로컬 작업 진행 중 - 원격 데이터 무시');
        return;
    }

    remoteSyncInProgress = true;
    try {
        let changed = false;

        if (cloudData.todos &&
            JSON.stringify(cloudData.todos) !== JSON.stringify(state.todos)) {
            console.log('[applyRemoteData] todos 데이터 불일치 - 원격 데이터로 업데이트');
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
                openConfirmCategoryModal(cat.id, cat.name);
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

function autoSizeInput(input) {
    const measure = () => {
        const sizer = document.createElement('span');
        sizer.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none;font-size:12px;font-weight:500;font-family:inherit;white-space:pre';
        sizer.textContent = input.value || input.placeholder || '';
        document.body.appendChild(sizer);
        input.style.width = Math.max(24, sizer.offsetWidth + 4) + 'px';
        sizer.remove();
    };
    measure();
    input.addEventListener('input', measure);
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
    autoSizeInput(input);

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
    autoSizeInput(input);

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
    console.log('[bindEvents] Task 모달 버튼 확인:', {
        modalClose: !!DOM.modalClose,
        modalCancel: !!DOM.modalCancel,
        modalSave: !!DOM.modalSave,
        taskInput: !!DOM.taskInput
    });

    if (!DOM.modalSave) {
        console.error('[bindEvents] ERROR: modalSave 버튼을 찾을 수 없습니다!');
    }

    DOM.modalClose?.addEventListener('click', () => closeModal(DOM.taskModal));
    DOM.modalCancel?.addEventListener('click', () => closeModal(DOM.taskModal));
    DOM.modalSave?.addEventListener('click', handleModalSave);
    DOM.taskInput?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleModalSave();
        }
    });
    DOM.taskResetType.addEventListener('change', () => {
        updateTaskResetTypeUI(DOM.taskResetType.value);
    });
    DOM.addYearlyDateBtn.addEventListener('click', () => addYearlyDateEntry());

    // 요일 토글 버튼 클릭 이벤트
    document.querySelectorAll('.weekday-btn').forEach(btn => {
        btn.addEventListener('click', () => btn.classList.toggle('active'));
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

    // Test notification button (developer tool)
    // if (DOM.testNotificationBtn) {
    //     DOM.testNotificationBtn.addEventListener('click', async () => {
    //         if (window.electronAPI) {
    //             try {
    //                 await window.electronAPI.showNotification(
    //                     '🔔 테스트 알림',
    //                     '시스템 알림이 정상적으로 작동하고 있습니다!'
    //                 );
    //                 showToast('테스트 알림을 전송했습니다', 'success');
    //             } catch (err) {
    //                 showToast('알림 전송 실패: ' + err.message, 'error');
    //             }
    //         } else {
    //             showToast('Electron 환경이 아닙니다', 'error');
    //         }
    //     });
    // }

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
   Debug Logging
=================================================== */
function parseResetKeyToDate(resetKey) {
    if (!resetKey) return null;

    // ISO datetime 형식 (2026-03-17T14:00:00)
    if (resetKey.includes('T')) {
        const date = new Date(resetKey);
        return date;
    }

    // Weekly 형식 (2026-W11-9-0)
    if (resetKey.includes('W')) {
        return null; // 주차 형식은 정확한 날짜 복원 어려움
    }

    // 일반 형식 (2026-2-17-9-0: year-month-date-hour-minute)
    const parts = resetKey.split('-');
    if (parts.length >= 5) {
        const year = parseInt(parts[0]);
        const month = parseInt(parts[1]);
        const day = parseInt(parts[2]);
        const hour = parseInt(parts[3]);
        const minute = parseInt(parts[4]);
        return new Date(year, month, day, hour, minute, 0);
    }

    return null;
}

function formatResetTime(resetKey) {
    if (!resetKey) return 'None';

    const date = parseResetKeyToDate(resetKey);
    if (!date || isNaN(date.getTime())) {
        return resetKey; // 파싱 실패 시 원본 표시
    }

    const pad = (n) => String(n).padStart(2, '0');
    const year = date.getFullYear();
    const month = pad(date.getMonth() + 1);
    const day = pad(date.getDate());
    const hour = pad(date.getHours());
    const minute = pad(date.getMinutes());
    const second = pad(date.getSeconds());

    return `${year}/${month}/${day} ${hour}:${minute}:${second}`;
}

function logResetStatus() {
    console.log('=== 체크리스트 초기화 상태 ===');

    // 전역 초기화 상태
    const globalResetKey = localStorage.getItem(LAST_RESET_KEY);
    console.log(`전역 초기화: ${formatResetTime(globalResetKey)}`);

    console.log('\n항목별 초기화:');
    state.todos.forEach((todo, index) => {
        const itemKey = `todoApp_itemLastReset_${todo.id}`;
        const lastReset = localStorage.getItem(itemKey);
        const resetType = todo.itemResetDatetime ? 'datetime'
            : todo.itemResetSchedule ? 'schedule'
                : todo.itemResetTime ? 'time'
                    : 'global';

        console.log(`  [${index + 1}] "${todo.text}" (${resetType}): ${formatResetTime(lastReset)}`);
    });

    console.log('=============================\n');
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

    // 디버깅: 초기화 상태 출력
    logResetStatus();
}

document.addEventListener('DOMContentLoaded', init);
