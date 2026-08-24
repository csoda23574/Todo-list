/**
 * modals.js — 모달 UI 로직
 *
 * 할 일 추가/수정 모달, 확인 모달, 설정 모달을 담당합니다.
 * 이미지 크롭 모달은 crop.js를 참조하세요.
 */

import { state } from './state.js';
import { DOM } from './dom.js';
import { showToast } from './utils.js';
import { loadFromStorage, saveSettings } from './storage.js';
import { STORAGE_KEYS, getStorageKey } from './config.js';
import { loadFromIDB } from './idb.js';
import { updateBgPreview } from './renderer.js';
import { emit } from './bus.js'; // renderer·reset 직접 의존 제거 — DIP
import { updateResetNextInfo, initMonthDayGrid, addYearlyDateEntry, getYearlyDatesFromDOM, updateTaskResetTypeUI, applyResets } from './reset.js';
import { settingsToRecurrence, calcNextDueAfter } from './recurrence.js';
import { addTodo, editTodo, deleteTodo, clearAllTodos } from './todos.js';
import { generateId } from './utils.js';
import { deleteCategory } from './categories.js';
import { openModal, closeModal } from './modal-base.js';

// 공개 re-export (events.js 등에서 import)
export { openModal, closeModal };

/* ────────────────── 할 일 모달 — 우선순위 선택 ─────────────────────────── */

export function getSelectedPriority() {
    const btn = DOM.prioritySelector?.querySelector('.priority-btn.active');
    return btn?.dataset.priority ?? 'medium';
}

export function setSelectedPriority(priority) {
    DOM.prioritySelector?.querySelectorAll('.priority-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.priority === priority);
    });
}

/* ─────────────────────── 할 일 폼 초기화 헬퍼 ──────────────────────────── */

function clearTaskForm() {
    DOM.taskInput.value = '';
    DOM.taskNote.value = '';
    DOM.taskResetTime.value = '';
    DOM.taskResetWeeklyTime.value = '';
    DOM.taskResetMonthlyTime.value = '';
    DOM.taskResetYearlyTime.value = '';
    document.querySelectorAll('.weekday-btn').forEach(b => b.classList.remove('active'));
    DOM.monthDayGrid?.querySelectorAll('.day-number-btn').forEach(b => b.classList.remove('active'));
    DOM.yearlyDateList.innerHTML = '';
    // 체크리스트 초기화
    const formList = document.getElementById('checklistFormList');
    if (formList) formList.innerHTML = '';
}

/* ──────────────────────── 할 일 추가 모달 ───────────────────────────────── */

export function openAddModal() {
    state.editingId = null;
    DOM.modalTitle.textContent = '새 할 일 추가';
    clearTaskForm();
    setSelectedPriority('medium');
    updateTaskResetTypeUI('none');
    openModal(DOM.taskModal);
    setTimeout(() => DOM.taskInput.focus(), 50);
}

/* ──────────────────────── 할 일 수정 모달 ───────────────────────────────── */

export function openEditModal(id) {
    const todo = state.todos.find(t => t.id === id);
    if (!todo) return;

    state.editingId = id;
    DOM.modalTitle.textContent = '할 일 수정';
    setSelectedPriority(todo.priority || 'medium');
    clearTaskForm();
    DOM.taskInput.value = todo.text;
    DOM.taskNote.value = todo.note || '';

    _populateResetFields(todo);
    _populateChecklist(todo.checklist || []);
    openModal(DOM.taskModal);
    setTimeout(() => DOM.taskInput.focus(), 50);
}

