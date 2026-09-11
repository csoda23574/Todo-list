"""HoYoLAB 실시간 메모에서 게임별 일일 보상 상태를 표시한다."""

from __future__ import annotations

import asyncio
import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

SETTINGS_PATH = Path(__file__).with_name("settings.json")
SUPPORTED_BROWSERS = {"chrome", "chromium", "edge", "firefox", "opera"}
GAME_NAMES = {
    "genshin": "원신",
    "starrail": "붕괴: 스타레일",
    "zzz": "젠레스 존 제로",
}
AUTH_COOKIE_NAMES = {
    "ltuid", "ltuid_v2", "ltoken", "ltoken_v2",
    "ltmid", "ltmid_v2", "account_id", "account_id_v2",
    "cookie_token", "cookie_token_v2", "account_mid_v2",
}


def parse_cookie_header(value: str) -> dict[str, str]:
    """'name=value; other=value' 형태의 Cookie 헤더를 딕셔너리로 바꾼다."""
    cookies: dict[str, str] = {}
    for part in value.split(";"):
        name, separator, cookie_value = part.strip().partition("=")
        if not separator or not name or not cookie_value:
            continue
        cookies[name] = cookie_value
    return cookies


def parse_session_cookies(value: str) -> dict[str, str]:
    """Electron의 임시 인증 세션에서 stdin으로 받은 쿠키만 검증해 사용한다."""
    try:
        payload = json.loads(value)
    except json.JSONDecodeError as error:
        raise RuntimeError("임시 HoYoLAB 인증 정보를 읽지 못했습니다.") from error

    raw_cookies = payload.get("cookies") if isinstance(payload, dict) else None
    if not isinstance(raw_cookies, dict):
        raise RuntimeError("임시 HoYoLAB 인증 정보 형식이 올바르지 않습니다.")

    cookies = {
        name: cookie_value
        for name, cookie_value in raw_cookies.items()
        if name in AUTH_COOKIE_NAMES and isinstance(cookie_value, str) and cookie_value
    }
    if not any(name.startswith("ltoken") for name in cookies):
        raise RuntimeError("HoYoLAB 로그인 세션을 찾지 못했습니다. 인증 창에서 다시 로그인해 주세요.")
    return cookies


def load_settings(path: Path = SETTINGS_PATH, game: str = "genshin") -> tuple[int, dict[str, str], str | None]:
    if not path.exists():
        raise RuntimeError(
            f"설정 파일이 없습니다: {path.name}\n"
            "settings.example.json을 복사해 settings.json으로 이름을 바꾼 뒤 값을 채워 주세요."
        )

    try:
        settings: dict[str, Any] = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        raise RuntimeError(f"{path.name}의 JSON 형식이 올바르지 않습니다: {error.msg}") from error

    uid = settings.get("uid")
    if not isinstance(uid, int) or uid <= 0:
        game_name = GAME_NAMES.get(game, game)
        raise RuntimeError(f'settings.json의 "uid"에 {game_name} UID 숫자를 입력해 주세요.')

    # 가장 알기 쉬운 설정 방식: Cookie 헤더 전체를 조립하지 않고 Value 열만 각각 넣는다.
    cookies = {
        name: value.strip()
        for name in ("ltuid", "ltuid_v2", "ltoken", "ltoken_v2")
        if isinstance((value := settings.get(name)), str) and value.strip()
    }

    # 이전 버전의 한 줄 Cookie 헤더 형식도 계속 지원한다.
    if not cookies and isinstance(settings.get("cookie"), str):
        cookies = parse_cookie_header(settings["cookie"])
    browser = settings.get("browser")
    if browser is not None:
        if not isinstance(browser, str) or browser.lower() not in SUPPORTED_BROWSERS:
            choices = ", ".join(sorted(SUPPORTED_BROWSERS))
            raise RuntimeError(f'"browser"는 다음 중 하나여야 합니다: {choices}')
        browser = browser.lower()

    if not cookies and browser is None:
        raise RuntimeError(
            "쿠키를 찾지 못했습니다. 브라우저 자동 읽기를 쓰려면 settings.json에 browser를 입력해 주세요."
        )
    if cookies and not any(name.startswith("ltoken") for name in cookies):
        raise RuntimeError('"cookie"에 ltoken 또는 ltoken_v2 쿠키가 없습니다.')

    return uid, cookies, browser


