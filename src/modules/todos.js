/**
 * todos.js — 할 일 CRUD 연산
 *
 * 관심사: todos 배열의 변경, 저장, 렌더링 트리거
 */

import { state } from './state.js';
import { saveTodos } from './storage.js';
import { emit } from './bus.js';
import { showToast, generateId } from './utils.js';
import { deleteTodoRemote } from './sync.js';
import { calcNextDueAfter } from './recurrence.js';

/* ──────────────────────────── 추가 ────────────────────────────────────── */

export function addTodo(text, note, priority, recurrence) {
    const nextDue = recurrence
        ? calcNextDueAfter(recurrence, new Date(), new Date())?.toISOString() ?? null
        : null;
    const todo = {
        id: generateId(),
        text: text.trim(),
        note: note.trim(),
        priority: priority || 'medium',
        done: false,
        createdAt: new Date().toISOString(),
        recurrence: recurrence || null,
        nextDue,
        categoryId: state.currentCategoryId,
    };
    state.todos.unshift(todo);
    saveTodos(todo);
    emit('todos:changed');
    showToast('새 할 일이 추가되었습니다', 'success');
}

/* ──────────────────────────── 수정 ────────────────────────────────────── */

export function editTodo(id, text, note, priority, recurrence) {
    const idx = state.todos.findIndex(t => t.id === id);
    if (idx === -1) return;

    const nextDue = recurrence
        ? calcNextDueAfter(recurrence, new Date(), new Date())?.toISOString() ?? null
        : null;
    state.todos[idx] = {
        ...state.todos[idx],
        text,
        note,
        priority: priority || 'medium',
        recurrence: recurrence || null,
        nextDue,
    };
    saveTodos(state.todos[idx]);
    emit('todos:changed');
    showToast('할 일이 수정되었습니다', 'info');
}

/* ──────────────────────────── 삭제 ────────────────────────────────────── */

const removeTodoState = (id) => {
    state.todos = state.todos.filter(t => t.id !== id);
    saveTodos();
    if (state.isSignedIn) deleteTodoRemote(id);
    emit('todos:changed');
};

export function deleteTodo(id) {
    const el = document.querySelector(`[data-id="${id}"]`);
    if (el) {
        el.classList.add('removing');
        el.addEventListener('animationend', () => removeTodoState(id), { once: true });
    } else {
        removeTodoState(id);
    }
    showToast('항목이 삭제되었습니다', 'error');
}

/* ──────────────────────── 완료 토글 ───────────────────────────────────── */

export function toggleTodo(id, done) {
    const idx = state.todos.findIndex(t => t.id === id);
    if (idx === -1) return;

    state.todos[idx] = {
        ...state.todos[idx],
        done,
        completedAt: done ? new Date().toISOString() : null,
    };
    saveTodos(state.todos[idx]);
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