/** 할 일의 초기화 설정을 폼에 채웁니다. */
function _populateResetFields(todo) {
    const r = todo.recurrence;
    if (!r) {
        updateTaskResetTypeUI('none');
        return;
    }
    if (r.type === 'daily' || r.type === 'weekday') {
        DOM.taskResetTime.value = r.time || '';
        updateTaskResetTypeUI(r.type);
    } else if (r.type === 'weekly') {
        updateTaskResetTypeUI('weekly');
        DOM.taskResetWeeklyTime.value = r.time || '';
        document.querySelectorAll('.weekday-btn').forEach(b => {
            b.classList.toggle('active', (r.weekdays || []).includes(parseInt(b.dataset.day, 10)));
        });
    } else if (r.type === 'monthly') {
        initMonthDayGrid();
        DOM.taskResetMonthlyTime.value = r.time || '';
        DOM.monthDayGrid.querySelectorAll('.day-number-btn').forEach(b => {
            b.classList.toggle('active', (r.days || []).includes(parseInt(b.dataset.day, 10)));
        });
        updateTaskResetTypeUI('monthly');
    } else if (r.type === 'yearly') {
        DOM.taskResetYearlyTime.value = r.time || '';
        (r.dates || []).forEach(d => addYearlyDateEntry(d.month, d.day));
        updateTaskResetTypeUI('yearly');
    } else if (r.type === 'everyN') {
        const elDays = document.getElementById('taskResetEveryNDays');
        const elDate = document.getElementById('taskResetEveryNDate');
        const elTime = document.getElementById('taskResetEveryNTime');
        
        if (elDays) elDays.value = r.n || 2;
        if (elTime) elTime.value = r.time || state.settings.resetTime || '00:00';
        
        const todayStr = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD
        if (elDate) {
            elDate.value = r.startDate 
                ? new Date(r.startDate).toLocaleDateString('en-CA') 
                : todayStr;
        }
        
        updateTaskResetTypeUI('everyN');
    } else if (r.type === 'everyNWeeks') {
        const elWeeks = document.getElementById('taskResetEveryNWeeksInput');
        const elDate = document.getElementById('taskResetEveryNWeeksDate');
        const elTime = document.getElementById('taskResetEveryNWeeksTime');
        
        if (elWeeks) elWeeks.value = r.n || 2;
        if (elTime) elTime.value = r.time || state.settings.resetTime || '00:00';
        
        const todayStr = new Date().toLocaleDateString('en-CA');
        if (elDate) {
            elDate.value = r.startDate 
                ? new Date(r.startDate).toLocaleDateString('en-CA') 
                : todayStr;
        }
        const weekday = r.weekday ?? null;
        document.querySelectorAll('#taskResetEveryNWeekdaySelector .weekday-btn').forEach(b => {
            b.classList.toggle('active', Number(b.dataset.day) === weekday);
        });
        updateTaskResetTypeUI('everyNWeeks');
    } else if (r.type === 'neverReset') {
        updateTaskResetTypeUI('neverReset');
    } else {
        updateTaskResetTypeUI('none');
    }
}

/* ────────────────────── 할 일 모달 저장 ────────────────────────────────── */

export function handleModalSave() {
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
    const resetType = DOM.taskResetType.value;
    const recurrence = _buildRecurrenceFromForm(resetType);
    const checklist = _getChecklistFromForm();

    if (state.editingId) {
        editTodo(state.editingId, text, note, priority, recurrence, checklist);
    } else {
        addTodo(text, note, priority, recurrence, checklist);
    }
    closeModal(DOM.taskModal);
    state.editingId = null;
}

function _buildRecurrenceFromForm(resetType) {
    if (resetType === 'neverReset') {
        return { type: 'neverReset' };
    }
    if (resetType === 'daily' || resetType === 'weekday') {
        return { type: resetType, time: DOM.taskResetTime.value || '00:00' };
    }
    if (resetType === 'weekly') {
        const weekdays = Array.from(document.querySelectorAll('.weekday-btn.active'))
            .map(b => parseInt(b.dataset.day, 10));
        return { type: 'weekly', weekdays, time: DOM.taskResetWeeklyTime.value || '00:00' };
    }
    if (resetType === 'monthly') {
        const days = Array.from(DOM.monthDayGrid.querySelectorAll('.day-number-btn.active'))
            .map(b => parseInt(b.dataset.day, 10));
        return { type: 'monthly', days, time: DOM.taskResetMonthlyTime.value || '00:00' };
    }
    if (resetType === 'yearly') {
        const dates = getYearlyDatesFromDOM();
        return { type: 'yearly', dates, time: DOM.taskResetYearlyTime.value || '00:00' };
    }
    if (resetType === 'everyN') {
        const n = parseInt(document.getElementById('taskResetEveryNDays')?.value, 10) || 2;
        const time = document.getElementById('taskResetEveryNTime')?.value || '00:00';
        const dateVal = document.getElementById('taskResetEveryNDate')?.value;
        const startDate = dateVal ? `${dateVal}T${time}:00` : null;
        return { type: 'everyN', n, time, startDate };
    }
    if (resetType === 'everyNWeeks') {
        const n = parseInt(document.getElementById('taskResetEveryNWeeksInput')?.value, 10) || 2;
        const time = document.getElementById('taskResetEveryNWeeksTime')?.value || '00:00';
        const dateVal = document.getElementById('taskResetEveryNWeeksDate')?.value;
        const startDate = dateVal ? `${dateVal}T${time}:00` : null;
        const activeBtn = document.querySelector('#taskResetEveryNWeekdaySelector .weekday-btn.active');
        const weekday = activeBtn ? parseInt(activeBtn.dataset.day, 10) : null;
        return { type: 'everyNWeeks', n, weekday, time, startDate };
    }
    return null;
}