def get_browser_cookies(genshin: Any, browser: str) -> dict[str, str]:
    """로그인된 브라우저에서 HoYoLAB 인증 쿠키만 읽어 메모리에서 사용한다."""
    try:
        cookies = dict(genshin.utility.get_browser_cookies(browser))
    except ImportError as error:
        raise RuntimeError(
            "브라우저 쿠키 읽기 기능이 설치되지 않았습니다. requirements.txt를 다시 설치해 주세요."
        ) from error
    except Exception as error:
        if type(error).__name__ == "RequiresAdminError":
            browser_name = browser.title()
            raise RuntimeError(
                f"{browser_name}의 쿠키 데이터베이스가 사용 중이어서 읽을 수 없습니다. "
                f"{browser_name} 창을 모두 종료한 뒤 Todo 앱에서 다시 새로고침해 주세요. "
                "계속되면 HoYoLAB에 로그인된 다른 브라우저를 선택해 보세요."
            ) from error
        raise RuntimeError(
            f"{browser} 브라우저의 HoYoLAB 쿠키를 읽지 못했습니다: {type(error).__name__}. "
            "브라우저에 HoYoLAB 로그인이 유지되어 있는지 확인해 주세요."
        ) from error

    if not cookies:
        raise RuntimeError(
            f"{browser} 브라우저에서 HoYoLAB 로그인 쿠키를 찾지 못했습니다. "
            "해당 브라우저로 HoYoLAB에 직접 로그인한 뒤 다시 실행해 주세요."
        )
    return cookies


def get_commission_values(notes: Any) -> tuple[int | None, int | None, bool | None]:
    """genshin.py의 현재/이전 모델 이름을 모두 수용해 필요한 값만 가져온다."""
    daily_task = getattr(notes, "daily_task", None)

    completed = getattr(daily_task, "completed_tasks", None)
    if completed is None:
        completed = getattr(notes, "completed_commissions", None)

    maximum = getattr(daily_task, "max_tasks", None)
    if maximum is None:
        maximum = getattr(notes, "max_commissions", None)

    claimed = getattr(daily_task, "claimed_commission_reward", None)
    if claimed is None:
        claimed = getattr(notes, "claimed_commission_reward", None)

    return completed, maximum, claimed


def format_status(completed: int | None, maximum: int | None, claimed: bool | None) -> str:
    progress = "확인 불가"
    if isinstance(completed, int) and isinstance(maximum, int):
        progress = f"{completed} / {maximum}"

    lines = ["[원신 일일 의뢰 확인]", f"일일 의뢰: {progress}"]
    if claimed is True:
        lines.append("캐서린 추가 보상: 수령 완료")
    elif claimed is False:
        lines.append("캐서린 추가 보상: 미수령")
        if isinstance(completed, int) and isinstance(maximum, int) and completed < maximum:
            lines.append("안내: 일일 의뢰/모험 수행 포인트를 먼저 모두 채워야 합니다.")
        else:
            lines.append("안내: 캐서린에게 말을 걸어 추가 보상을 받을 수 있습니다.")
    else:
        lines.append("캐서린 추가 보상: 확인 불가")
        lines.append("안내: HoYoLAB 응답 형식이 바뀌었을 수 있습니다. 라이브러리를 업데이트해 보세요.")

    return "\n".join(lines)


def make_status(completed: int | None, maximum: int | None, claimed: bool | None) -> dict[str, Any]:
    """Todo 앱 등 다른 프로그램이 사용할 수 있는 민감 정보 없는 상태값을 만든다."""
    return {
        "provider": "hoyolab",
        "game": "genshin",
        "daily_task": {
            "completed": completed,
            "maximum": maximum,
        },
        "conditions": {
            "catherine_reward_claimed": claimed,
        },
        "checked_at": datetime.now(timezone.utc).isoformat(),
    }


