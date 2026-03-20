/**
 * reset.js — 할 일 자동 초기화 타이머 시스템
 *
 * 전역 초기화(일별/주별/...) 및 개별 항목 초기화(시간 지정/날짜/스케줄)를 담당합니다.
 */

import { state } from './state.js';
import { LAST_RESET_KEY } from './config.js';
import { saveTodos } from './storage.js';
import { emit } from './bus.js'; // renderer 직접 의존 제거 — DIP
import { showToast, showSystemNotification } from './utils.js';
import { DOM } from './dom.js';

/* ─────────────────────── 다음 초기화 날짜 계산 ──────────────────────────── */

export function getNextResetDate(timeStr, repeat) {
    const now = new Date();
    const [hours, minutes] = timeStr.split(':').map(Number);
    const target = new Date(now);
    target.setHours(hours, minutes, 0, 0);
    if (target <= now) target.setDate(target.getDate() + 1);

    switch (repeat) {
        case 'weekly':
            while (target.getDay() !== now.getDay()) target.setDate(target.getDate() + 1);
            break;
        case 'monthly':
            target.setMonth(target.getMonth() + 1);
            break;
        case 'yearly':
            target.setFullYear(target.getFullYear() + 1);
            break;
        case 'weekday':
            while (target.getDay() === 0 || target.getDay() === 6) target.setDate(target.getDate() + 1);
            break;
        default:
            if (repeat?.startsWith('every')) {
                const n = parseInt(repeat.slice(5), 10);
                const lastKey = localStorage.getItem('todoApp_lastReset');
                if (lastKey) {
                    const parts = lastKey.split('-');
                    if (parts.length >= 3) {
                        const lastDate = new Date(+parts[0], +parts[1], +parts[2]);
                        lastDate.setHours(hours, minutes, 0, 0);
                        const nextDate = new Date(lastDate);
                        nextDate.setDate(nextDate.getDate() + n);
                        if (nextDate > now) return nextDate;
                    }
                }
                target.setDate(target.getDate() + n - 1);
            }
    }
    return target;
}

/* ─────────────────── 월별 날짜 그리드 초기화 ────────────────────────────── */

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

/* ───────────────── 연간 날짜 항목 추가 ──────────────────────────────────── */

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

/* ─────────────────── 연간 날짜 DOM 수집 ─────────────────────────────────── */

export function getYearlyDatesFromDOM() {
    return Array.from(DOM.yearlyDateList.querySelectorAll('.yearly-date-row'))
        .map(row => ({
            month: parseInt(row.querySelector('.yearly-month-sel').value, 10),
            day: parseInt(row.querySelector('.yearly-day-sel').value, 10),
        }));
}

/* ────────────────── 초기화 타입 UI 전환 ─────────────────────────────────── */

export function updateTaskResetTypeUI(type) {
    const rows = {
        time: DOM.taskResetTimeRow,
        datetime: DOM.taskResetDatetimeRow,
        weekly: DOM.taskResetWeeklyRow,
        monthly: DOM.taskResetMonthlyRow,
        yearly: DOM.taskResetYearlyRow,
    };
    Object.entries(rows).forEach(([key, el]) => {
        el?.classList.toggle('hidden', key !== type);
    });
    if (type === 'monthly') initMonthDayGrid();
    if (type === 'yearly' && DOM.yearlyDateList?.children.length === 0) {
        addYearlyDateEntry();
    }
    if (DOM.taskResetType) DOM.taskResetType.value = type;
}

/* ──────────────────── 다음 초기화 정보 표시 ─────────────────────────────── */

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

/* ──────────────────── 초기화 키 빌더 ───────────────────────────────────── */

export function buildResetKey(now, h, m) {
    const repeat = state.settings.resetRepeat;
    const y = now.getFullYear();
    const mo = now.getMonth();
    const d = now.getDate();

    if (repeat === 'weekly') {
        const week = Math.ceil(d / 7);
        return `${y}-W${week}-${now.getDay()}-${h}-${m}`;
    }
    if (repeat === 'monthly') return `${y}-${mo}-${h}-${m}`;
    if (repeat === 'yearly') return `${y}-${h}-${m}`;
    return `${y}-${mo}-${d}-${h}-${m}`;
}

