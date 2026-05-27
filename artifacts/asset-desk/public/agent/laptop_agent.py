"""
Miles IT Assets — Laptop Agent (Phase 1)

Cross-platform: Windows, macOS, Linux (Ubuntu/Debian/RHEL).

Lightweight agent that:
  - Registers the laptop with the portal using a one-time MILES_AGENT_TOKEN
  - Syncs system info every SYNC_INTERVAL_SECONDS
  - Polls for safe commands (sync_now, collect_system_info, update_wallpaper)
  - Reports command results

Packaging as a single binary via PyInstaller:
    pip install pyinstaller requests
    pyinstaller --onefile --noconsole --name miles-agent laptop_agent.py
    # → dist/miles-agent.exe (Windows) | dist/miles-agent (macOS/Linux)

One-time install (admin):
    # Windows
    setx MILES_AGENT_TOKEN "mil_xxxxxxxxxxxx" /M
    miles-agent.exe register
    # macOS / Linux
    export MILES_AGENT_TOKEN="mil_xxxxxxxxxxxx"
    ./miles-agent register

No destructive commands implemented in Phase 1.
"""
from __future__ import annotations

import os
import sys
import json
import time
import socket
import platform
import subprocess
import shutil
import uuid
from datetime import datetime, timezone

import requests

AGENT_VERSION       = "0.2.0"
DEFAULT_API_BASE    = "https://dimbgprindvmzoylzyud.supabase.co/functions/v1/agent-api"
API_BASE            = os.environ.get("MILES_AGENT_API_BASE", DEFAULT_API_BASE)
TOKEN               = os.environ.get("MILES_AGENT_TOKEN", "")
SYNC_INTERVAL_SEC   = int(os.environ.get("MILES_AGENT_SYNC_INTERVAL", "300"))  # 5 min
HTTP_TIMEOUT_SEC    = 30

EMPLOYEE_EMAIL      = os.environ.get("MILES_EMPLOYEE_EMAIL", "")
EMPLOYEE_ECODE      = os.environ.get("MILES_EMPLOYEE_ECODE", "")

IS_WIN  = sys.platform.startswith("win")
IS_MAC  = sys.platform == "darwin"
IS_LIN  = sys.platform.startswith("linux")


# ── shell helper ────────────────────────────────────────────────────────────
def _run(cmd: list[str], timeout: int = 15) -> str:
    """Run a command and return stripped stdout. Empty string on any failure."""
    try:
        out = subprocess.check_output(cmd, stderr=subprocess.DEVNULL, timeout=timeout)
        return out.decode("utf-8", errors="ignore").strip()
    except Exception:
        return ""


def _ps(snippet: str) -> str:
    return _run(["powershell", "-NoProfile", "-Command", snippet])


def _wmic_kv(cls: str, field: str) -> str:
    text = _run(["wmic", cls, "get", field, "/value"])
    for line in text.splitlines():
        if "=" in line:
            k, _, v = line.partition("=")
            if k.strip().lower() == field.lower():
                return v.strip()
    return ""


def _sysctl(key: str) -> str:
    return _run(["sysctl", "-n", key])


def _ioreg_serial() -> str:
    """macOS serial number via ioreg."""
    text = _run(["ioreg", "-l"])
    for line in text.splitlines():
        if '"IOPlatformSerialNumber"' in line:
            # ... "IOPlatformSerialNumber" = "C02XXXXXXXX"
            return line.split("=", 1)[-1].strip().strip('"').strip()
    return ""


def _read_file(path: str) -> str:
    try:
        with open(path, "r", encoding="utf-8", errors="ignore") as f:
            return f.read().strip()
    except Exception:
        return ""


# ── per-OS collectors ───────────────────────────────────────────────────────
def _collect_windows() -> dict:
    ram_raw = _wmic_kv("computersystem", "TotalPhysicalMemory")
    ram_gb  = f"{round(int(ram_raw) / (1024**3))} GB" if ram_raw.isdigit() else ""
    storage = _ps("[math]::Round((Get-CimInstance Win32_DiskDrive | Measure-Object -Property Size -Sum).Sum / 1GB)")
    return {
        "serial_number": _wmic_kv("bios", "SerialNumber"),
        "brand":         _wmic_kv("computersystem", "Manufacturer"),
        "model":         _wmic_kv("computersystem", "Model"),
        "processor":     _wmic_kv("cpu", "Name"),
        "ram":           ram_gb,
        "storage":       f"{storage} GB" if storage.isdigit() else "",
        "os_name":       "Windows",
        "os_version":    _ps("(Get-CimInstance Win32_OperatingSystem).Caption + ' ' + (Get-CimInstance Win32_OperatingSystem).Version"),
    }


