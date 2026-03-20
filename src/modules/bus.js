/**
 * bus.js — 경량 이벤트 버스 (Observer / Pub-Sub 패턴)
 *
 * 데이터·도메인 레이어가 UI 렌더링 레이어를 직접 import하지 않도록
 * 결합을 끊어 주는 중간 계층입니다.
 *
 * DIP (의존성 역전 원칙):
 *   - 구체 모듈(renderer, reset…)에 직접 의존하는 대신 이벤트를 발행합니다.
 *   - 실제 핸들러 등록은 app.js(Composition Root)에서만 이루어집니다.
 *
 * 이벤트 목록:
 *   'todos:changed'      → renderTodos()
 *   'categories:changed' → renderCategoryTabs() + renderTodos()
 *   'bg:changed'         → applyBackground()
 *   'title:changed'      → applyAppTitle()
 *   'reset:reschedule'   → scheduleResetTimer()
 */

const _listeners = Object.create(null);

/** 이벤트 핸들러를 등록합니다. */
export function on(event, handler) {
    (_listeners[event] ??= []).push(handler);
}

/** 이벤트 핸들러를 제거합니다. */
export function off(event, handler) {
    if (!_listeners[event]) return;
    _listeners[event] = _listeners[event].filter(h => h !== handler);
}

/** 이벤트를 발행합니다 — 등록된 모든 핸들러를 동기적으로 호출합니다. */
export function emit(event, payload) {
    _listeners[event]?.forEach(h => h(payload));
}
