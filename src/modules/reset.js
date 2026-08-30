/**
 * reset.js — 할 일 반복 초기화 시스템 (nextDue 기반)
 *
 * 설계 원칙:
 *   - 각 반복 항목은 `nextDue` (다음 초기화 예정 시각, ISO string) 를 Firestore에 저장
 *   - `now >= nextDue` 이면 done=false + completedAt=null 처리 후 `nextDue` 를 다음 주기로 전진
 *   - 크로스 디바이스: `nextDue` 가 Firestore에 저장되므로 onSnapshot 수신 후 자동 동기화
 *   - 완료 취소: `nextDue` 는 완료 여부와 무관하게 변하지 않음  로직 꼬임 없음
 *
 * 초기화 흐름:
 *   initializeResetSystem()
 *      applyResets()     현재 시각 기준으로 초기화 실행
 *      _scheduleNext()   setTimeout으로 다음 초기화 정확히 예약
 *   (nextDue 도달 시)
 *      applyResets() + _scheduleNext() 반복
 */

import { state } from './state.js';
import { saveTodos, saveSettings } from './storage.js';
import { emit } from './bus.js';
import { showToast, showSystemNotification } from './utils.js';
import { DOM } from './dom.js';
import { calcNextDue, calcNextDueAfter } from './recurrence.js';

/*  내부 헬퍼  */

function _onResetOccurred(label, changedItems) {
    if (changedItems.length > 0) {
        console.log(`${label} 완료미완료: ${changedItems.length}개`);
        showToast('일부 할 일이 자동으로 초기화되었습니다', 'info');
        showSystemNotification('🔄 항목 초기화', '일부 할 일이 자동으로 초기화되었습니다.');
    }
    saveTodos();
    emit('todos:changed');
}

/*  항목별 초기화 실행  */

/**
 * recurrence가 설정된 항목 중 nextDue가 도달한 항목을 초기화합니다.
 * nextDue를 now 이후 첫 번째 미래 발생 시각으로 전진시킵니다.
 */
function _applyItemResets(now) {
    const changedItems = [];
    let anyChanged = false;

    state.todos = state.todos.map(t => {
        if (!t.recurrence || !t.nextDue) return t;
        if (now < new Date(t.nextDue)) return t;

        const newNextDue = calcNextDueAfter(t.recurrence, new Date(t.nextDue), now);
        if (t.done) changedItems.push(t.text);
        anyChanged = true;
        return {
            ...t,
            done: false,
            completedAt: null,
            nextDue: newNextDue ? newNextDue.toISOString() : null,
            ...(t.checklist ? { checklist: t.checklist.map(c => ({ ...c, done: false })) } : {})
        };
    });

    if (anyChanged) {
        _onResetOccurred('[항목 초기화]', changedItems);
    }
}

/*  다음 초기화 예약  */

let _resetTimer = null;

/**
 * 현재 state 기준으로 가장 이른 nextDue에 setTimeout을 설정합니다.
 * applyResets() 완료 후 자동 호출됩니다.
 */
function _scheduleNext() {
    if (_resetTimer) { clearTimeout(_resetTimer); _resetTimer = null; }

    const now = Date.now();
    const candidates = [];

    state.todos.forEach(t => {
        if (t.nextDue) candidates.push(new Date(t.nextDue).getTime());
    });

    const earliest = candidates.filter(t => t > now).reduce((a, b) => Math.min(a, b), Infinity);
    if (!isFinite(earliest)) return;

    // setTimeout 최대값(~24.8일) 초과 방지
    const delay = Math.min(earliest - now, 2_147_483_647);
    _resetTimer = setTimeout(() => {
        applyResets(new Date());
    }, delay);
}

/*  공개 API  */

/**
 * 현재 시각 기준으로 초기화가 필요한 항목을 모두 실행하고 다음 타이머를 예약합니다.
 * 앱 시작, Firestore 동기화 완료, 설정 변경 시 호출합니다.
 * @param {Date} [now=new Date()]
 */
export function applyResets(now = new Date()) {
    _applyItemResets(now);
    _scheduleNext();
}

