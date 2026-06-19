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

# ── Windows console UTF-8 fix ────────────────────────────────────────────────
# Windows cmd / PowerShell default to cp1252 which can't encode Unicode chars
# used in agent log messages (✓ U+2713, — U+2014, → U+2192). Reconfigure
# stdout/stderr to UTF-8 at startup so print() never raises UnicodeEncodeError.
# errors="replace" means if a character still can't be encoded, it prints "?"
# rather than crashing the entire install.
if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass  # Python < 3.7 or frozen binary without reconfigure — best effort
import json
import time
import socket
import platform
import subprocess
import shutil
import shlex
import tempfile
import io
import uuid
import base64
import hashlib
import threading
from datetime import datetime, timezone

import requests

AGENT_VERSION       = "0.9.1"
DEFAULT_API_BASE    = "https://dimbgprindvmzoylzyud.supabase.co/functions/v1/agent-api"
API_BASE            = os.environ.get("MILES_AGENT_API_BASE", DEFAULT_API_BASE)
# Where the latest laptop_agent.py is served. Mirrors DEFAULT_API_BASE so silent
# self-update works even when the install-time MILES_AGENT_URL env var is missing
# from the service context (e.g. a root/SYSTEM service that did not inherit a
# user-scope env var). Without a working default the update check 404s silently
# and the device stays pinned to whatever version it was installed with.
DEFAULT_AGENT_URL   = "https://it-asset-hub-a7rf.onrender.com/agent/laptop_agent.py"
SYNC_INTERVAL_SEC   = int(os.environ.get("MILES_AGENT_SYNC_INTERVAL", "300"))  # 5 min
# Self-update: check once every 24 h. Set to 0 to disable.
SELF_UPDATE_INTERVAL_SEC = int(os.environ.get("MILES_AGENT_UPDATE_INTERVAL", "86400"))
# Commands (lock / unlock / etc.) are polled far more frequently than the heavy
# system sync so admin actions take effect within seconds, not minutes.
COMMAND_POLL_SEC    = max(2, int(os.environ.get("MILES_AGENT_COMMAND_POLL", "5")))
# Adaptive polling: when no commands are flowing, back off from the fast
# COMMAND_POLL_SEC cadence to this slower idle cadence to cut Edge Function
# invocations. Any command received snaps the loop back to the fast cadence
# (and holds it there for BURST_WINDOW_SEC in case more follow).
IDLE_POLL_SEC       = max(COMMAND_POLL_SEC, int(os.environ.get("MILES_AGENT_IDLE_POLL", "30")))
BURST_WINDOW_SEC    = max(0, int(os.environ.get("MILES_AGENT_BURST_WINDOW", "60")))
HTTP_TIMEOUT_SEC    = 30

EMPLOYEE_EMAIL      = os.environ.get("MILES_EMPLOYEE_EMAIL", "")
EMPLOYEE_ECODE      = os.environ.get("MILES_EMPLOYEE_ECODE", "")

IS_WIN  = sys.platform.startswith("win")
IS_MAC  = sys.platform == "darwin"
IS_LIN  = sys.platform.startswith("linux")

# On Windows the agent runs windowless (pythonw via the Startup launcher), but
# every child process we spawn — powershell, wmic, etc. — would otherwise pop up
# its own console window. collect_system_info() runs these on every /sync poll,
# so without this flag a PowerShell/cmd window flashes on the user's screen
# repeatedly. CREATE_NO_WINDOW keeps those children windowless. 0 on non-Windows.
_NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0) if IS_WIN else 0

# The macOS root LaunchDaemon must NOT carry the auth token in its world-readable
# plist (any local user could read it and forge command status). Instead the token
# is written to this root-only (0600) file at install time and read back here.
MAC_SYS_TOKEN_FILE = "/Library/Application Support/MilesAgent/agent.token"


def _load_token() -> str:
    t = os.environ.get("MILES_AGENT_TOKEN", "")
    if t:
        return t.strip()
    if IS_MAC:
        try:
            with open(MAC_SYS_TOKEN_FILE) as fh:
                return fh.read().strip()
        except OSError:
            pass
    return ""


TOKEN = _load_token()


# ── shell helper ────────────────────────────────────────────────────────────
def _run(cmd: list[str], timeout: int = 15) -> str:
    """Run a command and return stripped stdout. Empty string on any failure.
    Spawns children windowless on Windows (see _NO_WINDOW) so polling never
    flashes a PowerShell/cmd console on the user's screen."""
    try:
        out = subprocess.check_output(
            cmd, stderr=subprocess.DEVNULL, timeout=timeout,
            creationflags=_NO_WINDOW,
        )
        return out.decode("utf-8", errors="ignore").strip()
    except Exception:
        return ""


def _ps_exe() -> str:
    """Return the correct PowerShell executable for this process.

    On Windows, Python (and therefore the agent) may be 32-bit even when the OS
    is 64-bit (WOW64 mode).  In that case the normal 'powershell' alias resolves
    to 32-bit PowerShell, which can silently miss 64-bit WMI/CIM data (notably
    Win32_DiskDrive sizes, storage totals, and some BIOS fields).

    The fix is to call the 64-bit PowerShell via the special 'sysnative' redirect
    that Windows exposes to 32-bit processes.  If we're already a 64-bit process,
    or sysnative doesn't exist (pure 32-bit OS), we fall back to 'powershell'.

    Architecture map used in data collection:
      struct.calcsize('P') == 4  →  32-bit Python process
      struct.calcsize('P') == 8  →  64-bit Python process (native or WOW64 is N/A)
    """
    if not IS_WIN:
        return "powershell"
    try:
        import struct
        if struct.calcsize("P") == 4:
            # 32-bit process: try sysnative redirect for native 64-bit PowerShell
            sysnative = os.path.join(
                os.environ.get("SystemRoot", r"C:\Windows"),
                "sysnative", "WindowsPowerShell", "v1.0", "powershell.exe",
            )
            if os.path.exists(sysnative):
                return sysnative
    except Exception:
        pass
    return "powershell"


# Resolve once at import time so every _ps() call reuses the same executable.
_PS_EXE = _ps_exe() if IS_WIN else "powershell"


def _ps(snippet: str) -> str:
    return _run([_PS_EXE, "-NoProfile", "-Command", snippet])


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


# ── self-update ──────────────────────────────────────────────────────────────
# The agent stores this module path at startup so it can atomically replace
# itself and restart when a newer version is available on the portal.
_AGENT_SCRIPT_PATH   = os.path.abspath(__file__)
_last_update_check   = 0.0   # monotonic time of the last version check


def _agent_script_url() -> str:
    """Return the URL where the latest laptop_agent.py is served.

    install.ps1 / install.sh saves MILES_AGENT_URL as a user-level env var
    during enrollment — that's the preferred source (lets a differently-hosted
    portal override the default). When it is empty we fall back to the hardcoded
    DEFAULT_AGENT_URL so the updater always has a reachable source.
    """
    url = os.environ.get("MILES_AGENT_URL", "").strip()
    if url:
        return url
    # No env var (common when a root/SYSTEM service does not inherit a user-scope
    # var). Fall back to the hardcoded portal URL so self-update ALWAYS has a
    # reachable source. The old behaviour derived a URL from the Supabase API base
    # (https://<ref>.supabase.co/agent/laptop_agent.py) — a path Supabase does not
    # serve, so every update 404'd silently and the device never upgraded.
    return DEFAULT_AGENT_URL


def _parse_version(src: str) -> tuple[int, ...]:
    """Extract AGENT_VERSION from agent source and return as a comparable tuple.
    Returns (0,) if the version string cannot be found or parsed."""
    import re
    m = re.search(r'^AGENT_VERSION\s*=\s*["\']([^"\']+)["\']', src, re.MULTILINE)
    if not m:
        return (0,)
    try:
        return tuple(int(x) for x in m.group(1).split("."))
    except Exception:
        return (0,)


def _self_update(force: bool = False) -> tuple[bool, str]:
    """Check for a newer agent script and apply it if one exists.

    Steps:
      1. Rate-limit to SELF_UPDATE_INTERVAL_SEC (skipped when force=True).
      2. Download the remote script to a temp file.
      3. Parse its AGENT_VERSION — skip if not strictly newer.
      4. Compile-check the download so a truncated/corrupt file never replaces us.
      5. Atomically replace the local script with os.replace().
      6. os.execv() to restart the current process in-place with the new code.
         (execv replaces the process image — the caller never returns.)

    Returns (updated: bool, message: str). 'updated' is only False when the
    function returns normally; True is returned conceptually but execv() means
    the caller never sees it — the process has already been replaced.
    """
    global _last_update_check
    now = time.monotonic()

    if not force:
        if SELF_UPDATE_INTERVAL_SEC <= 0:
            return (False, "self-update disabled")
        if now - _last_update_check < SELF_UPDATE_INTERVAL_SEC:
            return (False, "not due yet")

    _last_update_check = now

    url = _agent_script_url()
    if not url:
        return (False, "no agent URL configured")

    tmp_path = _AGENT_SCRIPT_PATH + ".update_tmp"
    try:
        r = requests.get(url, timeout=30, stream=True)
        if r.status_code != 200:
            return (False, f"download failed: HTTP {r.status_code}")

        with open(tmp_path, "wb") as fh:
            for chunk in r.iter_content(chunk_size=16384):
                fh.write(chunk)

        with open(tmp_path, "r", encoding="utf-8", errors="ignore") as fh:
            new_src = fh.read()

        new_ver = _parse_version(new_src)
        cur_ver = _parse_version(f'AGENT_VERSION = "{AGENT_VERSION}"')
        if new_ver <= cur_ver:
            os.remove(tmp_path)
            return (False, f"already up to date (local={AGENT_VERSION})")

        # Validate: reject if the new script does not compile cleanly.
        import py_compile
        try:
            py_compile.compile(tmp_path, doraise=True)
        except py_compile.PyCompileError as exc:
            os.remove(tmp_path)
            return (False, f"new script failed syntax check: {exc}")

        # Atomic replace — on the same filesystem this is a rename, never a
        # partial write. If the replace fails the old script is untouched.
        os.replace(tmp_path, _AGENT_SCRIPT_PATH)

        # Restart in-place. os.execv() replaces this process with a fresh
        # Python interpreter running the updated script — the run loop, any
        # threads, and open handles are cleanly replaced without leaving a
        # ghost process.  This line never returns.
        os.execv(sys.executable, [sys.executable] + sys.argv)

    except Exception as exc:
        try:
            if os.path.exists(tmp_path):
                os.remove(tmp_path)
        except Exception:
            pass
        return (False, f"update error: {exc}")

    return (True, "updated")   # unreachable after execv, kept for type-checker


# ── per-OS collectors ───────────────────────────────────────────────────────
# Placeholder strings that some OEMs bake into firmware — treated as "no data".
_WIN_BAD_VALUES = {
    "", "to be filled by o.e.m.", "default string", "none", "n/a",
    "not applicable", "system serial number", "0", "unknown",
    "no asset tag", "asset-1234567890",
}


def _cim_clean(val: str) -> str:
    """Strip whitespace; return empty string for known placeholder values."""
    v = val.strip()
    return "" if v.lower() in _WIN_BAD_VALUES else v


