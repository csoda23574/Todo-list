# 원신 일일 의뢰·캐서린 보상 확인기

HoYoLAB의 실시간 메모를 읽어 다음 상태를 출력하는 개인용 명령줄 프로그램입니다.

- 오늘의 일일 의뢰/모험 수행 포인트 진행 수
- 캐서린의 추가 일일 보상 수령 여부

게임 클라이언트를 조작하거나 게임 메모리를 읽지 않습니다. HoYoLAB의 비공식 게임 기록 인터페이스를 사용하는 `genshin.py` 라이브러리에 의존하므로, HoYoLAB 변경에 따라 동작이 달라질 수 있습니다.

## 준비

1. 이 폴더에서 아래 명령으로 전용 실행 환경과 라이브러리를 준비합니다.

   ```powershell
   python -m venv .venv
   .\.venv\Scripts\python.exe -m pip install -r requirements.txt
   ```

2. `settings.example.json`을 복사해 `settings.json`으로 이름을 바꿉니다.

3. `settings.json`의 값을 채웁니다.

   - `uid`: 원신 게임 내 프로필에서 확인하는 숫자 UID
   - `browser`: HoYoLAB에 로그인해 둔 브라우저. `edge`, `chrome`, `firefox`, `opera`, `chromium` 중 하나

   기본 예시는 Windows 기본 브라우저인 Edge입니다. HoYoLAB에 Chrome으로 로그인했다면 `"browser": "chrome"`으로 바꾸세요. 프로그램은 실행할 때 선택한 브라우저에서 HoYoLAB 인증 쿠키만 읽어 메모리에서 사용하며, `settings.json`이나 다른 파일에 저장하지 않습니다.

   브라우저 로그인은 사용자가 직접 해야 합니다. 프로그램은 비밀번호·인증 코드·캡차를 입력하거나 브라우저 로그인 상태를 바꾸지 않습니다.

`settings.json`은 `.gitignore`에 포함되어 있어 버전 관리에 올라가지 않습니다. 쿠키는 로그인 권한을 줄 수 있는 민감한 정보이므로 누구에게도 보내지 마세요.

## 실행

```powershell
.\.venv\Scripts\python.exe .\daily_commission_status.py
```

예시 출력:

```text
[원신 일일 의뢰 확인]
일일 의뢰: 4 / 4
캐서린 추가 보상: 미수령
안내: 캐서린에게 말을 걸어 추가 보상을 받을 수 있습니다.
```

쿠키 만료나 HoYoLAB 인증 오류가 나면 HoYoLAB에 다시 로그인한 뒤 새 Cookie 값으로 갱신하세요.

실시간 메모 기능이 HoYoLAB에서 꺼져 있다면 이 프로그램은 설정을 바꾸지 않고 오류를 안내합니다. 해당 기능의 활성화 여부는 HoYoLAB에서 직접 결정하세요.

## Todo 앱 연동

Todo 앱의 Electron 데스크톱 연동은 설정의 **HoYoLAB 연결** 버튼으로 시작합니다. 연결 안내창에 UID를 입력하면 앱 안에 임시 HoYoLAB 인증 창이 열리고, 그 창에서 로그인 상태를 자동으로 확인합니다.

인증 창의 쿠키는 실행 중인 메모리에만 있으며 Chrome·Edge 등 다른 브라우저의 쿠키 파일을 읽지 않습니다. 상태 조회가 필요할 때만 확인기에 표준 입력으로 전달하고, 설정 파일·명령줄·로그에는 저장하지 않습니다. 인증 창을 닫아도 앱이 실행 중인 동안은 연결이 유지되며, 앱 종료 시 임시 세션이 폐기됩니다.

연동용 JSON 상태는 아래처럼 확인할 수 있습니다. 이 명령도 쿠키를 저장하지 않습니다.

```powershell
.\.venv\Scripts\python.exe .\daily_commission_status.py --json --uid 800000000 --browser edge
```

패키지 버전의 Todo 앱은 처음 실행할 때 앱 데이터 폴더에 전용 Python 가상환경을 만들고, `requirements.txt`의 라이브러리를 자동으로 설치합니다. 이후 앱 업데이트로 요구사항 파일이 바뀌면 다음 실행 시 자동으로 갱신합니다. 컴퓨터에 Python 3가 전혀 설치되어 있지 않은 경우에만 Python 설치 후 앱을 다시 실행해야 합니다.