/**
 * 초기화 시스템을 시작합니다.
 * applyResets()로 즉시 적용한 뒤 다음 초기화 시각에 setTimeout을 설정합니다.
 */
export function initializeResetSystem() {
    applyResets(new Date());
}

/**
 * 설정 변경 시 타이머를 재시작합니다.
 * 'reset:reschedule' 이벤트로 app.js에서 호출됩니다.
 */
export function scheduleResetTimer() {
    if (_resetTimer) { clearTimeout(_resetTimer); _resetTimer = null; }
    _scheduleNext();
}

/*  월별 날짜 그리드 초기화  */

/**
 * 설정 모달의 월별 날짜 선택 그리드(1~31일 버튼)를 최초 1회 생성합니다.
 * 이미 생성된 경우 dataset.initialized 플래그로 중복 생성을 방지합니다.
 */
export function initMonthDayGrid() {
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

/*  연간 날짜 항목 추가  */

/**
 * 설정 모달의 연간 날짜 목록에 (월, 일) 선택 행을 추가합니다.
 * @param {number} [month=1] - 기본 선택 월 (1~12)
 * @param {number} [day=1]   - 기본 선택 일 (1~31)
 */
export function addYearlyDateEntry(month = 1, day = 1) {
    const list = DOM.yearlyDateList;
    const row = document.createElement('div');
    row.className = 'yearly-date-row';

    const makeSelect = (max, selected) => {
        const sel = document.createElement('select');
        sel.className = 'form-input';
        for (let v = 1; v <= max; v++) {
            const opt = document.createElement('option');
            opt.value = v;
            opt.textContent = `${v}${max === 12 ? '월' : '일'}`;
            if (v === selected) opt.selected = true;
            sel.appendChild(opt);
        }
        return sel;
    };

    const monthSel = makeSelect(12, month);
    monthSel.className += ' yearly-month-sel';
    const daySel = makeSelect(31, day);
    daySel.className += ' yearly-day-sel';

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'yearly-remove-btn';
    removeBtn.textContent = '✕';
    removeBtn.addEventListener('click', () => row.remove());

    row.append(monthSel, daySel, removeBtn);
    list.appendChild(row);
}

/*  연간 날짜 DOM 수집  */

/**
 * 설정 모달의 연간 날짜 목록 DOM에서 현재 입력된 {month, day} 배열을 수집합니다.
 * @returns {{ month: number, day: number }[]}
 */
export function getYearlyDatesFromDOM() {
    return Array.from(DOM.yearlyDateList.querySelectorAll('.yearly-date-row'))
        .map(row => ({
            month: parseInt(row.querySelector('.yearly-month-sel').value, 10),
            day: parseInt(row.querySelector('.yearly-day-sel').value, 10),
        }));
}

/*  초기화 타입 UI 전환  */

/**
 * 항목별 초기화 타입에 따라 설정 모달의 관련 입력 행을 표시하거나 숨깁니다.
 * @param {string} type - 'deadline' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'everyN' | 'everyNWeeks' | 'neverReset'
 */
export function updateTaskResetTypeUI(type) {
    const timeTypes = new Set(['daily', 'weekday']);
    document.getElementById('taskResetDeadlineRow')?.classList.toggle('hidden', type !== 'deadline');
    document.getElementById('taskResetTimeRow')?.classList.toggle('hidden', !timeTypes.has(type));
    document.getElementById('taskResetWeeklyRow')?.classList.toggle('hidden', type !== 'weekly');
    document.getElementById('taskResetMonthlyRow')?.classList.toggle('hidden', type !== 'monthly');
    document.getElementById('taskResetYearlyRow')?.classList.toggle('hidden', type !== 'yearly');
    document.getElementById('taskResetEveryNRow')?.classList.toggle('hidden', type !== 'everyN');
    document.getElementById('taskResetEveryNWeeksRow')?.classList.toggle('hidden', type !== 'everyNWeeks');
    
    if (type === 'monthly') initMonthDayGrid();
    if (type === 'yearly' && DOM.yearlyDateList?.children.length === 0) addYearlyDateEntry();
    if (DOM.taskResetType) DOM.taskResetType.value = type;
}
