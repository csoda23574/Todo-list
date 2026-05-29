/**
 * sync.js — Firestore 실시간 동기화
 *
 * Firestore 경로:
 *   users/{uid}/todos     (컬렉션 — todo 개별 문서)
 *   users/{uid}/categories (컬렉션 — 카테고리 개별 문서)
 *   users/{uid}/settings/main (단일 문서 — bgImage 제외)
 *
 * 충돌 해결: updatedAt 타임스탬프 기반 Last-Write-Wins
 * bgImage(IDB), 초기화 타임스탬프(localStorage)는 동기화 제외
 */

import { db } from './firebase.js';
import { state } from './state.js';
import { emit } from './bus.js';

/* ────────────────── Firestore 경로 헬퍼 ──────────────────────────────── */

const userRef   = () => db.collection('users').doc(state.uid);
const todosRef  = () => userRef().collection('todos');
const catsRef   = () => userRef().collection('categories');
const settingsRef = () => userRef().collection('settings').doc('main');

/* ────────────────── 내부 플래그 (자기 변경 무시용) ──────────────────── */

// 로컬에서 변경 중일 때 onSnapshot 콜백이 중복 렌더를 하지 않도록 방지
// 여러 save* 함수가 동시에 실행될 수 있으므로 boolean 대신 카운터 사용
let _pendingWriteCount = 0;
const _localWritePending = () => _pendingWriteCount > 0;
export function setLocalWritePending(v) {
    if (v) {
        _pendingWriteCount++;
    } else {
        _pendingWriteCount = Math.max(0, _pendingWriteCount - 1);
    }
}

/* ────────────────── Todos 동기화 ─────────────────────────────────────── */

/**
 * 단일 todo를 Firestore에 upsert합니다.
 */
export async function pushTodo(todo) {
    if (!state.isSignedIn) return;
    try {
        await todosRef().doc(todo.id).set({
            ...todo,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
        });
    } catch (err) {
        console.error('[Sync] todo push 실패:', err);
    }
}

/**
 * 단일 todo를 Firestore에서 삭제합니다.
 */
export async function deleteTodoRemote(id) {
    if (!state.isSignedIn) return;
    try {
        await todosRef().doc(id).delete();
    } catch (err) {
        console.error('[Sync] todo delete 실패:', err);
    }
}

/**
 * 전체 todos를 Firestore에 일괄 업로드합니다.
 * (로그인 직후 로컬 → 서버 초기 동기화용)
 */
export async function pushAllTodos(todos) {
    if (!state.isSignedIn || !todos.length) return;
    const batch = db.batch();
    const ts = firebase.firestore.FieldValue.serverTimestamp();
    todos.forEach(t => {
        batch.set(todosRef().doc(t.id), { ...t, updatedAt: ts });
    });
    await batch.commit();
}

/* ────────────────── Categories 동기화 ──────────────────────────────── */

export async function pushCategories(categories, currentCategoryId) {
    if (!state.isSignedIn) return;
    try {
        const batch = db.batch();
        const ts = firebase.firestore.FieldValue.serverTimestamp();

        // 기존 카테고리 전부 교체 (단순 전략 — 카테고리는 소량)
        const snap = await catsRef().get();
        snap.forEach(doc => batch.delete(doc.ref));
        categories.forEach((c, i) => {
            batch.set(catsRef().doc(c.id), { ...c, order: i, updatedAt: ts });
        });
        // 현재 선택 카테고리도 settings/main에 저장
        batch.set(settingsRef(), { currentCategoryId, updatedAt: ts }, { merge: true });

        await batch.commit();
    } catch (err) {
        console.error('[Sync] categories push 실패:', err);
    }
}

/* ────────────────── Settings 동기화 ─────────────────────────────────── */

