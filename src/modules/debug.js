/**
 * debug.js — 개발/디버깅 유틸리티
 */

import { state } from './state.js';
import { formatRecurrenceBadge } from './utils.js';

/* ────────────────────── 초기화 상태 로깅 ──────────────────────────────── */

export function logResetStatus() {
    console.log('=== 체크리스트 초기화 상태 ===');
    const nextGlobal = state.settings.nextGlobalResetAt
        ? new Date(state.settings.nextGlobalResetAt).toLocaleString('ko-KR')
        : 'None';
    console.log(`전역 다음 초기화: ${nextGlobal}`);
    console.log('\n항목별 초기화:');

    state.todos.forEach((todo, index) => {
        const badge = todo.recurrence ? formatRecurrenceBadge(todo.recurrence) : 'global';
        const nextDue = todo.nextDue
            ? new Date(todo.nextDue).toLocaleString('ko-KR')
            : 'None';
        console.log(`  [${index + 1}] "${todo.text}" (${badge}) nextDue: ${nextDue}`);
    });

    console.log('=============================\n');
}
