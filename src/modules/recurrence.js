/**
 * recurrence.js — 반복 일정 계산 유틸리티
 *
 * 상태(state)나 DOM에 의존하지 않는 순수 함수 모음.
 *
 * recurrence 객체 구조:
 *   {
 *     type: 'daily' | 'weekday' | 'weekly' | 'monthly' | 'yearly' | 'everyNWeeks' | 'calendar',
 *     time: 'HH:mm',
 *     weekdays?: number[],           // weekly: 0=일 ~ 6=토
 *     days?: number[],               // monthly: 1~31
 *     dates?: { month, day }[],      // yearly
 *     n?: number, weekday?: number,  // everyNWeeks (완료 시각 기준, 시작일 없음)
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

    if (recurrence.type === 'calendar' || recurrence.type === 'deadline') return null; // 1회성 — 다음 없음
    if (recurrence.type === 'neverReset') return null; // 초기화 없음

    if (recurrence.type === 'daily') {
        const next = new Date(fromDate);
        next.setDate(next.getDate() + 1);
        next.setHours(h, m, 0, 0);
        return next;
    }

    if (recurrence.type === 'weekly') {
        const weekdays = recurrence.weekdays || [];
        const next = new Date(fromDate);
        next.setDate(next.getDate() + 1);
        next.setHours(h, m, 0, 0);
        // weekdays가 비어있으면 단순 7일 주기 (전역 설정의 '매주')
        if (weekdays.length === 0) {
            next.setDate(next.getDate() + 6); // +1 이미 했으므로 +6 = 총 7일
            return next;
        }
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

    if (recurrence.type === 'everyNWeeks') {
        // 시작일 없음: fromDate(완료 시각, 또는 직전 초기화 시각) 이후 첫 지정 요일 + (N-1)주.
        // 완료 시각 기준  → 목요일 완료, 2주마다 월요일 = 다다음주 월요일
        // 초기화 시각 기준 → 직전 월요일에서 정확히 N주 뒤 월요일
        const n = Math.max(1, recurrence.n || 1);
        const next = _nextWeekdayAfter(fromDate, recurrence.weekday, h, m);
        if (!next) return null;
        next.setDate(next.getDate() + (n - 1) * 7);
        return next;
    }

    return null;
}

/** `fromDate` 이후(초과) 첫 번째 지정 요일의 h:m 시각을 반환합니다. */
function _nextWeekdayAfter(fromDate, weekday, h, m) {
    if (weekday == null) return null; // 0(일)~6(토)
    const next = new Date(fromDate);
    next.setHours(h, m, 0, 0);
    next.setDate(next.getDate() + (weekday - next.getDay() + 7) % 7);
    if (next <= fromDate) next.setDate(next.getDate() + 7);
    return next;
}

/**
 * 새로 만들거나 수정한 항목의 첫 초기화 시각을 반환합니다.
 * N주마다는 완료 전이므로 가장 가까운 지정 요일을 첫 초기화로 잡고,
 * 이미 완료된 항목(completedAt)이면 완료 시각 기준으로 잡습니다.
 * @param {object} recurrence
 * @param {Date} now
 * @param {string|null} [completedAt]
 * @returns {Date|null}
 */
export function calcInitialNextDue(recurrence, now, completedAt = null) {
    if (recurrence?.type === 'everyNWeeks') {
        if (completedAt) return calcNextDue(recurrence, new Date(completedAt));
        const [h, m] = (recurrence.time || '00:00').split(':').map(Number);
        return _nextWeekdayAfter(now, recurrence.weekday, h, m);
    }
    return calcNextDueAfter(recurrence, now, now);
}

/**
 * 항목을 완료 처리할 때의 nextDue를 반환합니다.
 * N주마다는 완료할 때마다 완료 시각을 기점으로 다시 잡고,
 * 그 외 유형은 초기화 시각이 지났을 때만 전진합니다.
 * @param {object} recurrence
 * @param {string|null} nextDue - 현재 nextDue (ISO)
 * @param {Date} now - 완료 시각
 * @returns {string|null} ISO 문자열
 */
export function calcNextDueOnComplete(recurrence, nextDue, now) {
    if (recurrence?.type === 'everyNWeeks') {
        return calcNextDue(recurrence, now)?.toISOString() ?? nextDue;
    }
    if (!nextDue || now >= new Date(nextDue)) {
        return calcNextDueAfter(recurrence, now, now)?.toISOString() ?? nextDue;
    }
    return nextDue;
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