def _collect_windows() -> dict:
    # ── Serial Number ─────────────────────────────────────────────────────────
    # Primary: Get-CimInstance Win32_Bios (modern, replaces deprecated wmic bios).
    # Fallback chain covers firmware that stores S/N in the enclosure or baseboard.
    serial = _cim_clean(_ps("(Get-CimInstance Win32_Bios).SerialNumber"))
    if not serial:
        serial = _cim_clean(_ps("(Get-CimInstance Win32_SystemEnclosure).SerialNumber"))
    if not serial:
        serial = _cim_clean(_ps("(Get-CimInstance Win32_BaseBoard).SerialNumber"))
    if not serial:
        serial = _cim_clean(_wmic_kv("bios", "SerialNumber"))

    # ── Brand / Model ─────────────────────────────────────────────────────────
    brand = (
        _cim_clean(_ps("(Get-CimInstance Win32_ComputerSystem).Manufacturer"))
        or _cim_clean(_wmic_kv("computersystem", "Manufacturer"))
    )
    model = (
        _cim_clean(_ps("(Get-CimInstance Win32_ComputerSystem).Model"))
        or _cim_clean(_wmic_kv("computersystem", "Model"))
    )

    # ── Processor ────────────────────────────────────────────────────────────
    processor = (
        _cim_clean(_ps("(Get-CimInstance Win32_Processor | Select-Object -First 1).Name"))
        or _cim_clean(_wmic_kv("cpu", "Name"))
    )

    # ── RAM ──────────────────────────────────────────────────────────────────
    # CIM gives the exact physical memory size in bytes; wmic is the fallback.
    ram_raw = (
        _ps("(Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory").strip()
        or _wmic_kv("computersystem", "TotalPhysicalMemory")
    )
    ram_gb = f"{round(int(ram_raw) / (1024**3))} GB" if ram_raw and ram_raw.isdigit() else ""

    # ── Storage ───────────────────────────────────────────────────────────────
    # Strategy 1 — sum all physical disks (covers NVMe + SATA, most accurate).
    storage_num = _ps(
        "$d=(Get-CimInstance Win32_DiskDrive|Measure-Object -Property Size -Sum).Sum;"
        "if($d -and $d -gt 0){[math]::Round($d/1GB)}else{''}"
    ).strip()
    # Strategy 2 — C: logical disk size (reliable single-drive proxy).
    if not storage_num or not storage_num.isdigit():
        storage_num = _ps(
            "$d=Get-CimInstance Win32_LogicalDisk -Filter \"DeviceID='C:'\";"
            "if($d -and $d.Size -gt 0){[math]::Round($d.Size/1GB)}else{''}"
        ).strip()
    # Strategy 3 — wmic diskdrive fallback (first disk only, older Windows).
    if not storage_num or not storage_num.isdigit():
        raw = _wmic_kv("diskdrive", "Size")
        if raw and raw.isdigit():
            storage_num = str(round(int(raw) / (1024 ** 3)))
    storage = f"{storage_num} GB" if storage_num and storage_num.isdigit() else ""

    # ── OS + Architecture ────────────────────────────────────────────────────
    # OSArchitecture returns "64-bit", "32-bit", or "ARM 64-bit" automatically.
    os_obj      = _ps("$o=Get-CimInstance Win32_OperatingSystem;$o.Caption+'|'+$o.Version+'|'+$o.OSArchitecture")
    os_parts    = os_obj.split("|") if "|" in os_obj else [os_obj, "", ""]
    os_caption  = os_parts[0].strip()
    os_ver_num  = os_parts[1].strip()
    os_arch     = os_parts[2].strip()   # e.g. "64-bit", "32-bit", "ARM 64-bit"

    # Fallback: use platform module when CIM call fails
    if not os_caption:
        os_caption = _ps("(Get-CimInstance Win32_OperatingSystem).Caption").strip()
    if not os_arch:
        os_arch = _ps("(Get-CimInstance Win32_OperatingSystem).OSArchitecture").strip()
    if not os_arch:
        # Last resort: derive from Python's own pointer size
        try:
            import struct
            os_arch = "64-bit" if struct.calcsize("P") == 8 else "32-bit"
        except Exception:
            os_arch = platform.machine()   # e.g. "AMD64", "x86", "ARM64"

    os_version = " ".join(filter(None, [os_caption, os_ver_num])).strip()

    return {
        "serial_number": serial,
        "brand":         brand,
        "model":         model,
        "processor":     processor,
        "ram":           ram_gb,
        "storage":       storage,
        "os_name":       "Windows",
        "os_version":    os_version,
        "os_arch":       os_arch,        # "64-bit" | "32-bit" | "ARM 64-bit"
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
def _uptime_seconds() -> int | None:
    """Seconds since the machine last booted. None if it can't be determined."""
    try:
        if IS_WIN:
            import ctypes
            # GetTickCount64 = ms since boot (monotonic, unaffected by clock changes).
            ms = ctypes.windll.kernel32.GetTickCount64()
            return int(ms // 1000)
        if IS_LIN:
            with open("/proc/uptime", "r") as fh:
                return int(float(fh.read().split()[0]))
        if IS_MAC:
            # kern.boottime → "{ sec = 1700000000, usec = 0 } ..."
            r = subprocess.run(["sysctl", "-n", "kern.boottime"],
                               capture_output=True, text=True, timeout=10)
            import re
            m = re.search(r"sec\s*=\s*(\d+)", r.stdout)
            if m:
                return max(0, int(time.time()) - int(m.group(1)))
    except Exception:
        pass
    return None


def _boot_time_iso() -> str | None:
    """ISO8601 (UTC) timestamp of the last boot, derived from uptime."""
    up = _uptime_seconds()
    if up is None:
        return None
    try:
        from datetime import timedelta
        return (datetime.now(timezone.utc) - timedelta(seconds=up)).isoformat()
    except Exception:
        return None


def collect_system_info() -> dict:
    hostname  = socket.gethostname()
    logged_in = os.environ.get("USERNAME") or os.environ.get("USER") or ""
    # When the agent runs as a root system service (required for Linux hard lock),
    # USER/USERNAME is "root". Report the real human at the console instead so the
    # portal keeps showing the employee, not the service account.
    if IS_LIN and _is_root():
        cu = _linux_console_user()
        if cu:
            logged_in = cu
    if IS_MAC and _is_root():
        cu = _mac_console_user()
        if cu:
            logged_in = cu

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
        "uptime_seconds":      _uptime_seconds(),
        "last_boot_at":        _boot_time_iso(),
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
def _screen_size() -> tuple[int, int]:
    """Best-effort current primary-display resolution. Defaults to 1920x1080."""
    try:
        if IS_WIN:
            import ctypes
            user32 = ctypes.windll.user32
            try: user32.SetProcessDPIAware()
            except Exception: pass
            return (user32.GetSystemMetrics(0), user32.GetSystemMetrics(1))
        if IS_MAC:
            out = subprocess.check_output(
                ["system_profiler", "SPDisplaysDataType"], timeout=10
            ).decode(errors="ignore")
            import re
            m = re.search(r"Resolution:\s+(\d+)\s*x\s*(\d+)", out)
            if m: return (int(m.group(1)), int(m.group(2)))
        if IS_LIN and shutil.which("xrandr"):
            out = subprocess.check_output(["xrandr", "--current"], timeout=10).decode(errors="ignore")
            import re
            for line in out.splitlines():
                m = re.search(r"\s(\d+)x(\d+)\+\d+\+\d+", line)
                if m: return (int(m.group(1)), int(m.group(2)))
    except Exception:
        pass
    return (1920, 1080)


def pick_variant(variants: list, screen_w: int, screen_h: int) -> dict | None:
    """Choose the smallest variant that fully covers the screen.
    If none cover it, fall back to the largest available (avoids upscaling artefacts)."""
    if not variants: return None
    covering = [v for v in variants if v.get("width", 0) >= screen_w and v.get("height", 0) >= screen_h]
    if covering:
        return min(covering, key=lambda v: v["width"] * v["height"])
    return max(variants, key=lambda v: v.get("width", 0) * v.get("height", 0))


def _win_set_style_fill() -> None:
    """Write HKCU\\Control Panel\\Desktop\\WallpaperStyle=10 (Fill) + TileWallpaper=0."""
    try:
        import winreg
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, r"Control Panel\Desktop",
                            0, winreg.KEY_SET_VALUE) as k:
            winreg.SetValueEx(k, "WallpaperStyle", 0, winreg.REG_SZ, "10")  # 10 = Fill
            winreg.SetValueEx(k, "TileWallpaper",  0, winreg.REG_SZ, "0")
    except Exception:
        pass  # registry write is best-effort; SetDeskWallpaper still works


def _win_set_lockscreen(local_path: str) -> tuple[bool, str | None]:
    """Set the CURRENT USER's lock-screen image — no admin required.

    SystemParametersInfo only changes the desktop, never the lock screen. The
    only reliable per-user (non-admin) way to set the lock screen on Win 10/11
    is the WinRT API Windows.System.UserProfile.LockScreen.SetImageFileAsync,
    which we drive from in-box PowerShell 5.1. The image is read from the user's
    own LOCALAPPDATA, so it works while the agent runs in the user session.

    Returns (ok, error). Common failure: a Group Policy that forces/locks the
    lock-screen image throws "Access is denied" — reported, never raised.
    """
    # Single-quote the path for PowerShell, doubling any embedded single quotes.
    ps_path = local_path.replace("'", "''")
    snippet = (
        "$ErrorActionPreference='Stop';"
        "Add-Type -AssemblyName System.Runtime.WindowsRuntime | Out-Null;"
        "$null=[Windows.System.UserProfile.LockScreen,Windows.System.UserProfile,ContentType=WindowsRuntime];"
        "$null=[Windows.Storage.StorageFile,Windows.Storage,ContentType=WindowsRuntime];"
        "$gen=([System.WindowsRuntimeSystemExtensions].GetMethods()|"
        "Where-Object{$_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and "
        "$_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'})[0];"
        "$act=([System.WindowsRuntimeSystemExtensions].GetMethods()|"
        "Where-Object{$_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and -not $_.IsGenericMethod})[0];"
        "function Await($op,$t){$m=$gen.MakeGenericMethod($t);$tk=$m.Invoke($null,@($op));$tk.Wait(-1)|Out-Null;$tk.Result};"
        "function AwaitAction($a){$tk=$act.Invoke($null,@($a));$tk.Wait(-1)|Out-Null};"
        f"$f=Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync('{ps_path}')) ([Windows.Storage.StorageFile]);"
        "AwaitAction ([Windows.System.UserProfile.LockScreen]::SetImageFileAsync($f));"
        "Write-Output 'OK'"
    )
    try:
        kwargs: dict = {}
        if hasattr(subprocess, "CREATE_NO_WINDOW"):
            kwargs["creationflags"] = subprocess.CREATE_NO_WINDOW  # type: ignore[attr-defined]
        r = subprocess.run(
            ["powershell", "-NoProfile", "-NonInteractive", "-Command", snippet],
            capture_output=True, text=True, timeout=45, **kwargs,
        )
        if r.returncode == 0 and "OK" in (r.stdout or ""):
            return (True, None)
        err = (r.stderr or r.stdout or "").strip().replace("\r", " ").replace("\n", " ")
        return (False, (err[:300] or f"powershell exit {r.returncode}"))
    except Exception as e:
        return (False, str(e))


def _set_wallpaper(local_path: str) -> tuple[bool, str | None]:
    try:
        if IS_WIN:
            import ctypes
            _win_set_style_fill()
            # SPI_SETDESKWALLPAPER=20, SPIF_UPDATEINIFILE|SPIF_SENDWININICHANGE=3
            ok = bool(ctypes.windll.user32.SystemParametersInfoW(20, 0, local_path, 3))
            if not ok:
                return (False, "SystemParametersInfoW returned 0")
            # Desktop set — now also set the lock screen (separate subsystem;
            # SPI never touches it). Best-effort, per-user, no admin.
            lock_ok, lock_err = _win_set_lockscreen(local_path)
            if not lock_ok:
                # Desktop succeeded; surface the lock-screen problem without
                # failing the whole apply (e.g. policy-locked lock screens).
                return (True, f"desktop applied; lock screen not set: {lock_err}")
            return (True, None)
        if IS_MAC:
            # macOS Sonoma (14) / Sequoia (15+) overhauled wallpaper storage. The
            # classic `osascript ... set picture of every desktop` updates the
            # legacy store that the LOCK SCREEN reads, but frequently does NOT
            # refresh the LIVE DESKTOP. The reliable way to update the desktop on
            # modern macOS is NSWorkspace.setDesktopImageURL, applied to every
            # screen, with a reset-to-empty first to defeat the "same path, new
            # contents" cache bug. We do BOTH the NSWorkspace call and the legacy
            # AppleScript so the lock screen and every display update together.
            esc = local_path.replace("\\", "\\\\").replace('"', '\\"')
            try:
                mac_major = int((platform.mac_ver()[0] or "0").split(".")[0])
            except Exception:  # noqa: BLE001
                mac_major = 0

            # 1) Primary: NSWorkspace via the built-in Swift interpreter, which
            #    actually re-renders the LIVE DESKTOP on all displays. This is the
            #    authoritative "desktop applied" signal — the Swift program exits
            #    nonzero if any screen fails or there is no GUI session, so we never
            #    report a false success. Swift ships with the Command Line Tools
            #    that python3 already needs; if it is missing we fall through to the
            #    legacy AppleScript path below.
            swift_src = (
                "import AppKit\n"
                f'let u = URL(fileURLWithPath: "{esc}")\n'
                "let screens = NSScreen.screens\n"
                "if screens.isEmpty {\n"
                '  FileHandle.standardError.write("no GUI screens\\n".data(using: .utf8)!)\n'
                "  exit(3)\n"
                "}\n"
                "var failed = false\n"
                "for s in screens {\n"
                "  try? NSWorkspace.shared.setDesktopImageURL(URL(fileURLWithPath: \"\"), for: s, options: [:])\n"
                "  do {\n"
                "    try NSWorkspace.shared.setDesktopImageURL(u, for: s, options: [:])\n"
                "  } catch {\n"
                '    failed = true\n'
                '    FileHandle.standardError.write("setDesktopImageURL failed: \\(error)\\n".data(using: .utf8)!)\n'
                "  }\n"
                "}\n"
                "exit(failed ? 1 : 0)\n"
            )
            desktop_ok = False
            swift_err: str | None = None
            tmp_path: str | None = None
            try:
                with tempfile.NamedTemporaryFile("w", suffix=".swift", delete=False) as tmp:
                    tmp.write(swift_src)
                    tmp_path = tmp.name
                # When root, the swift program runs as the console user (see
                # _mac_gui_argv) and must be able to read this temp file.
                try:
                    os.chmod(tmp_path, 0o644)
                except OSError:
                    pass
                subprocess.check_call(_mac_gui_argv(["swift", tmp_path]), timeout=60,
                                      stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
                desktop_ok = True
            except FileNotFoundError:
                swift_err = "swift (Command Line Tools) not available"
            except subprocess.CalledProcessError as e:
                swift_err = (e.stderr.decode() if e.stderr else str(e)).strip() or "swift exited nonzero"
            except Exception as e:  # noqa: BLE001
                swift_err = str(e)
            finally:
                if tmp_path:
                    try:
                        os.remove(tmp_path)
                    except OSError:
                        pass

            # 2) Also drive the legacy AppleScript path so the LOCK SCREEN / login
            #    window and pre-Sonoma releases are covered.
            legacy_ok = False
            legacy_err: str | None = None
            for script in (
                f'tell application "System Events" to set picture of every desktop to "{esc}"',
                f'tell application "Finder" to set desktop picture to POSIX file "{esc}"',
            ):
                try:
                    subprocess.check_call(_mac_gui_argv(["osascript", "-e", script]), timeout=20,
                                          stderr=subprocess.PIPE)
                    legacy_ok = True
                except subprocess.CalledProcessError as e:
                    legacy_err = (e.stderr.decode() if e.stderr else str(e)).strip()
                except Exception as e:  # noqa: BLE001
                    legacy_err = str(e)

            if not (desktop_ok or legacy_ok):
                return (False, swift_err or legacy_err or "failed to set wallpaper on macOS")

            # Force an immediate re-render of the desktop + lock screen.
            for proc in ("Dock", "WallpaperAgent"):
                try:
                    subprocess.call(_mac_gui_argv(["killall", proc]), timeout=10,
                                    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                except Exception:  # noqa: BLE001
                    pass

            # Best-effort read-back: does the live desktop now reference our file?
            verified: bool | None = None
            try:
                out = subprocess.check_output(
                    _mac_gui_argv(["osascript", "-e",
                     'tell application "System Events" to get picture of desktop 1']),
                    timeout=15, stderr=subprocess.DEVNULL,
                ).decode().strip()
                verified = (
                    os.path.abspath(local_path) == out
                    or os.path.basename(local_path) in out
                )
            except Exception:  # noqa: BLE001 — verification unavailable
                verified = None

            # Decide honestly. NSWorkspace success means the desktop was updated on
            # every display; a positive read-back independently confirms it.
            if desktop_ok or verified:
                return (True, None)
            # On Sonoma+ (macOS 14+) the legacy AppleScript path alone typically
            # updates only the lock screen, not the live desktop — report that
            # truthfully instead of a false "applied".
            if mac_major >= 14:
                return (False, swift_err or
                        "lock screen updated but live desktop did not change "
                        "(NSWorkspace unavailable on macOS 14+)")
            # Older macOS: the legacy AppleScript path does update the desktop.
            return (True, None)
        if IS_LIN:
            if shutil.which("gsettings"):
                subprocess.check_call([
                    "gsettings", "set", "org.gnome.desktop.background",
                    "picture-uri", f"file://{local_path}",
                ], timeout=15)
                subprocess.call([
                    "gsettings", "set", "org.gnome.desktop.background",
                    "picture-uri-dark", f"file://{local_path}",
                ], timeout=15)
                # Fill the screen (image is already pre-composited at full-screen size)
                subprocess.call([
                    "gsettings", "set", "org.gnome.desktop.background",
                    "picture-options", "zoom",
                ], timeout=15)
                return (True, None)
            return (False, "no supported desktop env (gsettings missing)")
        return (False, f"unsupported platform: {sys.platform}")
    except Exception as e:
        return (False, str(e))


def _wallpaper_cache_dir() -> str:
    if IS_WIN:
        base = os.path.join(os.environ.get("LOCALAPPDATA", os.path.expanduser("~")), "MilesAgent")
    elif IS_MAC:
        if _is_root():
            # The agent runs as a root LaunchDaemon, but the wallpaper is applied
            # inside the console user's GUI session — which cannot read root's home
            # (/var/root). Stage the image in a world-readable shared location.
            base = "/Users/Shared/MilesAgent"
        else:
            base = os.path.expanduser("~/Library/Application Support/MilesAgent")
    else:
        base = os.path.expanduser("~/.cache/miles-agent")
    os.makedirs(base, exist_ok=True)
    if IS_MAC and _is_root():
        try:
            os.chmod(base, 0o755)
        except OSError:
            pass
    return base


def _wallpaper_state_path() -> str:
    return os.path.join(_wallpaper_cache_dir(), "wallpaper.state.json")


def _wallpaper_image_path(ext: str = "png") -> str:
    return os.path.join(_wallpaper_cache_dir(), f"miles_wallpaper.{ext}")


def _load_wallpaper_state() -> dict:
    try:
        with open(_wallpaper_state_path()) as fh:
            return json.load(fh)
    except Exception:
        return {}


def _save_wallpaper_state(d: dict) -> None:
    try:
        with open(_wallpaper_state_path(), "w") as fh:
            json.dump(d, fh)
    except Exception:
        pass


def apply_active_wallpaper(force: bool = False) -> tuple[str, str | None]:
    """Fetch active wallpaper from portal, download if changed, apply, and report.
    Returns (status, error). Status is 'applied' | 'skipped' | 'failed' | 'none'.
    Never raises — wallpaper failure must not break the sync loop.
    """
    try:
        resp = _get("/wallpaper/active")
        if not resp.get("success"):
            return ("failed", resp.get("error") or "fetch failed")
        w = resp.get("wallpaper")
        if not w:
            return ("none", None)

        wid    = w.get("id")
        # Pick the right-sized variant for THIS screen (preserves quality, avoids stretching)
        variants = w.get("variants") or []
        screen_w, screen_h = _screen_size()
        chosen = pick_variant(variants, screen_w, screen_h) if variants else None
        if chosen:
            url  = chosen["url"]
            sha  = chosen.get("sha256") or ""
            mime = "image/png"  # variants are PNG/JPG; ext determined below
        else:
            url  = w.get("url")
            sha  = w.get("sha256") or ""
            mime = (w.get("mime_type") or "").lower()
        ext    = "jpg" if "jpeg" in mime or "jpg" in mime else ("bmp" if "bmp" in mime else "png")
        # URL hint: if URL ends with .jpg/.png prefer that
        for e in ("jpg", "jpeg", "png", "bmp"):
            if url.lower().endswith("." + e):
                ext = "jpg" if e == "jpeg" else e
                break
        dst    = _wallpaper_image_path(ext)

        state  = _load_wallpaper_state()
        same   = (state.get("sha256") == sha and state.get("wallpaper_id") == wid
                  and os.path.exists(state.get("path", "")))

        if same and not force:
            return ("skipped", None)

        # Download (stream to avoid huge memory for large images)
        r = requests.get(url, timeout=HTTP_TIMEOUT_SEC, stream=True)
        if r.status_code != 200:
            err = f"download http {r.status_code}"
            _post("/wallpaper/status", {"wallpaper_id": wid, "status": "failed", "error": err})
            return ("failed", err)

        with open(dst, "wb") as f:
            for chunk in r.iter_content(chunk_size=64 * 1024):
                if chunk: f.write(chunk)
        if IS_MAC and _is_root():
            # The wallpaper is applied inside the console user's GUI session, which
            # must be able to read this file (root's umask would otherwise make it 0600).
            try:
                os.chmod(dst, 0o644)
            except OSError:
                pass

        # Verify hash if server supplied one (preserves quality / integrity)
        if sha:
            h = hashlib.sha256()
            with open(dst, "rb") as f:
                for chunk in iter(lambda: f.read(64 * 1024), b""):
                    h.update(chunk)
            if h.hexdigest() != sha:
                err = "sha256 mismatch — file corrupted in transit"
                _post("/wallpaper/status", {"wallpaper_id": wid, "status": "failed", "error": err})
                return ("failed", err)

        ok, err = _set_wallpaper(os.path.abspath(dst))
        status  = "applied" if ok else "failed"
        _post("/wallpaper/status", {
            "wallpaper_id": wid, "status": status, "error": err,
        })
        if ok:
            _save_wallpaper_state({
                "wallpaper_id": wid, "sha256": sha, "path": dst,
                "applied_at": datetime.now(timezone.utc).isoformat(),
            })
        return (status, err)
    except Exception as e:
        try: _post("/wallpaper/status", {"status": "failed", "error": str(e)})
        except Exception: pass
        return ("failed", str(e))


# ── remote HARD lock (real OS lockout, honest reporting) ───────────────────
# A locked device is locked at the OS level — NOT a dismissable overlay:
#   * Windows : LockWorkStation() drops to the secure desktop. This is dismissed
#               the instant the user types their password, so we RE-ASSERT it
#               every fast cycle (see reassert_lock) to keep them out.
#   * macOS   : the account is DISABLED (pwpolicy/DisabledUser) and the user is
#               dropped to the login window, where a custom banner tells them to
#               contact IT. Their password is rejected — a genuine login-window
#               lock, not a screen saver. Needs root (system LaunchDaemon).
#   * Linux   : the account is password-locked (usermod -L) and the active
#               session is terminated. Needs root (system service).
# macOS/Linux use a PERSISTENT account lock, so they need no re-assertion. On
# macOS/Linux, if the agent is NOT root we report "requires_admin" (reinstall
# with sudo) rather than faking success.
# We NEVER report 'completed' unless the OS lock actually took effect, and we
# surface the exact failure reason to the portal. Local state persists so the
# lock re-applies on reboot and is reconciled from the server every /sync.
LOCK_STATE_FILE = os.path.join(os.path.expanduser("~"), ".miles-agent", "lock.state.json")

_lock_mutex = threading.Lock()


def _read_lock_state() -> dict:
    try:
        with open(LOCK_STATE_FILE, "r", encoding="utf-8") as f:
            d = json.load(f)
            return d if isinstance(d, dict) else {}
    except Exception:
        return {}


def _read_local_lock() -> bool:
    return bool(_read_lock_state().get("locked", False))


def _write_lock_state(state: dict) -> None:
    try:
        os.makedirs(os.path.dirname(LOCK_STATE_FILE), exist_ok=True)
        with open(LOCK_STATE_FILE, "w", encoding="utf-8") as f:
            json.dump(state, f)
    except Exception:
        pass


def _is_root() -> bool:
    try:
        return hasattr(os, "geteuid") and os.geteuid() == 0
    except Exception:
        return False


# ── macOS hard-lock helpers ───────────────────────────────────────────────────
# The login-window banner shown to a locked-out user. Set via
# `defaults write /Library/Preferences/com.apple.loginwindow LoginwindowText`.
MAC_LOCK_MESSAGE = "This device is managed by Miles Education. Please contact IT Admin."


def _mac_console_user() -> str | None:
    """The human currently logged into the GUI (Aqua) session, or None when the
    Mac is sitting at the login window. Reads the owner of /dev/console, which is
    the console user; falls back to SystemConfiguration. System/service accounts
    (root, _windowserver, loginwindow, names starting with '_') are ignored."""
    def _is_human(name: str | None) -> bool:
        return bool(name) and name not in ("root", "loginwindow", "_windowserver") \
            and not name.startswith("_")
    try:
        out = subprocess.run(["stat", "-f", "%Su", "/dev/console"],
                             capture_output=True, text=True, timeout=10).stdout.strip()
        if _is_human(out):
            return out
    except Exception:
        pass
    try:
        out = subprocess.run(["scutil"], input="show State:/Users/ConsoleUser\n",
                             capture_output=True, text=True, timeout=10).stdout
        for line in out.splitlines():
            if "Name :" in line:
                name = line.split(":", 1)[1].strip()
                if _is_human(name):
                    return name
    except Exception:
        pass
    return None


def _mac_uid_for(user: str) -> int | None:
    try:
        import pwd
        return pwd.getpwnam(user).pw_uid
    except Exception:
        return None


def _mac_console_uid() -> int | None:
    u = _mac_console_user()
    return _mac_uid_for(u) if u else None


def _mac_human_users() -> list[str]:
    """All local human accounts (UID >= 500, name not starting with '_'). Used to
    pick a lock target when nobody is at the console (e.g. lost/stolen at the
    login window)."""
    users: list[str] = []
    try:
        out = subprocess.run(["dscl", ".", "-list", "/Users", "UniqueID"],
                             capture_output=True, text=True, timeout=10).stdout
        for line in out.splitlines():
            parts = line.split()
            if len(parts) >= 2 and parts[1].isdigit():
                name, uid = parts[0], int(parts[1])
                if uid >= 500 and name != "root" and not name.startswith("_"):
                    users.append(name)
    except Exception:
        pass
    return users


def _mac_gui_argv(argv: list[str]) -> list[str]:
    """Wrap argv so it executes inside the console user's Aqua GUI session when the
    agent runs as root (a LaunchDaemon). NSWorkspace / osascript / killall must run
    in the user's session, not the bare root daemon context, or they no-op. When the
    agent is not root (legacy per-user LaunchAgent) the argv runs unchanged."""
    if IS_MAC and _is_root():
        uid = _mac_console_uid()
        user = _mac_console_user()
        if uid is not None and user:
            return ["launchctl", "asuser", str(uid), "sudo", "-u", user, *argv]
    return argv


def _mac_account_disabled(user: str) -> bool | None:
    """Whether `user` is barred from logging in. Deterministic check via the
    account's AuthenticationAuthority (contains ';DisabledUser;' when disabled),
    with pwpolicy as a secondary signal. Returns True/False, or None if it cannot
    be determined (so we never report a false 'locked')."""
    try:
        r = subprocess.run(["dscl", ".", "-read", f"/Users/{user}", "AuthenticationAuthority"],
                           capture_output=True, text=True, timeout=10)
        if r.returncode == 0:
            if "DisabledUser" in r.stdout:
                return True
            # We could read the record and it is not disabled — unless pwpolicy
            # says otherwise below.
            authoritative_false = True
        else:
            authoritative_false = False
    except Exception:
        authoritative_false = False
    try:
        r = subprocess.run(["pwpolicy", "-u", user, "-getpolicy"],
                           capture_output=True, text=True, timeout=10)
        if r.returncode == 0:
            blob = r.stdout.replace(" ", "").lower()
            if "isdisabled=1" in blob or "isdisabled=true" in blob:
                return True
            return False
    except Exception:
        pass
    return False if authoritative_false else None


def _mac_disable_account(user: str) -> tuple[bool, str]:
    """Bar `user` from logging in. Tries pwpolicy then a direct DisabledUser
    authority append, verifying after each. Returns (ok, detail) where ok is True
    only when the account is CONFIRMED disabled."""
    subprocess.run(["pwpolicy", "-u", user, "-disableuser"],
                   capture_output=True, text=True, timeout=15)
    if _mac_account_disabled(user) is True:
        return (True, "pwpolicy -disableuser")
    subprocess.run(["dscl", ".", "-append", f"/Users/{user}",
                    "AuthenticationAuthority", ";DisabledUser;"],
                   capture_output=True, text=True, timeout=15)
    if _mac_account_disabled(user) is True:
        return (True, "dscl DisabledUser")
    return (False, "account could not be disabled (verification failed)")


def _mac_enable_account(user: str) -> tuple[bool, str]:
    """Re-enable `user`. Uses both pwpolicy and DisabledUser removal, then
    verifies. Returns (ok, detail); ok True only when CONFIRMED not disabled."""
    subprocess.run(["pwpolicy", "-u", user, "-enableuser"],
                   capture_output=True, text=True, timeout=15)
    subprocess.run(["dscl", ".", "-delete", f"/Users/{user}",
                    "AuthenticationAuthority", ";DisabledUser;"],
                   capture_output=True, text=True, timeout=15)
    state = _mac_account_disabled(user)
    if state is False:
        return (True, "account re-enabled")
    if state is None:
        return (False, "re-enable attempted but could not be verified")
    return (False, "account is still disabled after re-enable")


def _mac_set_login_message(msg: str) -> bool:
    """Show a banner on the login window. Root-only. Returns True only if the
    banner was written AND read back identically, so the caller can report an
    honest status instead of assuming the banner is showing."""
    try:
        subprocess.run(["defaults", "write",
                        "/Library/Preferences/com.apple.loginwindow",
                        "LoginwindowText", msg],
                       capture_output=True, text=True, timeout=10)
        out = subprocess.run(["defaults", "read",
                              "/Library/Preferences/com.apple.loginwindow",
                              "LoginwindowText"],
                             capture_output=True, text=True, timeout=10)
        return out.returncode == 0 and out.stdout.strip() == msg.strip()
    except Exception:
        return False


def _mac_clear_login_message() -> None:
    try:
        subprocess.run(["defaults", "delete",
                        "/Library/Preferences/com.apple.loginwindow",
                        "LoginwindowText"],
                       capture_output=True, text=True, timeout=10)
    except Exception:
        pass


def _mac_user_has_session(user: str) -> bool:
    """True while `user` still owns the live GUI session (i.e. they are at their
    desktop, not the login window)."""
    return _mac_console_user() == user


def _mac_force_logout(user: str) -> None:
    """Kick `user` to the login window. `launchctl bootout` ends their GUI session;
    if that does not stick we escalate to killing their processes."""
    uid = _mac_uid_for(user)
    if uid is not None:
        subprocess.run(["launchctl", "bootout", f"user/{uid}"],
                       capture_output=True, text=True, timeout=20)
        time.sleep(1)
    if _mac_user_has_session(user):
        subprocess.run(["pkill", "-KILL", "-u", user],
                       capture_output=True, text=True, timeout=15)
        time.sleep(1)


def _linux_console_user() -> str | None:
    """Best-effort: the human user logged into the graphical/console session —
    the one a hard lock must lock out. Only meaningful when running as root."""
    try:
        out = subprocess.run(["loginctl", "list-sessions", "--no-legend"],
                             capture_output=True, text=True, timeout=10).stdout
        for line in out.splitlines():
            parts = line.split()
            if len(parts) >= 3:
                uid, user = parts[1], parts[2]
                try:
                    if int(uid) >= 1000 and user != "root":
                        return user
                except ValueError:
                    continue
    except Exception:
        pass
    try:
        out = subprocess.run(["who"], capture_output=True, text=True, timeout=10).stdout
        for line in out.splitlines():
            cols = line.split()
            if cols and cols[0] != "root":
                return cols[0]
    except Exception:
        pass
    su = os.environ.get("SUDO_USER")
    return su if su and su != "root" else None


def _linux_user_has_session(user: str) -> bool:
    """True if `user` still has an active login session (root-only check)."""
    try:
        out = subprocess.run(["loginctl", "list-sessions", "--no-legend"],
                             capture_output=True, text=True, timeout=10).stdout
        for line in out.splitlines():
            parts = line.split()
            if len(parts) >= 3 and parts[2] == user:
                return True
    except Exception:
        # If we cannot determine it, assume a session may remain (fail safe:
        # the caller treats "unknown" as "still there" and reports honestly).
        return True
    return False


def _linux_account_locked(user: str) -> bool | None:
    """Whether the account password is locked, via `passwd -S` (root-only).
    Returns True (locked), False (usable), or None if it cannot be determined."""
    try:
        r = subprocess.run(["passwd", "-S", user], capture_output=True, text=True, timeout=10)
        if r.returncode != 0:
            return None
        parts = r.stdout.split()
        if len(parts) >= 2:
            # field 2: L/LK = locked, P/PS = usable password, NP = no password
            return parts[1] in ("L", "LK")
    except Exception:
        return None
    return None


def _linux_unlock_account(user: str) -> tuple[bool, str]:
    """Unlock the account using both available methods, then verify. Returns
    (ok, detail). ok is True only if the account is confirmed not locked."""
    subprocess.run(["usermod", "--unlock", user], capture_output=True, text=True, timeout=15)
    if _linux_account_locked(user) is False:
        return (True, "usermod --unlock")
    subprocess.run(["passwd", "-u", user], capture_output=True, text=True, timeout=15)
    locked = _linux_account_locked(user)
    if locked is False:
        return (True, "passwd -u")
    if locked is None:
        # Cannot verify either way; report best-effort outcome honestly.
        return (False, "unlock attempted but could not be verified")
    return (False, "account is still locked after both unlock methods")


def _win_lock_now() -> tuple[bool, str | None]:
    """Issue the Windows workstation lock. Returns (ok, error). Idempotent —
    safe to call when the screen is already locked."""
    try:
        import ctypes
        ret = ctypes.windll.user32.LockWorkStation()
        if ret:
            return (True, None)
        err = ctypes.windll.kernel32.GetLastError()
        return (False, f"LockWorkStation failed (Windows error {err})")
    except Exception as e:
        return (False, f"LockWorkStation unavailable ({e})")


def _apply_hard_lock() -> tuple[str, str | None, str | None]:
    """Lock the device at the OS level. Returns (status, result, error) where
    status is 'completed' (truly locked), 'failed', or 'requires_admin'.
    On Linux the locked username is persisted so unlock can target it later."""
    try:
        if IS_WIN:
            ok, err = _win_lock_now()
            if ok:
                _write_lock_state({"locked": True, "platform": "windows"})
                return ("completed", "Workstation locked", None)
            return ("failed", None, err)

        if IS_MAC:
            # TRUE login-window lock: bar the account from logging in and drop the
            # user to the login window, where a custom banner tells them to contact
            # IT. The user's password is rejected — this is NOT a dismissable screen
            # lock. It needs root, so the agent must run as a system LaunchDaemon.
            if not _is_root():
                return ("requires_admin", None,
                        "Hard lock requires admin. This Mac's agent is running as a "
                        "normal user and cannot lock the login window, so the device "
                        "was NOT locked. Reinstall the agent with admin rights (sudo) "
                        "using the portal install command, then retry.")
            user = _mac_console_user()
            if not user:
                humans = _mac_human_users()
                user = humans[0] if len(humans) == 1 else None
            if not user:
                return ("failed", None,
                        "Could not determine which macOS account to lock (no user at "
                        "the console and the account is ambiguous).")
            # 1) Show the login-window banner (verified by read-back).
            banner_ok = _mac_set_login_message(MAC_LOCK_MESSAGE)
            # 2) Disable the account so the password is rejected at the login window.
            ok, detail = _mac_disable_account(user)
            if not ok:
                _mac_clear_login_message()
                return ("failed", None,
                        f"Failed to lock account '{user}': {detail}. The device was "
                        f"NOT locked.")
            # 3) Kick the user to the login window so the lock takes effect now.
            _mac_force_logout(user)
            if _mac_user_has_session(user):
                # Could not evict the live session: the person can keep using the Mac.
                # Roll the lock back to a consistent UNLOCKED state and report honestly.
                _mac_enable_account(user)
                _mac_clear_login_message()
                return ("failed", None,
                        f"Account '{user}' was disabled but the active session could "
                        f"not be ended, so the user can still use the Mac. The lock was "
                        f"rolled back — please retry.")
            _write_lock_state({"locked": True, "platform": "macos", "user": user})
            # The password rejection (account disable) is the actual lock; the banner
            # is informational. Report success honestly but flag if the banner could
            # not be confirmed so IT knows the message may not be visible.
            banner_note = ("" if banner_ok
                           else "; WARNING: the login-window banner could not be "
                                "confirmed and may not be visible")
            return ("completed",
                    f"Account '{user}' locked at the login window ({detail}){banner_note}",
                    None)

        if IS_LIN:
            if not _is_root():
                return ("requires_admin", None,
                        "Hard lock requires root. This agent is running as a normal "
                        "user (systemd --user) and cannot lock the OS account, so the "
                        "device was NOT locked. Reinstall the agent as a system service "
                        "with sudo (see the portal install command) to enforce hard lock.")
            user = _linux_console_user()
            if not user:
                return ("failed", None, "Could not determine the logged-in user to lock.")
            # 1) Password-lock the account so the user cannot log back in.
            r = subprocess.run(["usermod", "--lock", user], capture_output=True, text=True, timeout=15)
            if r.returncode != 0:
                r = subprocess.run(["passwd", "-l", user], capture_output=True, text=True, timeout=15)
                if r.returncode != 0:
                    return ("failed", None,
                            f"Failed to lock account '{user}': {r.stderr.strip()}")
            # Positively verify the account is actually locked — never trust the exit
            # code alone. If verification explicitly says it is NOT locked, report a
            # failure rather than a false "Locked".
            if _linux_account_locked(user) is False:
                return ("failed", None,
                        f"The lock command returned success but account '{user}' is "
                        f"still reported as unlocked, so the device was NOT locked.")
            # 2) Terminate the active session so the user is kicked out NOW. We must
            #    confirm the session is actually gone — a still-running session means
            #    the user can keep using the device, which is NOT a real lock.
            subprocess.run(["loginctl", "terminate-user", user], capture_output=True, text=True, timeout=15)
            if _linux_user_has_session(user):
                # Escalate: kill all of the user's processes/scopes.
                subprocess.run(["loginctl", "kill-user", user], capture_output=True, text=True, timeout=15)
                time.sleep(1)
            if _linux_user_has_session(user):
                # Could not evict the live session. Roll the account lock back so the
                # device is left in a consistent UNLOCKED state and report the truth —
                # never a false "locked". Verify the rollback actually succeeded.
                ok, detail = _linux_unlock_account(user)
                if not ok:
                    return ("failed", None,
                            f"Account '{user}' could not be fully locked (the active "
                            f"session could not be terminated) AND the rollback failed: "
                            f"{detail}. The account may still be locked — unlock it "
                            f"manually as root, then retry.")
                return ("failed", None,
                        f"Account '{user}' could not be fully locked: the active session "
                        f"could not be terminated, so the user can still use the device. "
                        f"The partial lock was rolled back. Please retry.")
            _write_lock_state({"locked": True, "platform": "linux", "user": user})
            return ("completed", f"Account '{user}' locked and session terminated", None)

        return ("failed", None, f"unsupported platform: {sys.platform}")
    except Exception as e:
        return ("failed", None, str(e))


def _release_lock() -> tuple[str, str | None, str | None]:
    """Undo a hard lock. Returns (status, result, error)."""
    try:
        if IS_LIN:
            if not _is_root():
                # A non-root agent can NEVER produce a confirmed hard lock (it
                # returns requires_admin), so any unlock command reaching it must
                # correspond to a lock applied by a root agent — which a non-root
                # agent cannot undo. Always report requires_admin so the server's
                # is_locked is never falsely cleared (regardless of local state).
                return ("requires_admin", None,
                        "Cannot unlock: undoing an OS account lock requires root, but "
                        "this agent is running as a normal user. Reinstall the agent as "
                        "a system service with sudo, then retry the unlock.")
            user = _read_lock_state().get("user") or _linux_console_user()
            if not user:
                return ("failed", None, "Could not determine which account to unlock.")
            ok, detail = _linux_unlock_account(user)
            if not ok:
                return ("failed", None, f"Failed to unlock account '{user}': {detail}")
            _write_lock_state({"locked": False})
            return ("completed", f"Account '{user}' unlocked ({detail})", None)
        if IS_MAC:
            if not _is_root():
                # A non-root agent can never apply a confirmed macOS lock (it returns
                # requires_admin), so any unlock reaching it corresponds to a lock a
                # root agent applied — which this agent cannot undo. Report honestly so
                # the server's is_locked is never falsely cleared.
                return ("requires_admin", None,
                        "Cannot unlock: undoing a macOS login-window lock requires "
                        "admin, but this agent is running as a normal user. Reinstall "
                        "the agent with admin rights (sudo), then retry the unlock.")
            user = _read_lock_state().get("user") or _mac_console_user()
            if not user:
                humans = _mac_human_users()
                user = humans[0] if len(humans) == 1 else None
            if not user:
                return ("failed", None, "Could not determine which account to unlock.")
            ok, detail = _mac_enable_account(user)
            _mac_clear_login_message()
            if not ok:
                return ("failed", None, f"Failed to unlock account '{user}': {detail}")
            _write_lock_state({"locked": False})
            return ("completed", f"Account '{user}' unlocked ({detail})", None)
        # Windows workstation lock leaves nothing persistent to undo.
        _write_lock_state({"locked": False})
        return ("completed", "Access restored", None)
    except Exception as e:
        return ("failed", None, str(e))


def reconcile_lock(server_locked: bool) -> None:
    """Keep the OS in sync with the server's confirmed lock flag (best-effort,
    no command reporting). Only acts on a transition to avoid re-locking each
    heartbeat. Used by the sync loop and on startup."""
    with _lock_mutex:
        local = _read_local_lock()
        if server_locked and not local:
            _apply_hard_lock()
        elif not server_locked and local:
            _release_lock()


def reassert_lock() -> None:
    """While the device is meant to be locked, keep the OS lock asserted. The
    Windows workstation lock is dismissed the moment the user types their password,
    so without re-asserting a 'locked' device becomes usable again while the portal
    still shows Locked. Re-issuing the screen lock each fast cycle keeps the user
    out. macOS and Linux use a persistent ACCOUNT lock (login-window lock / password
    lock), so they need no re-assertion here. Best-effort and silent: never reports a
    command status, never flips local state."""
    if not IS_WIN:
        return
    try:
        if not _read_local_lock():
            return
        with _lock_mutex:
            if not _read_local_lock():
                return
            _win_lock_now()
    except Exception:
        pass


# ── restart management ──────────────────────────────────────────────────────
RESTART_GRACE_SEC = 600  # 10-minute warning before any restart actually happens.


def _notify_user(title: str, message: str) -> bool:
    """Best-effort, non-blocking desktop notification to the logged-in human.
    Never raises. Returns True if a notification mechanism was invoked."""
    try:
        if IS_WIN:
            CREATE_NO_WINDOW = 0x08000000
            # msg.exe is the most reliable interactive popup and needs no admin on
            # most editions; fall back to a WinForms message box via PowerShell.
            try:
                subprocess.Popen(["msg", "*", "/TIME:0", f"{title}: {message}"],
                                 creationflags=CREATE_NO_WINDOW)
                return True
            except Exception:
                ps = ("Add-Type -AssemblyName System.Windows.Forms; "
                      "[System.Windows.Forms.MessageBox]::Show("
                      f"{json.dumps(message)},{json.dumps(title)})")
                subprocess.Popen(["powershell", "-NoProfile", "-WindowStyle", "Hidden",
                                  "-Command", ps], creationflags=CREATE_NO_WINDOW)
                return True
        if IS_MAC:
            user = _mac_console_user() if _is_root() else None
            script = (f'display notification {json.dumps(message)} '
                      f'with title {json.dumps(title)}')
            args = ["osascript", "-e", script]
            if user:
                # Run inside the console user's GUI session when we are root.
                args = ["launchctl", "asuser", str(_mac_uid_for(user) or ""), *args]
            subprocess.Popen(args, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            return True
        if IS_LIN:
            subprocess.Popen(["notify-send", title, message],
                             stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            return True
    except Exception:
        pass
    return False


def _schedule_restart(delay_sec: int, force: bool, reason: str) -> tuple[str, str | None, str | None]:
    """Schedule an OS restart after a grace period, warning the user first.
    Always warns and always waits — there is no immediate, unannounced restart.
    The grace period is floored at RESTART_GRACE_SEC (10 min) so a restart can
    never be scheduled sooner, regardless of the requested delay."""
    delay_sec = max(RESTART_GRACE_SEC, int(delay_sec or RESTART_GRACE_SEC))
    mins = max(1, delay_sec // 60)
    warn = (f"{reason} Your computer will restart in about {mins} minute"
            f"{'s' if mins != 1 else ''}. Please save your work.")
    _notify_user("Scheduled restart", warn)
    try:
        if IS_WIN:
            CREATE_NO_WINDOW = 0x08000000
            args = ["shutdown", "/r", "/t", str(delay_sec), "/c", warn[:512]]
            if force:
                args.insert(3, "/f")
            r = subprocess.run(args, capture_output=True, text=True,
                               timeout=20, creationflags=CREATE_NO_WINDOW)
            if r.returncode != 0:
                return ("failed", None,
                        f"Could not schedule restart: {r.stderr.strip() or r.stdout.strip()}")
            return ("completed",
                    f"Restart scheduled in {mins} min (user warned).", None)
        if IS_MAC or IS_LIN:
            if not _is_root():
                return ("requires_admin", None,
                        "Scheduling a restart requires admin rights, but the agent is "
                        "running as a normal user. Reinstall the agent as a system "
                        "service (sudo) to enable restart actions.")
            # `shutdown -r +<minutes>` warns logged-in users automatically.
            r = subprocess.run(["shutdown", "-r", f"+{mins}", warn[:200]],
                               capture_output=True, text=True, timeout=20)
            if r.returncode != 0:
                return ("failed", None,
                        f"Could not schedule restart: {r.stderr.strip() or r.stdout.strip()}")
            return ("completed",
                    f"Restart scheduled in {mins} min (user warned).", None)
    except Exception as e:
        return ("failed", None, str(e))
    return ("failed", None, f"unsupported platform: {sys.platform}")


# ── commands ────────────────────────────────────────────────────────────────
def execute_command(cmd: dict) -> tuple[str, str | None, str | None]:
    """Returns (status, result_message, error_message). status is one of
    'completed', 'failed', or 'requires_admin' — only 'completed' means the
    action truly took effect."""
    ctype = cmd.get("type")
    if ctype in ("sync_now", "collect_system_info"):
        _post("/sync", {"payload": collect_system_info()})
        return ("completed", "synced", None)
    if ctype == "update_agent":
        # Force an immediate self-update check regardless of the daily timer.
        # If a newer version is on the server, the agent replaces itself and
        # restarts (os.execv) — this return is only reached when NO update was
        # applied. Report the REAL reason so a stuck device is diagnosable from
        # the portal (e.g. "download failed: HTTP 404", "no agent URL configured").
        _updated, detail = _self_update(force=True)
        return ("completed", f"update check (v{AGENT_VERSION}): {detail}", None)
    if ctype == "update_wallpaper":
        # Always pull the current active wallpaper from the portal (force re-apply)
        status, err = apply_active_wallpaper(force=True)
        if status in ("applied", "skipped"):
            return ("completed", f"wallpaper {status}", None)
        if status == "none":
            return ("completed", "no active wallpaper", None)
        return ("failed", None, err)
    if ctype == "lock_screen":
        with _lock_mutex:
            return _apply_hard_lock()
    if ctype == "unlock":
        with _lock_mutex:
            return _release_lock()
    if ctype == "notify_restart":
        payload = cmd.get("payload") or {}
        days = payload.get("uptime_days")
        if days:
            reason = (f"This computer has been running for {days} day"
                      f"{'s' if str(days) != '1' else ''} without a restart.")
        else:
            reason = "IT is asking you to restart this computer."
        msg = f"{reason} Please save your work and restart soon to keep it healthy and secure."
        if _notify_user("Please restart your computer", msg):
            return ("completed", "User notified to restart.", None)
        return ("failed", None, "Could not show a notification to the user.")
    if ctype in ("schedule_restart", "force_restart"):
        payload = cmd.get("payload") or {}
        delay = payload.get("delay_seconds", RESTART_GRACE_SEC)
        reason = payload.get("reason") or "IT has scheduled a restart for this computer."
        return _schedule_restart(delay, force=(ctype == "force_restart"), reason=reason)
    if ctype == "uninstall_agent":
        return _self_uninstall()
    return ("failed", None, f"unsupported command: {ctype}")


# ── self-uninstall (remove the agent from this laptop) ───────────────────────
# Removing the agent only ends the management connection: it stops the
# background service, deletes the local agent files, and removes the saved
# token. It never touches the user's own files or data.
_uninstall_requested = False


def _remaining_service_artifacts() -> list[str]:
    """Return service/autostart paths that should be gone after uninstall but
    still exist. We verify rather than trust the helpers' best-effort return
    codes. On Windows the install dir holds the *running* script and can only be
    deleted after the process exits (see _final_self_destruct), so we check the
    Startup launcher (.vbs) — once it's gone the agent will not auto-start again;
    the directory itself is cleaned up by the deferred job."""
    if IS_MAC:
        candidates = [MAC_DAEMON_PLIST_PATH, MAC_SYS_INSTALL_DIR,
                      MAC_PLIST_PATH, MAC_INSTALL_DIR]
    elif IS_LIN:
        candidates = [LIN_SYS_UNIT_PATH, LIN_SYS_INSTALL_DIR,
                      LIN_UNIT_PATH, LIN_INSTALL_DIR]
    elif IS_WIN:
        candidates = [WIN_VBS_PATH]
    else:
        candidates = []
    return [p for p in candidates if p and os.path.exists(p)]


def _self_uninstall() -> tuple[str, str | None, str | None]:
    """Tear down this agent locally. The actual process exit happens in the run
    loop *after* this status is reported back to the portal, so the portal can
    confirm the removal (it revokes the token + marks the device removed only on
    the confirmed 'completed')."""
    global _uninstall_requested
    warnings: list[str] = []   # non-fatal: removal still succeeded
    failures: list[str] = []   # fatal: agent would keep running / stay managed

    # 1. Never leave the user locked out by a half-removed agent. A failure here
    #    does NOT block removal (it is a safety nicety), but is surfaced.
    try:
        with _lock_mutex:
            _release_lock()
    except Exception as e:
        warnings.append(f"lock release: {e}")

    # 2. Stop + remove the background service / autostart and installed files.
    #    (Windows: removes the Startup launcher + %LOCALAPPDATA%\MilesAgent incl.
    #     the token-bearing run.cmd. macOS: unloads launchd + removes the daemon
    #     dir incl. the 0600 token file. Linux: disables + removes the unit.)
    #    If this fails the service keeps running, so it is a FATAL failure: we
    #    must NOT tell the portal the agent is gone. The platform helpers are
    #    best-effort and swallow errors, so we VERIFY the artifacts are actually
    #    gone afterwards rather than trusting the return code.
    try:
        rc = uninstall_service()
        if rc not in (0, None):
            failures.append(f"service removal returned {rc}")
    except Exception as e:
        failures.append(f"service removal: {e}")
    for leftover in _remaining_service_artifacts():
        failures.append(f"service/autostart still present: {leftover}")

    # 3. Remove the local state dir (venv/script copy, lock + wallpaper state,
    #    install log) and the macOS root token file. A leftover token means the
    #    agent could re-authenticate, so a failure here is also FATAL. Verify the
    #    paths are actually gone rather than trusting rmtree(ignore_errors=True).
    for path in (os.path.join(os.path.expanduser("~"), ".miles-agent"),
                 MAC_SYS_TOKEN_FILE if IS_MAC else None):
        if not path:
            continue
        try:
            if os.path.isdir(path):
                shutil.rmtree(path, ignore_errors=True)
            elif os.path.exists(path):
                os.remove(path)
            if os.path.exists(path):
                failures.append(f"cleanup {path}: still present after removal")
        except Exception as e:
            failures.append(f"cleanup {path}: {e}")

    # Honest confirmation: only report 'completed' when the agent is genuinely
    # gone. On any fatal failure report 'failed' and DO NOT exit — the device
    # stays managed so an admin can retry or Force Remove from the portal.
    if failures:
        return ("failed",
                None,
                "Uninstall did not complete; device is still managed. "
                + "; ".join(failures + warnings))

    _uninstall_requested = True
    if warnings:
        return ("completed",
                "Agent management removed (with minor cleanup warnings).",
                "; ".join(warnings))
    return ("completed",
            "Agent uninstalled: background service stopped, local files and saved token removed.",
            None)


def _final_self_destruct() -> None:
    """Called once, after the uninstall status has been reported, to remove any
    files that were still locked while the agent was running. On Windows the
    running script/exe in %LOCALAPPDATA%\\MilesAgent can't delete itself, so a
    detached cmd waits a moment and removes the directory after we exit."""
    try:
        if IS_WIN and WIN_INSTALL_DIR and os.path.isdir(WIN_INSTALL_DIR):
            CREATE_NO_WINDOW = 0x08000000
            DETACHED_PROCESS = 0x00000008
            subprocess.Popen(
                ["cmd", "/c", "ping 127.0.0.1 -n 3 >nul & rmdir /s /q "
                 + f'"{WIN_INSTALL_DIR}"'],
                creationflags=CREATE_NO_WINDOW | DETACHED_PROCESS,
                close_fds=True,
            )
    except Exception:
        pass


_last_uptime_notice = 0.0


def _maybe_notify_long_uptime() -> None:
    """If the machine has been up for more than a day, gently remind the user to
    restart. Throttled to at most once every 12 hours so it never nags."""
    global _last_uptime_notice
    try:
        up = _uptime_seconds()
        if up is None or up < 86400:
            return
        now = time.monotonic()
        if _last_uptime_notice and (now - _last_uptime_notice) < 12 * 3600:
            return
        days = up // 86400
        _notify_user(
            "Please restart your computer",
            f"This computer has been running for {days} day"
            f"{'s' if days != 1 else ''} without a restart. Please save your work "
            f"and restart soon to keep it healthy and secure.",
        )
        _last_uptime_notice = now
    except Exception:
        pass


def _looks_revoked(resp: dict) -> bool:
    """True only when the server EXPLICITLY rejected our token (the portal
    Force-Removed this device), never for a transient network/5xx error.
    agent_sync / agent_fetch_commands return success:false with this exact
    message once the token row is revoked."""
    if not isinstance(resp, dict) or resp.get("success"):
        return False
    err = str(resp.get("error", "")).lower()
    return "revoked token" in err or "invalid or revoked" in err


def _apply_server_poll(poll: object, active_sec: int, idle_sec: int) -> tuple[int, int]:
    """Apply the server-driven poll cadence carried on the /sync response, live.

    The portal/DB sets the interval once and every agent picks it up here on its
    next heavy /sync — no reinstall, restart, or env change. Values are clamped to
    sane bounds and idle is never faster than active. Missing/garbage values keep
    the current cadence (which itself defaults to the env vars / constants), so a
    server that omits `poll` (or an older server) never breaks the agent."""
    if not isinstance(poll, dict):
        return active_sec, idle_sec

    def _clamp(v: object, fallback: int) -> int:
        try:
            n = int(v)
        except (TypeError, ValueError):
            return fallback
        return max(2, min(3600, n))

    new_active = _clamp(poll.get("active"), active_sec)
    new_idle   = max(new_active, _clamp(poll.get("idle"), idle_sec))
    return new_active, new_idle



# ── Remote Access — end-user approval popup ───────────────────────────────────
# Sessions that have already been shown to the user (within this process run).
# Prevents showing the same dialog twice on the same agent invocation.
_prompted_sessions: set[str] = set()
_remote_access_lock = threading.Lock()


def _show_access_dialog(title: str, message: str, timeout_sec: int = 60) -> bool:
    """Show a native Allow/Deny dialog to the logged-in user.
    Returns True if the user clicks Allow (or the OS-equivalent positive button).
    Returns False on Deny, timeout, or any error — always safe to call, never raises.

    Platform notes:
      Windows  — ctypes MessageBoxW (no extra packages, works in user session)
      macOS    — osascript display dialog (built-in)
      Linux    — zenity → kdialog fallback (headless → auto-deny)
    """
    try:
        if IS_WIN:
            import ctypes
            # MB_YESNO | MB_ICONQUESTION | MB_TOPMOST | MB_SETFOREGROUND
            MB_FLAGS = 0x04 | 0x20 | 0x40000 | 0x10000
            result_holder: list[int] = [7]  # 7 = IDNO default (deny on timeout)

            def _show() -> None:
                result_holder[0] = ctypes.windll.user32.MessageBoxW(
                    None, message, title, MB_FLAGS
                )

            t = threading.Thread(target=_show, daemon=True)
            t.start()
            t.join(timeout=timeout_sec)
            return result_holder[0] == 6  # IDYES = 6

        elif IS_MAC:
            script = (
                f'set dlg to display dialog "{message}" '
                f'buttons {{"Deny", "Allow"}} default button "Allow" '
                f'with title "{title}" giving up after {timeout_sec}'
            )
            r = subprocess.run(
                ["osascript", "-e", script],
                capture_output=True, text=True, timeout=timeout_sec + 5,
            )
            return "button returned:Allow" in r.stdout

        elif IS_LIN:
            # GNOME / GTK
            try:
                r = subprocess.run(
                    ["zenity", "--question",
                     f"--title={title}", f"--text={message}",
                     "--ok-label=Allow", "--cancel-label=Deny",
                     f"--timeout={timeout_sec}"],
                    timeout=timeout_sec + 5,
                )
                return r.returncode == 0
            except FileNotFoundError:
                pass
            # KDE fallback
            try:
                r = subprocess.run(
                    ["kdialog", "--yesno", message, "--title", title],
                    timeout=timeout_sec + 5,
                )
                return r.returncode == 0
            except FileNotFoundError:
                pass
            # Headless — no GUI toolkit found, auto-deny
            return False

    except Exception:
        return False


# ── remote desktop transport (Commit 2 — spike only) ─────────────────────────
# This block proves the bidirectional transport works end to end: after the end
# user approves a session, the agent joins the per-session Supabase Realtime
# broadcast channel and answers the portal's `ping` with `pong`. There is NO
# screen capture and NO mouse/keyboard control here — those are Commits 3–5.
# It is fully isolated from /sync, /commands and the Agent Key flow: nothing runs
# until a session is approved, and any failure is logged and swallowed.
_active_remote_sessions: set[str] = set()
_active_remote_lock = threading.Lock()
# One id per agent PROCESS. Used to claim a session so two agent instances can
# never serve the same session token (the first to claim wins; we exit if not).
_AGENT_INSTANCE_ID = uuid.uuid4().hex


def _current_user() -> str:
    """Best-effort interactive/OS user name for the transport handshake."""
    try:
        import getpass
        return getpass.getuser()
    except Exception:
        return os.environ.get("USER") or os.environ.get("USERNAME") or "unknown"


def _ensure_websockets() -> bool:
    """Return True if the `websockets` library is importable. Already-deployed
    agents predate this dependency, so we best-effort `pip install` it once at
    runtime (windowless, quiet). Failure is non-fatal — the transport just stays
    disabled until the agent is reinstalled."""
    try:
        import websockets  # noqa: F401
        return True
    except Exception:
        pass
    try:
        subprocess.run(
            [sys.executable, "-m", "pip", "install", "--disable-pip-version-check",
             "--quiet", "websockets"],
            check=True, timeout=120,
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            creationflags=_NO_WINDOW,
        )
        import importlib
        importlib.invalidate_caches()
        import websockets  # noqa: F401
        return True
    except Exception as e:
        print(f"[remote] websockets unavailable, transport disabled: {e}", file=sys.stderr)
        return False


def start_remote_session(session_id: str) -> None:
    """Entry point: dedupe per session, then run the transport. Safe to call from
    multiple threads — only one transport runs per session id."""
    with _active_remote_lock:
        if session_id in _active_remote_sessions:
            return
        _active_remote_sessions.add(session_id)
    try:
        _run_remote_session(session_id)
    except Exception as e:
        print(f"[remote] session {session_id} ended: {e}", file=sys.stderr)
    finally:
        with _active_remote_lock:
            _active_remote_sessions.discard(session_id)


def _run_remote_session(session_id: str) -> None:
    # 1. Poll until the portal has issued a token for this approved session.
    cfg = None
    for _ in range(60):  # ~2 min ceiling (60 × 2 s)
        resp = _get(f"/remote-access/session?session_id={session_id}")
        if resp.get("ready"):
            cfg = resp
            break
        if resp.get("success") is False:
            print(f"[remote] cannot fetch session token: {resp.get('error')}", file=sys.stderr)
            return
        time.sleep(2)
    if not cfg:
        print("[remote] portal never issued a session token; giving up", file=sys.stderr)
        return

    # 2. Claim the session for THIS instance. If another agent already owns it
    #    we are rejected and must not join — prevents one token serving two agents.
    claim = _post("/remote-access/claim", {
        "session_id":  session_id,
        "instance_id": _AGENT_INSTANCE_ID,
    })
    if not claim.get("claimed"):
        print(f"[remote] claim rejected: {claim.get('error')}", file=sys.stderr)
        return

    if not _ensure_websockets():
        return
    from websockets.sync.client import connect as ws_connect

    # 3. Obtain a GENUINE Supabase auth token bound to THIS session so we can join
    #    the PRIVATE per-session channel. Frames only ever flow on an RLS-gated
    #    private channel — there is no public fallback.
    rt = _post("/remote-access/realtime-token", {"session_id": session_id})
    if not rt.get("success") or not rt.get("ready"):
        print(f"[remote] realtime token not ready: {rt.get('error') or rt.get('status')}", file=sys.stderr)
        return

    realtime_url = rt.get("realtime_url")
    anon_key     = rt.get("anon_key")
    channel      = rt.get("channel_name")
    device_id    = rt.get("asset_id")
    access_token = rt.get("access_token")
    token_exp    = rt.get("expires_at") or 0
    if not (realtime_url and anon_key and channel and access_token):
        print("[remote] incomplete realtime config from portal", file=sys.stderr)
        return

    # Streaming knobs (env-overridable). Conservative defaults keep bandwidth and
    # CPU modest for view-only screen sharing.
    fps       = float(os.environ.get("MILES_REMOTE_FPS", "6"))
    max_w     = int(os.environ.get("MILES_REMOTE_MAX_W", "1280"))
    quality   = int(os.environ.get("MILES_REMOTE_QUALITY", "55"))
    max_bytes = int(os.environ.get("MILES_REMOTE_MAX_BYTES", "90000"))

    topic  = f"realtime:{channel}"
    ws_url = f"{realtime_url}?apikey={anon_key}&vsn=1.0.0"
    _ref = [0]
    def next_ref() -> str:
        _ref[0] += 1
        return str(_ref[0])

    send_lock = threading.Lock()
    stop_evt  = threading.Event()

    print(f"[remote] joining PRIVATE channel {channel}", file=sys.stderr)
    with ws_connect(ws_url, open_timeout=20, close_timeout=5) as ws:
        def ws_send(obj) -> bool:
            # All sends are serialized: the capture thread and the recv loop both
            # write to the socket.
            try:
                with send_lock:
                    ws.send(json.dumps(obj))
                return True
            except Exception:
                stop_evt.set()
                return False

        def send_broadcast(event: str, payload: dict) -> bool:
            return ws_send({
                "topic":   topic,
                "event":   "broadcast",
                "payload": {"type": "broadcast", "event": event, "payload": payload},
                "ref":     next_ref(),
            })

        join_ref = next_ref()
        # PRIVATE channel: Realtime authorizes the join via access_token (our
        # session-bound agent identity) against the realtime.messages RLS policies.
        ws_send({
            "topic":   topic,
            "event":   "phx_join",
            "payload": {
                "config": {"broadcast": {"self": False, "ack": False},
                           "presence": {"key": ""},
                           "private": True},
                "access_token": access_token,
            },
            "ref":      join_ref,
            "join_ref": join_ref,
        })

        # ── Commit 4: remote input-control state ─────────────────────────────
        # input_state["enabled"] is the agent-side gate: input is replayed ONLY
        # while an admin holds control (a `control` broadcast) AND the session
        # token has not locally expired. The backend is built lazily on first use.
        input_state = {"enabled": False, "by": None}
        _backend_box = [None]
        _backend_tried = [False]

        def _get_backend():
            if _backend_box[0] is None and not _backend_tried[0]:
                _backend_tried[0] = True
                _backend_box[0] = _make_input_backend()
                if _backend_box[0] is None:
                    print("[remote] no input backend available; control disabled", file=sys.stderr)
                else:
                    print(f"[remote] input backend = {_backend_box[0].name}", file=sys.stderr)
            return _backend_box[0]

        def _banner_disconnect():
            print("[remote] END USER disconnected via banner; ending session", file=sys.stderr)
            try:
                send_broadcast("end", {"reason": "enduser_disconnect"})
            except Exception:
                pass
            stop_evt.set()

        banner = _RemoteControlBanner(on_disconnect=_banner_disconnect)

        def _set_input_enabled(want: bool, by: str = None, reason: str = None):
            prev = input_state["enabled"]
            input_state["enabled"] = want
            if by:
                input_state["by"] = by
            who = input_state["by"] or "IT Admin"
            if want != prev:
                ts = int(time.time() * 1000)
                if want:
                    print(f"[remote][audit] INPUT-ENABLED session={session_id} by={who} ts={ts}", file=sys.stderr)
                    _append_input_audit(session_id, "input_enabled", who)
                    banner.show(who)
                else:
                    print(f"[remote][audit] INPUT-DISABLED session={session_id} reason={reason or 'released'} ts={ts}", file=sys.stderr)
                    _append_input_audit(session_id, "input_disabled", who)
                    banner.hide()
            elif want and by:
                banner.update(who)

        # 4. Capture + stream frames in a dedicated thread so recv() stays
        #    responsive to ping/end. Capture deps are imported lazily in-thread.
        def capture_loop() -> None:
            grab = _make_screen_grabber()
            if grab is None:
                print("[remote] screen capture unavailable; streaming disabled", file=sys.stderr)
                return
            seq = 0
            interval = (1.0 / fps) if fps > 0 else 0.16
            while not stop_evt.is_set():
                t0 = time.monotonic()
                try:
                    w, h, jpeg = grab(max_w, quality, max_bytes)
                except Exception as e:
                    print(f"[remote] capture error: {e}", file=sys.stderr)
                    stop_evt.wait(1.0)
                    continue
                if not send_broadcast("frame", {
                    "seq": seq, "ts": int(time.time() * 1000),
                    "w": w, "h": h, "fmt": "jpeg",
                    "data": base64.b64encode(jpeg).decode("ascii"),
                }):
                    break
                seq += 1
                dt = time.monotonic() - t0
                if interval - dt > 0:
                    stop_evt.wait(interval - dt)

        cap_thread = threading.Thread(target=capture_loop, name="remote-capture", daemon=True)
        cap_thread.start()

        last_hb    = time.monotonic()
        last_check = time.monotonic()
        deadline   = time.monotonic() + 3600  # safety cap (1 h)
        while time.monotonic() < deadline and not stop_evt.is_set():
            now = time.monotonic()
            if now - last_hb >= 25:  # Phoenix heartbeat keeps the socket alive
                if not ws_send({"topic": "phoenix", "event": "heartbeat",
                                "payload": {}, "ref": next_ref()}):
                    break
                last_hb = now

            # Periodic authority re-check (defense in depth on top of the RLS gate):
            # stop the instant the portal ends / the session expires, and refresh
            # the realtime token before it lapses so long sessions stay authorized.
            if now - last_check >= 5:
                last_check = now
                st = _get(f"/remote-access/session?session_id={session_id}")
                if not st.get("ready"):
                    print(f"[remote] session no longer active ({st.get('status') or st.get('error')}); stopping", file=sys.stderr)
                    break
                if token_exp and time.time() > (token_exp - 120):
                    nr = _post("/remote-access/realtime-token", {"session_id": session_id})
                    if nr.get("success") and nr.get("access_token"):
                        access_token = nr["access_token"]
                        token_exp    = nr.get("expires_at") or token_exp
                        ws_send({"topic": topic, "event": "access_token",
                                 "payload": {"access_token": access_token},
                                 "ref": next_ref()})

            try:
                raw = ws.recv(timeout=2)
            except TimeoutError:
                continue
            except Exception:
                break
            try:
                msg = json.loads(raw)
            except Exception:
                continue

            mevt = msg.get("event")
            if mevt == "phx_reply" and msg.get("ref") == join_ref:
                status = (msg.get("payload") or {}).get("status")
                if status != "ok":
                    print(f"[remote] private channel join refused: {msg.get('payload')}", file=sys.stderr)
                    break
                print("[remote] private channel joined; streaming frames", file=sys.stderr)
                continue
            if mevt != "broadcast":
                continue
            inner = msg.get("payload") or {}
            evt   = inner.get("event")
            if evt == "ping":
                p = inner.get("payload") or {}
                # Echo the nonce + ts so the portal can correlate and measure RTT.
                send_broadcast("pong", {
                    "nonce":     p.get("nonce"),
                    "ts":        p.get("ts"),
                    "agent":     socket.gethostname(),
                    "version":   AGENT_VERSION,
                    "user":      _current_user(),
                    "device_id": device_id,
                })
            elif evt == "end":
                print("[remote] portal ended the session", file=sys.stderr)
                break
            elif evt == "control":
                # Admin took / released control. Flip the agent-side gate, surface
                # the on-machine banner, and audit the transition.
                p = inner.get("payload") or {}
                _set_input_enabled(bool(p.get("enabled")), by=p.get("by"))
            elif evt == "input":
                # SECURITY: replay input ONLY while control is enabled AND the
                # session token has not expired locally. The RLS channel gate
                # already blocks terminated/expired sessions at the transport
                # layer; these checks are defense in depth on the agent itself.
                if not input_state["enabled"]:
                    continue
                if token_exp and time.time() > token_exp:
                    _set_input_enabled(False, reason="token_expired")
                    continue
                be = _get_backend()
                if be is not None:
                    try:
                        apply_remote_input(inner.get("payload") or {}, be)
                    except Exception as ex:
                        print(f"[remote] input apply error: {ex}", file=sys.stderr)

        stop_evt.set()
        if input_state["enabled"]:
            _set_input_enabled(False, reason="session_closed")
        banner.close()
        cap_thread.join(timeout=3)
    print(f"[remote] session {session_id} transport closed", file=sys.stderr)


def _ensure_capture_deps() -> bool:
    """True if mss + Pillow import. Best-effort one-time pip install (quiet,
    windowless) for agents that predate the screen-capture feature."""
    try:
        import mss        # noqa: F401
        from PIL import Image  # noqa: F401
        return True
    except Exception:
        pass
    try:
        subprocess.run(
            [sys.executable, "-m", "pip", "install", "--disable-pip-version-check",
             "--quiet", "mss", "Pillow"],
            check=True, timeout=180,
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            creationflags=_NO_WINDOW,
        )
        import importlib
        importlib.invalidate_caches()
        import mss        # noqa: F401
        from PIL import Image  # noqa: F401
        return True
    except Exception as e:
        print(f"[remote] capture deps unavailable: {e}", file=sys.stderr)
        return False


def _make_screen_grabber():
    """Return a callable (max_w, quality, max_bytes) -> (w, h, jpeg_bytes) backed
    by mss + Pillow, or None if the capture stack is unavailable. The mss instance
    is created in the CALLING thread because mss is not safe to share across
    threads."""
    if not _ensure_capture_deps():
        return None
    import mss              # type: ignore
    from PIL import Image   # type: ignore

    sct = mss.mss()
    monitors = sct.monitors
    # monitors[1] = primary physical monitor; monitors[0] = full virtual desktop.
    mon = monitors[1] if len(monitors) > 1 else monitors[0]

    def grab(max_w: int, quality: int, max_bytes: int):
        shot = sct.grab(mon)
        img = Image.frombytes("RGB", shot.size, shot.bgra, "raw", "BGRX")
        if img.width > max_w:
            ratio = max_w / float(img.width)
            img = img.resize((max_w, max(1, int(img.height * ratio))))
        # Adaptive JPEG: step quality down until under the byte ceiling so a busy
        # screen cannot blow up bandwidth or overrun the Realtime payload cap.
        q = quality
        data = b""
        for _ in range(4):
            buf = io.BytesIO()
            img.save(buf, format="JPEG", quality=q, optimize=False)
            data = buf.getvalue()
            if len(data) <= max_bytes or q <= 25:
                break
            q = max(25, q - 12)
        return img.width, img.height, data

    return grab


# ── remote input control (Commit 4 — mouse + keyboard) ───────────────────────
# Input rides the SAME RLS-gated private channel as the frames, so the channel
# gate (session active + token unexpired + authorized uid) governs input too.
# The backend is pluggable: pynput on Windows/macOS (and Linux if installed),
# else an xdotool fallback on Linux. The dispatch/mapping/gating logic is shared.

# Browser KeyboardEvent.key -> X keysym name (xdotool) for named / control keys.
_XDO_KEYSYM = {
    "Enter": "Return", "Tab": "Tab", "Escape": "Escape", "Backspace": "BackSpace",
    "Delete": "Delete", "Insert": "Insert", " ": "space",
    "ArrowUp": "Up", "ArrowDown": "Down", "ArrowLeft": "Left", "ArrowRight": "Right",
    "Home": "Home", "End": "End", "PageUp": "Prior", "PageDown": "Next",
    "Control": "Control_L", "Alt": "Alt_L", "Shift": "Shift_L", "Meta": "Super_L",
    "CapsLock": "Caps_Lock", "ContextMenu": "Menu",
}
for _i in range(1, 13):
    _XDO_KEYSYM[f"F{_i}"] = f"F{_i}"
# Symbol chars that can show up inside a modifier combo (down/up path).
_XDO_SYM = {
    "!": "exclam", "@": "at", "#": "numbersign", "$": "dollar", "%": "percent",
    "^": "asciicircum", "&": "ampersand", "*": "asterisk", "(": "parenleft",
    ")": "parenright", "-": "minus", "_": "underscore", "=": "equal", "+": "plus",
    "[": "bracketleft", "]": "bracketright", "{": "braceleft", "}": "braceright",
    ";": "semicolon", ":": "colon", "'": "apostrophe", "\"": "quotedbl",
    ",": "comma", ".": "period", "/": "slash", "?": "question", "\\": "backslash",
    "|": "bar", "`": "grave", "~": "asciitilde", "<": "less", ">": "greater",
}


def _to_xdo_keysym(key: str):
    if key in _XDO_KEYSYM:
        return _XDO_KEYSYM[key]
    if len(key) == 1:
        if key.isalpha():
            return key.lower()
        if key.isdigit():
            return key
        return _XDO_SYM.get(key)
    return None


class _InputBackend:
    """Common geometry + normalized-coord handling. Subclasses drive the OS."""
    name = "base"

    def __init__(self):
        self._geom = None

    def geometry(self):
        if self._geom is None:
            self._geom = self._detect_geometry()
        return self._geom

    def _detect_geometry(self):
        return (1920, 1080)

    def move_norm(self, x: float, y: float):
        w, h = self.geometry()
        px = max(0, min(w - 1, int(round(float(x) * (w - 1)))))
        py = max(0, min(h - 1, int(round(float(y) * (h - 1)))))
        self.move(px, py)

    # subclass API
    def move(self, px: int, py: int): ...
    def button(self, name: str, press: bool): ...
    def scroll(self, dx: int, dy: int): ...
    def key(self, browser_key: str, press: bool): ...
    def type_text(self, text: str): ...


class _PynputBackend(_InputBackend):
    name = "pynput"

    def __init__(self):
        super().__init__()
        from pynput.mouse import Controller as MC, Button     # type: ignore
        from pynput.keyboard import Controller as KC, Key, KeyCode  # type: ignore
        self._mouse = MC()
        self._kb = KC()
        self._Button = Button
        self._Key = Key
        self._KeyCode = KeyCode
        self._buttons = {"left": Button.left, "right": Button.right, "middle": Button.middle}
        self._named = {
            "Enter": Key.enter, "Tab": Key.tab, "Escape": Key.esc, "Backspace": Key.backspace,
            "Delete": Key.delete, "Insert": Key.insert, " ": Key.space,
            "ArrowUp": Key.up, "ArrowDown": Key.down, "ArrowLeft": Key.left, "ArrowRight": Key.right,
            "Home": Key.home, "End": Key.end, "PageUp": Key.page_up, "PageDown": Key.page_down,
            "Control": Key.ctrl, "Alt": Key.alt, "Shift": Key.shift, "Meta": Key.cmd,
            "CapsLock": Key.caps_lock,
        }
        for i in range(1, 13):
            self._named[f"F{i}"] = getattr(Key, f"f{i}")

    def _detect_geometry(self):
        return _primary_screen_geometry()

    def _resolve(self, browser_key: str):
        if browser_key in self._named:
            return self._named[browser_key]
        if len(browser_key) == 1:
            ch = browser_key.lower() if browser_key.isalpha() else browser_key
            try:
                return self._KeyCode.from_char(ch)
            except Exception:
                return None
        return None

    def move(self, px, py):
        self._mouse.position = (px, py)

    def button(self, name, press):
        b = self._buttons.get(name, self._Button.left)
        (self._mouse.press if press else self._mouse.release)(b)

    def scroll(self, dx, dy):
        # pynput: +y scrolls up; our dy>0 means scroll down → negate.
        self._mouse.scroll(int(dx), -int(dy))

    def key(self, browser_key, press):
        k = self._resolve(browser_key)
        if k is None:
            return
        (self._kb.press if press else self._kb.release)(k)

    def type_text(self, text):
        if text:
            self._kb.type(text)


class _XdotoolBackend(_InputBackend):
    name = "xdotool"

    def __init__(self, exe: str):
        super().__init__()
        self._exe = exe
        self._buttons = {"left": "1", "middle": "2", "right": "3"}

    def _run(self, *args):
        try:
            subprocess.run([self._exe, *args], check=False, timeout=5,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        except Exception:
            pass

    def _detect_geometry(self):
        try:
            out = subprocess.run([self._exe, "getdisplaygeometry"], check=True, timeout=5,
                                 stdout=subprocess.PIPE, stderr=subprocess.DEVNULL).stdout.decode()
            w, h = out.split()
            return int(w), int(h)
        except Exception:
            return (1920, 1080)

    def move(self, px, py):
        self._run("mousemove", str(px), str(py))

    def button(self, name, press):
        self._run("mousedown" if press else "mouseup", self._buttons.get(name, "1"))

    def scroll(self, dx, dy):
        dy = int(dy); dx = int(dx)
        for _ in range(abs(dy)):
            self._run("click", "5" if dy > 0 else "4")
        for _ in range(abs(dx)):
            self._run("click", "7" if dx > 0 else "6")

    def key(self, browser_key, press):
        sym = _to_xdo_keysym(browser_key)
        if not sym:
            return
        self._run("keydown" if press else "keyup", sym)

    def type_text(self, text):
        if text:
            self._run("type", "--", text)


def _primary_screen_geometry():
    """Best-effort primary-monitor size in pixels."""
    if IS_WIN:
        try:
            import ctypes
            u = ctypes.windll.user32
            try:
                ctypes.windll.shcore.SetProcessDpiAwareness(2)  # per-monitor DPI aware
            except Exception:
                pass
            return int(u.GetSystemMetrics(0)), int(u.GetSystemMetrics(1))
        except Exception:
            pass
    try:
        import mss  # type: ignore
        with mss.mss() as sct:
            mon = sct.monitors[1] if len(sct.monitors) > 1 else sct.monitors[0]
            return int(mon["width"]), int(mon["height"])
    except Exception:
        return (1920, 1080)


def _ensure_input_deps() -> bool:
    """True if an input backend can be constructed. Tries pynput; one-time quiet
    pip install on Windows/macOS for agents predating this feature. xdotool (Linux)
    needs no Python package."""
    try:
        import pynput  # noqa: F401
        return True
    except Exception:
        pass
    if not IS_WIN and shutil.which("xdotool"):
        return True
    try:
        subprocess.run(
            [sys.executable, "-m", "pip", "install", "--disable-pip-version-check",
             "--quiet", "pynput"],
            check=True, timeout=180,
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            creationflags=_NO_WINDOW,
        )
        import importlib
        importlib.invalidate_caches()
        import pynput  # noqa: F401
        return True
    except Exception as e:
        print(f"[remote] input deps unavailable: {e}", file=sys.stderr)
        return bool(not IS_WIN and shutil.which("xdotool"))


def _make_input_backend():
    """Return an input backend (pynput preferred, xdotool fallback on Linux), or
    None if no driver is available."""
    try:
        import pynput  # noqa: F401
        return _PynputBackend()
    except Exception:
        pass
    exe = shutil.which("xdotool") if not IS_WIN else None
    if exe:
        return _XdotoolBackend(exe)
    return None


def apply_remote_input(evt: dict, backend: "_InputBackend") -> None:
    """Replay one portal input event on the local machine. Pure dispatch — the
    SECURITY gate (control enabled / not expired) is enforced by the caller."""
    kind = evt.get("kind")
    action = evt.get("action")
    if kind == "mouse":
        if action == "move":
            backend.move_norm(evt.get("x", 0), evt.get("y", 0))
        elif action in ("down", "up"):
            if "x" in evt and "y" in evt:
                backend.move_norm(evt["x"], evt["y"])
            backend.button(evt.get("button", "left"), action == "down")
        elif action == "wheel":
            if "x" in evt and "y" in evt:
                backend.move_norm(evt["x"], evt["y"])
            backend.scroll(int(evt.get("dx", 0) or 0), int(evt.get("dy", 0) or 0))
    elif kind == "key":
        if action == "type":
            backend.type_text(str(evt.get("text", "")))
        elif action in ("down", "up"):
            backend.key(str(evt.get("key", "")), action == "down")


def _input_audit_path() -> str:
    d = os.path.join(os.path.expanduser("~"), ".miles-agent")
    try:
        os.makedirs(d, exist_ok=True)
    except Exception:
        pass
    return os.path.join(d, "remote_input_audit.log")


def _append_input_audit(session_id: str, event: str, who: str) -> None:
    """Durable on-machine record of input-enabled / input-disabled transitions."""
    rec = {"ts": int(time.time() * 1000), "session_id": session_id,
           "event": event, "actor": who, "host": socket.gethostname()}
    try:
        with open(_input_audit_path(), "a", encoding="utf-8") as f:
            f.write(json.dumps(rec) + "\n")
    except Exception:
        pass


class _RemoteControlBanner:
    """Always-on-top on-machine banner shown to the END USER while an admin is in
    control: names who is connected and offers an immediate Disconnect button.
    Best-effort and fully guarded — if Tkinter is unavailable (e.g. headless) it
    degrades to a no-op so it can never break the session."""

    def __init__(self, on_disconnect):
        self._on_disconnect = on_disconnect
        self._thread = None
        self._lock = threading.Lock()
        self._want_visible = False
        self._text = ""
        self._closed = False

    def show(self, admin: str):
        with self._lock:
            self._text = f"🔴  Remote control active — {admin} is connected"
            self._want_visible = True
            if self._thread is None or not self._thread.is_alive():
                self._thread = threading.Thread(target=self._run, name="remote-banner", daemon=True)
                self._thread.start()

    def update(self, admin: str):
        with self._lock:
            self._text = f"🔴  Remote control active — {admin} is connected"

    def hide(self):
        with self._lock:
            self._want_visible = False

    def close(self):
        with self._lock:
            self._closed = True
            self._want_visible = False

    def _run(self):
        try:
            import tkinter as tk
        except Exception:
            print("[remote] banner unavailable (no Tk); end user sees no overlay", file=sys.stderr)
            return
        try:
            root = tk.Tk()
            root.overrideredirect(True)
            root.attributes("-topmost", True)
            try:
                root.attributes("-alpha", 0.96)
            except Exception:
                pass
            sw = root.winfo_screenwidth()
            bw, bh = min(620, sw - 40), 44
            root.geometry(f"{bw}x{bh}+{(sw - bw) // 2}+8")
            root.configure(bg="#7f1d1d")
            var = tk.StringVar(value=self._text)
            tk.Label(root, textvariable=var, bg="#7f1d1d", fg="white",
                     font=("Segoe UI", 11, "bold")).pack(side="left", padx=14)

            def _disconnect():
                try:
                    threading.Thread(target=self._on_disconnect, daemon=True).start()
                finally:
                    self.close()

            tk.Button(root, text="Disconnect", command=_disconnect, bg="white",
                      fg="#7f1d1d", relief="flat", font=("Segoe UI", 9, "bold"),
                      padx=10).pack(side="right", padx=10)

            def _tick():
                with self._lock:
                    closed, visible, text = self._closed, self._want_visible, self._text
                if closed:
                    try: root.destroy()
                    except Exception: pass
                    return
                var.set(text)
                try:
                    if visible:
                        root.deiconify(); root.lift(); root.attributes("-topmost", True)
                    else:
                        root.withdraw()
                except Exception:
                    pass
                root.after(300, _tick)

            root.after(100, _tick)
            root.mainloop()
        except Exception as e:
            print(f"[remote] banner error: {e}", file=sys.stderr)


def poll_remote_access() -> None:
    """Poll for pending Assisted Access requests and show a native Allow/Deny
    dialog to the end user. Called on every fast-poll cycle; safe and fast when
    no sessions are pending (single GET that returns an empty list).

    The dialog runs in a daemon thread so it never blocks the main poll loop.
    Sessions are tracked in _prompted_sessions to avoid showing the same dialog
    twice within a single agent process lifetime.
    """
    global _prompted_sessions
    try:
        resp = _get("/remote-access")
        if not resp.get("success"):
            return
        sessions = resp.get("sessions") or []
        for s in sessions:
            sid = s.get("id")
            if not sid:
                continue
            # Fast path — skip without acquiring the lock if we've seen it
            if sid in _prompted_sessions:
                continue
            with _remote_access_lock:
                if sid in _prompted_sessions:
                    continue
                _prompted_sessions.add(sid)

            requester = s.get("requested_by") or "Your IT Admin"
            title = "Miles IT — Remote Access Request"
            message = (
                f"{requester} is requesting remote access to your computer.\n\n"
                f"Click Allow to permit access, or Deny to reject the request.\n"
                f"If you do not respond within 60 seconds, access will be automatically denied."
            )

            # Handle in a background thread so the poll loop keeps ticking
            def _handle(session_id: str = sid, msg: str = message) -> None:
                try:
                    allowed   = _show_access_dialog(title, msg, timeout_sec=60)
                    response  = "approved" if allowed else "denied"
                    _post("/remote-access/respond", {
                        "session_id": session_id,
                        "response":   response,
                    })
                    if allowed:
                        # Commit-2 spike: once approved, join the per-session
                        # Realtime channel so the portal can prove the round-trip.
                        threading.Thread(target=start_remote_session,
                                         args=(session_id,), daemon=True).start()
                except Exception:
                    pass

            threading.Thread(target=_handle, daemon=True).start()

    except Exception:
        pass


def poll_commands() -> tuple[bool, int]:
    """Poll + execute queued commands. Returns (revoked, processed):
      - `revoked`   True if the portal has revoked our token (so the caller can
                    tear the agent down and exit).
      - `processed` number of commands executed this poll — drives adaptive
                    polling, since any command means we should keep the fast
                    cadence so follow-up actions still apply within seconds."""
    resp = _get("/commands")
    if not resp.get("success"):
        return _looks_revoked(resp), 0
    processed = 0
    for cmd in resp.get("commands", []):
        status, result, err = execute_command(cmd)
        _post("/commands/status", {
            "id":     cmd["id"],
            "status": status,
            "result": result,
            "error":  err,
        })
        processed += 1
        # A confirmed uninstall is terminal: the local files/token are gone, so
        # never run any further command claimed in the same batch. The run loop
        # sees _uninstall_requested next and exits.
        if _uninstall_requested:
            break
    return False, processed


# ── entrypoints ─────────────────────────────────────────────────────────────
def register() -> int:
    if not TOKEN:
        print("ERROR: MILES_AGENT_TOKEN is not set", file=sys.stderr); return 2
    print(json.dumps(_post("/register", {"payload": collect_system_info()}), indent=2))
    # First-run wallpaper apply (best-effort, never blocks registration success)
    status, err = apply_active_wallpaper(force=True)
    if status == "applied": print("[wallpaper] applied")
    elif status == "skipped": print("[wallpaper] already up-to-date")
    elif status == "none":    print("[wallpaper] none configured")
    else:                     print(f"[wallpaper] {status}: {err}", file=sys.stderr)
    return 0


_SINGLETON_HANDLE = None  # kept alive for the process lifetime so the lock holds


def _acquire_singleton() -> bool:
    """Ensure only one `run` loop is active per user. Re-running install-service,
    a second logon launch, or a manual `run` must not spawn a duplicate agent
    (which would double every sync and command). Returns True if we own the lock."""
    global _SINGLETON_HANDLE
    if IS_WIN:
        try:
            import ctypes
            ERROR_ALREADY_EXISTS = 183
            # Per-user named mutex (Local\ namespace = current session/user).
            h = ctypes.windll.kernel32.CreateMutexW(None, False, "Local\\MilesAgentSingleton")
            if ctypes.windll.kernel32.GetLastError() == ERROR_ALREADY_EXISTS:
                return False
            _SINGLETON_HANDLE = h
            return True
        except Exception:
            return True  # never block the agent if the guard itself fails
    try:
        import fcntl
        lock_path = os.path.join(tempfile.gettempdir(), f"miles-agent-{os.getuid()}.lock")
        fh = open(lock_path, "w")
        fcntl.flock(fh.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        _SINGLETON_HANDLE = fh  # held until process exit
        return True
    except OSError:
        return False
    except Exception:
        return True


def run_loop() -> int:
    if not TOKEN:
        print("ERROR: MILES_AGENT_TOKEN is not set", file=sys.stderr); return 2
    if not _acquire_singleton():
        print("Another Miles agent is already running for this user — exiting.", file=sys.stderr)
        return 0
    # Re-assert the last-known lock immediately so a reboot — even offline —
    # keeps the device locked before the first /sync round-trips. On Linux the
    # account stays password-locked across reboot anyway; this also kicks any
    # session that came up.
    try:
        if _read_local_lock():
            with _lock_mutex:
                _apply_hard_lock()
    except Exception:
        pass
    last_sync = 0.0
    revoked_strikes = 0
    last_activity = float("-inf")  # last poll that carried commands; -inf = start idle (monotonic() can be ~0 right after boot)
    # Live poll cadence. Seeded from the env/constants, then overridden by whatever
    # the server returns on /sync — so the portal can retune the whole fleet once
    # and every agent converges with no reinstall/restart/env change.
    active_sec, idle_sec = COMMAND_POLL_SEC, IDLE_POLL_SEC
    while True:
        now = time.monotonic()
        try:
            # Heavy system sync + wallpaper + lock reconcile on the slow cycle.
            if now - last_sync >= SYNC_INTERVAL_SEC:
                sync = _post("/sync", {"payload": collect_system_info()})
                if isinstance(sync, dict) and sync.get("success"):
                    if "locked" in sync:
                        reconcile_lock(bool(sync.get("locked")))
                    # Server-driven poll cadence: the portal/DB sets it once and we
                    # adopt it here live, clamped, with idle never faster than active.
                    active_sec, idle_sec = _apply_server_poll(sync.get("poll"), active_sec, idle_sec)
                apply_active_wallpaper()   # post-sync wallpaper check (no-op if unchanged)
                _maybe_notify_long_uptime()
                # Self-update: silently check for a newer agent once per day.
                # If an update is available, _self_update() atomically replaces
                # this script and calls os.execv() — the process never returns
                # past that line. On a no-op check it returns immediately.
                _self_update()
                last_sync = now
            # Commands (lock / unlock) on the fast cycle so they apply in seconds.
            # poll_commands() also reports if the portal has revoked our token
            # (Force Remove from Portal). Two consecutive revoked polls — never a
            # one-off network blip — means we must stop managing this laptop:
            # tear ourselves down and exit so no background process or console
            # window is left running.
            revoked, processed = poll_commands()
            poll_remote_access()  # prompt end user for any pending Assisted Access requests
            if processed > 0:
                last_activity = now  # activity → snap back to the fast cadence
            if revoked:
                revoked_strikes += 1
                if revoked_strikes >= 2:
                    # Token revoked server-side: the device is already removed, so
                    # staying alive serves no purpose — we always stop. Still run
                    # the local teardown and report its result honestly rather
                    # than silently assuming the cleanup succeeded.
                    try:
                        status, _msg, warn = _self_uninstall()
                        if status != "completed":
                            print(f"Token revoked; local cleanup incomplete: {warn}",
                                  file=sys.stderr)
                    except Exception as e:
                        print(f"Token revoked; local cleanup error: {e}", file=sys.stderr)
                    print("Agent token revoked by portal — exiting.", file=sys.stderr)
                    _final_self_destruct()
                    return 0
            else:
                revoked_strikes = 0
            # An uninstall command tore the agent down (and poll_commands has
            # just reported its result to the portal). Exit cleanly now; on
            # Windows hand off a detached job to delete the still-locked files.
            if _uninstall_requested:
                print("Agent uninstalled — exiting.", file=sys.stderr)
                _final_self_destruct()
                return 0
            # Keep a locked device locked: re-assert the Windows/macOS screen
            # lock every fast cycle (no-op on Linux / when unlocked). Runs after
            # poll_commands so an incoming unlock clears local state first and we
            # don't re-lock in the same cycle.
            reassert_lock()
        except Exception as e:
            print(f"[{datetime.now(timezone.utc).isoformat()}] loop error: {e}", file=sys.stderr)
        # Adaptive cadence: stay on the fast COMMAND_POLL_SEC tick while commands
        # are actively flowing — and for BURST_WINDOW_SEC after the last one in
        # case more follow — then fall back to the cheap IDLE_POLL_SEC tick. This
        # is what cuts idle Edge Function invocations ~83% (5s → 30s).
        active = (time.monotonic() - last_activity) < BURST_WINDOW_SEC
        time.sleep(active_sec if active else idle_sec)


# ── service install (auto-start after reboot) ───────────────────────────────
MAC_PLIST_LABEL = "com.miles.agent"
MAC_PLIST_PATH  = os.path.expanduser(f"~/Library/LaunchAgents/{MAC_PLIST_LABEL}.plist")
MAC_INSTALL_DIR = os.path.expanduser("~/Library/Application Support/MilesAgent")
MAC_LOG_OUT     = os.path.expanduser("~/Library/Logs/miles-agent.out.log")
MAC_LOG_ERR     = os.path.expanduser("~/Library/Logs/miles-agent.err.log")

# Root install (required for the TRUE login-window hard lock): a system-wide
# LaunchDaemon that runs as root and survives reboot/logout.
MAC_DAEMON_PLIST_PATH = f"/Library/LaunchDaemons/{MAC_PLIST_LABEL}.plist"
MAC_SYS_INSTALL_DIR   = "/Library/Application Support/MilesAgent"
MAC_SYS_LOG_OUT       = "/Library/Logs/miles-agent.out.log"
MAC_SYS_LOG_ERR       = "/Library/Logs/miles-agent.err.log"


def _xml_escape(s: str) -> str:
    return (s.replace("&", "&amp;").replace("<", "&lt;")
             .replace(">", "&gt;").replace('"', "&quot;"))


def install_service_mac() -> int:
    """Install the launchd service that runs `miles-agent run` and survives reboot.
    ROOT  -> a system LaunchDaemon (required for the login-window hard lock).
    non-root -> a per-user LaunchAgent (convenient, but lock reports requires_admin)."""
    if _is_root():
        return _install_service_mac_system()
    return _install_service_mac_impl()


def _remove_legacy_mac_user_agent() -> None:
    """Tear down a previously-installed per-user LaunchAgent so it does not poll
    alongside the new root daemon (which would double-execute and let a non-root
    agent claim lock commands). Runs as the SUDO_USER who launched the install."""
    su = os.environ.get("SUDO_USER")
    if not su or su == "root":
        return
    uid = _mac_uid_for(su)
    legacy_plist = f"/Users/{su}/Library/LaunchAgents/{MAC_PLIST_LABEL}.plist"
    if uid is not None:
        subprocess.run(["launchctl", "bootout", f"gui/{uid}/{MAC_PLIST_LABEL}"],
                       capture_output=True, text=True)
        subprocess.run(["sudo", "-u", su, "launchctl", "unload", legacy_plist],
                       capture_output=True, text=True)
    try:
        if os.path.exists(legacy_plist):
            os.remove(legacy_plist)
    except Exception:
        pass


def _install_service_mac_system() -> int:
    """Root install: a system-wide LaunchDaemon that runs as root so it can enforce
    the macOS login-window hard lock (disable account + login banner)."""
    if not TOKEN:
        print("ERROR: MILES_AGENT_TOKEN must be set so the background service can authenticate.",
              file=sys.stderr)
        return 2

    _remove_legacy_mac_user_agent()
    os.makedirs(MAC_SYS_INSTALL_DIR, exist_ok=True)
    os.makedirs(os.path.dirname(MAC_SYS_LOG_OUT), exist_ok=True)

    # Store the auth token in a ROOT-ONLY file rather than the world-readable
    # plist, so a local standard user cannot steal it and forge command status.
    try:
        fd = os.open(MAC_SYS_TOKEN_FILE, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w") as tf:
            tf.write(TOKEN)
        os.chown(MAC_SYS_TOKEN_FILE, 0, 0)
        os.chmod(MAC_SYS_TOKEN_FILE, 0o600)
    except OSError as e:
        print(f"ERROR: could not write secure token file {MAC_SYS_TOKEN_FILE}: {e}",
              file=sys.stderr)
        return 1

    prog_args, dst = _service_program_args(MAC_SYS_INSTALL_DIR)
    prog_xml = "\n".join(f"    <string>{_xml_escape(a)}</string>" for a in prog_args)

    plist = f"""<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>{MAC_PLIST_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
{prog_xml}
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>MILES_AGENT_API_BASE</key><string>{_xml_escape(API_BASE)}</string>
    <key>MILES_AGENT_SYNC_INTERVAL</key><string>{SYNC_INTERVAL_SEC}</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>{_xml_escape(MAC_SYS_LOG_OUT)}</string>
  <key>StandardErrorPath</key><string>{_xml_escape(MAC_SYS_LOG_ERR)}</string>
</dict>
</plist>
"""
    with open(MAC_DAEMON_PLIST_PATH, "w") as fh:
        fh.write(plist)
    # LaunchDaemons must be owned root:wheel and not group/world writable or launchd
    # refuses to load them.
    try:
        os.chown(MAC_DAEMON_PLIST_PATH, 0, 0)
    except Exception:
        pass
    os.chmod(MAC_DAEMON_PLIST_PATH, 0o644)

    subprocess.run(["launchctl", "unload", MAC_DAEMON_PLIST_PATH],
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    r = subprocess.run(["launchctl", "load", "-w", MAC_DAEMON_PLIST_PATH],
                       stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if r.returncode != 0:
        print("ERROR: launchctl load failed:", r.stderr.decode(errors="ignore"), file=sys.stderr)
        return 1

    print(f"✓ System service '{MAC_PLIST_LABEL}' installed and started (root).")
    print(f"  Binary:   {dst}")
    print(f"  Plist:    {MAC_DAEMON_PLIST_PATH}")
    print(f"  Logs:     {MAC_SYS_LOG_OUT}")
    print(f"  Sync every: {SYNC_INTERVAL_SEC} seconds (auto-starts at boot)")
    print("  Hard lock: ENABLED (login-window lock with custom message)")
    return 0


def _service_program_args(install_dir: str) -> tuple[list[str], str]:
    """Return the argv used to launch the agent in `run` mode as a persistent service,
    plus a display path. Handles both frozen-binary and plain .py script installs so the
    service keeps working whether the user ran the binary or `python3 laptop_agent.py`."""
    src = os.path.abspath(sys.argv[0])
    if getattr(sys, "frozen", False):
        # PyInstaller binary — exec it directly.
        dst = os.path.join(install_dir, "miles-agent")
        if os.path.abspath(src) != os.path.abspath(dst):
            shutil.copy2(src, dst)
        os.chmod(dst, 0o755)
        return ([dst, "run"], dst)
    # Script mode — copy the .py to a stable location and launch via the current interpreter
    # (e.g. a venv python that has `requests`), so the service uses the same env that worked.
    dst = os.path.join(install_dir, "laptop_agent.py")
    if os.path.abspath(src) != os.path.abspath(dst):
        shutil.copy2(src, dst)
    os.chmod(dst, 0o644)
    return ([os.path.abspath(sys.executable), dst, "run"], dst)


def _install_service_mac_impl() -> int:
    if not TOKEN:
        print("ERROR: MILES_AGENT_TOKEN must be set so the background service can authenticate.",
              file=sys.stderr)
        return 2

    os.makedirs(MAC_INSTALL_DIR, exist_ok=True)
    os.makedirs(os.path.dirname(MAC_PLIST_PATH), exist_ok=True)
    os.makedirs(os.path.dirname(MAC_LOG_OUT), exist_ok=True)

    # Build launch argv (handles both frozen binary and plain .py script installs).
    prog_args, dst = _service_program_args(MAC_INSTALL_DIR)
    prog_xml = "\n".join(f"    <string>{_xml_escape(a)}</string>" for a in prog_args)

    plist = f"""<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>{MAC_PLIST_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
{prog_xml}
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>MILES_AGENT_TOKEN</key><string>{_xml_escape(TOKEN)}</string>
    <key>MILES_AGENT_API_BASE</key><string>{_xml_escape(API_BASE)}</string>
    <key>MILES_AGENT_SYNC_INTERVAL</key><string>{SYNC_INTERVAL_SEC}</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>{_xml_escape(MAC_LOG_OUT)}</string>
  <key>StandardErrorPath</key><string>{_xml_escape(MAC_LOG_ERR)}</string>
</dict>
</plist>
"""
    with open(MAC_PLIST_PATH, "w") as fh:
        fh.write(plist)
    os.chmod(MAC_PLIST_PATH, 0o644)

    # Reload (unload-then-load; ignore "Could not find specified service")
    subprocess.run(["launchctl", "unload", MAC_PLIST_PATH],
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    r = subprocess.run(["launchctl", "load", "-w", MAC_PLIST_PATH],
                       stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if r.returncode != 0:
        print("ERROR: launchctl load failed:", r.stderr.decode(errors="ignore"), file=sys.stderr)
        return 1

    print(f"✓ Service '{MAC_PLIST_LABEL}' installed and started.")
    print(f"  Binary:   {dst}")
    print(f"  Plist:    {MAC_PLIST_PATH}")
    print(f"  Logs:     {MAC_LOG_OUT}")
    print(f"  Sync every: {SYNC_INTERVAL_SEC} seconds (auto-starts on login)")
    return 0


def uninstall_service_mac() -> int:
    # System LaunchDaemon (root install).
    if os.path.exists(MAC_DAEMON_PLIST_PATH):
        subprocess.run(["launchctl", "unload", MAC_DAEMON_PLIST_PATH],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            os.remove(MAC_DAEMON_PLIST_PATH)
        except Exception:
            pass
        if os.path.isdir(MAC_SYS_INSTALL_DIR):
            shutil.rmtree(MAC_SYS_INSTALL_DIR, ignore_errors=True)
    # Per-user LaunchAgent (legacy / non-root install).
    if os.path.exists(MAC_PLIST_PATH):
        subprocess.run(["launchctl", "unload", MAC_PLIST_PATH],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        os.remove(MAC_PLIST_PATH)
    if os.path.isdir(MAC_INSTALL_DIR):
        shutil.rmtree(MAC_INSTALL_DIR, ignore_errors=True)
    print("✓ Service uninstalled.")
    return 0


# ── Linux systemd service ───────────────────────────────────────────────────
# Two install modes:
#   * ROOT  -> a SYSTEM service (/etc/systemd/system). Required for the hard
#     lock: only root can usermod -L / terminate another user's session.
#   * non-root -> a per-user service (systemd --user). Convenient, but the agent
#     cannot enforce a hard lock and will report "requires_admin" on lock.
LIN_UNIT_NAME        = "miles-agent.service"
LIN_UNIT_PATH        = os.path.expanduser(f"~/.config/systemd/user/{LIN_UNIT_NAME}")
LIN_INSTALL_DIR      = os.path.expanduser("~/.local/share/miles-agent")
LIN_SYS_UNIT_PATH    = f"/etc/systemd/system/{LIN_UNIT_NAME}"
LIN_SYS_INSTALL_DIR  = "/opt/miles-agent"


def _remove_legacy_user_service() -> None:
    """Best-effort: tear down a previously-installed per-user service so it does
    not poll for commands alongside the new root system service (which would
    cause duplicate execution / a non-root agent claiming lock commands)."""
    su = os.environ.get("SUDO_USER")
    if not su or su == "root":
        return
    try:
        import pwd
        uid = pwd.getpwnam(su).pw_uid
    except Exception:
        return
    env = dict(os.environ, XDG_RUNTIME_DIR=f"/run/user/{uid}")
    subprocess.run(["sudo", "-u", su, "systemctl", "--user", "disable", "--now", LIN_UNIT_NAME],
                   env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    legacy_unit = f"/home/{su}/.config/systemd/user/{LIN_UNIT_NAME}"
    try:
        if os.path.exists(legacy_unit):
            os.remove(legacy_unit)
    except Exception:
        pass


def _install_service_linux_system() -> int:
    """Root install: a system-wide systemd service that can enforce the hard lock."""
    _remove_legacy_user_service()
    os.makedirs(LIN_SYS_INSTALL_DIR, exist_ok=True)

    prog_args, dst = _service_program_args(LIN_SYS_INSTALL_DIR)
    exec_start = " ".join(shlex.quote(a) for a in prog_args)

    unit = f"""[Unit]
Description=Miles IT Assets Device Agent (system)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart={exec_start}
Restart=always
RestartSec=15
Environment=MILES_AGENT_TOKEN={TOKEN}
Environment=MILES_AGENT_API_BASE={API_BASE}
Environment=MILES_AGENT_SYNC_INTERVAL={SYNC_INTERVAL_SEC}

[Install]
WantedBy=multi-user.target
"""
    with open(LIN_SYS_UNIT_PATH, "w") as fh:
        fh.write(unit)
    os.chmod(LIN_SYS_UNIT_PATH, 0o600)  # contains token

    for args in (
        ["systemctl", "daemon-reload"],
        ["systemctl", "enable", LIN_UNIT_NAME],
        ["systemctl", "restart", LIN_UNIT_NAME],
    ):
        r = subprocess.run(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        if r.returncode != 0:
            print(f"ERROR: {' '.join(args)} failed:", r.stderr.decode(errors="ignore"), file=sys.stderr)
            return 1

    print(f"✓ Service '{LIN_UNIT_NAME}' installed and started (system service, root).")
    print(f"  Binary:   {dst}")
    print(f"  Unit:     {LIN_SYS_UNIT_PATH}")
    print(f"  Status:   systemctl status {LIN_UNIT_NAME}")
    print(f"  Logs:     journalctl -u {LIN_UNIT_NAME} -f")
    print(f"  Sync every: {SYNC_INTERVAL_SEC} seconds")
    print("  Hard lock: ENABLED (running as root).")
    return 0


def install_service_linux() -> int:
    """Install a systemd service that runs the agent and survives reboot.
    Runs as a SYSTEM service when invoked as root (enables hard lock); otherwise
    falls back to a per-user service (hard lock unavailable)."""
    if not TOKEN:
        print("ERROR: MILES_AGENT_TOKEN must be set so the background service can authenticate.",
              file=sys.stderr)
        return 2

    if _is_root():
        return _install_service_linux_system()

    print("WARNING: installing as a per-user service (not root). Remote HARD LOCK will")
    print("         NOT work — the agent cannot lock the OS account without root. To")
    print("         enable hard lock, reinstall with: sudo python3 laptop_agent.py install")
    print()

    os.makedirs(LIN_INSTALL_DIR, exist_ok=True)
    os.makedirs(os.path.dirname(LIN_UNIT_PATH), exist_ok=True)

    # Build launch argv (handles both frozen binary and plain .py script installs).
    prog_args, dst = _service_program_args(LIN_INSTALL_DIR)
    exec_start = " ".join(shlex.quote(a) for a in prog_args)

    unit = f"""[Unit]
Description=Miles IT Assets Device Agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart={exec_start}
Restart=always
RestartSec=15
Environment=MILES_AGENT_TOKEN={TOKEN}
Environment=MILES_AGENT_API_BASE={API_BASE}
Environment=MILES_AGENT_SYNC_INTERVAL={SYNC_INTERVAL_SEC}

[Install]
WantedBy=default.target
"""
    with open(LIN_UNIT_PATH, "w") as fh:
        fh.write(unit)
    os.chmod(LIN_UNIT_PATH, 0o600)  # contains token

    for args in (
        ["systemctl", "--user", "daemon-reload"],
        ["systemctl", "--user", "enable", LIN_UNIT_NAME],
        ["systemctl", "--user", "restart", LIN_UNIT_NAME],
    ):
        r = subprocess.run(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        if r.returncode != 0:
            print(f"ERROR: {' '.join(args)} failed:", r.stderr.decode(errors="ignore"), file=sys.stderr)
            return 1

    print(f"✓ Service '{LIN_UNIT_NAME}' installed and started (systemd --user).")
    print(f"  Binary:   {dst}")
    print(f"  Unit:     {LIN_UNIT_PATH}")
    print(f"  Status:   systemctl --user status {LIN_UNIT_NAME}")
    print(f"  Logs:     journalctl --user -u {LIN_UNIT_NAME} -f")
    print(f"  Sync every: {SYNC_INTERVAL_SEC} seconds")
    print("  Hard lock: DISABLED (per-user service, no root).")
    print()
    print("To keep the agent running when you are logged out (headless servers), run once:")
    print(f"  sudo loginctl enable-linger {os.environ.get('USER', '$USER')}")
    return 0


def uninstall_service_linux() -> int:
    if _is_root():
        subprocess.run(["systemctl", "disable", "--now", LIN_UNIT_NAME],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        if os.path.exists(LIN_SYS_UNIT_PATH):
            os.remove(LIN_SYS_UNIT_PATH)
        subprocess.run(["systemctl", "daemon-reload"],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        if os.path.isdir(LIN_SYS_INSTALL_DIR):
            shutil.rmtree(LIN_SYS_INSTALL_DIR, ignore_errors=True)
        print("✓ System service uninstalled.")
        return 0

    subprocess.run(["systemctl", "--user", "disable", "--now", LIN_UNIT_NAME],
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    if os.path.exists(LIN_UNIT_PATH):
        os.remove(LIN_UNIT_PATH)
    subprocess.run(["systemctl", "--user", "daemon-reload"],
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    if os.path.isdir(LIN_INSTALL_DIR):
        shutil.rmtree(LIN_INSTALL_DIR, ignore_errors=True)
    print("✓ Service uninstalled.")
    return 0


# ── Windows logon auto-start (Startup folder — no admin required) ────────────
# A per-user scheduled task (schtasks /SC ONLOGON) requires elevation and fails
# with "Access is denied" from a normal Command Prompt. The Startup folder runs
# at every logon for the current user with no admin rights, so we drop a hidden
# VBScript launcher there that starts the agent via pythonw (no console window).
WIN_INSTALL_DIR = os.path.expandvars(r"%LOCALAPPDATA%\MilesAgent") if IS_WIN else ""
WIN_STARTUP_DIR = (os.path.expandvars(r"%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup")
                   if IS_WIN else "")
WIN_VBS_PATH    = os.path.join(WIN_STARTUP_DIR, "MilesAgent.vbs") if IS_WIN else ""
WIN_RUN_CMD     = os.path.join(WIN_INSTALL_DIR, "run.cmd") if IS_WIN else ""


def install_service_windows() -> int:
    if not TOKEN:
        print("ERROR: MILES_AGENT_TOKEN must be set so the background service can authenticate.",
              file=sys.stderr)
        return 2

    os.makedirs(WIN_INSTALL_DIR, exist_ok=True)
    os.makedirs(WIN_STARTUP_DIR, exist_ok=True)

    if getattr(sys, "frozen", False):
        # PyInstaller binary — launch it directly.
        exe = os.path.abspath(sys.argv[0])
        dst = os.path.join(WIN_INSTALL_DIR, "miles-agent.exe")
        if os.path.abspath(exe) != os.path.abspath(dst):
            shutil.copy2(exe, dst)
        # Run the binary directly inside the (hidden) launcher cmd — do NOT use
        # `start`, which spawns a SEPARATE window that stays visible.
        run_line = f'"{dst}" run'
        shown = dst
    else:
        # Script mode — copy the .py and launch it with the windowless interpreter
        # (pythonw.exe next to the current python, e.g. the venv) so no console shows.
        src = os.path.abspath(sys.argv[0])
        dst = os.path.join(WIN_INSTALL_DIR, "laptop_agent.py")
        if os.path.abspath(src) != os.path.abspath(dst):
            shutil.copy2(src, dst)
        py_dir = os.path.dirname(os.path.abspath(sys.executable))
        pythonw = os.path.join(py_dir, "pythonw.exe")
        if not os.path.exists(pythonw):
            pythonw = os.path.abspath(sys.executable)
        # Run the interpreter directly inside the (hidden) launcher cmd. We must
        # NOT use `start ""` here: `start` opens a brand-new console window that
        # stays visible whenever pythonw.exe is missing and we fall back to the
        # console python.exe — that is the persistent black cmd window users saw.
        # Running in-place keeps the agent inside the VBS-launched hidden cmd.
        run_line = f'"{pythonw}" "{dst}" run'
        shown = dst

    # run.cmd embeds the token/config (same posture as the macOS plist / Linux unit)
    # and runs the agent in-place (the VBS launches this cmd hidden, so the agent
    # inherits that hidden console instead of opening its own visible window).
    with open(WIN_RUN_CMD, "w", encoding="utf-8") as fh:
        fh.write("@echo off\r\n")
        fh.write(f'set "MILES_AGENT_TOKEN={TOKEN}"\r\n')
        fh.write(f'set "MILES_AGENT_API_BASE={API_BASE}"\r\n')
        fh.write(f'set "MILES_AGENT_SYNC_INTERVAL={SYNC_INTERVAL_SEC}"\r\n')
        fh.write(run_line + "\r\n")

    # Hidden launcher in the Startup folder (window style 0 = no flash at logon).
    with open(WIN_VBS_PATH, "w", encoding="utf-8") as fh:
        fh.write('CreateObject("WScript.Shell").Run "cmd /c """ & "'
                 + WIN_RUN_CMD + '" & """", 0, False\r\n')

    # Start it right now too (detached, no console window). DETACHED_PROCESS so
    # it survives the installer exiting; CREATE_NO_WINDOW so nothing flashes.
    try:
        CREATE_NO_WINDOW = 0x08000000
        DETACHED_PROCESS = 0x00000008
        subprocess.Popen(["cmd", "/c", WIN_RUN_CMD],
                         creationflags=CREATE_NO_WINDOW | DETACHED_PROCESS,
                         close_fds=True)
    except Exception as e:
        print(f"warning: installed, but could not start immediately: {e}", file=sys.stderr)

    print("\u2713 Service installed (Startup folder) — auto-starts at logon, no admin needed.")
    print(f"  Agent:   {shown}")
    print(f"  Startup: {WIN_VBS_PATH}")
    return 0


def uninstall_service_windows() -> int:
    try:
        if WIN_VBS_PATH and os.path.exists(WIN_VBS_PATH):
            os.remove(WIN_VBS_PATH)
    except Exception:
        pass
    if WIN_INSTALL_DIR and os.path.isdir(WIN_INSTALL_DIR):
        shutil.rmtree(WIN_INSTALL_DIR, ignore_errors=True)
    print("\u2713 Service uninstalled.")
    return 0


def install_service() -> int:
    if IS_MAC:  return install_service_mac()
    if IS_LIN:  return install_service_linux()
    if IS_WIN:  return install_service_windows()
    print("Unsupported platform for service install.", file=sys.stderr); return 2


def uninstall_service() -> int:
    if IS_MAC: return uninstall_service_mac()
    if IS_LIN: return uninstall_service_linux()
    if IS_WIN: return uninstall_service_windows()
    print("Service uninstall not implemented for this platform.", file=sys.stderr); return 2


def main() -> int:
    cmd = sys.argv[1] if len(sys.argv) > 1 else "run"
    if cmd == "register": return register()
    if cmd == "sync":
        print(json.dumps(_post("/sync", {"payload": collect_system_info()}), indent=2)); return 0
    if cmd == "info":
        print(json.dumps(collect_system_info(), indent=2)); return 0
    if cmd == "run":               return run_loop()
    if cmd == "install-service":   return install_service()
    if cmd == "uninstall-service": return uninstall_service()
    if cmd == "unregister":
        # Full local teardown: stop the background service, delete the agent's
        # local files, and remove the saved token. Use this to clean up a
        # device the portal has already force-removed. Does not touch user data.
        status, msg, warn = _self_uninstall()
        if status != "completed":
            # Honest exit: teardown did not fully succeed, so the device is still
            # managed. Report the reason and a non-zero code for the operator.
            print(f"ERROR: uninstall did not complete: {warn}", file=sys.stderr)
            return 1
        _final_self_destruct()
        print(msg or "Agent unregistered.")
        if warn:
            print(f"Note: {warn}", file=sys.stderr)
        return 0
    print(f"unknown command: {cmd}", file=sys.stderr); return 2


if __name__ == "__main__":
    sys.exit(main())
