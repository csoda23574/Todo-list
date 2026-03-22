'use strict';
/* global firebase */

// Firebase 설정 — apiKey는 공개 가능(보안은 Firestore 보안 규칙으로 처리)
const FIREBASE_CONFIG = {
    apiKey: "AIzaSyD5oKyQgAx51Mh35yj7BgsOfYO-tKr2shI",
    authDomain: "todo-list-2695f.firebaseapp.com",
    projectId: "todo-list-2695f",
    storageBucket: "todo-list-2695f.firebasestorage.app",
    messagingSenderId: "848702298682",
    appId: "1:848702298682:web:6ad1193fc0fb314c03b303",
};

// 컬렉션 구조: userData/{uid}/data (사용자별 격리)
const COLLECTION = 'userData';
const DOC_NAME = 'data';

let db = null;
let auth = null;
let currentUser = null;
let unsubTodos = null;
let unsubCategories = null;
let unsubSettings = null;
let writeTimer = null;
let lastWriteId = null;
let netSyncTodos = false;
let netSyncCategories = false;
let netSyncSettings = false;

// ─── 동기화 상태 표시 ────────────────────────────────────────────────────────
function setSyncStatus(status) {
    const dot = document.getElementById('syncDot');
    if (dot) dot.dataset.status = status;
}

// ─── 환경 감지 ──────────────────────────────────────────────────────────────
function isCapacitorNative() {
    return typeof window !== 'undefined' && window.Capacitor?.isNativePlatform?.() === true;
}

// ─── 사용자 문서 경로 ─────────────────────────────────────────────────────────
function userDocRef() {
    if (!db || !currentUser) return null;
    return db.collection(COLLECTION).doc(currentUser.uid);
}

