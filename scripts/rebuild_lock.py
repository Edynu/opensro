from __future__ import annotations

import json
import os
import shutil
import socket
import sys
import threading
import time
from calendar import timegm
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator


REBUILD_ROOT = Path(__file__).resolve().parents[1]
LOCKS_ROOT = REBUILD_ROOT / ".state" / "locks"
GENERATED_ASSETS_LOCK_NAME = "generated-assets"

LOCK_NAME_ENV = "SRO_REBUILD_LOCK_NAME"
LOCK_TOKEN_ENV = "SRO_REBUILD_LOCK_TOKEN"
LOCK_DIR_ENV = "SRO_REBUILD_LOCK_DIR"
DEFAULT_POLL_MS = 5000
DEFAULT_STALE_MS = 12 * 60 * 60 * 1000
HEARTBEAT_MS = 10000


@contextmanager
def generated_assets_lock(label: str) -> Iterator[None]:
    with rebuild_lock(GENERATED_ASSETS_LOCK_NAME, label):
        yield


@contextmanager
def rebuild_lock(name: str, label: str) -> Iterator[None]:
    normalized_name = normalize_lock_name(name)
    if os.environ.get(LOCK_NAME_ENV) == normalized_name and os.environ.get(LOCK_TOKEN_ENV):
        yield
        return

    poll_ms = max(250, int_from_env("SRO_REBUILD_LOCK_POLL_MS", DEFAULT_POLL_MS))
    stale_ms = max(60000, int_from_env("SRO_REBUILD_LOCK_STALE_MS", DEFAULT_STALE_MS))
    timeout_ms = int_from_env("SRO_REBUILD_LOCK_TIMEOUT_MS", 0)
    lock_dir = LOCKS_ROOT / f"{normalized_name}.lock"
    owner_path = lock_dir / "owner.json"
    token = f"{os.getpid()}-{int(time.time() * 1000)}"
    started_at_ms = int(time.time() * 1000)
    next_notice_at_ms = 0

    LOCKS_ROOT.mkdir(parents=True, exist_ok=True)

    while True:
        try:
            lock_dir.mkdir()
            break
        except FileExistsError:
            owner = read_owner(owner_path)
            if remove_stale_lock_if_needed(lock_dir, owner, stale_ms, label):
                continue

            now_ms = int(time.time() * 1000)
            if now_ms >= next_notice_at_ms:
                print(
                    f"[rebuild-lock] {label}: waiting for {format_owner(owner)} "
                    f"({relative_lock_path(lock_dir)}).",
                    file=sys.stderr,
                    flush=True,
                )
                next_notice_at_ms = now_ms + max(poll_ms, 30000)

            if timeout_ms > 0 and now_ms - started_at_ms >= timeout_ms:
                raise TimeoutError(f"[rebuild-lock] {label}: timed out waiting for {format_owner(owner)}.")

            time.sleep(poll_ms / 1000)

    owner = owner_record(normalized_name, label, token, lock_dir)
    write_owner(owner_path, owner)
    stop_heartbeat = threading.Event()
    heartbeat = threading.Thread(
        target=heartbeat_owner,
        args=(owner_path, owner, stop_heartbeat),
        daemon=True,
    )
    heartbeat.start()

    os.environ[LOCK_NAME_ENV] = normalized_name
    os.environ[LOCK_TOKEN_ENV] = token
    os.environ[LOCK_DIR_ENV] = str(lock_dir)
    print(f"[rebuild-lock] {label}: acquired {relative_lock_path(lock_dir)} (pid {os.getpid()}).", file=sys.stderr)

    try:
        yield
    finally:
        stop_heartbeat.set()
        if os.environ.get(LOCK_TOKEN_ENV) == token:
            os.environ.pop(LOCK_NAME_ENV, None)
            os.environ.pop(LOCK_TOKEN_ENV, None)
            os.environ.pop(LOCK_DIR_ENV, None)
        shutil.rmtree(lock_dir, ignore_errors=True)
        print(f"[rebuild-lock] {label}: released {relative_lock_path(lock_dir)}.", file=sys.stderr)


def owner_record(name: str, label: str, token: str, lock_dir: Path) -> dict[str, object]:
    now = iso_now()
    return {
        "name": name,
        "label": label,
        "token": token,
        "pid": os.getpid(),
        "ppid": os.getppid(),
        "user": os.environ.get("USERNAME") or os.environ.get("USER") or "",
        "host": socket.gethostname(),
        "cwd": os.getcwd(),
        "command": " ".join(sys.argv),
        "lockDir": str(lock_dir),
        "startedAt": now,
        "heartbeatAt": now,
    }