def _collect_macos() -> dict:
    model    = _sysctl("hw.model")           # e.g. "MacBookPro18,2"
    cpu      = _sysctl("machdep.cpu.brand_string") or _sysctl("hw.model")
    mem_raw  = _sysctl("hw.memsize")
    ram_gb   = f"{round(int(mem_raw) / (1024**3))} GB" if mem_raw.isdigit() else ""
    # Total storage: sum of physical disks via diskutil
    disk_json = _run(["diskutil", "info", "-plist", "/"])  # may be plist, ignore — use df fallback
    df = _run(["df", "-k", "/"])
    storage = ""
    if df:
        lines = df.splitlines()
        if len(lines) >= 2:
            parts = lines[1].split()
            if len(parts) >= 2 and parts[1].isdigit():
                storage = f"{round(int(parts[1]) / (1024**2))} GB"
    os_ver = _run(["sw_vers", "-productVersion"])
    os_name_full = _run(["sw_vers", "-productName"]) or "macOS"
    return {
        "serial_number": _ioreg_serial(),
        "brand":         "Apple",
        "model":         model,
        "processor":     cpu,
        "ram":           ram_gb,
        "storage":       storage,
        "os_name":       os_name_full,
        "os_version":    os_ver,
    }


def _collect_linux() -> dict:
    # Brand / model / serial from DMI (requires read access — usually root for serial)
    brand   = _read_file("/sys/class/dmi/id/sys_vendor")
    model   = _read_file("/sys/class/dmi/id/product_name")
    serial  = _read_file("/sys/class/dmi/id/product_serial") or _read_file("/sys/class/dmi/id/board_serial")
    # Processor from /proc/cpuinfo
    cpu = ""
    cpuinfo = _read_file("/proc/cpuinfo")
    for line in cpuinfo.splitlines():
        if line.lower().startswith("model name"):
            cpu = line.split(":", 1)[-1].strip(); break
    # RAM from /proc/meminfo
    ram_gb = ""
    meminfo = _read_file("/proc/meminfo")
    for line in meminfo.splitlines():
        if line.startswith("MemTotal:"):
            kb = int(line.split()[1])
            ram_gb = f"{round(kb / (1024 * 1024))} GB"; break
    # Storage: sum of mounted block devices via `lsblk`
    storage = ""
    lsblk = _run(["lsblk", "-bdn", "-o", "SIZE,TYPE"])
    if lsblk:
        total = 0
        for line in lsblk.splitlines():
            parts = line.split()
            if len(parts) >= 2 and parts[1] == "disk" and parts[0].isdigit():
                total += int(parts[0])
        if total > 0:
            storage = f"{round(total / (1024**3))} GB"
    # OS info
    os_release = _read_file("/etc/os-release")
    os_name = "Linux"
    os_version = platform.release()
    for line in os_release.splitlines():
        if line.startswith("PRETTY_NAME="):
            os_name = line.split("=", 1)[-1].strip().strip('"'); break
    return {
        "serial_number": serial,
        "brand":         brand,
        "model":         model,
        "processor":     cpu,
        "ram":           ram_gb,
        "storage":       storage,
        "os_name":       os_name,
        "os_version":    os_version,
    }