// ─── FirebaseSync 공개 API ───────────────────────────────────────────────────
window.FirebaseSync = {

    /** Firebase 초기화 (Auth 포함). 앱 시작 시 1회 호출. */
    init() {
        try {
            if (typeof firebase === 'undefined') {
                console.warn('[Sync] Firebase SDK가 로드되지 않았습니다.');
                return false;
            }
            if (!firebase.apps.length) {
                firebase.initializeApp(FIREBASE_CONFIG);
            }
            db = firebase.firestore();
            auth = firebase.auth();

            // 오프라인 캐시(IndexedDB) 활성화
            db.enablePersistence({ synchronizeTabs: false }).catch(() => {
                // 멀티탭 환경 또는 시크릿 모드에서는 persistence가 비활성화됨 — 무시
            });

            setSyncStatus('offline');
            return true;
        } catch (e) {
            console.warn('[Sync] 초기화 오류:', e);
            return false;
        }
    },

    /**
     * 인증 상태 변화 감지 시작.
     * onSignIn(user)  — 로그인됐을 때 호출
     * onSignOut()     — 로그아웃됐을 때 호출
     */
    listenAuth(onSignIn, onSignOut) {
        if (!auth) return;

        // (signInWithRedirect 미사용 — getRedirectResult 불필요)

        auth.onAuthStateChanged((user) => {
            if (user) {
                currentUser = user;
                setSyncStatus('connected');
                onSignIn(user);
            } else {
                currentUser = null;
                window.FirebaseSync.stopSyncListeners();
                setSyncStatus('offline');
                onSignOut();
            }
        });
    },

    /** Google 로그인 — 모바일: 네이티브 플러그인 / 데스크탑: 팝업 */
    async signInWithGoogle() {
        if (!auth) return;
        try {
            if (isCapacitorNative()) {
                const { FirebaseAuthentication } = window.Capacitor.Plugins;
                if (!FirebaseAuthentication) throw new Error('FirebaseAuthentication 플러그인 없음');
                const result = await FirebaseAuthentication.signInWithGoogle();
                const idToken = result.credential?.idToken;
                if (!idToken) throw new Error('idToken을 받지 못했습니다.');
                const credential = firebase.auth.GoogleAuthProvider.credential(idToken);
                await auth.signInWithCredential(credential);
            } else {
                const provider = new firebase.auth.GoogleAuthProvider();
                provider.setCustomParameters({ prompt: 'select_account' });
                await auth.signInWithPopup(provider);
            }
        } catch (e) {
            console.warn('[Auth] Google 로그인 오류:', e);
            throw e;
        }
    },

    /** 로그아웃 */
    async signOut() {
        if (!auth) return;
        this.stop();
        // 네이티브 Google Sign-In 세션도 해제해야 다음 로그인 시 계정 선택 창이 표시됨
        if (isCapacitorNative()) {
            const { FirebaseAuthentication } = window.Capacitor?.Plugins ?? {};
            if (FirebaseAuthentication) {
                await FirebaseAuthentication.signOut().catch(() => { });
            }
        }
        await auth.signOut();
    },

    /** 현재 로그인된 사용자 반환 */
    currentUser() { return currentUser; },

    /** 실시간 수신 시작 — 원격 변경 시 onRemoteData(data) 호출 */
    startSync(onRemoteData) {
        const userRef = userDocRef();
        if (!userRef) return;
        this.stopSyncListeners();

        setSyncStatus('connected');

        // 단일 문서 -> Subcollection 마이그레이션 (Fire-and-forget)
        userRef.collection('data').doc('data').get().then(async oldDoc => {
            if (oldDoc.exists) {
                console.log('[Sync] 단일 문서 데이터를 서브컬렉션으로 마이그레이션합니다...');
                const data = oldDoc.data();
                let batch = db.batch();
                let ops = 0;
                const commitBatch = async () => { if (ops > 0) { await batch.commit(); batch = db.batch(); ops = 0; } };

                if (Array.isArray(data.todos)) {
                    for (const t of data.todos) { batch.set(userRef.collection('todos').doc(t.id), t); if (++ops >= 400) await commitBatch(); }
                }
                if (Array.isArray(data.categories)) {
                    for (const c of data.categories) { batch.set(userRef.collection('categories').doc(c.id), c); if (++ops >= 400) await commitBatch(); }
                }
                batch.set(userRef.collection('settings').doc('main'), { settings: data.settings || {}, resetHistory: data.resetHistory || {} });
                if (++ops >= 400) await commitBatch();
                await commitBatch();
                await oldDoc.ref.delete();
                console.log('[Sync] 마이그레이션 완료');
            }
        }).catch(() => { });

        // 개별 서브컬렉션 리스너 등록
        unsubTodos = userRef.collection('todos').onSnapshot(snap => {
            if (!snap.metadata.fromCache) netSyncTodos = true;
            const todos = snap.docs.map(d => d.data());
            todos.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
            onRemoteData({ todos });
        });

        unsubCategories = userRef.collection('categories').onSnapshot(snap => {
            if (!snap.metadata.fromCache) netSyncCategories = true;
            const categories = snap.docs.map(d => d.data());
            categories.sort((a, b) => a.id === 'default' ? -1 : b.id === 'default' ? 1 : a.id.localeCompare(b.id));
            onRemoteData({ categories });
        });

        unsubSettings = userRef.collection('settings').doc('main').onSnapshot(doc => {
            if (!doc.metadata.fromCache) netSyncSettings = true;
            if (doc.exists) {
                const data = doc.data();
                if (data._writeId && data._writeId === lastWriteId) return; // 로컬 쓰기 에코 무시
                onRemoteData({ settingsDoc: data });
            }
        });
    },

    /** 변경된(Diff) 데이터만 추려 Firestore 배치 업데이트 (500ms 디바운스) */
    pushDiffs(todosDiff, categoriesDiff, settingsData) {
        const userRef = userDocRef();
        if (!userRef) return;
        setSyncStatus('syncing');
        if (writeTimer) clearTimeout(writeTimer);

        writeTimer = setTimeout(async () => {
            try {
                let batch = db.batch();
                let ops = 0;
                const commitBatch = async () => { if (ops > 0) { await batch.commit(); batch = db.batch(); ops = 0; } };

                lastWriteId = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

                const applyDiff = async (diff, colName) => {
                    if (!diff) return;
                    const colRef = userRef.collection(colName);
                    for (const item of diff.addedOrModified) {
                        batch.set(colRef.doc(item.id), { ...item, _updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
                        if (++ops >= 400) await commitBatch();
                    }
                    for (const id of diff.deleted) {
                        batch.delete(colRef.doc(id));
                        if (++ops >= 400) await commitBatch();
                    }
                };

                await applyDiff(todosDiff, 'todos');
                await applyDiff(categoriesDiff, 'categories');

                if (settingsData) {
                    batch.set(userRef.collection('settings').doc('main'), {
                        ...settingsData, _writeId: lastWriteId, _updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                    });
                    if (++ops >= 400) await commitBatch();
                }
                await commitBatch();
                setSyncStatus('connected');
            } catch (err) { setSyncStatus('error'); }
        }, 500);
    },

    isReady() { return db !== null && currentUser !== null; },
    isNetworkSyncReady() { return netSyncTodos && netSyncCategories && netSyncSettings; },

    stopSyncListeners() {
        if (unsubTodos) { unsubTodos(); unsubTodos = null; }
        if (unsubCategories) { unsubCategories(); unsubCategories = null; }
        if (unsubSettings) { unsubSettings(); unsubSettings = null; }
    },

    stop() {
        this.stopSyncListeners();
        if (writeTimer) { clearTimeout(writeTimer); writeTimer = null; }
        lastWriteId = null;  // 재로그인 시 이전 write echo 오판 방지
        netSyncTodos = netSyncCategories = netSyncSettings = false;
        setSyncStatus('offline');
    },
};

// 외부 스크립트에 의한 속성 추가/수정 방지
// (완전한 보호는 CSP 적용으로 제공됨)
Object.freeze(window.FirebaseSync);
