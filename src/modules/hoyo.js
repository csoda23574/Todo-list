/** HoYoLAB 상태 조회, 프로필별 백오프, Todo 완료 연결. */

import { state } from './state.js';
import { applyHoyoCompletionStatus } from './todos.js';
import { getHoyoConditionDetails, getLinkedHoyoConnections } from './hoyo-conditions.js';
import { showSystemNotification, showToast } from './utils.js';
import { getHoyoAPI } from './hoyo-api.js';

const checkTimers = new Map();
const failedChecks = new Map();
const checksInProgress = new Set();
let scheduleVersion = 0;

function clearCheckTimers() {
    for (const timer of checkTimers.values()) clearTimeout(timer);
    checkTimers.clear();
}

function nextDelayMinutes(connection) {
    const failed = failedChecks.get(connection.id) || 0;
    if (failed === 0) return connection.refreshInterval;
    return Math.max(connection.refreshInterval, failed === 1 ? 30 : 60);
}

async function scheduleNextChecks({ immediate = false } = {}) {
    clearCheckTimers();
    const version = ++scheduleVersion;
    const hoyoAPI = getHoyoAPI();
    if (!hoyoAPI || !state.isSignedIn) return;

    let connections;
    try {
        const allConnections = await hoyoAPI.getHoyoConnections();
        connections = getLinkedHoyoConnections(state.todos, allConnections);
    } catch {
        return;
    }
    if (version !== scheduleVersion) return;

    await Promise.all(connections.map(async connection => {
        if (connection.refreshInterval === 0) return;
        const authState = await hoyoAPI.getHoyoAuthState(connection.id);
        if (version !== scheduleVersion || !authState.signedIn) return;
        const delay = immediate ? 0 : nextDelayMinutes(connection) * 60_000;
        checkTimers.set(connection.id, setTimeout(() => {
            refreshHoyoStatus({ connectionIds: [connection.id] });
        }, delay));
    }));
}

export function refreshHoyoPolling() {
    scheduleNextChecks();
}

export function startHoyoPolling() {
    scheduleNextChecks({ immediate: true });
}

export function stopHoyoPolling() {
    scheduleVersion += 1;
    clearCheckTimers();
    failedChecks.clear();
}

function formatProgress(current, maximum) {
    return Number.isFinite(current) && Number.isFinite(maximum) ? `${current} / ${maximum}` : '확인 불가';
}

function gameLabel(game) {
    return game === 'genshin' ? '원신'
        : game === 'starrail' ? '붕괴: 스타레일'
            : game === 'zzz' ? '젠레스 존 제로'
                : 'HoYoLAB';
}

function statusMessage(status) {
    if (status?.game === 'genshin') {
        const progress = formatProgress(status.daily_task?.completed, status.daily_task?.maximum);
        const reward = status.conditions?.catherine_reward_claimed === true
            ? '캐서린 보상 수령 완료'
            : status.conditions?.catherine_reward_claimed === false
                ? '캐서린 보상 미수령'
                : '캐서린 보상 확인 불가';
        return `원신 · 일일 의뢰 ${progress} · ${reward}`;
    }
    if (status?.game === 'starrail') {
        const progress = formatProgress(status.daily_training?.current, status.daily_training?.maximum);
        const reward = status.conditions?.daily_training_completed === true
            ? '일일 훈련 최대치 도달'
            : status.conditions?.daily_training_completed === false
                ? '일일 훈련 진행 중'
                : '일일 훈련 확인 불가';
        return `붕괴: 스타레일 · 일일 훈련 ${progress} · ${reward}`;
    }
    if (status?.game === 'zzz') {
        const progress = formatProgress(status.daily_engagement?.current, status.daily_engagement?.maximum);
        const reward = status.conditions?.daily_engagement_completed === true
            ? '일일 활약도 최대치 도달'
            : status.conditions?.daily_engagement_completed === false
                ? '일일 활약도 진행 중'
                : '일일 활약도 확인 불가';
        return `젠레스 존 제로 · 일일 활약도 ${progress} · ${reward}`;
    }
    return 'HoYoLAB 상태를 확인했습니다';
}

export async function refreshHoyoStatus({ manual = false, connectionIds = null } = {}) {
    const hoyoAPI = getHoyoAPI();
    if (!hoyoAPI) {
        if (manual) showToast('이 기기에서는 HoYoLAB 상태 확인을 사용할 수 없습니다', 'info');
        return { ok: false, code: 'unsupported' };
    }
    if (!state.isSignedIn) {
        if (manual) showToast('로그인 후 HoYoLAB 상태를 확인할 수 있습니다', 'info');
        return { ok: false, code: 'signed_out' };
    }

    let linkedConnections;
    let allConnections;
    try {
        allConnections = await hoyoAPI.getHoyoConnections();
        linkedConnections = getLinkedHoyoConnections(state.todos, allConnections);
    } catch {
        if (manual) showToast('HoYoLAB 연동 정보를 읽지 못했습니다', 'error');
        return { ok: false, code: 'connection_unavailable' };
    }
    const connections = connectionIds
        ? allConnections.filter(connection => connectionIds.includes(connection.id))
        : manual ? allConnections : linkedConnections;
    if (connections.length === 0) {
        if (manual) showToast('연결된 HoYoLAB 게임 계정이 없습니다', 'info');
        return { ok: false, code: 'no_link' };
    }

    clearCheckTimers();
    const uid = state.uid;
    const results = await Promise.all(connections.map(async connection => {
        if (checksInProgress.has(connection.id)) return { connection, skipped: true };
        checksInProgress.add(connection.id);
        try {
            return { connection, result: await hoyoAPI.checkHoyoStatus(connection.id) };
        } finally {
            checksInProgress.delete(connection.id);
        }
    }));
    if (!state.isSignedIn || state.uid !== uid) return { ok: false, code: 'signed_out' };

    const completed = [];
    const failures = [];
    const successful = [];
    for (const { connection, result, skipped } of results) {
        if (skipped) continue;
        if (!result?.ok) {
            failedChecks.set(connection.id, (failedChecks.get(connection.id) || 0) + 1);
            failures.push(result);
            continue;
        }
        failedChecks.delete(connection.id);
        successful.push({ connection, status: result.status });
        completed.push(...applyHoyoCompletionStatus(connection, result.status).completed);
    }

    if (completed.length > 0) {
        const firstDetails = getHoyoConditionDetails(completed[0].condition);
        const message = `${firstDetails?.notificationText || 'HoYoLAB 완료 조건'}를 확인해 ${completed.length}개 항목을 완료 처리했습니다`;
        if (!manual) showToast(message, 'success');
        showSystemNotification(firstDetails?.notificationTitle || 'HoYoLAB 완료', message);
    }
    if (manual) {
        const messages = results.map(({ connection, result, skipped }) => {
            if (skipped) return `${gameLabel(connection.game)} · 확인 중`;
            if (result?.ok) return statusMessage(result.status);
            return `${gameLabel(connection.game)} · ${result?.message || '상태를 확인하지 못했습니다'}`;
        });
        if (completed.length > 0) messages.push(`${completed.length}개 Todo를 자동 완료 처리했습니다`);
        showToast(messages.join('\n'), completed.length > 0 ? 'success' : failures.length > 0 ? 'error' : 'info');
    }

    scheduleNextChecks();
    return failures.length > 0 && successful.length === 0
        ? failures[0]
        : { ok: true, completed, statuses: successful.map(result => result.status) };
}
