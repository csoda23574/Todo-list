/**
 * dom.js — DOM 요소 참조 (지연 getter 패턴)
 *
 * 모든 getter는 호출 시점에 getElementById를 실행하므로
 * DOMContentLoaded 이전에 import해도 안전합니다.
 */

export const DOM = {
    // 할 일 목록
    get todoList() { return document.getElementById('todoList'); },
    get emptyState() { return document.getElementById('emptyState'); },

    // 메인 FAB
    get fabWrap() { return document.getElementById('fabWrap'); },
    get mainFab() { return document.getElementById('mainFab'); },
    get fabCalendarBtn() { return document.getElementById('fabCalendarBtn'); },
    get fabAddTodoBtn() { return document.getElementById('fabAddTodoBtn'); },

    // 캘린더 요소
    get mainContent() { return document.getElementById('mainContent'); },
    get calendarView() { return document.getElementById('calendarView'); },
    get calPrevMonthBtn() { return document.getElementById('calPrevMonthBtn'); },
    get calNextMonthBtn() { return document.getElementById('calNextMonthBtn'); },
    get calBackBtn() { return document.getElementById('calBackBtn'); },
    get calendarTitle() { return document.getElementById('calendarTitle'); },
    get calendarGridBody() { return document.getElementById('calendarGridBody'); },
    get calDetailPopup() { return document.getElementById('calDetailPopup'); },
    get calDetailDateTitle() { return document.getElementById('calDetailDateTitle'); },
    get calDetailCloseBtn() { return document.getElementById('calDetailCloseBtn'); },
    get calDetailContent() { return document.getElementById('calDetailContent'); },

    // 헤더
    get headerDate() { return document.getElementById('headerDate'); },
    get headerTitle() { return document.getElementById('headerTitle'); },
    get themeToggle() { return document.getElementById('themeToggle'); },
    get settingsBtn() { return document.getElementById('settingsBtn'); },
    get refreshBtn() { return document.getElementById('refreshBtn'); },
    get uiToggleBtn() { return document.getElementById('uiToggleBtn'); },

    // 통계
    get totalCount() { return document.getElementById('totalCount'); },
    get doneCount() { return document.getElementById('doneCount'); },
    get pendingCount() { return document.getElementById('pendingCount'); },
    get progressFill() { return document.getElementById('progressFill'); },

    // 할 일 추가/수정 모달
    get taskModal() { return document.getElementById('taskModal'); },
    get modalTitle() { return document.getElementById('modalTitle'); },
    get modalClose() { return document.getElementById('modalClose'); },
    get modalCancel() { return document.getElementById('modalCancel'); },
    get modalSave() { return document.getElementById('modalSave'); },
    get taskInput() { return document.getElementById('taskInput'); },
    get taskNote() { return document.getElementById('taskNote'); },
    get prioritySelector() { return document.getElementById('prioritySelector'); },

    // 할 일 초기화 설정 (모달 내)
    get taskResetType() { return document.getElementById('taskResetType'); },
    get taskResetTime() { return document.getElementById('taskResetTime'); },
    get taskResetTimeRow() { return document.getElementById('taskResetTimeRow'); },
    get taskResetWeeklyRow() { return document.getElementById('taskResetWeeklyRow'); },
    get taskResetMonthlyRow() { return document.getElementById('taskResetMonthlyRow'); },
    get taskResetYearlyRow() { return document.getElementById('taskResetYearlyRow'); },
    get taskResetWeeklyTime() { return document.getElementById('taskResetWeeklyTime'); },
    get taskResetMonthlyTime() { return document.getElementById('taskResetMonthlyTime'); },
    get taskResetYearlyTime() { return document.getElementById('taskResetYearlyTime'); },
    get monthDayGrid() { return document.getElementById('monthDayGrid'); },
    get yearlyDateList() { return document.getElementById('yearlyDateList'); },
    get addYearlyDateBtn() { return document.getElementById('addYearlyDateBtn'); },

    // 설정 모달
    get settingsModal() { return document.getElementById('settingsModal'); },
    get settingsClose() { return document.getElementById('settingsClose'); },
    get settingsCancelBtn() { return document.getElementById('settingsCancelBtn'); },
    get settingsSaveBtn() { return document.getElementById('settingsSaveBtn'); },
    get bgScopeGlobal() { return document.getElementById('bgScopeGlobal'); },
    get bgScopeCategory() { return document.getElementById('bgScopeCategory'); },
    get bgScopeCategoryLabel() { return document.getElementById('bgScopeCategoryLabel'); },
    get resetEnabled() { return document.getElementById('resetEnabled'); },
    get resetTime() { return document.getElementById('resetTime'); },
    get resetRepeat() { return document.getElementById('resetRepeat'); },
    get resetSubGroup() { return document.getElementById('resetSubGroup'); },
    get resetNextInfo() { return document.getElementById('resetNextInfo'); },
    get bgFileInput() { return document.getElementById('bgFileInput'); },
    get bgPreviewWrap() { return document.getElementById('bgPreviewWrap'); },
    get bgPreviewImg() { return document.getElementById('bgPreviewImg'); },
    get bgPreviewName() { return document.getElementById('bgPreviewName'); },
    get bgRemoveBtn() { return document.getElementById('bgRemoveBtn'); },
    get bgOpacity() { return document.getElementById('bgOpacity'); },
    get bgOpacityValue() { return document.getElementById('bgOpacityValue'); },
    get bgBlur() { return document.getElementById('bgBlur'); },
    get bgBlurValue() { return document.getElementById('bgBlurValue'); },
    get clearAllBtn() { return document.getElementById('clearAllBtn'); },
    get appTitleInput() { return document.getElementById('appTitleInput'); },

    // 확인 모달
    get confirmModal() { return document.getElementById('confirmModal'); },
    get confirmCancel() { return document.getElementById('confirmCancel'); },
    get confirmDelete() { return document.getElementById('confirmDelete'); },

    // 배경 오버레이
    get bgOverlay() { return document.getElementById('bgOverlay'); },

    // 로그인 오버레이
    get loginOverlay() { return document.getElementById('loginOverlay'); },
    get googleLoginBtn() { return document.getElementById('googleLoginBtn'); },
    get loginErrorMsg() { return document.getElementById('loginErrorMsg'); },

    // 헤더 유저 정보
    get userAvatar() { return document.getElementById('userAvatar'); },
    get userDisplayName() { return document.getElementById('userDisplayName'); },
    get logoutBtn() { return document.getElementById('logoutBtn'); },
    get syncDot() { return document.getElementById('syncDot'); },

    // 필터 탭
    get filterTabs() { return document.querySelectorAll('.filter-tab'); },

    // 토스트 컨테이너
    get toastContainer() { return document.getElementById('toastContainer'); },

    // 개발자 도구
    get devToolsSection() { return document.getElementById('devToolsSection'); },
    get testNotificationBtn() { return document.getElementById('testNotificationBtn'); },
};
