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
let unsubscribeSnapshot = null;
let writeTimer = null;
let lastWriteId = null;

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
    return db.collection(COLLECTION).doc(currentUser.uid).collection('data').doc(DOC_NAME);
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
            db.enablePersistence({ synchronizeTabs: false }).catch(() => { });

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
                if (unsubscribeSnapshot) { unsubscribeSnapshot(); unsubscribeSnapshot = null; }
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
        const ref = userDocRef();
        if (!ref) return;
        if (unsubscribeSnapshot) unsubscribeSnapshot();

        unsubscribeSnapshot = ref.onSnapshot(
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
        const ref = userDocRef();
        if (!ref) return;
        setSyncStatus('syncing');
        if (writeTimer) clearTimeout(writeTimer);
        writeTimer = setTimeout(() => {
            const writeId = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
            lastWriteId = writeId;
            ref.set({
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

    isReady() { return db !== null && currentUser !== null; },

    stop() {
        if (unsubscribeSnapshot) { unsubscribeSnapshot(); unsubscribeSnapshot = null; }
        if (writeTimer) { clearTimeout(writeTimer); writeTimer = null; }
        setSyncStatus('offline');
    },
};

// 외부 스크립트에 의한 속성 추가/수정 방지
// (완전한 보호는 CSP 적용으로 제공됨)
Object.freeze(window.FirebaseSync);

