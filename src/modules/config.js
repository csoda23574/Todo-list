/**
 * config.js — 앱 전역 상수
 */

export const STORAGE_KEYS = {
    THEME: 'todoApp_theme',       // 테마는 디바이스 전역 설정 유지
    TODOS: 'todos',               // 이 아래부터는 UID 기반 동적 키로 조합됨
    SETTINGS: 'settings',
    BG_IMAGE: 'bgImage',
    CATEGORIES: 'categories',
    CURRENT_CATEGORY: 'currentCategory',
};

export const WEEKDAY_NAMES = ['일', '월', '화', '수', '목', '금', '토'];

// 계정별 데이터 격리를 위한 동적 키 생성기
export const getStorageKey = (uid, key) => `todoApp_${uid}_${key}`;
export const getGlobalResetKey = (uid) => `todoApp_${uid}_lastReset`;
export const getItemResetKey = (uid, itemId) => `todoApp_${uid}_itemLastReset_${itemId}`;
export const getResetTimestampKey = (uid) => `todoApp_${uid}_resetTimestamp`;