def get_starrail_training_values(notes: Any) -> tuple[int | None, int | None]:
    """스타레일 실시간 메모의 일일 훈련 현재·최대 점수를 가져온다."""
    return (
        getattr(notes, "current_train_score", None),
        getattr(notes, "max_train_score", None),
    )


def make_starrail_status(current: int | None, maximum: int | None) -> dict[str, Any]:
    """일일 훈련 최대치 도달 여부를 Todo 앱용 상태값으로 만든다."""
    completed = (
        current >= maximum
        if isinstance(current, int) and isinstance(maximum, int) and maximum > 0
        else None
    )
    return {
        "provider": "hoyolab",
        "game": "starrail",
        "daily_training": {
            "current": current,
            "maximum": maximum,
        },
        "conditions": {
            "daily_training_completed": completed,
        },
        "checked_at": datetime.now(timezone.utc).isoformat(),
    }


def format_starrail_status(current: int | None, maximum: int | None) -> str:
    progress = "확인 불가"
    if isinstance(current, int) and isinstance(maximum, int):
        progress = f"{current} / {maximum}"

    status = make_starrail_status(current, maximum)
    lines = ["[붕괴: 스타레일 일일 훈련 확인]", f"일일 훈련: {progress}"]
    if status["conditions"]["daily_training_completed"] is True:
        lines.append("일일 훈련 보상: 최대치 도달")
    elif status["conditions"]["daily_training_completed"] is False:
        lines.append("일일 훈련 보상: 아직 진행 중")
    else:
        lines.append("일일 훈련 보상: 확인 불가")
    return "\n".join(lines)


def get_zzz_engagement_values(notes: Any) -> tuple[int | None, int | None]:
    """젠레스 존 제로 실시간 메모의 일일 활약도 현재·최대 점수를 가져온다."""
    engagement = getattr(notes, "engagement", None)
    return getattr(engagement, "current", None), getattr(engagement, "max", None)


def make_zzz_status(current: int | None, maximum: int | None) -> dict[str, Any]:
    """일일 활약도 최대치 도달 여부를 Todo 앱용 상태값으로 만든다."""
    completed = (
        current >= maximum
        if isinstance(current, int) and isinstance(maximum, int) and maximum > 0
        else None
    )
    return {
        "provider": "hoyolab",
        "game": "zzz",
        "daily_engagement": {
            "current": current,
            "maximum": maximum,
        },
        "conditions": {
            "daily_engagement_completed": completed,
        },
        "checked_at": datetime.now(timezone.utc).isoformat(),
    }


def format_zzz_status(current: int | None, maximum: int | None) -> str:
    progress = "확인 불가"
    if isinstance(current, int) and isinstance(maximum, int):
        progress = f"{current} / {maximum}"

    status = make_zzz_status(current, maximum)
    lines = ["[젠레스 존 제로 일일 활약도 확인]", f"일일 활약도: {progress}"]
    if status["conditions"]["daily_engagement_completed"] is True:
        lines.append("일일 보상: 최대치 도달")
    elif status["conditions"]["daily_engagement_completed"] is False:
        lines.append("일일 보상: 아직 진행 중")
    else:
        lines.append("일일 보상: 확인 불가")
    return "\n".join(lines)


