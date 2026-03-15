# Todo List

개인용 할 일 관리 앱. **Windows 데스크톱(Electron)** 및 **Android(Capacitor)** 에서 동작하며, **Firebase Firestore**를 통해 두 플랫폼 간 실시간 동기화를 지원합니다.

---

## 주요 기능

| 기능 | 설명 |
|------|------|
| 할 일 CRUD | 추가 · 수정 · 삭제, 우선순위(낮음/보통/높음), 메모 |
| 카테고리 탭 | 여러 탭 생성·이름 변경·삭제, 탭별 독립 목록 |
| 자동 초기화 타이머 | 전역(전체 항목) 또는 항목별 지정 시각에 완료 체크 자동 해제 |
| 다크 모드 | 라이트 / 다크 테마 토글 |
| 배경 이미지 | 이미지 선택 → 크롭 모달로 자르기 → 앱 컨테이너 배경으로 설정 |
| UI 숨김 토글 | 눈 아이콘 버튼으로 UI 전체 숨기기 / 보이기 (배경화면만 표시) |
| Firebase 실시간 동기화 | PC ↔ Android 간 할 일·카테고리·설정 자동 동기화 |
| 수동 새로고침 | 새로고침 버튼으로 Firebase 스냅샷 재구독 |
| 되돌리기 (Undo) | 카테고리 삭제 시 4초 내 실행 취소 가능 |
| 항목 정렬 | 미완료 항목 상단 / 완료 항목 하단 자동 정렬 |
| Always on Top | 창을 항상 최상위로 고정 (Electron 전용) |
| 자동 시작 | Windows 로그인 시 자동 실행 (Electron 전용, 최초 1회 등록) |

---

## 기술 스택

- **Electron 28** — Windows 데스크톱 앱
- **Capacitor 6** — Android WebView 래퍼
- **Firebase Firestore (compat 10.14.1)** — 실시간 클라우드 동기화
- **Vanilla JS / CSS** — 프레임워크 없음
- **electron-builder 24** — Windows NSIS 설치 파일 / Portable 빌드

---

## 프로젝트 구조

```
todo-app/
├── main.js              # Electron 메인 프로세스
├── preload.js           # contextBridge IPC 노출
├── index.html           # 앱 UI (Electron용)
├── app.js               # 렌더러 로직 전체
├── style.css            # 스타일시트
├── firebase-sync.js     # Firebase 초기화 및 동기화 모듈
├── capacitor.config.json
├── package.json
├── assets/              # 아이콘 등 정적 파일
├── scripts/
│   ├── sync-www.js      # www/ 폴더 동기화 + Firebase SDK 로컬 번들링
│   └── generate-icon.js # 아이콘 생성
├── www/                 # Capacitor WebView용 빌드 결과 (sync-www.js 생성)
│   └── lib/             # Firebase SDK 로컬 번들 (CDN 대신 사용)
├── android/             # Capacitor Android 프로젝트
└── todo-dist/           # electron-builder 빌드 출력
```

---

## 환경 요구사항

| 항목 | 버전 |
|------|------|
| Node.js | 18 이상 권장 |
| JDK | 21 (Android 빌드 전용, JDK 25는 Gradle 미지원) |
| Gradle | 8.13 (wrapper 자동 다운로드) |
| Android Gradle Plugin | 8.7.3 |

> **JDK 경로 설정**: `android/gradle.properties`의 `org.gradle.java.home` 값을 로컬 JDK 21 경로로 수정하세요.

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

---

## 빌드

### Windows 데스크톱

```bash
# 설치 파일 + Portable (기본)
npm run dist

# Portable만
npm run dist:portable

# 빌드 없이 디렉터리 확인
npm run pack
```

출력 경로: `todo-dist/`

### Android APK (디버그)

```bash
# www/ 동기화 → cap sync → 디버그 APK 빌드
npm run android:apk
```

출력 경로: `android/app/build/outputs/apk/debug/app-debug.apk`

#### 기타 Android 명령

```bash
# www/ 동기화만
npm run android:sync

# www/ 동기화 + Android Studio 열기
npm run android:open
```

---

## Firebase 설정

`firebase-sync.js`에 Firebase 프로젝트 설정이 내장되어 있습니다.  
다른 Firebase 프로젝트를 사용하려면 해당 파일의 `FIREBASE_CONFIG` 객체를 교체하세요.

**Firestore 보안 규칙** (최소 권장):

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /userData/owner {
      allow read, write: if true; // 개인용: 인증 없이 허용
    }
  }
}
```

> 공유 환경에서는 Firebase Authentication을 연동하여 규칙을 강화하세요.

---

## 데이터 저장

| 데이터 | 저장 위치 | 비고 |
|--------|-----------|------|
| 할 일 목록 | `localStorage` + Firestore | 실시간 동기화 |
| 카테고리 | `localStorage` + Firestore | 실시간 동기화 |
| 설정 (테마 등) | `localStorage` + Firestore | bgImage 제외 동기화 |
| 배경 이미지 | `localStorage` 전용 | 용량 이슈로 동기화 제외 |
| 창 크기·위치 | `userData/window-state.json` | Electron 전용 |
| 앱 설정 (자동시작 등) | `userData/app-settings.json` | Electron 전용 |

---

## 주요 스크립트 설명

### `scripts/sync-www.js`

Capacitor WebView에 제공할 파일을 `www/`에 복사하고,  
Firebase SDK CDN URL을 로컬 파일(`www/lib/`)로 패치합니다.  
Firebase SDK 파일은 최초 1회만 다운로드하며 이후 캐시를 사용합니다.

### `scripts/generate-icon.js`

`jimp`를 사용해 앱 아이콘을 생성합니다.

---

## 알려진 제약사항

- 배경 이미지는 기기 간 동기화되지 않습니다 (용량 문제).
- `enablePersistence({ synchronizeTabs: true })`는 Android WebView 미지원으로 비활성화되어 있습니다.
- Android APK 빌드 시 JDK 21이 필요합니다 (JDK 25는 Gradle 8.13과 호환되지 않음).
