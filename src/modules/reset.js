/**
 * reset.js — 할 일 자동 초기화 타이머 시스템
 *
 * 전역 초기화(일별/주별/...) 및 개별 항목 초기화(시간 지정/날짜/스케줄)를 담당합니다.
 */

import { state } from './state.js';
import { getGlobalResetKey, getItemResetKey, getResetTimestampKey } from './config.js';
import { saveTodos, saveSettings } from './storage.js';
import { emit } from './bus.js'; // renderer 직접 의존 제거 — DIP
import { showToast, showSystemNotification } from './utils.js';
import { DOM } from './dom.js';

function updateResetTimestamp() {
    localStorage.setItem(getResetTimestampKey(state.uid), Date.now().toString());
}

/* ─────────────────────── 다음 초기화 날짜 계산 ──────────────────────────── */

const getLastResetDate = (hours, minutes) => {
    const lastKey = localStorage.getItem(getGlobalResetKey(state.uid));
    if (!lastKey) return null;

    const parts = lastKey.split('-');
    if (parts.length < 3) return null;

    const lastDate = new Date(+parts[0], +parts[1], +parts[2]);
    lastDate.setHours(hours, minutes, 0, 0);
    return lastDate;
};

const resetStrategies = {
    weekly: (target, now) => {
        const result = new Date(target);
        while (result.getDay() !== now.getDay()) result.setDate(result.getDate() + 1);
        return result;
    },
    monthly: (target) => {
        const result = new Date(target);
        result.setMonth(result.getMonth() + 1);
        return result;
    },
    yearly: (target) => {
        const result = new Date(target);
        result.setFullYear(result.getFullYear() + 1);
        return result;
    },
    weekday: (target) => {
        const result = new Date(target);
        while (result.getDay() === 0 || result.getDay() === 6) result.setDate(result.getDate() + 1);
        return result;
    }
};

