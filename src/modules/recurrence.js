/**
 * recurrence.js — 반복 일정 계산 유틸리티
 *
 * 상태(state)나 DOM에 의존하지 않는 순수 함수 모음.
 *
 * recurrence 객체 구조:
 *   {
 *     type: 'daily' | 'weekday' | 'weekly' | 'monthly' | 'yearly' | 'everyN' | 'calendar',
 *     time: 'HH:mm',
 *     weekdays?: number[],           // weekly: 0=일 ~ 6=토
 *     days?: number[],               // monthly: 1~31
 *     dates?: { month, day }[],      // yearly
 *     n?: number,                    // everyN
 *     date?: string,                 // calendar: ISO string (1회성)
 *   }
 */

/**
 * recurrence 패턴에 따라 `fromDate` 이후 첫 번째 발생 시각을 반환합니다.
 * @param {object} recurrence
 * @param {Date} fromDate - 이 시각 이후의 다음 발생을 찾습니다
 * @returns {Date|null}
 */
export function calcNextDue(recurrence, fromDate) {
    if (!recurrence) return null;
    const [h, m] = (recurrence.time || '00:00').split(':').map(Number);

    if (recurrence.type === 'calendar') return null; // 1회성 — 다음 없음

    if (recurrence.type === 'daily' || recurrence.type === 'weekday') {
        const next = new Date(fromDate);
        next.setDate(next.getDate() + 1);
        next.setHours(h, m, 0, 0);
        if (recurrence.type === 'weekday') {
            while (next.getDay() === 0 || next.getDay() === 6) next.setDate(next.getDate() + 1);
        }
        return next;
    }

    if (recurrence.type === 'weekly') {
        const weekdays = recurrence.weekdays || [];
        if (weekdays.length === 0) return null;
        const next = new Date(fromDate);
        next.setDate(next.getDate() + 1);
        next.setHours(h, m, 0, 0);
        for (let i = 0; i < 7; i++) {
            if (weekdays.includes(next.getDay())) return next;
            next.setDate(next.getDate() + 1);
        }
        return null;
    }

    if (recurrence.type === 'monthly') {
        const days = [...(recurrence.days || [])].sort((a, b) => a - b);
        if (days.length === 0) return null;
        const next = new Date(fromDate);
        next.setDate(next.getDate() + 1);
        next.setHours(h, m, 0, 0);
        for (let i = 0; i < 62; i++) {
            if (days.includes(next.getDate())) return next;
            next.setDate(next.getDate() + 1);
        }
        return null;
    }

    if (recurrence.type === 'yearly') {
        const dates = recurrence.dates || [];
        if (dates.length === 0) return null;
        const next = new Date(fromDate);
        next.setDate(next.getDate() + 1);
        next.setHours(h, m, 0, 0);
        for (let i = 0; i < 400; i++) {
            if (dates.some(d => d.month === next.getMonth() + 1 && d.day === next.getDate())) return next;
            next.setDate(next.getDate() + 1);
        }
        return null;
    }

    if (recurrence.type === 'everyN') {
        const n = recurrence.n || 1;
        const next = new Date(fromDate);
        next.setDate(next.getDate() + n);
        next.setHours(h, m, 0, 0);
        return next;
    }

    return null;
}

/**
 * `now`보다 미래인 첫 번째 발생 시각을 반환합니다.
 * `fromDate`(현재 nextDue)가 과거인 경우 now보다 미래가 될 때까지 전진합니다.
 * @param {object} recurrence
 * @param {Date} fromDate - 탐색 시작점 (현재 nextDue 또는 기준 시각)
 * @param {Date} now
 * @returns {Date|null}
 */
export function calcNextDueAfter(recurrence, fromDate, now) {
    let current = fromDate;
    for (let i = 0; i < 500; i++) {
        const next = calcNextDue(recurrence, current);
        if (!next) return null;
        if (next > now) return next;
        current = next;
    }
    return null;
}

/**
 * 전역 초기화 settings를 recurrence 객체로 변환합니다.
 * @param {{ resetRepeat: string, resetTime: string, resetCalendarDate?: string }} settings
 * @returns {object|null}
 */
export function settingsToRecurrence(settings) {
    const { resetRepeat, resetTime, resetCalendarDate } = settings;
    if (resetRepeat === 'calendar') return { type: 'calendar', date: resetCalendarDate };
    if (resetRepeat?.startsWith('every')) {
        return { type: 'everyN', n: parseInt(resetRepeat.slice(5), 10), time: resetTime };
    }
    return { type: resetRepeat || 'daily', time: resetTime };
}

/**
 * 기존 형식(itemResetTime / itemResetSchedule)을 recurrence 객체로 변환합니다.
 * storage.js의 마이그레이션에서 사용합니다.
 * @param {object} todo
 * @returns {object|null}
 */
export function migrateToRecurrence(todo) {
    if (todo.recurrence !== undefined) return todo.recurrence; // 이미 마이그레이션 완료
    if (todo.itemResetSchedule) {
        const s = todo.itemResetSchedule;
        return { type: s.type, time: s.time, weekdays: s.weekdays, days: s.days, dates: s.dates };
    }
    if (todo.itemResetTime) {
        return { type: 'daily', time: todo.itemResetTime };
    }
    return null;
}
