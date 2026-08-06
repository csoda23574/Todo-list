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

    if (recurrence.type === 'everyNWeeks') {
        const n = recurrence.n || 1;
        const weekday = recurrence.weekday ?? null; // 0(일)~6(토), 단일 값
        if (weekday === null) return null;
        // fromDate 다음 날부터 시작해서 지정 요일까지 며칠인지 계산
        const next = new Date(fromDate);
        next.setDate(next.getDate() + 1);
        next.setHours(h, m, 0, 0);
        const cur = next.getDay();
        const daysToTarget = (weekday - cur + 7) % 7;
        // daysToTarget이 0이면 내일이 바로 해당 요일 → 그 자체가 다음 후보
        next.setDate(next.getDate() + daysToTarget);
        // n주 주기 맞추기: fromDate 기준 에포크 주 번호와 비교해 배수 조정
        const epochDays = Math.floor(next.getTime() / 86_400_000);
        const fromEpochDays = Math.floor(fromDate.getTime() / 86_400_000);
        const weekDiff = Math.floor((epochDays - fromEpochDays + daysToTarget) / 7);
        const remainder = weekDiff % n;
        if (remainder !== 0) next.setDate(next.getDate() + (n - remainder) * 7);
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
    if (resetRepeat === 'everyNWeeks') {
        return {
            type: 'everyNWeeks',
            n: settings.resetEveryNWeeks || 2,
            weekday: settings.resetEveryNWeekday ?? null,
            time: resetTime,
        };
    }
    if (resetRepeat === 'everyN') {
        return { type: 'everyN', n: settings.resetEveryNDays || 2, time: resetTime };
    }
    if (resetRepeat === 'weekly') {
        return { type: 'weekly', weekdays: settings.resetWeekdays || [], time: resetTime };
    }
    return { type: resetRepeat || 'daily', time: resetTime };
}

/**
 * 기존 형식(itemResetTime / itemResetSchedule)을 가진 todo를
 * recurrence + nextDue 형식의 todo로 변환합니다.
 * storage.js의 마이그레이션에서 사용합니다.
 * @param {object} todo
 * @returns {object} 변환된 todo 객체 (oldfields 제거됨)
 */
export function migrateToRecurrence(todo) {
    if (todo.recurrence !== undefined) return todo; // 이미 마이그레이션 완료

    let recurrence = null;
    if (todo.itemResetSchedule) {
        const s = todo.itemResetSchedule;
        recurrence = { type: s.type, time: s.time, weekdays: s.weekdays, days: s.days, dates: s.dates };
    } else if (todo.itemResetTime) {
        recurrence = { type: 'daily', time: todo.itemResetTime };
    }

    // 구버전 필드 제거하고 recurrence로 교체
    const { itemResetTime, itemResetSchedule, ...rest } = todo;
    return { ...rest, recurrence };
}