export function getNextResetDate(timeStr, repeat) {
    const now = new Date();
    const [hours, minutes] = timeStr.split(':').map(Number);
    const target = new Date(now);
    target.setHours(hours, minutes, 0, 0);
    if (target <= now) target.setDate(target.getDate() + 1);

    if (resetStrategies[repeat]) {
        return resetStrategies[repeat](target, now);
    }

    if (repeat?.startsWith('every')) {
        const n = parseInt(repeat.slice(5), 10);
        const lastDate = getLastResetDate(hours, minutes);

        if (lastDate) {
            const nextDate = new Date(lastDate);
            nextDate.setDate(nextDate.getDate() + n);
            if (nextDate > now) return nextDate;
        }
        const fallback = new Date(target);
        fallback.setDate(fallback.getDate() + n - 1);
        return fallback;
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

    // 이 초기화 주기의 시작 시각 — completedAt 비교 기준
    const resetMoment = new Date(now);
    resetMoment.setHours(h, m, 0, 0);

    if (repeat?.startsWith('every')) {
        const n = parseInt(repeat.slice(5), 10);
        const rKey = getGlobalResetKey(state.uid);

        // 크로스 디바이스: Firestore 동기화된 lastGlobalResetAt 우선 확인
        const fsLastReset = state.settings.lastGlobalResetAt;
        if (fsLastReset) {
            const nextDate = new Date(fsLastReset);
            nextDate.setDate(nextDate.getDate() + n);
            if (now < nextDate) return;
        } else {
            // 동일 기기 폴백: localStorage
            const lastKey = localStorage.getItem(rKey);
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
        }

        // 같은 날 중복 실행 방지
        const todayKey = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}-${h}-${m}`;
        if (localStorage.getItem(rKey) === todayKey) return;
        localStorage.setItem(rKey, todayKey);
        updateResetTimestamp();

        // Firestore에 마지막 초기화 시각 저장 (크로스 디바이스 N일 간격 기준)
        state.settings.lastGlobalResetAt = resetMoment.toISOString();
        saveSettings();
    } else {
        const resetKey = buildResetKey(now, h, m);
        const rKey = getGlobalResetKey(state.uid);
        if (localStorage.getItem(rKey) === resetKey) return;
        localStorage.setItem(rKey, resetKey);
        updateResetTimestamp();
    }

    const targetItems = state.todos.filter(t => !t.itemResetTime && !t.itemResetDatetime && !t.itemResetSchedule);
    // completedAt > resetMoment 인 항목은 초기화 후 재완료된 것이므로 유지
    const toReset = targetItems.filter(t =>
        t.done && !(t.completedAt && new Date(t.completedAt) > resetMoment)
    );
    const kept = targetItems.filter(t =>
        t.done && t.completedAt && new Date(t.completedAt) > resetMoment
    );

    console.log(`[전역 초기화] 초기화: ${toReset.length}개, 유지(재완료): ${kept.length}개`);

    if (toReset.length > 0) {
        const toResetIds = new Set(toReset.map(t => t.id));
        state.todos = state.todos.map(t => {
            if (t.itemResetTime || t.itemResetDatetime || t.itemResetSchedule) return t;
            if (!toResetIds.has(t.id)) return t;
            return { ...t, done: false, completedAt: null };
        });
        _onResetOccurred('[전역 초기화]', toReset);
    } else {
        saveTodos();
    }
}

/* ──────────────────── 개별 시간 초기화 ─────────────────────────────────── */

export function doItemResets(now, hh, mm) {
    if (isWeekdayBlocked(now)) return;

    // resetKey은 (now, hh, mm)에만 의존 — map 바깥에서 한 번만 계산
    const resetKey = buildResetKey(now, hh, mm);
    // completedAt 비교 기준: 오늘 해당 초기화 시각
    const resetMoment = new Date(now);
    resetMoment.setHours(hh, mm, 0, 0);
    const changedItems = [];
    let anyReset = false;

    state.todos = state.todos.map(t => {
        if (!t.itemResetTime || t.itemResetDatetime || t.itemResetSchedule) return t;
        const [th, tm] = t.itemResetTime.split(':').map(Number);
        if (th !== hh || tm !== mm) return t;

        const itemKey = getItemResetKey(state.uid, t.id);
        if (localStorage.getItem(itemKey) === resetKey) return t;
        localStorage.setItem(itemKey, resetKey);

        // 초기화 시각 이후 완료된 항목은 유지
        if (t.done && t.completedAt && new Date(t.completedAt) > resetMoment) return t;

        anyReset = true;
        if (t.done) changedItems.push(t.text);
        return { ...t, done: false, completedAt: null };
    });

    if (anyReset) {
        updateResetTimestamp();
        _onResetOccurred('[개별 시간 초기화]', changedItems);
    }
}

/* ─────────────────── 날짜/시간 지정 1회 초기화 ─────────────────────────── */

export function doItemDatetimeResets(now) {
    const changedItems = [];
    let anyReset = false;
    state.todos = state.todos.map(t => {
        if (!t.itemResetDatetime) return t;
        const itemKey = getItemResetKey(state.uid, t.id);
        if (localStorage.getItem(itemKey) === t.itemResetDatetime) return t;

        // 정각(Exact minute)에만 동작하도록 수정하여 Boot 시 덮어쓰기 방지
        const target = new Date(t.itemResetDatetime);
        if (now.getFullYear() !== target.getFullYear() ||
            now.getMonth() !== target.getMonth() ||
            now.getDate() !== target.getDate() ||
            now.getHours() !== target.getHours() ||
            now.getMinutes() !== target.getMinutes()) return t;

        localStorage.setItem(itemKey, t.itemResetDatetime);

        anyReset = true;
        if (t.done) changedItems.push(t.text);
        return { ...t, done: false };
    });

    if (anyReset) {
        updateResetTimestamp();
        _onResetOccurred('[날짜/시간 초기화]', changedItems);
    }
}

/* ─────────────────── 주간/월간/연간 스케줄 초기화 ──────────────────────── */

export function doItemScheduleResets(now) {
    const hh = now.getHours();
    const mm = now.getMinutes();
    const changedItems = [];
    let anyReset = false;

    state.todos = state.todos.map(t => {
        if (!t.itemResetSchedule) return t;
        const s = t.itemResetSchedule;
        const [sh, sm] = (s.time || '00:00').split(':').map(Number);

        // 정각(Exact minute)에만 동작하도록 수정
        if (hh !== sh || mm !== sm) return t;

        const matched = _matchesSchedule(s, now);
        if (!matched) return t;

        const itemKey = getItemResetKey(state.uid, t.id);
        const occKey = `${s.type}-${now.getFullYear()}-${now.getMonth()}-${now.getDate()}-${sh}-${sm}`;
        if (localStorage.getItem(itemKey) === occKey) return t;
        localStorage.setItem(itemKey, occKey);

        // 초기화 시각 이후 완료된 항목은 유지
        const resetMoment = new Date(now);
        resetMoment.setHours(sh, sm, 0, 0);
        if (t.done && t.completedAt && new Date(t.completedAt) > resetMoment) return t;

        anyReset = true;
        if (t.done) changedItems.push(t.text);
        return { ...t, done: false, completedAt: null };
    });

    if (anyReset) {
        updateResetTimestamp();
        _onResetOccurred('[스케줄 초기화]', changedItems);
    }
}

const scheduleMatchers = {
    weekly: (s, now) => (s.weekdays || []).includes(now.getDay()),
    monthly: (s, now) => (s.days || []).includes(now.getDate()),
    yearly: (s, now) => (s.dates || []).some(
        d => d.month === (now.getMonth() + 1) && d.day === now.getDate()
    )
};

/** 스케줄 타입에 따라 today와 매칭되는지 확인합니다. */
function _matchesSchedule(s, now) {
    const matcher = scheduleMatchers[s.type];
    return matcher ? matcher(s, now) : false;
}

/** 초기화 발생 공통 후처리 */
function _onResetOccurred(label, changedItems) {
    if (changedItems.length > 0) {
        console.log(`${label} 완료→미완료: ${changedItems.length}개`);
        showToast('일부 할 일이 자동으로 초기화되었습니다', 'info');
        showSystemNotification('🔄 항목 초기화', '일부 할 일이 자동으로 초기화되었습니다.');
    }
    saveTodos();
    emit('todos:changed');
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

const handleTimerTick = () => {
    const now = new Date();
    const hh = now.getHours();
    const mm = now.getMinutes();

    if (state.settings.resetEnabled) {
        const [h, m] = (state.settings.resetTime || '00:00').split(':').map(Number);
        const repeat = state.settings.resetRepeat;

        if (repeat === 'calendar') {
            const cd = state.settings.resetCalendarDate;
            if (cd) {
                const calDate = new Date(cd);
                if (now.getFullYear() === calDate.getFullYear() &&
                    now.getMonth() === calDate.getMonth() &&
                    now.getDate() === calDate.getDate() &&
                    hh === calDate.getHours() &&
                    mm === calDate.getMinutes()) {
                    doGlobalReset(now, h, m);
                }
            }
        } else if (hh === h && mm === m) {
            doGlobalReset(now, h, m);
        }
    }

    const uniqueTimes = new Set();
    state.todos.forEach(t => { if (t.itemResetTime && !t.itemResetDatetime && !t.itemResetSchedule) uniqueTimes.add(t.itemResetTime); });

    uniqueTimes.forEach(timeStr => {
        const [th, tm] = timeStr.split(':').map(Number);
        if (hh === th && mm === tm) doItemResets(now, th, tm);
    });

    doItemDatetimeResets(now);
    doItemScheduleResets(now);
};

export function initializeResetSystem() {
    // 앱 시작 시 놓친 초기화 소급 적용 (앱이 꺼져 있는 동안 지나간 시간 처리)
    checkMissedResets();
    handleTimerTick();
    state.resetTimerInterval = setInterval(handleTimerTick, 1000);
}

/**
 * 앱 시작 시 호출 — 앱이 꺼진 동안 지나간 초기화를 소급 적용합니다.
 * doGlobalReset / doItemResets 내부의 resetKey 중복 방지 로직이 있으므로
 * 이미 초기화된 주기는 절대 재실행되지 않습니다.
 */
function checkMissedResets() {
    const now = new Date();

    // ── 전역 초기화 ──
    if (state.settings.resetEnabled) {
        const [h, m] = (state.settings.resetTime || '00:00').split(':').map(Number);
        const repeat = state.settings.resetRepeat;

        // calendar 타입은 1회성이므로 소급 제외
        if (repeat !== 'calendar') {
            const resetMoment = new Date(now);
            resetMoment.setHours(h, m, 0, 0);
            // 오늘 초기화 시각이 이미 지났으면 doGlobalReset 실행
            // (내부에서 resetKey 비교로 중복 실행 방지)
            if (now >= resetMoment) {
                doGlobalReset(now, h, m);
            }
        }
    }

    // ── 개별 시간 초기화 ──
    const uniqueTimes = new Set();
    state.todos.forEach(t => {
        if (t.itemResetTime && !t.itemResetDatetime && !t.itemResetSchedule) {
            uniqueTimes.add(t.itemResetTime);
        }
    });
    uniqueTimes.forEach(timeStr => {
        const [th, tm] = timeStr.split(':').map(Number);
        const resetMoment = new Date(now);
        resetMoment.setHours(th, tm, 0, 0);
        if (now >= resetMoment) {
            doItemResets(now, th, tm);
        }
    });

    // ── 스케줄 초기화 소급 (주간/월간/연간) ──
    _checkMissedScheduleResets(now);
}

/**
 * 스케줄(itemResetSchedule) 항목의 가장 최근 발생 시점을 반환합니다.
 * 지나간 시점이어야 하며, 타입별로 최대 탐색 범위를 제한합니다.
 */
function _getLastScheduleOccurrence(s, now, sh, sm) {
    if (s.type === 'weekly') {
        // 오늘 포함 최대 7일 전까지 탐색
        for (let i = 0; i <= 7; i++) {
            const candidate = new Date(now);
            candidate.setDate(candidate.getDate() - i);
            candidate.setHours(sh, sm, 0, 0);
            if (candidate > now) continue;
            if ((s.weekdays || []).includes(candidate.getDay())) return candidate;
        }
    } else if (s.type === 'monthly') {
        // 이번 달 및 지난 달 탐색
        for (let monthBack = 0; monthBack <= 1; monthBack++) {
            const base = new Date(now);
            base.setMonth(base.getMonth() - monthBack);
            const days = [...(s.days || [])].sort((a, b) => b - a);
            for (const day of days) {
                const candidate = new Date(base.getFullYear(), base.getMonth(), day, sh, sm, 0, 0);
                if (candidate <= now) return candidate;
            }
        }
    } else if (s.type === 'yearly') {
        // 올해 및 작년 탐색
        for (let yearBack = 0; yearBack <= 1; yearBack++) {
            const year = now.getFullYear() - yearBack;
            for (const d of (s.dates || [])) {
                const candidate = new Date(year, d.month - 1, d.day, sh, sm, 0, 0);
                if (candidate <= now) return candidate;
            }
        }
    }
    return null;
}

/**
 * 앱 시작 시 놓친 스케줄 초기화를 소급 적용합니다.
 * doItemScheduleResets 와 동일한 occKey 형식을 사용해 중복 실행을 방지합니다.
 */
function _checkMissedScheduleResets(now) {
    const changedItems = [];
    let anyReset = false;

    state.todos = state.todos.map(t => {
        if (!t.itemResetSchedule) return t;
        const s = t.itemResetSchedule;
        const [sh, sm] = (s.time || '00:00').split(':').map(Number);

        const lastOcc = _getLastScheduleOccurrence(s, now, sh, sm);
        if (!lastOcc) return t;

        const itemKey = getItemResetKey(state.uid, t.id);
        const occKey = `${s.type}-${lastOcc.getFullYear()}-${lastOcc.getMonth()}-${lastOcc.getDate()}-${sh}-${sm}`;
        if (localStorage.getItem(itemKey) === occKey) return t;
        localStorage.setItem(itemKey, occKey);

        // 마지막 발생 시점 이후 완료된 항목은 유지
        if (t.done && t.completedAt && new Date(t.completedAt) > lastOcc) return t;

        anyReset = true;
        if (t.done) changedItems.push(t.text);
        return { ...t, done: false, completedAt: null };
    });

    if (anyReset) {
        updateResetTimestamp();
        _onResetOccurred('[스케줄 소급 초기화]', changedItems);
    }
}

/**
 * Firestore initialMerge() 완료 후 호출.
 * 서버 데이터를 받은 뒤 놓친 초기화를 소급 적용합니다.
 * (로그인 시 app.js에서 호출)
 */
export function checkMissedResetsAfterSync() {
    checkMissedResets();
}