async def find_game_account(game: str, session_cookies: dict[str, str]) -> dict[str, Any]:
    """로그인한 HoYoLAB 계정의 게임 역할 중 레벨이 가장 높은 역할을 고른다."""
    try:
        import genshin
    except ImportError as error:
        raise RuntimeError(
            "필요한 라이브러리가 없습니다. 먼저 'python -m pip install -r requirements.txt'를 실행해 주세요."
        ) from error

    client = genshin.Client(session_cookies, lang="ko-kr")
    accounts = await client.get_game_accounts()
    game_biz_marker = {"genshin": "hk4e", "starrail": "hkrpg", "zzz": "nap"}[game]
    matching = []
    for account in accounts:
        account_game = getattr(account, "game", None)
        account_game_value = str(getattr(account_game, "value", account_game)).lower()
        account_game_biz = str(getattr(account, "game_biz", "")).lower()
        if account_game_value == game or game_biz_marker in account_game_biz:
            matching.append(account)
    if not matching:
        raise RuntimeError("로그인한 HoYoLAB 계정에서 선택한 게임 역할을 찾지 못했습니다.")

    account = max(matching, key=lambda item: getattr(item, "level", 0))
    return {
        "uid": int(account.uid),
        "nickname": str(account.nickname),
        "server": str(account.server_name),
        "level": int(account.level),
    }


async def check_status(
    uid_override: int | None = None,
    browser_override: str | None = None,
    session_cookies: dict[str, str] | None = None,
    game: str = "genshin",
) -> tuple[str, dict[str, Any]]:
    try:
        import genshin
    except ImportError as error:
        raise RuntimeError(
            "필요한 라이브러리가 없습니다. 먼저 'python -m pip install -r requirements.txt'를 실행해 주세요."
        ) from error

    if uid_override is None:
        uid, cookies, browser = load_settings(game=game)
    else:
        if uid_override <= 0:
            raise RuntimeError('UID는 양의 정수여야 합니다.')
        if session_cookies is not None:
            uid, cookies, browser = uid_override, session_cookies, None
        elif browser_override not in SUPPORTED_BROWSERS:
            choices = ", ".join(sorted(SUPPORTED_BROWSERS))
            raise RuntimeError(f'브라우저는 다음 중 하나여야 합니다: {choices}')
        else:
            uid, cookies, browser = uid_override, {}, browser_override
    if not cookies:
        if browser is None:  # load_settings에서 막지만 타입 검사기와 미래 변경을 위해 남긴다.
            raise RuntimeError("인증 정보를 찾지 못했습니다.")
        cookies = get_browser_cookies(genshin, browser)

    # 원신·스타레일 UID는 라이브러리가 숫자 범위로 게임을 추론할 수 있지만,
    # 젠존제 UID는 그 추론 대상이 아니다. 게임을 항상 명시해 기본 게임 설정 오류를 막는다.
    client_game = {
        "genshin": genshin.Game.GENSHIN,
        "starrail": genshin.Game.STARRAIL,
        "zzz": genshin.Game.ZZZ,
    }[game]
    client = genshin.Client(cookies, game=client_game, uid=uid, lang="ko-kr")
    # autoauth=True는 실시간 메모가 꺼져 있을 때 HoYoLAB 설정을 변경하려 시도한다.
    # 이 확인기는 상태를 읽기만 해야 하므로 그 동작을 명시적으로 막는다.
    if game == "genshin":
        notes = await client.get_genshin_notes(uid=uid, autoauth=False)
        completed, maximum, claimed = get_commission_values(notes)
        return format_status(completed, maximum, claimed), make_status(completed, maximum, claimed)
    if game == "starrail":
        notes = await client.get_starrail_notes(uid=uid, autoauth=False)
        current, maximum = get_starrail_training_values(notes)
        return format_starrail_status(current, maximum), make_starrail_status(current, maximum)
    if game == "zzz":
        notes = await client.get_zzz_notes(uid=uid, autoauth=False)
        current, maximum = get_zzz_engagement_values(notes)
        return format_zzz_status(current, maximum), make_zzz_status(current, maximum)
    raise RuntimeError(f"지원하지 않는 게임입니다: {game}")


