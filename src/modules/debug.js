/**
 * debug.js — 개발/디버깅 유틸리티
 */

import { state } from './state.js';
import { getGlobalResetKey, getItemResetKey } from './config.js';

/* ──────────────────── 리셋 키 → Date 변환 ─────────────────────────────── */

function parseResetKeyToDate(resetKey) {
    if (!resetKey) return null;
    if (resetKey.includes('T')) return new Date(resetKey);
    if (resetKey.includes('W')) return null; // 주차 형식은 복원 어려움

    const parts = resetKey.split('-');
    if (parts.length >= 5) {
        return new Date(+parts[0], +parts[1], +parts[2], +parts[3], +parts[4], 0);
    }
    return null;
}

function formatResetTime(resetKey) {
    if (!resetKey) return 'None';
    const date = parseResetKeyToDate(resetKey);
    if (!date || isNaN(date.getTime())) return resetKey;

    const pad = n => String(n).padStart(2, '0');
    return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} ` +
        `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/* ────────────────────── 초기화 상태 로깅 ──────────────────────────────── */

export function logResetStatus() {
    console.log('=== 체크리스트 초기화 상태 ===');
    console.log(`전역 초기화: ${formatResetTime(localStorage.getItem(getGlobalResetKey(state.uid)))}`);
    console.log('\n항목별 초기화:');

    state.todos.forEach((todo, index) => {
        const lastReset = localStorage.getItem(getItemResetKey(state.uid, todo.id));
        const resetType = todo.itemResetDatetime ? 'datetime'
            : todo.itemResetSchedule ? 'schedule'
                : todo.itemResetTime ? 'time'
                    : 'global';
        console.log(`  [${index + 1}] "${todo.text}" (${resetType}): ${formatResetTime(lastReset)}`);
    });

    console.log('=============================\n');
}
