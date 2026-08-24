/**
 * presets.js — 프리셋 공유 기능
 *
 * Firestore 경로:
 *   presets/{code}  (최상위 컬렉션)
 *     uid, name, code, createdAt, categories[]
 *
 * 유저 보유 코드 목록: state.settings.presetCodes[] → Firestore settings 동기화
 *
 * 제약:
 *   - 유저 1인당 최대 5개
 *   - 스냅샷 방식 (1회성 복사)
 */

import { db } from './firebase.js';
import { state } from './state.js';
import { generateId, showToast, escapeHtml } from './utils.js';
import { saveSettings, saveTodos } from './storage.js';
import { pushCategories } from './sync.js';
import { emit } from './bus.js';

const MAX_PRESETS = 5;
const CODE_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789';
const presetsCol = () => db.collection('presets');

/* ─────────── 코드 생성 ─────────────────────────────────────────────────── */

function _genCode() {
    let c = '';
    for (let i = 0; i < 6; i++) c += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    return c;
}

async function _uniqueCode() {
    for (let i = 0; i < 5; i++) {
        const code = _genCode();
        const snap = await presetsCol().doc(code).get();
        if (!snap.exists) return code;
    }
    throw new Error('코드 생성 실패. 다시 시도해 주세요.');
}

/* ─────────── 프리셋 생성 ────────────────────────────────────────────────── */

export async function createPreset(name, categoryIds) {
    if (!state.isSignedIn) { showToast('로그인이 필요합니다', 'error'); return null; }

    const codes = state.settings.presetCodes || [];
    if (codes.length >= MAX_PRESETS) {
        showToast(`프리셋은 최대 ${MAX_PRESETS}개까지 저장 가능합니다`, 'error');
        return null;
    }
    if (!name.trim()) { showToast('프리셋 이름을 입력해주세요', 'error'); return null; }
    if (!categoryIds.length) { showToast('공유할 탭을 하나 이상 선택해주세요', 'error'); return null; }

    try {
        const code = await _uniqueCode();

        const categories = categoryIds.map(catId => {
            const cat = state.categories.find(c => c.id === catId);
            if (!cat) return null;
            const todos = state.todos
                .filter(t => t.categoryId === catId)
                .map(t => ({
                    text: t.text,
                    note: t.note || '',
                    priority: t.priority || 'medium',
                    recurrence: t.recurrence || null,
                    checklist: (t.checklist || []).map(c => ({ id: c.id, text: c.text, done: false })),
                    done: false,
                    completedAt: null,
                    order: t.order ?? 0,
                }));
            return { name: cat.name, todos };
        }).filter(Boolean);

        await presetsCol().doc(code).set({
            code, uid: state.uid, name: name.trim(),
            createdAt: new Date().toISOString(), categories,
        });

        state.settings.presetCodes = [...codes, code];
        saveSettings();

        showToast(`프리셋 '${name}' 생성 완료 (코드: ${code})`, 'success');
        return code;
    } catch (err) {
        console.error('[Preset] 생성 오류:', err);
        showToast('프리셋 생성에 실패했습니다', 'error');
        return null;
    }
}

/* ─────────── 프리셋 삭제 ────────────────────────────────────────────────── */

export async function deletePreset(code) {
    if (!state.isSignedIn) return false;
    try {
        const snap = await presetsCol().doc(code).get();
        if (!snap.exists) { showToast('존재하지 않는 프리셋입니다', 'error'); return false; }
        if (snap.data().uid !== state.uid) { showToast('삭제 권한이 없습니다', 'error'); return false; }

        await presetsCol().doc(code).delete();
        state.settings.presetCodes = (state.settings.presetCodes || []).filter(c => c !== code);
        saveSettings();
        showToast('프리셋이 삭제되었습니다', 'success');
        return true;
    } catch (err) {
        console.error('[Preset] 삭제 오류:', err);
        showToast('프리셋 삭제에 실패했습니다', 'error');
        return false;
    }
}

/* ─────────── 프리셋 가져오기 ────────────────────────────────────────────── */