# ── unified collection ──────────────────────────────────────────────────────
def collect_system_info() -> dict:
    hostname  = socket.gethostname()
    logged_in = os.environ.get("USERNAME") or os.environ.get("USER") or ""

    ip_addr = ""
    try:
        # Connect to a public IP to find the outbound interface (no packet sent).
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            s.connect(("8.8.8.8", 80))
            ip_addr = s.getsockname()[0]
        finally:
            s.close()
    except Exception:
        try:
            ip_addr = socket.gethostbyname(hostname)
        except Exception:
            pass

    mac_addr = ""
    try:
        n = uuid.getnode()
        mac_addr = ":".join(f"{(n >> i) & 0xff:02x}" for i in range(40, -1, -8))
    except Exception:
        pass

    if IS_WIN:
        per_os = _collect_windows()
    elif IS_MAC:
        per_os = _collect_macos()
    elif IS_LIN:
        per_os = _collect_linux()
    else:
        per_os = {
            "serial_number": "", "brand": "", "model": "", "processor": "",
            "ram": "", "storage": "", "os_name": platform.system(),
            "os_version": platform.version(),
        }

    return {
        **per_os,
        "hostname":            hostname,
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
        "User-Agent":    f"miles-agent/{AGENT_VERSION} ({platform.system()})",
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


# ── wallpaper (cross-platform) ──────────────────────────────────────────────
def _set_wallpaper(local_path: str) -> tuple[bool, str | None]:
    try:
        if IS_WIN:
            import ctypes
            ctypes.windll.user32.SystemParametersInfoW(20, 0, local_path, 3)
            return (True, None)
        if IS_MAC:
            # AppleScript across all desktops
            script = (
                'tell application "System Events" to '
                f'set picture of every desktop to "{local_path}"'
            )
            subprocess.check_call(["osascript", "-e", script], timeout=15)
            return (True, None)
        if IS_LIN:
            # GNOME 3+ — most common on Ubuntu desktop
            if shutil.which("gsettings"):
                subprocess.check_call([
                    "gsettings", "set", "org.gnome.desktop.background",
                    "picture-uri", f"file://{local_path}",
                ], timeout=15)
                # GNOME 42+ split light/dark
                subprocess.call([
                    "gsettings", "set", "org.gnome.desktop.background",
                    "picture-uri-dark", f"file://{local_path}",
                ], timeout=15)
                return (True, None)
            return (False, "no supported desktop env (gsettings missing)")
        return (False, f"unsupported platform: {sys.platform}")
    except Exception as e:
        return (False, str(e))


def _wallpaper_dest() -> str:
    if IS_WIN:
        base = os.environ.get("PROGRAMDATA", "C:\\ProgramData")
    else:
        base = os.path.expanduser("~/.miles_agent")
    os.makedirs(base, exist_ok=True)
    return os.path.join(base, "miles_wallpaper.jpg")


# ── commands ────────────────────────────────────────────────────────────────
def execute_command(cmd: dict) -> tuple[str, str | None, str | None]:
    """Returns (status, result_message, error_message)."""
    ctype = cmd.get("type")
    if ctype in ("sync_now", "collect_system_info"):
        _post("/sync", {"payload": collect_system_info()})
        return ("completed", "synced", None)
    if ctype == "update_wallpaper":
        url = (cmd.get("payload") or {}).get("url")
        if not url:
            return ("failed", None, "no wallpaper URL")
        try:
            dst = _wallpaper_dest()
            r = requests.get(url, timeout=HTTP_TIMEOUT_SEC)
            with open(dst, "wb") as f:
                f.write(r.content)
            ok, err = _set_wallpaper(dst)
            return ("completed", "wallpaper applied", None) if ok else ("failed", None, err)
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
        print("ERROR: MILES_AGENT_TOKEN is not set", file=sys.stderr); return 2
    print(json.dumps(_post("/register", {"payload": collect_system_info()}), indent=2))
    return 0


def run_loop() -> int:
    if not TOKEN:
        print("ERROR: MILES_AGENT_TOKEN is not set", file=sys.stderr); return 2
    while True:
        try:
            _post("/sync", {"payload": collect_system_info()})
            poll_commands()
        except Exception as e:
            print(f"[{datetime.now(timezone.utc).isoformat()}] sync error: {e}", file=sys.stderr)
        time.sleep(SYNC_INTERVAL_SEC)


def main() -> int:
    cmd = sys.argv[1] if len(sys.argv) > 1 else "run"
    if cmd == "register": return register()
    if cmd == "sync":
        print(json.dumps(_post("/sync", {"payload": collect_system_info()}), indent=2)); return 0
    if cmd == "info":
        print(json.dumps(collect_system_info(), indent=2)); return 0
    if cmd == "run":      return run_loop()
    print(f"unknown command: {cmd}", file=sys.stderr); return 2


if __name__ == "__main__":
    sys.exit(main())
