# Todo List

개인용 할 일 관리 앱. **Windows, Linux (Electron)** 및 **Android (Capacitor)** 환경에서 동작하며, **Firebase Firestore**를 통해 기기 간 실시간 데이터 동기화를 지원합니다.

---

## 주요 기능

| 기능 | 설명 |
|------|------|
| 할 일 CRUD | 추가 · 수정 · 삭제, 우선순위(낮음/보통/높음), 메모 기능 지원 |
| 카테고리 탭 | 여러 탭 생성·이름 변경·삭제, 탭별 독립 목록 관리 |
| 자동 초기화 타이머 | 전역(전체 항목) 또는 항목별 지정 시각(매일/매주/특정일)에 완료 체크 자동 해제 |
| 다크 모드 | 라이트 / 다크 테마 전환 |
| 배경 이미지 | 고화질 배경 이미지 지원 (IndexedDB 활용으로 용량 제한 없음), 크롭 지원 |
| UI 숨김 토글 | 눈 아이콘 버튼으로 전체 UI 숨기기 (배경화면만 감상 모드) |
| Firebase 실시간 동기화 | Google 로그인 연동, PC ↔ Android 간 할 일·카테고리 실시간 자동 동기화 |
| 시스템 알림 | 운영체제 네이티브 알림 통합 지원 (Windows/Linux/Android) |
| 되돌리기 (Undo) | 카테고리 삭제 시 4초 내 실행 취소 가능 |
| 항목 정렬 | 미완료 항목 상단 / 완료 항목 하단 자동 정렬 |
| Always on Top | 데스크톱 창을 항상 최상위로 고정 (Electron 전용) |
| 자동 시작 | OS 로그인 시 자동 실행 (Electron 전용) |

---

## 기술 스택

- **프론트엔드 코어** — ES Modules (Vanilla JS) 기반의 SOLID 아키텍처
- **Electron 28** — Windows 및 Linux 데스크톱 앱
- **Capacitor 6** — Android 네이티브 앱 및 플러그인 래퍼
- **Firebase (compat 10.14.1)** — Firestore 데이터베이스 및 Google 인증 연동
- **IndexedDB** — 고해상도 이미지 등 대용량 데이터 로컬 스토리지
- **electron-builder 24** — 크로스 플랫폼 패키징 (NSIS, AppImage 등)

---

## 프로젝트 구조 (Modular Architecture)

최근 리팩토링을 통해 단일 파일(app.js) 구조에서 도메인 주도 설계(DDD) 기반의 모듈형 아키텍처로 개선되었습니다.

```
todo-app/
├── main.js              # Electron 메인 프로세스 (로컬 HTTP 서버 내장)
├── preload.js           # contextBridge를 통한 안전한 IPC 브릿지
├── src/
│   ├── index.html       # 앱 진입점 및 레이아웃
│   ├── app.js           # 모듈 초기화, 이벤트 버스 구독, 디버그 훅(Composition Root)
│   ├── style.css        # 스타일시트
│   ├── assets/          # 아이콘 등 정적 리소스
│   ├── lib/             # 오프라인 호환을 위한 Firebase SDK 로컬 번들
│   └── modules/         # 기능별 분리된 ES 모듈 (SOLID 원칙 적용)
│       ├── bus.js        # 이벤트 버스 (DIP 매개체)
│       ├── categories.js # 카테고리 CRUD 및 탭 렌더
│       ├── config.js     # 전역 상수 및 스토리지 키
│       ├── crop.js       # 배경 이미지 크롭
│       ├── debug.js      # 개발용 상태 로그 유틸
│       ├── dom.js        # DOM 요소 참조 집중 관리
│       ├── events.js     # 이벤트 바인딩
│       ├── firebase.js   # Firebase 초기화 및 인증 헬퍼
│       ├── idb.js        # IndexedDB 래퍼 (배경 이미지 저장)
│       ├── modal-base.js # 모달 열기/닫기 기반 로직
│       ├── modals.js     # 할 일·설정·확인 모달 UI 로직
│       ├── perf.js       # 렌더 횟수 계측 유틸
│       ├── renderer.js   # 할 일 목록·배경·타이틀 렌더
│       ├── reset.js      # 자동 초기화 타이머 시스템
│       ├── state.js      # 전역 앱 상태 객체
│       ├── storage.js    # localStorage 읽기·쓰기 래퍼
│       ├── sync.js       # Firestore 실시간 동기화 및 병합
│       ├── todos.js      # 할 일 CRUD 도메인 로직
│       ├── ui.js         # 테마·필터·UI 토글
│       └── utils.js      # 순수 유틸리티 함수
├── scripts/
│   ├── smoke-policy.json # 환경별 렌더 budget 임계값 (dev/prod)
│   ├── smoke-test.js     # 정적 아키텍처 불변성 검사
│   ├── runtime-smoke.js  # Electron 런타임 렌더·시나리오 검사
│   └── smoke-ci.js       # CI 래퍼 (실패 시 힌트·diff 리포트 출력)
├── .github/
│   └── workflows/
│       ├── release.yml   # 태그 푸시 시 Windows/Android 빌드 및 릴리즈
│       └── smoke-pr.yml  # PR 시 스모크 회귀 검사 (prod 정책)
├── android/              # Capacitor Android 프로젝트 환경
└── todo-dist/            # 빌드 출력 디렉터리
```

