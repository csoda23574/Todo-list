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

const COLLECTION = 'userData';
const DOC_ID = 'owner';

let db = null;
let unsubscribeSnapshot = null;
let writeTimer = null;
let lastWriteId = null;

// ─── 동기화 상태 표시 ────────────────────────────────────────────────────────
function setSyncStatus(status) {
    const dot = document.getElementById('syncDot');
    if (dot) dot.dataset.status = status;
}

// ─── FirebaseSync 공개 API ───────────────────────────────────────────────────
window.FirebaseSync = {

    /** Firebase 초기화 및 Firestore 연결 */
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

            // 오프라인 캐시(IndexedDB) 활성화 — synchronizeTabs 옵션은 Android WebView 미지원
            db.enablePersistence().catch(() => { });

            setSyncStatus('connected');
            return true;
        } catch (e) {
            console.warn('[Sync] 초기화 오류:', e);
            setSyncStatus('error');
            return false;
        }
    },

    /** 실시간 수신 시작 — 원격 변경 시 onRemoteData(data) 호출 */
    startSync(onRemoteData) {
        if (!db) return;
        if (unsubscribeSnapshot) unsubscribeSnapshot();

        unsubscribeSnapshot = db.collection(COLLECTION).doc(DOC_ID)
            .onSnapshot(
                (doc) => {
                    setSyncStatus('connected');
                    if (!doc.exists) return;
                    const data = doc.data();
                    if (!data) return;
                    // 내 자신의 쓰기 반사(echo)는 무시
                    if (data._writeId && data._writeId === lastWriteId) return;
                    onRemoteData(data);
                },
                (err) => {
                    console.warn('[Sync] 스냅샷 오류:', err);
                    setSyncStatus('error');
                }
            );
    },

    /** Firestore에 데이터 쓰기 (800ms 디바운스) */
    push(payload) {
        if (!db) return;
        setSyncStatus('syncing');
        if (writeTimer) clearTimeout(writeTimer);
        writeTimer = setTimeout(() => {
            const writeId = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
            lastWriteId = writeId;
            db.collection(COLLECTION).doc(DOC_ID)
                .set({
                    ...payload,
                    _writeId: writeId,
                    _updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
                })
                .then(() => setSyncStatus('connected'))
                .catch((e) => {
                    console.warn('[Sync] 쓰기 오류:', e);
                    setSyncStatus('error');
                });
        }, 800);
    },

    isReady() { return db !== null; },

    stop() {
        if (unsubscribeSnapshot) { unsubscribeSnapshot(); unsubscribeSnapshot = null; }
        if (writeTimer) { clearTimeout(writeTimer); writeTimer = null; }
        setSyncStatus('offline');
    },
};
