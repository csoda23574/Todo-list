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
import { STORAGE_KEYS } from './config.js';
import { loadFromIDB } from './idb.js';
import { updateBgPreview } from './renderer.js';
import { emit } from './bus.js'; // renderer·reset 직접 의존 제거 — DIP
import { updateResetNextInfo, initMonthDayGrid, addYearlyDateEntry, getYearlyDatesFromDOM, updateTaskResetTypeUI } from './reset.js';
import { addTodo, editTodo, deleteTodo, clearAllTodos } from './todos.js';
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
    DOM.taskResetDatetime.value = '';
    DOM.taskResetWeeklyTime.value = '';
    DOM.taskResetMonthlyTime.value = '';
    DOM.taskResetYearlyTime.value = '';
    document.querySelectorAll('.weekday-btn').forEach(b => b.classList.remove('active'));
    DOM.monthDayGrid?.querySelectorAll('.day-number-btn').forEach(b => b.classList.remove('active'));
    DOM.yearlyDateList.innerHTML = '';
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
    openModal(DOM.taskModal);
    setTimeout(() => DOM.taskInput.focus(), 50);
}

/** 할 일의 초기화 설정을 폼에 채웁니다. */
function _populateResetFields(todo) {
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
    const itemResetTime = resetType === 'time' ? (DOM.taskResetTime.value || null) : null;
    const itemResetDatetime = resetType === 'datetime' ? (DOM.taskResetDatetime.value || null) : null;
    const itemResetSchedule = _buildScheduleFromForm(resetType);

    if (state.editingId) {
        editTodo(state.editingId, text, note, priority, itemResetTime, itemResetDatetime, itemResetSchedule);
    } else {
        addTodo(text, note, priority, itemResetTime, itemResetDatetime, itemResetSchedule);
    }
    closeModal(DOM.taskModal);
    state.editingId = null;
}

function _buildScheduleFromForm(resetType) {
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
    return null;
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
    let bgImage = await loadFromIDB(STORAGE_KEYS.BG_IMAGE);
    if (!bgImage) {
        bgImage = loadFromStorage(STORAGE_KEYS.BG_IMAGE, null);
    }
    state.settings.bgImage = bgImage;

    tempSettings = { ...state.settings };
    tempBgImage = state.settings.bgImage;
    tempBgImageChanged = false;

    _populateSettingsForm();
    openModal(DOM.settingsModal);
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
    
    if (DOM.appTitleInput) {
        DOM.appTitleInput.value = tempSettings.appTitle || 'My Tasks';
    }

    updateResetNextInfo();
    updateBgPreview(tempBgImage, tempSettings.bgFileName);
    _updateElectronSettingsSection();
}

/* ─────────────────────── 설정 모달 저장 ────────────────────────────────── */

export async function saveSettingsFromModal() {
    const { bgImage: _ignored, ...restTemp } = tempSettings;
    state.settings = { ...state.settings, ...restTemp, bgImage: tempBgImage };

    if (DOM.appTitleInput) {
        state.settings.appTitle = DOM.appTitleInput.value.trim() || 'My Tasks';
    }

    saveSettings();
    emit('bg:changed');
    emit('title:changed');
    emit('reset:reschedule');

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
