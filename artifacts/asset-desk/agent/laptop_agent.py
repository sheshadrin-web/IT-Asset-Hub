"""
Miles IT Assets — Windows Laptop Agent (Phase 1)

Lightweight Python agent that:
  - Registers the laptop with the portal using a one-time MILES_AGENT_TOKEN
  - Syncs system info every SYNC_INTERVAL_SECONDS
  - Polls for safe commands (sync_now, collect_system_info, update_wallpaper)
  - Reports command results

Designed to be packaged as a single .exe via PyInstaller:
    pip install pyinstaller requests
    pyinstaller --onefile --noconsole --name miles-agent laptop_agent.py

Token bootstrap (run once after install, by admin):
    setx MILES_AGENT_TOKEN "mil_xxxxxxxxxxxx"
    miles-agent.exe register

After that, the agent runs in the background (Task Scheduler or Service) and
loops the sync. The token is the ONLY secret on the machine; revoking it from
the portal stops sync immediately.

Endpoints (all routed through the shared Supabase Edge Function `agent-api`):
    POST /functions/v1/agent-api/register
    POST /functions/v1/agent-api/sync
    GET  /functions/v1/agent-api/commands
    POST /functions/v1/agent-api/commands/status

No destructive commands are implemented in Phase 1.
"""
from __future__ import annotations

import os
import sys
import json
import time
import socket
import platform
import subprocess
import uuid
from datetime import datetime, timezone

import requests

AGENT_VERSION       = "0.1.0"
DEFAULT_API_BASE    = "https://dimbgprindvmzoylzyud.supabase.co/functions/v1/agent-api"
API_BASE            = os.environ.get("MILES_AGENT_API_BASE", DEFAULT_API_BASE)
TOKEN               = os.environ.get("MILES_AGENT_TOKEN", "")
SYNC_INTERVAL_SEC   = int(os.environ.get("MILES_AGENT_SYNC_INTERVAL", "300"))   # 5 min
HTTP_TIMEOUT_SEC    = 30

# Optional per-laptop employee binding — set at install time by admin or HR.
EMPLOYEE_EMAIL      = os.environ.get("MILES_EMPLOYEE_EMAIL", "")
EMPLOYEE_ECODE      = os.environ.get("MILES_EMPLOYEE_ECODE", "")


# ── system info collection ───────────────────────────────────────────────────
def _ps(cmd: str) -> str:
    """Run a PowerShell snippet, return stripped stdout (empty on failure)."""
    try:
        out = subprocess.check_output(
            ["powershell", "-NoProfile", "-Command", cmd],
            stderr=subprocess.DEVNULL, timeout=15,
        )
        return out.decode("utf-8", errors="ignore").strip()
    except Exception:
        return ""


def _wmic(cls: str, field: str) -> str:
    try:
        out = subprocess.check_output(
            ["wmic", cls, "get", field, "/value"],
            stderr=subprocess.DEVNULL, timeout=15,
        )
        text = out.decode("utf-8", errors="ignore").strip()
        for line in text.splitlines():
            if "=" in line:
                k, _, v = line.partition("=")
                if k.strip().lower() == field.lower():
                    return v.strip()
    except Exception:
        pass
    return ""


def collect_system_info() -> dict:
    is_windows = sys.platform.startswith("win")
    hostname   = socket.gethostname()

    serial = brand = model = processor = ""
    ram_gb = storage_gb = ""
    os_name = platform.system()
    os_version = platform.version()
    logged_in = os.environ.get("USERNAME") or os.environ.get("USER") or ""
    ip_addr = mac_addr = ""

    try:
        ip_addr = socket.gethostbyname(hostname)
    except Exception:
        pass
    try:
        mac_int = uuid.getnode()
        mac_addr = ":".join(f"{(mac_int >> i) & 0xff:02x}" for i in range(40, -1, -8))
    except Exception:
        pass

    if is_windows:
        serial    = _wmic("bios", "SerialNumber")
        brand     = _wmic("computersystem", "Manufacturer")
        model     = _wmic("computersystem", "Model")
        processor = _wmic("cpu", "Name")
        ram_raw   = _wmic("computersystem", "TotalPhysicalMemory")
        if ram_raw.isdigit():
            ram_gb = f"{round(int(ram_raw) / (1024**3))} GB"
        storage_raw = _ps(
            "(Get-CimInstance Win32_DiskDrive | Measure-Object -Property Size -Sum).Sum"
        )
        if storage_raw.isdigit():
            storage_gb = f"{round(int(storage_raw) / (1024**3))} GB"
        os_name    = "Windows"
        os_version = _ps("(Get-CimInstance Win32_OperatingSystem).Caption + ' ' + (Get-CimInstance Win32_OperatingSystem).Version")

    return {
        "serial_number":       serial,
        "hostname":            hostname,
        "brand":               brand,
        "model":               model,
        "processor":           processor,
        "ram":                 ram_gb,
        "storage":             storage_gb,
        "os_name":             os_name,
        "os_version":          os_version,
        "logged_in_username":  logged_in,
        "employee_email":      EMPLOYEE_EMAIL,
        "employee_ecode":      EMPLOYEE_ECODE,
        "ip_address":          ip_addr,
        "mac_address":         mac_addr,
        "agent_version":       AGENT_VERSION,
    }