/* ───────────────── 평일 제한 확인 ──────────────────────────────────────── */

export function isWeekdayBlocked(now) {
    return state.settings.resetRepeat === 'weekday'
        && (now.getDay() === 0 || now.getDay() === 6);
}

/* ──────────────────── 전역 초기화 실행 ──────────────────────────────────── */

export function doGlobalReset(now, h, m) {
    if (isWeekdayBlocked(now)) return;

    const repeat = state.settings.resetRepeat;

    if (repeat?.startsWith('every')) {
        const n = parseInt(repeat.slice(5), 10);
        const lastKey = localStorage.getItem(LAST_RESET_KEY);
        if (lastKey) {
            const parts = lastKey.split('-');
            if (parts.length >= 3) {
                const lastDate = new Date(+parts[0], +parts[1], +parts[2]);
                lastDate.setHours(h, m, 0, 0);
                const nextDate = new Date(lastDate);
                nextDate.setDate(nextDate.getDate() + n);
                if (now < nextDate) return;
            }
        }
        const todayKey = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}-${h}-${m}`;
        if (localStorage.getItem(LAST_RESET_KEY) === todayKey) return;
        localStorage.setItem(LAST_RESET_KEY, todayKey);
    } else {
        const resetKey = buildResetKey(now, h, m);
        if (localStorage.getItem(LAST_RESET_KEY) === resetKey) return;
        localStorage.setItem(LAST_RESET_KEY, resetKey);
    }

    const targetItems = state.todos.filter(t => !t.itemResetTime);
    const completedBefore = targetItems.filter(t => t.done);
    console.log(`[전역 초기화] 대상: ${targetItems.length}개, 완료: ${completedBefore.length}개`);
    if (completedBefore.length > 0) {
        console.log('  완료→미완료:', completedBefore.map(t => `"${t.text}"`).join(', '));
    }

    state.remoteSyncInProgress = true;
    state.todos = state.todos.map(t => t.itemResetTime ? t : { ...t, done: false });
    saveTodos();
    emit('todos:changed');
    showToast('할 일 목록이 자동으로 초기화되었습니다', 'info');
    showSystemNotification('✅ 체크리스트 초기화', '할 일 목록이 자동으로 초기화되었습니다.');
}

/* ──────────────────── 개별 시간 초기화 ─────────────────────────────────── */

export function doItemResets(now, hh, mm) {
    if (isWeekdayBlocked(now)) return;

    // resetKey은 (now, hh, mm)에만 의존 — map 바깥에서 한 번만 계산
    const resetKey = buildResetKey(now, hh, mm);
    const changedItems = [];
    let anyReset = false;

    state.todos = state.todos.map(t => {
        if (!t.itemResetTime || t.itemResetDatetime || t.itemResetSchedule) return t;
        const [th, tm] = t.itemResetTime.split(':').map(Number);
        if (th !== hh || tm !== mm) return t;

        const itemKey = `todoApp_itemLastReset_${t.id}`;
        if (localStorage.getItem(itemKey) === resetKey) return t;
        localStorage.setItem(itemKey, resetKey);

        anyReset = true;
        if (t.done) changedItems.push(t.text);
        return { ...t, done: false };
    });

    if (anyReset) _onResetOccurred('[개별 초기화]', changedItems);
}

/* ─────────────────── 날짜/시간 지정 1회 초기화 ─────────────────────────── */

export function doItemDatetimeResets(now) {
    const changedItems = [];
    state.todos = state.todos.map(t => {
        if (!t.itemResetDatetime) return t;
        const itemKey = `todoApp_itemLastReset_${t.id}`;
        if (localStorage.getItem(itemKey) === t.itemResetDatetime) return t;
        if (now < new Date(t.itemResetDatetime)) return t;

        localStorage.setItem(itemKey, t.itemResetDatetime);
        if (t.done) changedItems.push(t.text);
        return { ...t, done: false };
    });

    if (changedItems.length > 0) _onResetOccurred('[날짜/시간 초기화]', changedItems);
}

/* ─────────────────── 주간/월간/연간 스케줄 초기화 ──────────────────────── */

export function doItemScheduleResets(now, catchUp = false) {
    const hh = now.getHours();
    const mm = now.getMinutes();
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

        const matched = _matchesSchedule(s, now);
        if (!matched) return t;

        const itemKey = `todoApp_itemLastReset_${t.id}`;
        const occKey = `${s.type}-${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`;
        if (localStorage.getItem(itemKey) === occKey) return t;
        localStorage.setItem(itemKey, occKey);

        if (t.done) changedItems.push(t.text);
        return { ...t, done: false };
    });

    if (changedItems.length > 0) _onResetOccurred('[스케줄 초기화]', changedItems);
}

/** 스케줄 타입에 따라 today와 매칭되는지 확인합니다. */
function _matchesSchedule(s, now) {
    if (s.type === 'weekly') return (s.weekdays || []).includes(now.getDay());
    if (s.type === 'monthly') return (s.days || []).includes(now.getDate());
    if (s.type === 'yearly') {
        return (s.dates || []).some(
            d => d.month === (now.getMonth() + 1) && d.day === now.getDate()
        );
    }
    return false;
}

/** 초기화 발생 공통 후처리 */
function _onResetOccurred(label, changedItems) {
    console.log(`${label} 완료→미완료: ${changedItems.length}개`);
    state.remoteSyncInProgress = true;
    saveTodos();
    emit('todos:changed');
    showToast('일부 할 일이 자동으로 초기화되었습니다', 'info');
    showSystemNotification('🔄 항목 초기화', '일부 할 일이 자동으로 초기화되었습니다.');
}

/* ──────────────────── 타이머 스케줄러 ──────────────────────────────────── */

export function scheduleResetTimer() {
    if (state.resetTimerInterval) {
        clearInterval(state.resetTimerInterval);
        state.resetTimerInterval = null;
    }
    initializeResetSystem();
}

/* ──────────────────── 초기화 시스템 시작 ───────────────────────────────── */

export function initializeResetSystem() {
    const now = new Date();
    const nowMins = now.getHours() * 60 + now.getMinutes();

    // Catch-up: 전역 초기화
    if (state.settings.resetEnabled) {
        const [h, m] = (state.settings.resetTime || '00:00').split(':').map(Number);
        const repeat = state.settings.resetRepeat;
        if (repeat?.startsWith('every') || repeat === 'calendar') {
            doGlobalReset(now, h, m);
        } else if (nowMins >= h * 60 + m) {
            doGlobalReset(now, h, m);
        }
    }

    // Catch-up: 개별 항목 시간 초기화 (중간 배열 없이 Set 직접 구성)
    const uniqueTimes = new Set();
    state.todos.forEach(t => { if (t.itemResetTime) uniqueTimes.add(t.itemResetTime); });
    uniqueTimes.forEach(timeStr => {
        const [th, tm] = timeStr.split(':').map(Number);
        if (nowMins >= th * 60 + tm) doItemResets(now, th, tm);
    });

    doItemDatetimeResets(now);
    doItemScheduleResets(now, true);

    // 1초 간격 타이머
    state.resetTimerInterval = setInterval(() => {
        const t = new Date();
        const hh = t.getHours();
        const mm = t.getMinutes();

        if (state.settings.resetEnabled) {
            const [h, m] = (state.settings.resetTime || '00:00').split(':').map(Number);
            const repeat = state.settings.resetRepeat;
            if (repeat === 'calendar') {
                const cd = state.settings.resetCalendarDate;
                if (cd) {
                    const calDate = new Date(cd);
                    if (hh === calDate.getHours() && mm === calDate.getMinutes()) {
                        doGlobalReset(t, h, m);
                    }
                }
            } else if (hh === h && mm === m) {
                doGlobalReset(t, h, m);
            }
        }

        doItemResets(t, hh, mm);
        doItemDatetimeResets(t);
        doItemScheduleResets(t, false);
    }, 1000);
}
