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
import { calcNextDue, calcNextDueAfter, settingsToRecurrence } from './recurrence.js';

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

/*  전역 초기화 실행 ─ */

/**
 * 개별 recurrence가 없는 항목을 대상으로 전역 초기화를 실행합니다.
 * nextGlobalResetAt이 도달했을 때만 실행하며, 이후 다음 주기로 전진합니다.
 * 크로스 디바이스: nextGlobalResetAt이 Firestore에 저장되므로 다른 기기가
 * 이미 초기화한 경우 now < nextGlobalResetAt 조건으로 자동 건너뜁니다.
 */
function _applyGlobalReset(now) {
    if (!state.settings.resetEnabled) return;
    const recurrence = settingsToRecurrence(state.settings);
    if (!recurrence) return;

    if (!state.settings.nextGlobalResetAt) {
        // nextGlobalResetAt이 없으면 즉시 초기화 실행 후 다음 주기 예약
        // (최초 활성화 및 버그 등으로 null이 된 경우 모두 포함)
        const changedItems = [];
        state.todos = state.todos.map(t => {
            if (t.recurrence) return t;
            if (!t.done && !(t.checklist?.some(c => c.done))) return t;
            if (t.done) changedItems.push(t.text);
            return {
                ...t,
                done: false,
                completedAt: null,
                ...(t.checklist ? { checklist: t.checklist.map(c => ({ ...c, done: false })) } : {})
            };
        });
        if (changedItems.length > 0) _onResetOccurred('[전역 초기화]', changedItems);

        const nextDate = recurrence.type === 'calendar'
            ? (recurrence.date ? new Date(recurrence.date) : null)
            : calcNextDueAfter(recurrence, now, now);
        if (nextDate) {
            state.settings.nextGlobalResetAt = nextDate.toISOString();
            saveSettings();
        }
        return;
    }

    const nextGlobal = new Date(state.settings.nextGlobalResetAt);
    if (now < nextGlobal) return; // 아직 주기 미도래

    // 초기화 대상: 개별 recurrence 없는 항목
    const changedItems = [];
    state.todos = state.todos.map(t => {
        if (t.recurrence) return t;
        if (!t.done && !(t.checklist?.some(c => c.done))) return t;
        if (t.done) changedItems.push(t.text); // 실제 완료된 항목만 기록
        return {
            ...t,
            done: false,
            completedAt: null,
            ...(t.checklist ? { checklist: t.checklist.map(c => ({ ...c, done: false })) } : {})
        };
    });

    // nextGlobalResetAt을 다음 미래 주기로 전진 (calendar는 1회성이므로 null)
    const newNext = recurrence.type === 'calendar'
        ? null
        : calcNextDueAfter(recurrence, nextGlobal, now);
    state.settings.nextGlobalResetAt = newNext ? newNext.toISOString() : null;
    saveSettings();

    if (changedItems.length > 0) {
        _onResetOccurred('[전역 초기화]', changedItems);
    }
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
 * 현재 state 기준으로 가장 이른 nextDue/nextGlobalResetAt에 setTimeout을 설정합니다.
 * applyResets() 완료 후 자동 호출됩니다.
 */
function _scheduleNext() {
    if (_resetTimer) { clearTimeout(_resetTimer); _resetTimer = null; }

    const now = Date.now();
    const candidates = [];

    if (state.settings.resetEnabled && state.settings.nextGlobalResetAt) {
        candidates.push(new Date(state.settings.nextGlobalResetAt).getTime());
    }
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
    _applyGlobalReset(now);
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

/*  다음 초기화 날짜 계산  */

/**
 * 반복 방식(repeat)에 따라 다음 초기화 예정 날짜를 계산합니다.
 * 설정 모달의 "다음 초기화" 안내 문구 표시에 사용합니다.
 * @param {string} timeStr - "HH:mm" 형식의 초기화 시각
 * @param {string} repeat  - 반복 방식
 * @returns {Date}
 */
export function getNextResetDate(timeStr, repeat) {
    const now = new Date();
    if (repeat === 'calendar') return new Date(now.getTime() + 86_400_000);
    const recurrence = settingsToRecurrence({ ...state.settings, resetRepeat: repeat, resetTime: timeStr });
    return calcNextDueAfter(recurrence, now, now) ?? new Date(now.getTime() + 86_400_000);
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
 * @param {string} type - 'none' | 'daily' | 'weekday' | 'weekly' | 'monthly' | 'yearly'
 */
export function updateTaskResetTypeUI(type) {
    const timeTypes = new Set(['daily', 'weekday']);
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

/*  다음 초기화 정보 표시  */

/**
 * 설정 모달의 "다음 초기화" 안내 문구를 현재 설정값 기준으로 갱신합니다.
 * 초기화가 비활성화되어 있거나 시각이 미설정된 경우 문구를 숨깁니다.
 */
export function updateResetNextInfo() {
    const el = DOM.resetNextInfo;
    if (!el) return;

    const enabled = DOM.resetEnabled?.checked;
    const timeVal = DOM.resetTime?.value;
    const repeatVal = DOM.resetRepeat?.value;

    if (!enabled || !timeVal) {
        el.textContent = '';
        el.classList.add('hidden');
        return;
    }
    const next = getNextResetDate(timeVal, repeatVal);
    el.textContent = `다음 초기화: ${next.toLocaleString('ko-KR', {
        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    })}`;
    el.classList.remove('hidden');
}
