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
import { toggleTodo, reorderTodo, toggleChecklistItem } from './todos.js';
import { signInWithGoogle, signOut } from './firebase.js';

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
    tempSettings, applyCropResult, closeModal, addChecklistFormItem,
    tempBgScope, tempCatBgMeta, switchBgScope
} from './modals.js';
import { switchCategory, startCategoryAdd, startCategoryRename, wasCategoryDragged, initCategoryDragSort } from './categories.js';
import { updateTaskResetTypeUI, addYearlyDateEntry, updateResetNextInfo } from './reset.js';
import { openCropModal, initCropModal } from './crop.js';
import { toggleTheme, setFilter, toggleUI, updateWinMaximizeBtn } from './ui.js';
import { updateBgPreview, applyUiPalette } from './renderer.js';
import { createPreset, importPreset, renderPresetList } from './presets.js';

/* ──────────────────── 할 일 목록 이벤트 위임 ───────────────────────────── */

function bindTodoListEvents() {
    if (!DOM.todoList) return;
    DOM.todoList.addEventListener('change', e => {
        // 상위 할 일 체크박스
        const checkbox = e.target.closest('.todo-checkbox');
        if (checkbox) {
            const id = checkbox.closest('[data-id]')?.dataset.id;
            if (id) toggleTodo(id, checkbox.checked);
            return;
        }
        // 체크리스트 항목 체크박스
        const clCheck = e.target.closest('.checklist-item-check');
        if (clCheck) {
            const todoId = clCheck.closest('[data-id]')?.dataset.id;
            const checklistId = clCheck.closest('[data-checklist-id]')?.dataset.checklistId;
            if (todoId && checklistId) toggleChecklistItem(todoId, checklistId, clCheck.checked);
        }
    });

    DOM.todoList.addEventListener('click', e => {
        // 체크리스트 펼침/숨김
        const toggleBtn = e.target.closest('.checklist-toggle-btn');
        if (toggleBtn) {
            const li = toggleBtn.closest('.todo-item');
            const area = li?.querySelector('.checklist-area');
            if (!area) return;
            const expanded = area.classList.toggle('expanded');
            toggleBtn.setAttribute('aria-expanded', expanded);
            toggleBtn.querySelector('svg')?.classList.toggle('rotated', expanded);
            return;
        }
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

    initTodoDragSort();
}

/* ──────────────────── 할 일 목록 드래그 정렬 ───────────────────────────── */

function initTodoDragSort() {
    const list = DOM.todoList;
    if (!list || list._dragBound) return;
    list._dragBound = true;

    let dragSrcId = null;

    list.addEventListener('dragstart', e => {
        const item = e.target.closest('.todo-item');
        if (!item) return;
        // 드래그 핸들에서만 시작되도록 (핸들 또는 항목 자체 클릭 허용)
        dragSrcId = item.dataset.id;
        e.dataTransfer.effectAllowed = 'move';
        requestAnimationFrame(() => item.classList.add('dragging'));
    });

    list.addEventListener('dragend', () => {
        dragSrcId = null;
        list.querySelectorAll('.todo-item')
            .forEach(el => el.classList.remove('dragging', 'drag-over-above', 'drag-over-below'));
    });

    list.addEventListener('dragover', e => {
        const item = e.target.closest('.todo-item');
        if (!item || item.dataset.id === dragSrcId) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';

        // 마우스 Y 위치로 삽입 위치(위/아래) 결정
        const rect = item.getBoundingClientRect();
        const isAbove = e.clientY < rect.top + rect.height / 2;
        list.querySelectorAll('.todo-item')
            .forEach(el => el.classList.remove('drag-over-above', 'drag-over-below'));
        item.classList.add(isAbove ? 'drag-over-above' : 'drag-over-below');
    });

    list.addEventListener('dragleave', e => {
        if (!list.contains(e.relatedTarget)) {
            list.querySelectorAll('.todo-item')
                .forEach(el => el.classList.remove('drag-over-above', 'drag-over-below'));
        }
    });

    list.addEventListener('drop', e => {
        e.preventDefault();
        const item = e.target.closest('.todo-item');
        if (!item || !dragSrcId) return;
        const targetId = item.dataset.id;
        if (dragSrcId === targetId) return;

        const isAbove = item.classList.contains('drag-over-above');
        reorderTodo(dragSrcId, targetId, isAbove ? 'before' : 'after');
    });
}



function bindCategoryTabsEvents() {
    const bar = document.getElementById('categoryTabsBar');
    if (!bar) return;

    // 드래그 정렬: container에 1회만 바인딩 (DOM 재생성에 영향받지 않음)
    initCategoryDragSort();

    bar.addEventListener('click', e => {
        // 드래그 직후 발생하는 클릭은 무시 (drop → click 오발 방지)
        if (wasCategoryDragged()) return;

        // < / > 스크롤 네비 버튼
        const navBtn = e.target.closest('.category-tabs-nav');
        if (navBtn) {
            const scroll = bar.querySelector('.category-tabs-scroll');
            if (scroll) {
                const dir = navBtn.dataset.scrollDir === 'left' ? -1 : 1;
                scroll.scrollBy({ left: dir * 120, behavior: 'smooth' });
            }
            return;
        }

        if (e.target.closest('.category-tab-add')) {
            const scrollWrapper = bar.querySelector('.category-tabs-scroll');
            const addBtn = e.target.closest('.category-tab-add');
            startCategoryAdd(scrollWrapper ?? bar, addBtn);
            return;
        }

        if (e.target.closest('.category-tab-trash')) {
            const cat = state.categories.find(c => c.id === state.currentCategoryId);
            if (cat && cat.id !== 'default') {
                openConfirmCategoryModal(cat.id, cat.name);
            }
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

    // 체크리스트 항목 추가 버튼
    document.getElementById('addChecklistItemBtn')?.addEventListener('click', () => {
        addChecklistFormItem();
    });

    // 체크리스트 폼 항목 삭제 (이벤트 위임)
    document.getElementById('checklistFormList')?.addEventListener('click', e => {
        const removeBtn = e.target.closest('.checklist-form-remove');
        if (removeBtn) removeBtn.closest('.checklist-form-item')?.remove();
    });

    // 매주 요일 선택 (다중 선택 - 토글)
    document.getElementById('taskResetWeeklySelector')?.addEventListener('click', e => {
        const btn = e.target.closest('.weekday-btn');
        if (btn) btn.classList.toggle('active');
    });

    // N주마다 요일 선택 (단일 선택 - 라디오)
    document.getElementById('taskResetEveryNWeekdaySelector')?.addEventListener('click', e => {
        const btn = e.target.closest('.weekday-btn');
        if (!btn) return;
        document.querySelectorAll('#taskResetEveryNWeekdaySelector .weekday-btn')
            .forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
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

    DOM.bgScopeGlobal?.addEventListener('click', () => switchBgScope('global'));
    DOM.bgScopeCategory?.addEventListener('click', () => switchBgScope('category'));

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
        const val = DOM.resetRepeat.value;
        document.getElementById('resetEveryNRow')?.classList.toggle('hidden', val !== 'everyN');
        document.getElementById('resetEveryNWeeksRow')?.classList.toggle('hidden', val !== 'everyNWeeks');
        updateResetNextInfo();
    });

    // N일마다 숫자 입력
    document.getElementById('resetEveryNDays')?.addEventListener('input', () => {
        tempSettings.resetEveryNDays = parseInt(document.getElementById('resetEveryNDays').value, 10) || 2;
        updateResetNextInfo();
    });

    // N주마다 숫자 입력
    document.getElementById('resetEveryNWeeksInput')?.addEventListener('input', () => {
        tempSettings.resetEveryNWeeks = parseInt(document.getElementById('resetEveryNWeeksInput').value, 10) || 2;
        updateResetNextInfo();
    });

    // N주마다 요일 선택 버튼 (단일 선택)
    document.getElementById('resetEveryNWeekdaySelector')?.addEventListener('click', e => {
        const btn = e.target.closest('.weekday-btn');
        if (!btn) return;
        // 다른 버튼 해제 후 이 버튼만 활성화 (라디오 방식)
        document.querySelectorAll('#resetEveryNWeekdaySelector .weekday-btn')
            .forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        tempSettings.resetEveryNWeekday = Number(btn.dataset.day);
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
        if (file.size > 20 * 1024 * 1024) {
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
        reader.onload = evt => {
            // app-content 영역 크기 = 배경이 표시되는 실제 영역
            const appContent = document.querySelector('.app-content');
            const targetRatio = appContent
                ? appContent.clientWidth / appContent.clientHeight
                : null;
            openCropModal(evt.target.result, file.name, applyCropResult, targetRatio);
        };
        reader.readAsDataURL(file);
        e.target.value = '';
    });

    DOM.bgRemoveBtn?.addEventListener('click', () => {
        applyCropResult(null, '');
        updateBgPreview(null, '');
    });

    DOM.bgOpacity?.addEventListener('input', () => {
        const val = parseInt(DOM.bgOpacity.value, 10);
        if (tempBgScope === 'category') {
            tempCatBgMeta.bgOpacity = val;
        } else {
            tempSettings.bgOpacity = val;
        }
        if (DOM.bgOpacityValue) DOM.bgOpacityValue.textContent = `${val}%`;
    });

    DOM.bgBlur?.addEventListener('input', () => {
        const val = parseInt(DOM.bgBlur.value, 10);
        if (tempBgScope === 'category') {
            tempCatBgMeta.bgBlur = val;
        } else {
            tempSettings.bgBlur = val;
        }
        if (DOM.bgBlurValue) DOM.bgBlurValue.textContent = `${val}px`;
    });

    // 팔레트 — 프리셋 스와치 클릭
    document.getElementById('paletteSwatches')?.addEventListener('click', (e) => {
        const swatch = e.target.closest('.palette-swatch');
        if (!swatch) return;
        const color = swatch.dataset.color;
        _applyPaletteColor(color);
    });

    // 팔레트 — 커스텀 색상 피커
    document.getElementById('uiBaseColorPicker')?.addEventListener('input', (e) => {
        _applyPaletteColor(e.target.value);
    });

    // 팔레트 — hex 직접 입력 (6자리 완성 시 실시간 반영, blur 시 최종 적용)
    const hexInput = document.getElementById('uiBaseColorHex');
    if (hexInput) {
        hexInput.addEventListener('input', (e) => {
            // 허용 문자만 남기기 (0-9, a-f, A-F)
            e.target.value = e.target.value.replace(/[^0-9a-fA-F]/g, '');
            if (e.target.value.length === 6) {
                _applyPaletteColor('#' + e.target.value);
            }
        });
        hexInput.addEventListener('blur', (e) => {
            const val = e.target.value.trim();
            // 3자리 축약형 지원 (예: fff → ffffff)
            if (val.length === 3) {
                const expanded = val.split('').map(c => c + c).join('');
                _applyPaletteColor('#' + expanded);
            } else if (val.length === 6) {
                _applyPaletteColor('#' + val);
            } else {
                // 유효하지 않으면 현재 색으로 되돌리기
                e.target.value = (tempSettings.uiBaseColor || '#3a6491').replace('#', '');
            }
        });
        hexInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') hexInput.blur();
        });
    }

    bindPresetEvents();
}

function _applyPaletteColor(color) {
    tempSettings.uiBaseColor = color;
    // 색상 피커 & hex 입력창 동기화 (input은 # 없이)
    const picker = document.getElementById('uiBaseColorPicker');
    const hexInput = document.getElementById('uiBaseColorHex');
    if (picker) picker.value = color;
    if (hexInput) hexInput.value = color.replace('#', '');
    // 스와치 active 상태 업데이트
    document.querySelectorAll('.palette-swatch').forEach(s => {
        s.classList.toggle('active', s.dataset.color === color);
    });
    // 실시간 미리보기: CSS 변수 직접 적용
    document.documentElement.style.setProperty('--ui-base-color', color);
}

/* ──────────────────────── 프리셋 이벤트 ─────────────────────────────────── */

function bindPresetEvents() {
    const toggleBtn = document.getElementById('presetCreateToggleBtn');
    const panel = document.getElementById('presetCreatePanel');
    const cancelBtn = document.getElementById('presetCreateCancelBtn');
    const saveBtn = document.getElementById('presetCreateSaveBtn');
    const importBtn = document.getElementById('presetImportBtn');
    const importInput = document.getElementById('presetImportCodeInput');

    // 새 프리셋 만들기 패널 토글
    toggleBtn?.addEventListener('click', () => {
        const visible = panel.style.display !== 'none';
        panel.style.display = visible ? 'none' : 'block';
        toggleBtn.style.display = visible ? '' : 'none';

        if (!visible) {
            // 카테고리 체크박스 동적 생성
            const checkboxArea = document.getElementById('presetCategoryCheckboxes');
            if (checkboxArea) {
                checkboxArea.innerHTML = state.categories.map(c => `
                    <label class="preset-cat-label">
                        <input type="checkbox" value="${c.id}" class="preset-cat-check" />
                        <span>${c.name}</span>
                    </label>
                `).join('');
            }
            const nameInput = document.getElementById('presetNameInput');
            nameInput.value = '';
            setTimeout(() => nameInput.focus(), 50);
        }
    });

    // 취소
    cancelBtn?.addEventListener('click', () => {
        panel.style.display = 'none';
        toggleBtn.style.display = '';
    });

    // 저장
    saveBtn?.addEventListener('click', async () => {
        const name = document.getElementById('presetNameInput')?.value?.trim();
        const checked = document.querySelectorAll('.preset-cat-check:checked');
        const ids = Array.from(checked).map(el => el.value);

        saveBtn.disabled = true;
        saveBtn.textContent = '저장 중...';
        try {
            const code = await createPreset(name, ids);
            if (code) {
                panel.style.display = 'none';
                toggleBtn.style.display = '';
                await renderPresetList();
            }
        } finally {
            saveBtn.disabled = false;
            saveBtn.textContent = '저장';
        }
    });

    // 가져오기
    importBtn?.addEventListener('click', async () => {
        const code = importInput?.value?.trim();
        if (!code) { importInput?.focus(); return; }

        importBtn.disabled = true;
        importBtn.textContent = '가져오는 중...';
        try {
            const ok = await importPreset(code);
            if (ok) importInput.value = '';
        } finally {
            importBtn.disabled = false;
            importBtn.textContent = '가져오기';
        }
    });

    importInput?.addEventListener('keydown', e => {
        if (e.key === 'Enter') importBtn?.click();
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

export function bindAuthEvents() {
    DOM.googleLoginBtn?.addEventListener('click', async () => {
        const btn = DOM.googleLoginBtn;
        btn.disabled = true;
        btn.textContent = '로그인 중...';
        try {
            await signInWithGoogle();
            // onAuthStateChanged에서 UI 업데이트 처리
        } catch (err) {
            console.error('[Auth] 로그인 실패:', err);
            const msg = DOM.loginErrorMsg;
            if (msg) {
                msg.textContent = '로그인에 실패했습니다. 다시 시도해 주세요.';
                msg.style.display = 'block';
            }
            btn.disabled = false;
            btn.innerHTML = `<svg viewBox="0 0 24 24" width="20" height="20">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
            </svg> Google로 로그인`;
        }
    });

    DOM.logoutBtn?.addEventListener('click', async () => {
        try {
            await signOut();
        } catch (err) {
            console.error('[Auth] 로그아웃 실패:', err);
            showToast('로그아웃에 실패했습니다', 'error');
        }
    });
}

/* ──────────────────────── 전체 이벤트 바인딩 ───────────────────────────── */

export function bindEvents() {
    DOM.themeToggle?.addEventListener('click', toggleTheme);
    DOM.addBtn?.addEventListener('click', openAddModal);
    DOM.settingsBtn?.addEventListener('click', openSettingsModal);
    DOM.uiToggleBtn?.addEventListener('click', toggleUI);

    bindTodoListEvents();
    bindCategoryTabsEvents();
    bindTaskModalEvents();
    bindSettingsModalEvents();
    bindConfirmModalEvents();
    bindFilterEvents();
    initCropModal();
    bindAuthEvents();
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