# ── HTTP helpers ─────────────────────────────────────────────────────────────
def _headers() -> dict:
    return {
        "X-Agent-Token": TOKEN,
        "Content-Type":  "application/json",
        "User-Agent":    f"miles-agent/{AGENT_VERSION}",
    }


def _post(path: str, body: dict) -> dict:
    r = requests.post(f"{API_BASE}{path}", json=body, headers=_headers(), timeout=HTTP_TIMEOUT_SEC)
    try:
        return r.json()
    except Exception:
        return {"success": False, "error": f"http {r.status_code}: {r.text[:200]}"}


def _get(path: str) -> dict:
    r = requests.get(f"{API_BASE}{path}", headers=_headers(), timeout=HTTP_TIMEOUT_SEC)
    try:
        return r.json()
    except Exception:
        return {"success": False, "error": f"http {r.status_code}: {r.text[:200]}"}


# ── commands ────────────────────────────────────────────────────────────────
def execute_command(cmd: dict) -> tuple[str, str | None, str | None]:
    """Returns (status, result_message, error_message)."""
    ctype = cmd.get("type")
    if ctype == "sync_now":
        _post("/sync", {"payload": collect_system_info()})
        return ("completed", "synced", None)
    if ctype == "collect_system_info":
        _post("/sync", {"payload": collect_system_info()})
        return ("completed", "system info collected", None)
    if ctype == "update_wallpaper":
        url = (cmd.get("payload") or {}).get("url")
        if not url:
            return ("failed", None, "no wallpaper URL")
        # Phase 1: download + set via Windows API
        try:
            dst = os.path.join(os.environ.get("PROGRAMDATA", "C:\\ProgramData"), "miles_wallpaper.jpg")
            r = requests.get(url, timeout=HTTP_TIMEOUT_SEC)
            with open(dst, "wb") as f:
                f.write(r.content)
            if sys.platform.startswith("win"):
                import ctypes
                ctypes.windll.user32.SystemParametersInfoW(20, 0, dst, 3)
            return ("completed", "wallpaper applied", None)
        except Exception as e:
            return ("failed", None, str(e))
    return ("failed", None, f"unsupported command: {ctype}")


def poll_commands() -> None:
    resp = _get("/commands")
    if not resp.get("success"):
        return
    for cmd in resp.get("commands", []):
        status, result, err = execute_command(cmd)
        _post("/commands/status", {
            "id":     cmd["id"],
            "status": status,
            "result": result,
            "error":  err,
        })


# ── entrypoints ─────────────────────────────────────────────────────────────
def register() -> int:
    if not TOKEN:
        print("ERROR: MILES_AGENT_TOKEN is not set", file=sys.stderr)
        return 2
    info = collect_system_info()
    resp = _post("/register", {"payload": info})
    print(json.dumps(resp, indent=2))
    return 0 if resp.get("success") else 1


def run_loop() -> int:
    if not TOKEN:
        print("ERROR: MILES_AGENT_TOKEN is not set", file=sys.stderr)
        return 2
    while True:
        try:
            _post("/sync", {"payload": collect_system_info()})
            poll_commands()
        except Exception as e:
            print(f"[{datetime.now(timezone.utc).isoformat()}] sync error: {e}", file=sys.stderr)
        time.sleep(SYNC_INTERVAL_SEC)


def main() -> int:
    cmd = sys.argv[1] if len(sys.argv) > 1 else "run"
    if cmd == "register":
        return register()
    if cmd == "sync":
        info = collect_system_info()
        print(json.dumps(_post("/sync", {"payload": info}), indent=2))
        return 0
    if cmd == "info":
        print(json.dumps(collect_system_info(), indent=2))
        return 0
    if cmd == "run":
        return run_loop()
    print(f"unknown command: {cmd}", file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main())
