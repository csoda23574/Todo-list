/**
 * firebase.js — Firebase 초기화 및 인증 헬퍼
 *
 * - Electron (Desktop): Web SDK signInWithPopup
 * - Android Capacitor: @capacitor-firebase/authentication 네이티브 플러그인
 *
 * 플랫폼 감지:
 *   isCapacitorNative === true  → Android 네이티브 플러그인 경로
 *   isCapacitorNative === false → Electron / 브라우저 Web SDK 경로
 */

const firebaseConfig = {
    apiKey: "AIzaSyBz8MEzFabzyJvYp9ZeQ54Su3NsUDghpuM",
    authDomain: "todo-ff76f.firebaseapp.com",
    projectId: "todo-ff76f",
    storageBucket: "todo-ff76f.firebasestorage.app",
    messagingSenderId: "923976771382",
    appId: "1:923976771382:web:44bd289b6f82c9046b3597",
};

// Firebase SDK는 index.html의 <script> 태그로 이미 로드됨 (compat 번들)
const app = firebase.initializeApp(firebaseConfig);

export const auth = firebase.auth();
export const db   = firebase.firestore();

// Firestore 오프라인 지속성 (경고는 무시해도 무방 — compat API 한정 동작)
db.enablePersistence({ synchronizeTabs: true }).catch(err => {
    if (err.code !== 'failed-precondition' && err.code !== 'unimplemented') {
        console.warn('[Firestore] 오프라인 지속성 오류:', err.code);
    }
});

// 플랫폼 감지
export const isCapacitorNative =
    typeof window !== 'undefined' &&
    !!window.Capacitor?.isNativePlatform?.();

/**
 * Google 로그인 실행
 * - Electron/브라우저: signInWithPopup
 * - Android 네이티브: @capacitor-firebase/authentication
 */
export async function signInWithGoogle() {
    if (isCapacitorNative) {
        // Capacitor 네이티브 플러그인 (동적 import — Android 빌드 시에만 존재)
        const { FirebaseAuthentication } = await import(
            /* webpackIgnore: true */ '@capacitor-firebase/authentication'
        );
        const result = await FirebaseAuthentication.signInWithGoogle();
        // 네이티브 결과를 Web SDK에 연동
        const credential = firebase.auth.GoogleAuthProvider.credential(
            result.credential?.idToken
        );
        return auth.signInWithCredential(credential);
    } else {
        const provider = new firebase.auth.GoogleAuthProvider();
        return auth.signInWithPopup(provider);
    }
}

/**
 * 로그아웃
 */
export async function signOut() {
    if (isCapacitorNative) {
        try {
            const { FirebaseAuthentication } = await import(
                /* webpackIgnore: true */ '@capacitor-firebase/authentication'
            );
            await FirebaseAuthentication.signOut();
        } catch { /* 플러그인 없을 경우 무시 */ }
    }
    return auth.signOut();
}