/* ────────────────── 체크리스트 폼 헬퍼 ────────────────────────────────── */

/**
 * 체크리스트 항목 행을 폼 목록에 추가합니다.
 * @param {string} [text=''] - 초기 텍스트
 * @param {boolean} [done=false] - 초기 완료 상태
 * @param {string} [id] - 기존 항목 id (없으면 신규 생성)
 */
export function addChecklistFormItem(text = '', done = false, id = null) {
    const list = document.getElementById('checklistFormList');
    if (!list) return;
    const itemId = id || generateId();
    const row = document.createElement('div');
    row.className = 'checklist-form-item';
    row.dataset.id = itemId;
    row.innerHTML = `
        <span class="checklist-drag-handle" title="드래그로 순서 변경">⠿</span>
        <input type="checkbox" class="checklist-form-check" ${done ? 'checked' : ''} title="완료 표시" />
        <input type="text" class="checklist-form-input form-input" placeholder="항목 입력..." value="${text.replace(/"/g, '&quot;')}" maxlength="200" />
        <button type="button" class="checklist-form-remove" title="삭제">×</button>
    `;
    list.appendChild(row);
    // 바로 텍스트 입력란 포커스
    row.querySelector('.checklist-form-input')?.focus();
}

function _populateChecklist(checklist) {
    const list = document.getElementById('checklistFormList');
    if (!list) return;
    list.innerHTML = '';
    checklist.forEach(item => addChecklistFormItem(item.text, item.done, item.id));
}

function _getChecklistFromForm() {
    const rows = document.querySelectorAll('#checklistFormList .checklist-form-item');
    const items = [];
    rows.forEach(row => {
        const text = row.querySelector('.checklist-form-input')?.value.trim();
        if (!text) return; // 빈 항목 무시
        items.push({
            id: row.dataset.id,
            text,
            done: row.querySelector('.checklist-form-check')?.checked ?? false,
        });
    });
    return items;
}

/* ──────────────────── 확인 모달 (범용) ─────────────────────────────────── */

let _pendingConfirmAction = null;

function _openConfirmModalWith(title, subText, action) {
    _pendingConfirmAction = action;
    const titleEl = DOM.confirmModal?.querySelector('.confirm-title');
    const subEl = DOM.confirmModal?.querySelector('.confirm-sub');
    if (titleEl) titleEl.textContent = title;
    if (subEl) subEl.textContent = subText;
    openModal(DOM.confirmModal);
}

export function openConfirmModal(id) {
    state.deleteTargetId = id;
    _openConfirmModalWith(
        '항목을 삭제하시겠습니까?',
        '이 작업은 되돌릴 수 없습니다.',
        () => deleteTodo(id)
    );
}

export function openConfirmCategoryModal(id, name) {
    _openConfirmModalWith(
        `'${name}' 탭을 삭제하시겠습니까?`,
        '탭 안의 모든 할 일도 함께 삭제됩니다.',
        () => deleteCategory(id)
    );
}

export function openClearAllModal() {
    state.deleteTargetId = null;
    _openConfirmModalWith(
        '모든 할 일을 삭제하시겠습니까?',
        '모든 항목이 영구적으로 삭제됩니다.',
        () => clearAllTodos()
    );
}

