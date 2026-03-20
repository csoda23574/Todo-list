/**
 * todos.js — 할 일 CRUD 연산
 *
 * 관심사: todos 배열의 변경, 저장, 렌더링 트리거
 */

import { state } from './state.js';
import { saveTodos } from './storage.js';
import { emit } from './bus.js'; // renderer 직접 의존 제거 — DIP
import { showToast, generateId } from './utils.js';

/* ──────────────────────────── 추가 ────────────────────────────────────── */

export function addTodo(text, note, priority, itemResetTime, itemResetDatetime, itemResetSchedule) {
    const todo = {
        id: generateId(),
        text: text.trim(),
        note: note.trim(),
        priority: priority || 'medium',
        done: false,
        createdAt: new Date().toISOString(),
        itemResetTime: itemResetTime || null,
        itemResetDatetime: itemResetDatetime || null,
        itemResetSchedule: itemResetSchedule || null,
        categoryId: state.currentCategoryId,
    };
    state.todos.unshift(todo);
    saveTodos();
    emit('todos:changed');
    showToast('새 할 일이 추가되었습니다', 'success');
}

/* ──────────────────────────── 수정 ────────────────────────────────────── */

export function editTodo(id, text, note, priority, itemResetTime, itemResetDatetime, itemResetSchedule) {
    const idx = state.todos.findIndex(t => t.id === id);
    if (idx === -1) return;

    state.todos[idx] = {
        ...state.todos[idx],
        text,
        note,
        priority: priority || 'medium',
        itemResetTime: itemResetTime || null,
        itemResetDatetime: itemResetDatetime || null,
        itemResetSchedule: itemResetSchedule || null,
    };
    saveTodos();
    emit('todos:changed');
    showToast('할 일이 수정되었습니다', 'info');
}

/* ──────────────────────────── 삭제 ────────────────────────────────────── */

export function deleteTodo(id) {
    const el = document.querySelector(`[data-id="${id}"]`);
    if (el) {
        el.classList.add('removing');
        el.addEventListener('animationend', () => {
            state.todos = state.todos.filter(t => t.id !== id);
            saveTodos();
            emit('todos:changed');
        }, { once: true });
    } else {
        state.todos = state.todos.filter(t => t.id !== id);
        saveTodos();
        emit('todos:changed');
    }
    showToast('항목이 삭제되었습니다', 'error');
}

/* ──────────────────────── 완료 토글 ───────────────────────────────────── */

export function toggleTodo(id, done) {
    const idx = state.todos.findIndex(t => t.id === id);
    if (idx === -1) return;

    state.todos[idx] = { ...state.todos[idx], done };
    saveTodos();
    emit('todos:changed');
    if (done) showToast('완료 처리되었습니다!', 'success');
}

/* ──────────────────────── 전체 삭제 ───────────────────────────────────── */

export function clearAllTodos(silent = false) {
    state.todos = [];
    saveTodos();
    emit('todos:changed');
    if (!silent) showToast('모든 할 일이 삭제되었습니다', 'info');
}

/* ───────────────── 자동 초기화 (완료 해제, 항목 유지) ─────────────────── */

export function resetAllTodos() {
    state.todos = state.todos.map(t => ({ ...t, done: false }));
    saveTodos();
    emit('todos:changed');
}