export async function importPreset(code) {
    if (!state.isSignedIn) { showToast('로그인이 필요합니다', 'error'); return false; }

    const trimmed = code.trim().toLowerCase();
    if (trimmed.length !== 6) { showToast('프리셋 코드는 6자리입니다', 'error'); return false; }

    try {
        const snap = await presetsCol().doc(trimmed).get();
        if (!snap.exists) { showToast('존재하지 않는 프리셋 코드입니다', 'error'); return false; }

        const data = snap.data();
        if (!data.categories?.length) { showToast('가져올 데이터가 없습니다', 'error'); return false; }

        let totalTodos = 0;
        const now = new Date().toISOString();

        for (const cat of data.categories) {
            const newCatId = `cat_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
            state.categories.push({ id: newCatId, name: cat.name });

            const todos = (cat.todos || []).map((t, i) => ({
                id: generateId(),
                text: t.text,
                note: t.note || '',
                priority: t.priority || 'medium',
                recurrence: t.recurrence || null,
                nextDue: null,
                checklist: t.checklist?.length
                    ? t.checklist.map(c => ({ id: generateId(), text: c.text, done: false }))
                    : null,
                done: false,
                completedAt: null,
                createdAt: now,
                updatedAt: now,
                categoryId: newCatId,
                order: i,
            }));

            state.todos.push(...todos);
            totalTodos += todos.length;
        }

        await pushCategories(state.categories, state.currentCategoryId);
        saveTodos();
        emit('categories:changed');
        emit('todos:changed');

        showToast(
            `'${data.name}' 가져오기 완료 (${data.categories.length}개 탭, ${totalTodos}개 할 일)`,
            'success'
        );
        return true;
    } catch (err) {
        console.error('[Preset] 가져오기 오류:', err);
        showToast('프리셋 가져오기에 실패했습니다', 'error');
        return false;
    }
}

/* ─────────── 유저 프리셋 목록 조회 ─────────────────────────────────────── */

export async function loadUserPresets() {
    const codes = state.settings.presetCodes || [];
    if (!codes.length) return [];

    try {
        const results = await Promise.all(codes.map(async code => {
            try {
                const snap = await presetsCol().doc(code).get();
                if (!snap.exists) return null;
                const d = snap.data();
                return {
                    code: d.code,
                    name: d.name,
                    createdAt: d.createdAt,
                    categoryCount: (d.categories || []).length,
                    todoCount: (d.categories || []).reduce((s, c) => s + (c.todos || []).length, 0),
                };
            } catch { return null; }
        }));

        const valid = results.filter(Boolean);
        if (valid.length !== codes.length) {
            state.settings.presetCodes = valid.map(p => p.code);
            saveSettings();
        }
        return valid;
    } catch (err) {
        console.error('[Preset] 목록 로드 오류:', err);
        return [];
    }
}

/* ─────────── 설정 창 프리셋 목록 렌더링 ────────────────────────────────── */

export async function renderPresetList() {
    const listEl = document.getElementById('presetList');
    const countEl = document.getElementById('presetCountBadge');
    if (!listEl) return;

    listEl.innerHTML = '<div class="preset-list-loading">불러오는 중...</div>';
    const presets = await loadUserPresets();

    if (countEl) countEl.textContent = `${presets.length} / ${MAX_PRESETS}`;

    if (!presets.length) {
        listEl.innerHTML = '<div class="preset-list-empty">저장된 프리셋이 없습니다</div>';
        return;
    }

    listEl.innerHTML = presets.map(p => `
        <div class="preset-item" data-code="${escapeHtml(p.code)}">
            <div class="preset-item-info">
                <span class="preset-item-name">${escapeHtml(p.name)}</span>
                <span class="preset-item-meta">${p.categoryCount}개 탭 · ${p.todoCount}개 할 일</span>
            </div>
            <div class="preset-item-actions">
                <button class="preset-code-btn" data-code="${escapeHtml(p.code)}" title="코드 복사">
                    <code class="preset-code-text">${escapeHtml(p.code)}</code>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12">
                        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                    </svg>
                </button>
                <button class="preset-delete-btn icon-btn" data-code="${escapeHtml(p.code)}" title="삭제" aria-label="프리셋 삭제">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
                        <polyline points="3 6 5 6 21 6"/>
                        <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                        <path d="M10 11v6M14 11v6"/>
                        <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
                    </svg>
                </button>
            </div>
        </div>
    `).join('');

    listEl.querySelectorAll('.preset-code-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            navigator.clipboard.writeText(btn.dataset.code)
                .then(() => showToast(`코드 '${btn.dataset.code}' 복사됨`, 'success'))
                .catch(() => showToast(`코드: ${btn.dataset.code}`, 'info'));
        });
    });

    listEl.querySelectorAll('.preset-delete-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            if (!confirm(`프리셋 '${btn.dataset.code}'를 삭제하시겠습니까?\n삭제 후에는 이 코드로 가져오기가 불가능합니다.`)) return;
            const ok = await deletePreset(btn.dataset.code);
            if (ok) renderPresetList();
        });
    });
}