export function handleConfirmDelete() {
    _pendingConfirmAction?.();
    _pendingConfirmAction = null;
    state.deleteTargetId = null;
    closeModal(DOM.confirmModal);
}

/* ────────────────────── 설정 모달 임시 상태 ────────────────────────────── */

export let tempSettings = {};
export let tempBgImage = null;
export let tempBgImageChanged = false;

/** crop.js에서 크롭 결과를 반영할 때 사용하는 세터 */
export function applyCropResult(cropped, fileName) {
    tempBgImage = cropped;
    tempSettings.bgFileName = fileName;
    tempBgImageChanged = true;
    updateBgPreview(cropped, fileName);
}

/* ──────────────────────── 설정 모달 열기 ───────────────────────────────── */

export async function openSettingsModal() {
    // 최신 설정을 로컬스토리지에서 재로드
    const saved = loadFromStorage(STORAGE_KEYS.SETTINGS, {});
    state.settings = { ...state.settings, ...saved };

    // Check IDB for background image, fallback to localStorage if migrating
    const idbKey = getStorageKey(state.uid, STORAGE_KEYS.BG_IMAGE);
    let bgImage = await loadFromIDB(idbKey);
    if (!bgImage) {
        bgImage = loadFromStorage(STORAGE_KEYS.BG_IMAGE, null);
    }
    state.settings.bgImage = bgImage;

    tempSettings = { ...state.settings };
    tempBgImage = state.settings.bgImage;
    tempBgImageChanged = false;

    _populateSettingsForm();
    openModal(DOM.settingsModal);

    // 프리셋 목록 비동기 로드 (모달이 열린 뒤 백그라운드)
    import('./presets.js').then(m => m.renderPresetList());

    // 프리셋 생성 패널 초기화 (숨김)
    const panel = document.getElementById('presetCreatePanel');
    const toggleBtn = document.getElementById('presetCreateToggleBtn');
    if (panel) panel.style.display = 'none';
    if (toggleBtn) toggleBtn.style.display = '';
}

function _updateElectronSettingsSection() {
    const electronSection = document.getElementById('electronSettingsSection');
    if (!electronSection || !window.electronAPI) return;

    electronSection.style.display = '';

    window.electronAPI.getPlatform().then(platform => {
        const osName = platform === 'linux' ? 'Linux'
            : platform === 'darwin' ? 'macOS'
                : 'Windows';

        const titleEl = document.getElementById('electronSettingsTitle');
        const subEl = document.getElementById('autoLaunchSubLabel');
        if (titleEl) titleEl.textContent = `${osName} 앛 설정`;
        if (subEl) subEl.textContent = `${osName} 로그인 시 자동으로 앱을 시작합니다`;
    }).catch(() => { });

    window.electronAPI.getAppSettings().then(s => {
        const autoEl = document.getElementById('autoLaunchEnabled');
        const topEl = document.getElementById('alwaysOnTopEnabled');
        if (autoEl) autoEl.checked = s.autoLaunch;
        if (topEl) topEl.checked = s.alwaysOnTop;
    }).catch(() => { });
}