export async function pushSettings(settings) {
    if (!state.isSignedIn) return;
    try {
        // bgImage는 대용량이므로 동기화 제외
        const { bgImage, bgFileName, ...syncable } = settings;
        await settingsRef().set({
            ...syncable,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
    } catch (err) {
        console.error('[Sync] settings push 실패:', err);
    }
}

/* ────────────────── 실시간 리스너 ───────────────────────────────────── */

let _unsubTodos    = null;
let _unsubCats     = null;
let _unsubSettings = null;

function _sameTodo(a, b) {
    return a.id === b.id
        && a.text === b.text
        && a.note === b.note
        && a.priority === b.priority
        && a.done === b.done
        && (a.completedAt ?? null) === (b.completedAt ?? null)
        && (a.createdAt ?? null) === (b.createdAt ?? null)
        && (a.updatedAt ?? null) === (b.updatedAt ?? null)
        && (a.categoryId ?? 'default') === (b.categoryId ?? 'default')
        && (a.itemResetTime ?? null) === (b.itemResetTime ?? null)
        && JSON.stringify(a.itemResetSchedule ?? null) === JSON.stringify(b.itemResetSchedule ?? null);
}

function _sameTodos(nextTodos, prevTodos) {
    if (nextTodos.length !== prevTodos.length) return false;
    for (let i = 0; i < nextTodos.length; i++) {
        if (!_sameTodo(nextTodos[i], prevTodos[i])) return false;
    }
    return true;
}

function _sameCategories(nextCats, prevCats) {
    if (nextCats.length !== prevCats.length) return false;
    for (let i = 0; i < nextCats.length; i++) {
        if (nextCats[i].id !== prevCats[i].id) return false;
        if (nextCats[i].name !== prevCats[i].name) return false;
        if ((nextCats[i].order ?? i) !== (prevCats[i].order ?? i)) return false;
    }
    return true;
}

export function getSettingsChangeFlags(prevSettings, nextSettings) {
    return {
        bgChanged: prevSettings.bgOpacity !== nextSettings.bgOpacity
            || prevSettings.bgBlur !== nextSettings.bgBlur,
        titleChanged: prevSettings.appTitle !== nextSettings.appTitle,
        resetChanged: prevSettings.resetEnabled !== nextSettings.resetEnabled
            || prevSettings.resetTime !== nextSettings.resetTime
            || prevSettings.resetRepeat !== nextSettings.resetRepeat
            || prevSettings.lastGlobalResetAt !== nextSettings.lastGlobalResetAt
            || prevSettings.resetCalendarDate !== nextSettings.resetCalendarDate,
    };
}

/**
 * Firestore onSnapshot 리스너를 시작합니다.
 * 로그인 성공 후 1회 호출. 로그아웃 시 stopListeners()로 해제.
 */
export function startListeners() {
    stopListeners(); // 혹시 이전 리스너가 남아있으면 정리

    // ── Todos 리스너 ──
    _unsubTodos = todosRef().onSnapshot(snap => {
        if (_localWritePending()) return; // 자기 변경 무시

        const remoteTodos = snap.docs.map(doc => {
            const data = doc.data();
            // Firestore Timestamp → ISO string 변환
            return {
                ...data,
                id: doc.id,
                createdAt: data.createdAt?.toDate?.()?.toISOString?.() ?? data.createdAt,
                updatedAt: data.updatedAt?.toDate?.()?.toISOString?.() ?? data.updatedAt,
            };
        });

        // updatedAt 기반으로 최신 항목만 적용 (충돌 해결)
        const localMap = new Map(state.todos.map(t => [t.id, t]));
        remoteTodos.forEach(remote => {
            const local = localMap.get(remote.id);
            if (!local) {
                localMap.set(remote.id, remote);
                return;
            }
            const remoteTs = new Date(remote.updatedAt || 0).getTime();
            const localTs  = new Date(local.updatedAt  || 0).getTime();
            if (remoteTs >= localTs) localMap.set(remote.id, remote);
        });

        // 원격에서 삭제된 항목 제거
        const remoteIds = new Set(remoteTodos.map(t => t.id));
        for (const [id] of localMap) {
            if (!remoteIds.has(id)) localMap.delete(id);
        }

        const mergedTodos = [...localMap.values()].sort((a, b) =>
            new Date(b.createdAt) - new Date(a.createdAt)
        );
        if (_sameTodos(mergedTodos, state.todos)) return;
        state.todos = mergedTodos;
        emit('todos:changed');
    }, err => console.error('[Sync] todos 리스너 오류:', err));

    // ── Categories 리스너 ──
    _unsubCats = catsRef().onSnapshot(snap => {
        if (_localWritePending()) return;
        if (snap.empty) return;

        const cats = snap.docs
            .map(doc => ({ id: doc.id, ...doc.data() }))
            .sort((a, b) => (a.order ?? 999) - (b.order ?? 999));
        if (cats.length) {
            const prevCats = state.categories;
            const prevCurrent = state.currentCategoryId;

            state.categories = cats;
            if (!state.categories.find(c => c.id === state.currentCategoryId)) {
                state.currentCategoryId = state.categories[0].id;
            }
            if (_sameCategories(state.categories, prevCats) && prevCurrent === state.currentCategoryId) return;
            emit('categories:changed');
        }
    }, err => console.error('[Sync] categories 리스너 오류:', err));

    // ── Settings 리스너 ──
    _unsubSettings = settingsRef().onSnapshot(snap => {
        if (_localWritePending()) return;
        if (!snap.exists) return;

        const data = snap.data();
        const { updatedAt, currentCategoryId, ...remoteSettings } = data;

        const prevSettings = state.settings;

        state.settings = { ...state.settings, ...remoteSettings };
        // currentCategoryId는 앱 시작 시 적용하지 않음 (항상 첫 번째 카테고리로 시작)

        const {
            bgChanged,
            titleChanged,
            resetChanged,
        } = getSettingsChangeFlags(prevSettings, state.settings);

        if (bgChanged) emit('bg:changed');
        if (titleChanged) emit('title:changed');
        if (resetChanged) emit('reset:reschedule');
    }, err => console.error('[Sync] settings 리스너 오류:', err));
}

/**
 * 모든 Firestore 리스너를 해제합니다.
 */
export function stopListeners() {
    _unsubTodos?.();
    _unsubCats?.();
    _unsubSettings?.();
    _unsubTodos = _unsubCats = _unsubSettings = null;
}

/* ────────────────── 초기 데이터 병합 전략 ───────────────────────────── */

/**
 * 로그인 직후 서버 데이터를 가져와 로컬과 병합합니다.
 * - 서버에 데이터가 있으면 → 서버를 우선하되, 로컬에만 있는 새 항목은 push
 * - 서버가 비어있고 로컬에 데이터가 있으면 → 로컬을 서버로 업로드
 */
export async function initialMerge() {
    try {
        const snap = await todosRef().get();
        if (snap.empty && state.todos.length > 0) {
            // 신규 계정 — 로컬 데이터를 서버로 업로드
            await pushAllTodos(state.todos);
        } else if (!snap.empty) {
            // 기존 계정 — 서버 데이터로 덮어쓰기 (가장 최근 기기 우선)
            const remoteTodos = snap.docs.map(doc => {
                const data = doc.data();
                return {
                    ...data,
                    id: doc.id,
                    createdAt: data.createdAt?.toDate?.()?.toISOString?.() ?? data.createdAt,
                    updatedAt: data.updatedAt?.toDate?.()?.toISOString?.() ?? data.updatedAt,
                };
            }).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
            if (!_sameTodos(remoteTodos, state.todos)) {
                state.todos = remoteTodos;
                emit('todos:changed');
            }
        }

        // Categories 초기 로드
        const catSnap = await catsRef().get();
        if (!catSnap.empty) {
            const cats = catSnap.docs
                .map(doc => ({ id: doc.id, ...doc.data() }))
                .sort((a, b) => (a.order ?? 999) - (b.order ?? 999));
            if (cats.length) {
                const prevCats = state.categories;
                const prevCurrent = state.currentCategoryId;
                state.categories = cats;
                // 항상 첫 번째(가장 왼쪽) 카테고리로 시작
                state.currentCategoryId = state.categories[0].id;
                if (!_sameCategories(state.categories, prevCats) || state.currentCategoryId !== prevCurrent) {
                    emit('categories:changed');
                }
            }
        } else if (state.categories.length) {
            await pushCategories(state.categories, state.currentCategoryId);
        }

        // Settings 초기 로드
        const setSnap = await settingsRef().get();
        if (setSnap.exists) {
            const { updatedAt, currentCategoryId, ...remoteSettings } = setSnap.data();
            const prevSettings = { ...state.settings };
            state.settings = { ...state.settings, ...remoteSettings };
            // currentCategoryId는 앱 시작 시 적용하지 않음 (항상 첫 번째 카테고리로 시작)
            const { bgChanged, titleChanged, resetChanged } = getSettingsChangeFlags(prevSettings, state.settings);
            // title은 로그인 직후 항상 DOM에 적용 (로컬과 같아도 최신값 보장)
            emit('title:changed');
            if (bgChanged) emit('bg:changed');
            if (resetChanged) emit('reset:reschedule');
        } else {
            await pushSettings(state.settings);
        }
    } catch (err) {
        console.error('[Sync] initialMerge 오류:', err);
    }
}
