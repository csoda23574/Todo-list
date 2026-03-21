/**
 * utils.js — 순수 유틸리티 함수 모음
 * 외부 모듈 의존성 없음 (브라우저 API만 사용)
 */

import { DOM } from './dom.js';

/* ───────────────────────────── 플랫폼 감지 ─────────────────────────────── */

export function isElectron() {
    return typeof window !== 'undefined' && !!window.electronAPI;
}

export function isCapacitorNative() {
    return typeof window !== 'undefined'
        && window.Capacitor?.isNativePlatform?.() === true;
}

/* ──────────────────────────── 시스템 알림 ──────────────────────────────── */

export async function showSystemNotification(title, body) {
    try {
        if (isElectron()) {
            await window.electronAPI.showNotification(title, body);
            return;
        }

        if (isCapacitorNative()) {
            const { LocalNotifications } = window.Capacitor?.Plugins ?? {};
            if (!LocalNotifications) return;

            const permission = await LocalNotifications.checkPermissions();
            if (permission.display !== 'granted') {
                const result = await LocalNotifications.requestPermissions();
                if (result.display !== 'granted') return;
            }
            await LocalNotifications.schedule({
                notifications: [{
                    title,
                    body,
                    id: Date.now(),
                    schedule: { at: new Date(Date.now() + 1000) },
                    sound: undefined,
                    attachments: undefined,
                    actionTypeId: '',
                    extra: null,
                }],
            });
            return;
        }

        if ('Notification' in window) {
            if (Notification.permission === 'granted') {
                new Notification(title, { body });
            } else if (Notification.permission !== 'denied') {
                const perm = await Notification.requestPermission();
                if (perm === 'granted') new Notification(title, { body });
            }
        }
    } catch (err) {
        console.error('[Notification Error]', err);
    }
}

/* ─────────────────────────────── ID 생성 ───────────────────────────────── */

export function generateId() {
    return crypto.randomUUID();
}

/* ───────────────────────────── 토스트 알림 ─────────────────────────────── */

export function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    // innerHTML 대신 DOM API 사용 — XSS 원체 차단
    const dot = document.createElement('span');
    dot.className = 'toast-dot';
    toast.appendChild(dot);
    toast.appendChild(document.createTextNode(message));
    const container = DOM.toastContainer;
    if (!container) return;
    container.appendChild(toast);

    setTimeout(() => {
        toast.classList.add('leaving');
        toast.addEventListener('animationend', () => toast.remove());
    }, 2400);
}

/* ──────────────────────────── HTML 이스케이프 ──────────────────────────── */

export function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

/* ─────────────────────────────── 날짜/시간 포맷 ───────────────────────── */

export const WEEKDAY_NAMES = ['일', '월', '화', '수', '목', '금', '토'];

export function formatItemDatetime(dt) {
    if (!dt) return '';
    return new Date(dt).toLocaleString('ko-KR', {
        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    });
}

export function formatScheduleBadge(s) {
    if (!s) return '';
    const time = s.time || '';
    if (s.type === 'weekly') {
        const days = (s.weekdays || []).map(d => WEEKDAY_NAMES[d]).join('·');
        return `🔄 매주 ${days} ${time}`;
    }
    if (s.type === 'monthly') {
        const days = (s.days || []).join('·');
        return `🔄 매월 ${days}일 ${time}`;
    }
    if (s.type === 'yearly') {
        const dates = (s.dates || []).map(d => `${d.month}/${d.day}`).join('·');
        return `🔄 매년 ${dates} ${time}`;
    }
    return '';
}

export function formatTime(isoStr) {
    if (!isoStr) return '';
    return new Date(isoStr).toLocaleTimeString('ko-KR', {
        hour: '2-digit', minute: '2-digit',
    });
}