---

## 환경 요구사항

| 항목 | 버전 |
|------|------|
| Node.js | 18 이상 권장 |
| JDK | 21 (Android 빌드 전용, JDK 25는 Gradle 미지원) |
| Gradle | 8.13 (wrapper 자동 다운로드) |
| Android Gradle Plugin | 8.7.3 |

> **JDK 경로 설정**: Android 빌드 시 `android/gradle.properties`의 `org.gradle.java.home` 값을 로컬 JDK 21 경로로 수정하세요.

---

## 시작하기

### 의존성 설치

```bash
npm install
```

### 개발 모드 실행 (Electron)

```bash
npm start
```

### 스모크 테스트 (회귀/성능 임계값)

```bash
# 기본(dev) 정책으로 정적+런타임 스모크 실행
npm run test:smoke

# 환경별 임계값 정책 강제 (PowerShell)
$env:SMOKE_ENV='prod'; npm run test:smoke

# 환경별 임계값 정책 강제 (bash/zsh)
SMOKE_ENV=prod npm run test:smoke

# CI/PR용 실행 (실패 시 힌트 + git diff 출력)
npm run test:smoke:ci
```

CI에서는 `.smoke-report/`에 실행 로그와 요약(`smoke-output.log`, `smoke-summary.json`)이 생성되며,
실패 시 힌트(`smoke-hints.txt`)와 diff(`smoke-diff.patch`)도 함께 아티팩트로 업로드됩니다.

정책 파일: `scripts/smoke-policy.json`
- `dev`: 개발 편의 중심의 완화된 렌더 budget
- `prod`: PR/배포 게이트용 엄격한 렌더 budget

---

## 빌드 명령어

### 데스크톱 (Windows / Linux)

```bash
# Windows 설치 파일(.exe) 및 Portable 동시 빌드
npm run dist:win

# Windows Portable 전용
npm run dist:portable

# Linux AppImage 빌드
npm run dist:linux

# 모든 플랫폼 기본 패키징
npm run dist
```
출력 경로: `todo-dist/`

### 모바일 (Android APK)

```bash
# 웹 소스 동기화 후 디버그 APK 빌드
npm run android:apk

# 소스 동기화만 수행
npm run android:sync

# 동기화 후 Android Studio 프로젝트 열기
npm run android:open
```
출력 경로: `android/app/build/outputs/apk/debug/app-debug.apk`

---

## 아키텍처 및 최적화 포인트

1. **플랫폼 독립성 확보:** 모바일 네이티브 브릿지 확인 로직(`isCapacitorNative`)을 일원화하여, 데스크톱 오프라인 환경이나 일반 웹 브라우저에서 실행해도 스크립트 충돌이 발생하지 않도록 격리했습니다.
2. **함수형 스케줄러 구현:** `reset.js` 모듈에 전략 패턴(Strategy Pattern)을 도입하여, 타이머 및 자동 초기화 로직의 유지보수성과 확장성을 극대화했습니다.
3. **Storage Quota 우회:** 기존 5MB로 제한되는 모바일 및 브라우저 `localStorage`의 한계를 극복하기 위해, 배경 이미지 저장용 `idb.js` (IndexedDB) 모듈을 도입하여 앱 크래시 없이 고화질 4K 이미지를 저장할 수 있습니다.
4. **오프라인 지원:** 모든 Firebase 및 Capacitor 코어 라이브러리를 로컬(`src/lib/`)에 번들링하여 오프라인 환경에서 데스크톱 앱을 실행할 때 발생하는 CDN 로딩 오류(ERR_INTERNET_DISCONNECTED)를 완벽히 해결했습니다.

---

## 데이터 저장소

| 데이터 | 저장 위치 | 비고 |
|--------|-----------|------|
| 할 일 목록 | `localStorage` + Firestore | 실시간 양방향 동기화 |
| 카테고리 | `localStorage` + Firestore | 실시간 양방향 동기화 |
| 설정 (테마 등) | `localStorage` + Firestore | 기기 간 동기화 |
| 배경 이미지 | `IndexedDB` | 고용량 처리, 기기 간 동기화 제외 |
| 창 크기·위치 | `userData/window-state.json` | Electron 전용 로컬 데이터 |
| 앱 설정 (자동시작) | `userData/app-settings.json` | Electron 전용 시스템 설정 |

---

## 알려진 제약사항

- 용량 문제 및 성능 최적화를 위해 사용자별 배경 이미지는 기기 간 클라우드 동기화를 수행하지 않습니다 (각 기기별 별도 설정 필요).
- 다중 기기(웹탭) 간의 Firestore 오프라인 캐시 공유(`synchronizeTabs: true`) 기능은 Android WebView 구조상 지원하지 않아 비활성화되어 있습니다.
- Android APK 빌드 시 컴파일 호환성 이슈로 반드시 JDK 21 버전을 사용해야 합니다.
