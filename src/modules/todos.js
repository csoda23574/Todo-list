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
    const minOrder = state.todos.length > 0
        ? Math.min(...state.todos.map(t => t.order ?? 0)) - 1
        : 0;
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
        order: minOrder,
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

/* ──────────────────────── 순서 변경 ───────────────────────────────────── */

/**
 * 드래그앤드롭으로 할 일 순서를 변경합니다.
 * @param {string} dragId   - 드래그 중인 항목 id
 * @param {string} targetId - 삽입 기준이 되는 항목 id
 * @param {'before'|'after'} position - 기준 항목 앞/뒤
 */
export function reorderTodo(dragId, targetId, position) {
    if (dragId === targetId) return;
    const srcIdx = state.todos.findIndex(t => t.id === dragId);
    const tgtIdx = state.todos.findIndex(t => t.id === targetId);
    if (srcIdx === -1 || tgtIdx === -1) return;

    const [moved] = state.todos.splice(srcIdx, 1);
    const insertAt = state.todos.findIndex(t => t.id === targetId);
    state.todos.splice(position === 'before' ? insertAt : insertAt + 1, 0, moved);

    // order 필드를 현재 배열 인덱스 기준으로 갱신 (Firestore 동기화용)
    state.todos.forEach((t, i) => { t.order = i; });

    saveTodos();
    emit('todos:changed');
}



export function clearAllTodos(silent = false) {
    state.todos = [];
    saveTodos();
    emit('todos:changed');
    if (!silent) showToast('모든 할 일이 삭제되었습니다', 'info');
}