function _populateSettingsForm() {
    DOM.resetEnabled.checked = tempSettings.resetEnabled;
    DOM.resetTime.value = tempSettings.resetTime || '00:00';
    DOM.resetRepeat.value = tempSettings.resetRepeat || 'daily';

    DOM.bgOpacity.value = tempSettings.bgOpacity;
    DOM.bgOpacityValue.textContent = `${tempSettings.bgOpacity}%`;

    DOM.bgBlur.value = tempSettings.bgBlur;
    DOM.bgBlurValue.textContent = `${tempSettings.bgBlur}px`;

    DOM.resetSubGroup.classList.toggle('hidden', !tempSettings.resetEnabled);

    // N일마다 / N주마다 조건부 UI 토글 + 값 복원
    const repeat = tempSettings.resetRepeat || 'daily';
    document.getElementById('resetEveryNRow')?.classList.toggle('hidden', repeat !== 'everyN');
    document.getElementById('resetEveryNWeeksRow')?.classList.toggle('hidden', repeat !== 'everyNWeeks');

    if (repeat === 'everyN') {
        const el = document.getElementById('resetEveryNDays');
        if (el) el.value = tempSettings.resetEveryNDays || 2;
    }
    if (repeat === 'everyNWeeks') {
        const el = document.getElementById('resetEveryNWeeksInput');
        if (el) el.value = tempSettings.resetEveryNWeeks || 2;
        const weekday = tempSettings.resetEveryNWeekday ?? null;
        document.querySelectorAll('#resetEveryNWeekdaySelector .weekday-btn').forEach(btn => {
            btn.classList.toggle('active', Number(btn.dataset.day) === weekday);
        });
    }

    if (DOM.appTitleInput) {
        DOM.appTitleInput.value = tempSettings.appTitle || 'My Tasks';
    }

    const showNextResetTimeEl = document.getElementById('showNextResetTime');
    if (showNextResetTimeEl) {
        showNextResetTimeEl.checked = tempSettings.showNextResetTime !== false;
    }

    updateResetNextInfo();
    updateBgPreview(tempBgImage, tempSettings.bgFileName);
    _updateElectronSettingsSection();

    // 팔레트 복원
    const color = tempSettings.uiBaseColor || '#3a6491';
    const picker = document.getElementById('uiBaseColorPicker');
    const hexInput = document.getElementById('uiBaseColorHex');
    if (picker) picker.value = color;
    if (hexInput) hexInput.value = color.replace('#', '');
    document.querySelectorAll('.palette-swatch').forEach(s => {
        s.classList.toggle('active', s.dataset.color === color);
    });
}

/* ─────────────────────── 설정 모달 저장 ────────────────────────────────── */

export async function saveSettingsFromModal() {
    const { bgImage: _ignored, ...restTemp } = tempSettings;
    state.settings = { ...state.settings, ...restTemp, bgImage: tempBgImage };

    if (DOM.appTitleInput) {
        state.settings.appTitle = DOM.appTitleInput.value.trim() || 'My Tasks';
    }

    const showNextResetTimeEl = document.getElementById('showNextResetTime');
    if (showNextResetTimeEl) {
        state.settings.showNextResetTime = showNextResetTimeEl.checked;
    }

    // nextGlobalResetAt을 null로 지우지 않고, 새 설정 기준으로 다음 미래 시점을 계산하여 업데이트.
    // null로 지우면 applyResets()에서 "최초 활성화" 케이스로 처리되어 즉시 초기화가 발동됨.
    // 대신 미래 시점을 직접 계산해 두면 applyResets()에서 아직 시간이 안 됐다고 판단해 초기화를 건너뜀.
    if (state.settings.resetEnabled) {
        const newRecurrence = settingsToRecurrence(state.settings);
        if (newRecurrence && newRecurrence.type !== 'calendar') {
            const now = new Date();
            const nextDate = calcNextDueAfter(newRecurrence, now, now);
            state.settings.nextGlobalResetAt = nextDate ? nextDate.toISOString() : null;
        } else if (newRecurrence?.type === 'calendar') {
            // calendar 타입은 기존 nextGlobalResetAt 유지 (1회성이므로 건드리지 않음)
        } else {
            state.settings.nextGlobalResetAt = null;
        }
    } else {
        // 자동 초기화 비활성화 시에는 null로
        state.settings.nextGlobalResetAt = null;
    }

    // 팔레트 저장
    const colorPicker = document.getElementById('uiBaseColorPicker');
    if (colorPicker) {
        state.settings.uiBaseColor = colorPicker.value;
    }

    saveSettings();
    emit('bg:changed');
    emit('palette:changed');
    emit('title:changed');
    applyResets(new Date());
    emit('todos:changed');

    if (window.electronAPI) {
        const autoEl = document.getElementById('autoLaunchEnabled');
        const topEl = document.getElementById('alwaysOnTopEnabled');
        try {
            if (autoEl) await window.electronAPI.setAutoLaunch(autoEl.checked);
            if (topEl) await window.electronAPI.setAlwaysOnTop(topEl.checked);
        } catch { /* IPC 오류는 치명적이지 않음 */ }
    }

    showToast('설정이 저장되었습니다', 'success');
    closeModal(DOM.settingsModal);
}