def heartbeat_owner(owner_path: Path, owner: dict[str, object], stop_event: threading.Event) -> None:
    while not stop_event.wait(HEARTBEAT_MS / 1000):
        updated = {**owner, "heartbeatAt": iso_now()}
        try:
            write_owner(owner_path, updated)
        except OSError:
            return


def write_owner(owner_path: Path, owner: dict[str, object]) -> None:
    owner_path.write_text(json.dumps(owner, indent=2) + "\n", encoding="utf-8")


def read_owner(owner_path: Path) -> dict[str, object] | None:
    try:
        return json.loads(owner_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


def remove_stale_lock_if_needed(lock_dir: Path, owner: dict[str, object] | None, stale_ms: int, label: str) -> bool:
    pid = int(owner.get("pid", 0)) if owner and str(owner.get("pid", "")).isdigit() else 0
    heartbeat_at = str(owner.get("heartbeatAt") or owner.get("startedAt") or "") if owner else ""
    heartbeat_age_ms = int(time.time() * 1000) - parse_iso_ms(heartbeat_at)
    alive = process_alive(pid) if pid > 0 else False

    if alive and heartbeat_age_ms <= stale_ms:
        return False

    reason = f"stale heartbeat from pid {pid}" if alive else f"exited pid {pid or '(unknown)'}"
    print(f"[rebuild-lock] {label}: removing stale lock ({reason}).", file=sys.stderr, flush=True)
    shutil.rmtree(lock_dir, ignore_errors=True)
    return True


def process_alive(pid: int) -> bool:
    if sys.platform == "win32":
        return windows_process_alive(pid)
    try:
        os.kill(pid, 0)
        return True
    except PermissionError:
        return True
    except OSError:
        return False


def windows_process_alive(pid: int) -> bool:
    # os.kill(pid, 0) is NOT a liveness probe on Windows: any signal other than
    # CTRL_C_EVENT/CTRL_BREAK_EVENT goes through TerminateProcess, so probing a
    # live lock holder would kill it (with exit code 0, no less). Query instead.
    import ctypes

    PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
    ERROR_ACCESS_DENIED = 5
    STILL_ACTIVE = 259

    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    handle = kernel32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, False, pid)
    if not handle:
        # Access denied means the pid exists but belongs to another user.
        return ctypes.get_last_error() == ERROR_ACCESS_DENIED
    try:
        exit_code = ctypes.c_ulong()
        if not kernel32.GetExitCodeProcess(handle, ctypes.byref(exit_code)):
            return True
        return exit_code.value == STILL_ACTIVE
    finally:
        kernel32.CloseHandle(handle)


def format_owner(owner: dict[str, object] | None) -> str:
    if owner is None:
        return "another process with no owner metadata"
    pieces = [
        str(owner.get("label") or owner.get("name") or "another rebuild"),
        f"pid {owner['pid']}" if owner.get("pid") else "",
        f"{owner.get('user')}@{owner.get('host')}" if owner.get("user") and owner.get("host") else "",
        f"started {owner.get('startedAt')}" if owner.get("startedAt") else "",
    ]
    command = str(owner.get("command") or "")
    command_suffix = f", command: {truncate(command, 180)}" if command else ""
    return f"{', '.join(piece for piece in pieces if piece)}{command_suffix}"


def normalize_lock_name(name: str) -> str:
    allowed = []
    for char in name.strip().lower():
        allowed.append(char if char.isalnum() or char in "._-" else "-")
    return "".join(allowed).strip("-") or "default"


def relative_lock_path(lock_dir: Path) -> str:
    return lock_dir.relative_to(REBUILD_ROOT).as_posix()


def truncate(value: str, max_length: int) -> str:
    return value if len(value) <= max_length else value[: max_length - 3] + "..."


def int_from_env(name: str, fallback: int) -> int:
    try:
        return int(os.environ.get(name, ""))
    except ValueError:
        return fallback


def iso_now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def parse_iso_ms(value: str) -> int:
    # Node writes `new Date().toISOString()` (millisecond precision, e.g.
    # 2026-07-28T12:00:00.123Z); Python writes second precision. Accept both,
    # with any number of fractional digits, or a live Node-held lock parses to
    # 0 and looks infinitely stale.
    if not value:
        return 0
    base = value
    millis = 0
    if value.endswith("Z") and "." in value:
        base, _, fraction = value[:-1].partition(".")
        base += "Z"
        if not fraction.isdigit():
            return 0
        millis = int((fraction + "000")[:3])
    try:
        return timegm(time.strptime(base, "%Y-%m-%dT%H:%M:%SZ")) * 1000 + millis
    except ValueError:
        return 0
