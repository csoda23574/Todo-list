/**
 * state.js — 앱 공유 가변 상태
 *
 * 모든 모듈은 이 객체를 import해서 직접 프로퍼티를 읽거나 변경합니다.
 * (ES 모듈 live binding 제약을 피해 객체 참조를 통해 뮤테이션)
 */

export const state = {
    uid: 'guest',           // 로컬 스토리지 키 격리용 식별자 (로그인 후 Firebase UID로 교체)
    user: null,             // Firebase User 객체 (로그인 전 null)
    isSignedIn: false,      // 로그인 상태
    isSyncing: false,       // Firestore 동기화 진행 중 여부
    unsubscribeSync: null,  // Firestore onSnapshot 해제 함수

    // 할 일 목록
    todos: [],

    // UI 상태
    filter: 'all',          // 'all' | 'done' | 'pending'
    editingId: null,        // 수정 중인 할 일 ID
    deleteTargetId: null,   // 삭제 확인 대상 ID

    // 카테고리
    categories: [{ id: 'default', name: '기본' }],
    currentCategoryId: 'default',

    // 앱 설정
    settings: {
        resetEnabled: false,
        resetTime: '00:00',
        resetRepeat: 'daily',
        bgOpacity: 50,
        bgBlur: 0,
        bgImage: null,      // base64 data URL (로컬 디바이스 전용)
        bgFileName: '',
        appTitle: 'My Tasks',
    },

    // 타이머
    resetTimerInterval: null,
};
