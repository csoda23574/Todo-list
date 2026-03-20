/**
 * events.js — DOM 이벤트 바인딩 (이벤트 위임 패턴 활용)
 *
 * SOLID: 이벤트 바인딩만 담당 (Single Responsibility)
 * 도메인 액션은 각 모듈의 함수를 호출합니다.
 *
 * --- 이벤트 위임 대상 ---
 * #todoList           → 체크박스, 수정 버튼, 삭제 버튼
 * #categoryTabsBar    → 탭 클릭, 탭 삭제, 탭 추가(+)
 */

import { state } from './state.js';
import { DOM } from './dom.js';
import { showToast } from './utils.js';
import { toggleTodo } from './todos.js';

/* ────────────────────── 파일 매직 바이트 검증 ────────────────────── */

// 실제 파일 매직 바이트를 확인하여 확장자 위조 방지
async function validateImageMagicBytes(file) {
    try {
        const buffer = await file.slice(0, 12).arrayBuffer();
        const b = new Uint8Array(buffer);
        // JPEG: FF D8 FF
        if (b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return true;
        // PNG: 89 50 4E 47 0D 0A 1A 0A
        if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47) return true;
        // GIF: 47 49 46 38
        if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return true;
        // WebP: 52 49 46 46 ... 57 45 42 50
        if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46
            && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return true;
        return false;
    } catch {
        return false;
    }
}
import {
    openAddModal, openEditModal, openConfirmModal, openConfirmCategoryModal,
    openClearAllModal, handleConfirmDelete, handleModalSave,
    openSettingsModal, saveSettingsFromModal,
    tempSettings, applyCropResult, closeModal
} from './modals.js';
import { switchCategory, startCategoryAdd, startCategoryRename } from './categories.js';
import { updateTaskResetTypeUI, addYearlyDateEntry, updateResetNextInfo } from './reset.js';
import { openCropModal, initCropModal } from './crop.js';
import { manualRefresh } from './sync.js';
import { toggleTheme, setFilter, toggleUI, updateWinMaximizeBtn } from './ui.js';
import { updateBgPreview } from './renderer.js';

/* ──────────────────── 할 일 목록 이벤트 위임 ───────────────────────────── */

function bindTodoListEvents() {
    if (!DOM.todoList) return;
    DOM.todoList.addEventListener('change', e => {
        const checkbox = e.target.closest('.todo-checkbox');
        if (!checkbox) return;
        const id = checkbox.closest('[data-id]')?.dataset.id;
        if (id) toggleTodo(id, checkbox.checked);
    });

    DOM.todoList.addEventListener('click', e => {
        const editBtn = e.target.closest('.edit-btn');
        const deleteBtn = e.target.closest('.delete-btn');
        if (editBtn) {
            const id = editBtn.closest('[data-id]')?.dataset.id;
            if (id) openEditModal(id);
        } else if (deleteBtn) {
            const id = deleteBtn.closest('[data-id]')?.dataset.id;
            if (id) openConfirmModal(id);
        }
    });
}

/* ─────────────────── 카테고리 탭 이벤트 위임 ───────────────────────────── */

function bindCategoryTabsEvents() {
    const bar = document.getElementById('categoryTabsBar');
    if (!bar) return;

    bar.addEventListener('click', e => {
        if (e.target.closest('.category-tab-add')) {
            const addBtn = e.target.closest('.category-tab-add');
            startCategoryAdd(bar, addBtn);
            return;
        }

        const delBtn = e.target.closest('[data-delete-category-id]');
        if (delBtn) {
            e.stopPropagation();
            openConfirmCategoryModal(
                delBtn.dataset.deleteCategoryId,
                delBtn.dataset.deleteCategoryName
            );
            return;
        }

        const tab = e.target.closest('.category-tab');
        if (!tab?.dataset.id) return;
        const id = tab.dataset.id;

        if (state.currentCategoryId === id) {
            const cat = state.categories.find(c => c.id === id);
            startCategoryRename(tab, id, cat?.name ?? '');
        } else {
            switchCategory(id);
        }
    });
}

/* ──────────────────────── 할 일 추가/수정 모달 ─────────────────────────── */

function bindTaskModalEvents() {
    DOM.modalClose?.addEventListener('click', () => closeModal(DOM.taskModal));
    DOM.modalCancel?.addEventListener('click', () => closeModal(DOM.taskModal));
    DOM.modalSave?.addEventListener('click', handleModalSave);
    DOM.taskInput?.addEventListener('keydown', e => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleModalSave(); }
    });

    DOM.taskResetType?.addEventListener('change', () => {
        updateTaskResetTypeUI(DOM.taskResetType.value);
    });
    DOM.addYearlyDateBtn?.addEventListener('click', () => addYearlyDateEntry());

    document.querySelectorAll('.weekday-btn').forEach(btn => {
        btn.addEventListener('click', () => btn.classList.toggle('active'));
    });

    DOM.prioritySelector?.addEventListener('click', e => {
        const btn = e.target.closest('.priority-btn');
        if (!btn) return;
        DOM.prioritySelector.querySelectorAll('.priority-btn')
            .forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
    });
}

