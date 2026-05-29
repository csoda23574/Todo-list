/**
 * perf.js — 간단한 렌더 계측 유틸
 */

const _metrics = {
    todos: 0,
    categories: 0,
    bg: 0,
    title: 0,
    lastUpdatedAt: null,
};

function _touch() {
    _metrics.lastUpdatedAt = new Date().toISOString();
}

export function recordRender(kind) {
    if (!_metrics[kind] && _metrics[kind] !== 0) return;
    _metrics[kind] += 1;
    _touch();
}

export function withRenderMetric(kind, fn) {
    return (...args) => {
        recordRender(kind);
        return fn(...args);
    };
}

export function getRenderMetrics() {
    return { ..._metrics };
}

export function resetRenderMetrics() {
    _metrics.todos = 0;
    _metrics.categories = 0;
    _metrics.bg = 0;
    _metrics.title = 0;
    _touch();
}

if (typeof window !== 'undefined') {
    const prev = window.todoDebug || {};
    window.todoDebug = {
        ...prev,
        getRenderMetrics,
        resetRenderMetrics,
    };
}