def explain_error(error: Exception, game: str = "genshin") -> str:
    name = type(error).__name__
    message = str(error).strip()
    retcode = getattr(error, "retcode", None)
    game_name = GAME_NAMES.get(game, game)

    if retcode in {-100, 10001, -1071} or name == "InvalidCookies":
        return (
            f"HoYoLAB이 쿠키를 거부했습니다 (응답 코드 {retcode}). "
            "Todo 앱의 HoYoLAB 연결 창에서 다시 로그인해 주세요."
        )
    if retcode == 10102 or name == "DataNotPublic":
        return f"HoYoLAB의 {game_name} 실시간 메모가 꺼져 있습니다 (응답 코드 10102). HoYoLAB에서 직접 활성화한 뒤 다시 실행해 주세요."
    if retcode == 10103:
        return "쿠키는 인식됐지만 HoYoLAB 계정에 게임 계정이 연결되지 않았습니다 (응답 코드 10103). 로그인한 계정을 확인해 주세요."
    if name in {"AccountNotFound", "UserNotesAccessDenied"}:
        return f"로그인한 HoYoLAB 계정에서 해당 {game_name} UID를 찾지 못했습니다. UID와 로그인 계정을 확인해 주세요."
    if name == "GenshinException" and "Real-time notes are not enabled" in message:
        return f"HoYoLAB에서 {game_name} 실시간 메모를 활성화한 뒤 다시 실행해 주세요."
    if name in {"GeetestError", "TooManyRequests"}:
        return "HoYoLAB에서 요청을 잠시 제한했습니다. 잠시 후 다시 실행해 주세요."
    return f"{name}: {message}" if message else name


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--json", action="store_true", help="상태를 JSON으로 출력합니다.")
    parser.add_argument("--uid", type=int, help="설정 파일 대신 사용할 게임 UID입니다.")
    parser.add_argument("--game", choices=("genshin", "starrail", "zzz"), default="genshin", help="조회할 게임입니다.")
    parser.add_argument("--browser", choices=sorted(SUPPORTED_BROWSERS), help="쿠키를 읽을 브라우저입니다.")
    parser.add_argument("--cookies-stdin", action="store_true", help="stdin에서 임시 인증 쿠키를 받습니다.")
    parser.add_argument("--account", action="store_true", help="로그인 계정의 게임 역할을 자동 선택합니다.")
    args = parser.parse_args()
    if args.account and args.uid is not None:
        parser.error("--account와 --uid는 함께 사용할 수 없습니다.")
    if args.cookies_stdin and (args.browser is not None or (args.uid is None and not args.account)):
        parser.error("--cookies-stdin은 --uid 또는 --account와 함께 사용하며 --browser와는 함께 쓸 수 없습니다.")
    if not args.cookies_stdin and args.account:
        parser.error("--account는 --cookies-stdin과 함께 사용해야 합니다.")
    if not args.cookies_stdin and (args.uid is None) != (args.browser is None):
        parser.error("--uid와 --browser는 함께 지정해야 합니다.")
    return args


def error_code(error: Exception) -> str:
    name = type(error).__name__
    retcode = getattr(error, "retcode", None)
    if retcode in {-100, 10001, -1071} or name == "InvalidCookies":
        return "authentication"
    if name in {"GeetestError", "TooManyRequests"}:
        return "rate_limited"
    return "check_failed"


def main() -> int:
    args = parse_args()
    try:
        session_cookies = parse_session_cookies(sys.stdin.read()) if args.cookies_stdin else None
        if args.account:
            account = asyncio.run(find_game_account(args.game, session_cookies or {}))
            print(json.dumps(account, ensure_ascii=False) if args.json else account["uid"])
        else:
            text, status = asyncio.run(check_status(args.uid, args.browser, session_cookies, args.game))
            print(json.dumps(status, ensure_ascii=False) if args.json else text)
    except KeyboardInterrupt:
        if args.json:
            print(json.dumps({"ok": False, "code": "cancelled", "message": "확인이 취소되었습니다."}, ensure_ascii=False), file=sys.stderr)
        else:
            print("\n취소했습니다.", file=sys.stderr)
        return 130
    except Exception as error:  # 사용자에게 라이브러리 내부 traceback 대신 해결 방법을 보여 준다.
        message = explain_error(error, args.game)
        if args.json:
            print(json.dumps({"ok": False, "code": error_code(error), "message": message}, ensure_ascii=False), file=sys.stderr)
        else:
            print(f"확인하지 못했습니다. {message}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