/* ──────────────────────── 설정 모달 이벤트 ─────────────────────────────── */

function bindSettingsModalEvents() {
    DOM.settingsClose?.addEventListener('click', () => closeModal(DOM.settingsModal));
    DOM.settingsCancelBtn?.addEventListener('click', () => closeModal(DOM.settingsModal));
    DOM.settingsSaveBtn?.addEventListener('click', saveSettingsFromModal);

    DOM.clearAllBtn?.addEventListener('click', () => {
        closeModal(DOM.settingsModal);
        setTimeout(() => openClearAllModal(), 200);
    });

    // tempSettings와 DOM 동기화 (live binding으로 실시간 객체 참조)
    DOM.resetEnabled?.addEventListener('change', () => {
        tempSettings.resetEnabled = DOM.resetEnabled.checked;
        DOM.resetSubGroup?.classList.toggle('hidden', !DOM.resetEnabled.checked);
        updateResetNextInfo();
    });
    DOM.resetTime?.addEventListener('change', () => {
        tempSettings.resetTime = DOM.resetTime.value;
        updateResetNextInfo();
    });
    DOM.resetRepeat?.addEventListener('change', () => {
        tempSettings.resetRepeat = DOM.resetRepeat.value;
        updateResetNextInfo();
    });

    // 배경 이미지 파일 선택 → 크롭 모달 열기
    DOM.bgFileInput?.addEventListener('change', async e => {
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
        // 실제 파일 매직 바이트 검증 (확장자 위조 방지)
        if (!await validateImageMagicBytes(file)) {
            showToast('유효하지 않은 이미지 파일입니다', 'error');
            e.target.value = '';
            return;
        }

        const reader = new FileReader();
        reader.onload = evt => openCropModal(evt.target.result, file.name, applyCropResult);
        reader.readAsDataURL(file);
        e.target.value = '';
    });

    DOM.bgRemoveBtn?.addEventListener('click', () => {
        applyCropResult(null, '');
        updateBgPreview(null, '');
    });

    DOM.bgOpacity?.addEventListener('input', () => {
        tempSettings.bgOpacity = parseInt(DOM.bgOpacity.value, 10);
        if (DOM.bgOpacityValue) DOM.bgOpacityValue.textContent = `${tempSettings.bgOpacity}%`;
    });

    DOM.bgBlur?.addEventListener('input', () => {
        tempSettings.bgBlur = parseInt(DOM.bgBlur.value, 10);
        if (DOM.bgBlurValue) DOM.bgBlurValue.textContent = `${tempSettings.bgBlur}px`;
    });
}

/* ──────────────────────── 확인 모달 이벤트 ─────────────────────────────── */

function bindConfirmModalEvents() {
    DOM.confirmCancel?.addEventListener('click', () => closeModal(DOM.confirmModal));
    DOM.confirmDelete?.addEventListener('click', handleConfirmDelete);
}

/* ──────────────────────── 필터 탭 이벤트 ───────────────────────────────── */

function bindFilterEvents() {
    DOM.filterTabs.forEach(tab => {
        tab.addEventListener('click', () => setFilter(tab.dataset.filter));
    });
}

/* ──────────────────────── 인증 이벤트 ─────────────────────────────────── */

function bindAuthEvents() {
    DOM.googleLoginBtn?.addEventListener('click', async () => {
        try {
            await window.FirebaseSync?.signInWithGoogle();
        } catch (err) {
            showToast('로그인에 실패했습니다: ' + String(err?.message ?? '알 수 없는 오류'), 'error');
        }
    });
    DOM.userAvatarBtn?.addEventListener('click', openSettingsModal);
    DOM.logoutBtn?.addEventListener('click', async () => {
        await window.FirebaseSync?.signOut();
        closeModal(DOM.settingsModal);
    });
}

/* ──────────────────────── 전체 이벤트 바인딩 ───────────────────────────── */

export function bindEvents() {
    DOM.themeToggle?.addEventListener('click', toggleTheme);
    DOM.addBtn?.addEventListener('click', openAddModal);
    DOM.settingsBtn?.addEventListener('click', openSettingsModal);
    DOM.refreshBtn?.addEventListener('click', manualRefresh);
    DOM.uiToggleBtn?.addEventListener('click', toggleUI);

    bindTodoListEvents();
    bindCategoryTabsEvents();
    bindTaskModalEvents();
    bindSettingsModalEvents();
    bindConfirmModalEvents();
    bindFilterEvents();
    bindAuthEvents();
    initCropModal();
}

/* ──────────────────── Electron 창 버튼 이벤트 ──────────────────────────── */

export function bindElectronEvents() {
    if (!window.electronAPI) return;
    document.body.classList.add('electron-mode');

    document.getElementById('winMinimize')?.addEventListener('click', () => window.electronAPI.minimize());
    document.getElementById('winMaximize')?.addEventListener('click', () => window.electronAPI.maximize());
    document.getElementById('winClose')?.addEventListener('click', () => window.electronAPI.close());

    window.electronAPI.onMaximizeChange(updateWinMaximizeBtn);
    window.electronAPI.isMaximized().then(updateWinMaximizeBtn).catch(() => { });
}
