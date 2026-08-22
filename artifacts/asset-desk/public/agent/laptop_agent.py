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
import uuid
import hashlib
import re
import secrets
import string
import threading
from datetime import datetime, timezone

import requests

AGENT_VERSION       = "0.9.10"
DEFAULT_API_BASE    = "https://dimbgprindvmzoylzyud.supabase.co/functions/v1/agent-api"
API_BASE            = os.environ.get("MILES_AGENT_API_BASE", DEFAULT_API_BASE)
# Where the latest laptop_agent.py is served. Mirrors DEFAULT_API_BASE so silent
# self-update works even when the install-time MILES_AGENT_URL env var is missing
# from the service context (e.g. a root/SYSTEM service that did not inherit a
# user-scope env var). Without a working default the update check 404s silently
# and the device stays pinned to whatever version it was installed with.
DEFAULT_AGENT_URL   = "https://it.assets.mileseducation.org/agent/laptop_agent.py"
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
COMMAND_RETRY_BACKOFF_MIN_SEC = 5
COMMAND_RETRY_BACKOFF_MAX_SEC = 120

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
LIN_SYS_ENV_FILE = "/etc/miles-agent/agent.env"
WIN_SYS_TOKEN_FILE = (
    os.path.join(os.environ.get("ProgramData", r"C:\ProgramData"), "MilesAgent", "agent.token")
    if IS_WIN else ""
)
WIN_RUNTIME_LOG = (
    os.path.join(os.environ.get("ProgramData", r"C:\ProgramData"), "MilesAgent", "agent.log")
    if IS_WIN else ""
)


def _load_token() -> str:
    if IS_WIN:
        try:
            with open(WIN_SYS_TOKEN_FILE, encoding="utf-8") as fh:
                token = fh.read().strip()
                if token:
                    return token
        except OSError:
            pass
    t = os.environ.get("MILES_AGENT_TOKEN", "")
    if t:
        return t.strip()
    if IS_MAC:
        try:
            with open(MAC_SYS_TOKEN_FILE) as fh:
                return fh.read().strip()
        except OSError:
            pass
    if IS_LIN:
        try:
            with open(LIN_SYS_ENV_FILE, encoding="utf-8") as fh:
                for line in fh:
                    key, sep, value = line.partition("=")
                    if sep and key.strip() == "MILES_AGENT_TOKEN":
                        return value.strip().strip('"').strip("'")
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
# itself and restart when the portal has a changed copy. The version is a
# compatibility label, not a release counter: repairs rewrite the same agent
# in place instead of forcing 0.9.7 → 0.9.8 → 0.9.9.
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
    """Check for a changed agent script and apply it if one exists.

    Steps:
      1. Rate-limit to SELF_UPDATE_INTERVAL_SEC (skipped when force=True).
      2. Download the remote script to a temp file.
      3. Reject an older version; compare content when the version is equal.
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
        if new_ver < cur_ver:
            os.remove(tmp_path)
            return (False, f"downloaded agent is older than local={AGENT_VERSION}")

        current_digest = None
        try:
            with open(_AGENT_SCRIPT_PATH, "rb") as fh:
                current_digest = hashlib.sha256(fh.read()).digest()
        except OSError:
            pass
        remote_digest = hashlib.sha256(new_src.encode("utf-8")).digest()
        if new_ver == cur_ver and current_digest == remote_digest:
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


def collect_system_info(include_location_request: bool = False) -> dict:
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

    payload = {
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
    # Location is resolved server-side from the request's public IP. This marker
    # is intentionally opt-in so command-poll-triggered inventory syncs do not
    # perform a location lookup.
    if include_location_request:
        payload["location_request"] = "network"
    return payload


# ── HTTP helpers ─────────────────────────────────────────────────────────────
def _headers() -> dict:
    return {
        "X-Agent-Token": TOKEN,
        "Content-Type":  "application/json",
        "User-Agent":    f"miles-agent/{AGENT_VERSION} ({platform.system()})",
    }


def _post(path: str, body: dict) -> dict:
    try:
        r = requests.post(
            f"{API_BASE}{path}",
            json=body,
            headers=_headers(),
            timeout=HTTP_TIMEOUT_SEC,
        )
    except Exception as exc:
        return {
            "success": False,
            "retryable": True,
            "error": f"temporary communication failure during POST {path}: "
                     f"{type(exc).__name__}: {exc}",
        }

    try:
        response = r.json()
        _win_log(
            f"HTTP POST {path} status={r.status_code} "
            f"success={response.get('success') if isinstance(response, dict) else 'unknown'}"
        )
        return response
    except Exception:
        return {
            "success": False,
            "retryable": True,
            "error": f"http {getattr(r, 'status_code', 'unknown')}: malformed response",
        }


def _get(path: str) -> dict:
    try:
        r = requests.get(
            f"{API_BASE}{path}", headers=_headers(), timeout=HTTP_TIMEOUT_SEC
        )
    except Exception as exc:
        return {
            "success": False,
            "retryable": True,
            "error": f"temporary communication failure during GET {path}: "
                      f"{type(exc).__name__}: {exc}",
        }
    try:
        response = r.json()
        _win_log(f"HTTP GET {path} status={r.status_code} success={response.get('success') if isinstance(response, dict) else 'unknown'}")
        return response
    except Exception:
        return {
            "success": False,
            "retryable": True,
            "error": f"http {r.status_code}: {r.text[:200]}",
        }


# ── wallpaper (cross-platform) ──────────────────────────────────────────────
_MAC_WALLPAPER_TARGET_USER: str | None = None

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


def apply_active_wallpaper_for_user(username: str) -> tuple[str, str | None]:
    """Apply the active wallpaper in a managed employee's GUI session.

    A never-logged-in employee may not have an Aqua session yet; that is a
    pending policy result, not a provisioning failure.
    """
    global _MAC_WALLPAPER_TARGET_USER
    if not IS_MAC or not username:
        return ("failed", "targeted wallpaper is macOS-only")
    _MAC_WALLPAPER_TARGET_USER = username
    try:
        if not _mac_user_has_session(username):
            _post("/wallpaper/user-status", {
                "os_username": username, "status": "pending",
                "error": "employee has not started a graphical session",
            })
            return ("pending", "employee has not started a graphical session")
        status, error = apply_active_wallpaper(force=True)
        user_status = "applied" if status in ("applied", "skipped") else (
            "pending" if status == "none" else "failed"
        )
        _post("/wallpaper/user-status", {
            "os_username": username, "status": user_status, "error": error,
        })
        return (user_status, error)
    finally:
        _MAC_WALLPAPER_TARGET_USER = None


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
LOCK_STATE_FILE = (
    os.path.join(os.environ.get("ProgramData", r"C:\ProgramData"), "MilesAgent", "lock_state.json")
    if IS_WIN
    else os.path.join(os.path.expanduser("~"), ".miles-agent", "lock.state.json")
)

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
        tmp = LOCK_STATE_FILE + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(state, f)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, LOCK_STATE_FILE)
    except Exception:
        pass


COMMAND_STATUS_OUTBOX_FILE = (
    os.path.join(os.environ.get("ProgramData", r"C:\ProgramData"), "MilesAgent", "command-status.json")
    if IS_WIN
    else os.path.join(os.path.expanduser("~"), ".miles-agent", "command-status.json")
)


def _read_command_status_outbox() -> list[dict]:
    try:
        with open(COMMAND_STATUS_OUTBOX_FILE, "r", encoding="utf-8") as fh:
            data = json.load(fh)
            return data if isinstance(data, list) else []
    except Exception:
        return []


def _write_command_status_outbox(items: list[dict]) -> None:
    try:
        os.makedirs(os.path.dirname(COMMAND_STATUS_OUTBOX_FILE), exist_ok=True)
        tmp = COMMAND_STATUS_OUTBOX_FILE + ".tmp"
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(items[-100:], fh)
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(tmp, COMMAND_STATUS_OUTBOX_FILE)
    except Exception:
        pass


def _flush_command_status_outbox() -> None:
    """Retry terminal command updates that failed because the network was down.

    The API marks a command running before returning it. Without this small
    durable outbox, a transient failure after claiming a lock command leaves it
    running forever and the portal never reconciles is_locked.
    """
    pending = _read_command_status_outbox()
    if not pending:
        return
    remaining: list[dict] = []
    for body in pending:
        try:
            response = _post("/commands/status", body)
            if not isinstance(response, dict) or not response.get("success"):
                remaining.append(body)
        except Exception:
            remaining.append(body)
    _write_command_status_outbox(remaining)


def _post_command_status(body: dict) -> None:
    try:
        response = _post("/commands/status", body)
        if isinstance(response, dict) and response.get("success"):
            return
    except Exception:
        pass
    pending = _read_command_status_outbox()
    command_id = body.get("id")
    pending = [item for item in pending if item.get("id") != command_id]
    pending.append(body)
    _write_command_status_outbox(pending)


def _is_root() -> bool:
    try:
        return hasattr(os, "geteuid") and os.geteuid() == 0
    except Exception:
        return False


def _enable_runtime_log() -> None:
    """Capture SYSTEM-task startup and command errors where IT can inspect them.

    Task Scheduler runs the Windows agent without a console. Without redirecting
    stdout/stderr, an import failure, missing token, or API error looks exactly
    like a task that never ran.
    """
    if not IS_WIN:
        return
    try:
        os.makedirs(os.path.dirname(WIN_RUNTIME_LOG), exist_ok=True)
        handle = open(WIN_RUNTIME_LOG, "a", encoding="utf-8", buffering=1)
        sys.stdout = handle
        sys.stderr = handle
        print(f"[{datetime.now(timezone.utc).isoformat()}] agent process starting "
              f"version={AGENT_VERSION} pid={os.getpid()} token={'yes' if TOKEN else 'no'}")
    except Exception:
        pass


def _win_log(message: str) -> None:
    """Write safe Windows diagnostics after stdout is redirected to agent.log."""
    if IS_WIN:
        try:
            print(f"[{datetime.now(timezone.utc).isoformat()}] {message}", flush=True)
        except Exception:
            pass


# ── Branded full-screen lock kiosk + Windows account hardening ──────────────
# On a hard-locked Windows device the re-asserted workstation lock is dismissed
# the moment the user types their password, so we also paint an unmissable,
# branded "DEVICE ACCESS RESTRICTED" screen carrying the device's Asset ID and
# the IT message. It runs as its OWN process (see the __lockscreen__ subcommand)
# so the agent loop keeps polling and can tear the kiosk down the instant an
# unlock is confirmed. Best-effort: if tkinter is unavailable the workstation /
# account lock still enforces — we just cannot draw the overlay.
LOCK_SCREEN_TITLE   = "DEVICE ACCESS RESTRICTED"
LOCK_SCREEN_DEFAULT = "This device has been locked by the IT Asset Management Team."
LOCK_SCREEN_BRAND   = "Miles Education"
LOCK_SCREEN_BG      = "#0a1a3f"   # deep brand blue
LOCK_SCREEN_FG      = "#ffffff"
LOCK_SCREEN_ACCENT  = "#9db8ff"
WIN_LOCK_CAPTION    = "Device Locked — Miles Education IT"
# Standard end-user accounts disabled on a Windows hard lock. The account the
# agent itself runs as is NEVER disabled (break-glass + keeps enforcement alive).
WIN_SYSTEM_ACCOUNTS = {
    "system", "localsystem", "local service", "network service",
    "administrator", "defaultaccount", "defaultuser0", "wdagutilityaccount",
}
WIN_PROTECTED_ACCOUNTS = {
    name.strip().lower()
    for name in os.environ.get("MILES_PROTECTED_WINDOWS_USERS", "").split(",")
    if name.strip()
}
_win_last_lock_error = ""
_command_poll_degraded = False
_command_retry_delay = 0


def _win_is_admin() -> bool:
    if not IS_WIN:
        return False
    try:
        import ctypes
        return bool(ctypes.windll.shell32.IsUserAnAdmin())
    except Exception:
        return False


def _win_account_exists(user: str) -> bool:
    # `quser` may return DOMAIN\user. `net user` must receive the local
    # account name; this also prevents a domain-qualified session name from
    # making a valid local account look missing.
    account = _win_local_account_name(user)
    if not account:
        return False
    try:
        r = subprocess.run(["net", "user", account], capture_output=True, text=True,
                           timeout=15, creationflags=_NO_WINDOW)
        return r.returncode == 0
    except Exception:
        return False


def _win_local_account_name(user: str) -> str | None:
    """Resolve a Windows identity to a local SAM account, if it is one.

    Win32_ComputerSystem.UserName returns COMPUTERNAME\\user for local
    accounts. That is safe to administer when the qualifier is this machine;
    DOMAIN\\user, AzureAD\\user, and Microsoft-account identities are not.
    """
    raw = (user or "").strip().lstrip(">")
    if not raw or "@" in raw:
        return None
    if "\\" not in raw:
        return raw
    prefix, leaf = raw.split("\\", 1)
    local_names = {
        ".",
        (os.environ.get("COMPUTERNAME") or "").strip().lower(),
        socket.gethostname().strip().lower(),
    }
    return leaf if prefix.strip().lower() in local_names and leaf.strip() else None


def _win_is_protected_account(user: str) -> bool:
    leaf = user.strip().rsplit("\\", 1)[-1].lower()
    return leaf in WIN_SYSTEM_ACCOUNTS or leaf in WIN_PROTECTED_ACCOUNTS


def _win_is_local_account(user: str) -> bool:
    account = _win_local_account_name(user)
    return bool(account) and _win_account_exists(account)


def _win_account_disabled(user: str) -> bool | None:
    """Verify that Windows reports the account as inactive.

    ``net user`` output is localized, so this returns ``None`` when the stable
    ``Account active`` field cannot be interpreted. Locking fails closed when
    verification is unavailable; a successful command alone is not enough to
    claim that sign-in is blocked.
    """
    # PowerShell/CIM exposes the invariant boolean property even on localized
    # Windows, unlike parsing the localized `net user` text.
    leaf = _win_local_account_name(user)
    if leaf:
        safe_leaf = leaf.replace("'", "''")
        cim = _ps(
            f"$u=Get-CimInstance Win32_UserAccount -Filter "
            f"\"LocalAccount=True AND Name='{safe_leaf}'\" | Select-Object -First 1;"
            "if($u){if($u.Disabled){'DISABLED'}else{'ENABLED'}}"
        ).strip().upper()
        if cim == "DISABLED":
            return True
        if cim == "ENABLED":
            return False
    if not leaf:
        return None
    try:
        r = subprocess.run(["net", "user", leaf], capture_output=True, text=True,
                           timeout=15, creationflags=_NO_WINDOW)
        if r.returncode != 0:
            return None
        for line in r.stdout.splitlines():
            if "account active" in line.lower():
                value = line.split(":", 1)[-1].strip().lower()
                if value in ("no", "n"):
                    return True
                if value in ("yes", "y"):
                    return False
        return None
    except Exception:
        return None


def _win_interactive_users() -> list[str]:
    """Return active interactive usernames from Windows session manager.

    The agent runs as SYSTEM, so USERNAME is not the console employee. `quser`
    is authoritative for the active interactive session.
    """
    users: list[str] = []

    def add_user(raw: str) -> None:
        account = raw.strip().lstrip(">")
        normalized = account.rsplit("\\", 1)[-1].lower()
        if not account or _win_is_protected_account(account):
            return
        if all(existing.rsplit("\\", 1)[-1].lower() != normalized for existing in users):
            users.append(account)

    # Win32_ComputerSystem gives the console identity without parsing localized
    # `quser` state words. It is available while a user is signed in.
    console = _ps("(Get-CimInstance Win32_ComputerSystem).UserName").strip()
    if console:
        _win_log(f"Windows console identity discovered: {console}")
        add_user(console)

    lines: list[str] = []
    try:
        r = subprocess.run(["quser"], capture_output=True, text=True,
                           timeout=15, creationflags=_NO_WINDOW)
        lines = r.stdout.splitlines()[1:] if r.returncode == 0 else []
    except Exception:
        pass

    # Some Windows editions do not ship quser, while query user exposes the
    # same session table. Keep both paths because this runs as SYSTEM.
    if not lines:
        try:
            fallback = subprocess.run(["query", "user"], capture_output=True, text=True,
                                      timeout=15, creationflags=_NO_WINDOW)
            lines = fallback.stdout.splitlines()[1:] if fallback.returncode == 0 else []
        except Exception:
            pass

    for line in lines:
        parts = line.strip().lstrip(">").split()
        if not parts:
            continue
        state_index = next(
            (i for i, value in enumerate(parts)
             if value.lower() in ("active", "disc", "idle")),
            None,
        )
        # `Active` is English-only. If the state is localized, the console
        # identity above remains the only safe fallback.
        if state_index is not None and parts[state_index].lower() == "active":
            add_user(parts[0])

    _win_log(f"Windows interactive users discovered: {users}")
    return users


def _win_disable_lock_accounts(users: list[str] | None = None) -> list[str]:
    """Disable only intended interactive accounts and return changed accounts.

    A fresh lock discovers active users. Reassertion passes the persisted list,
    allowing the same accounts to remain disabled after reboot at sign-in.
    """
    global _win_last_lock_error
    _win_last_lock_error = ""
    disabled: list[str] = []
    me = (os.environ.get("USERNAME") or "").strip().lower()
    if users is not None:
        targets = users
    else:
        discovered = _win_interactive_users()
        # Never guess an employee account at the sign-in screen.
        targets = discovered
    for u in targets:
        account = _win_local_account_name(u)
        if not account:
            _win_last_lock_error = (
                f"Windows account '{u}' is not a local account; "
                "Microsoft/Azure AD/domain sign-in cannot be blocked by local "
                "net user administration."
            )
            continue
        normalized = account.lower()
        if normalized == me or _win_is_protected_account(u):
            continue
        if not _win_is_local_account(u):
            _win_last_lock_error = (
                f"Windows account '{u}' is not a local account; "
                "Microsoft/Azure AD/domain sign-in cannot be blocked by local "
                "net user administration."
            )
            continue
        _win_log(f"Windows account disable attempt account={account}")
        try:
            r = subprocess.run(["net", "user", account, "/active:no"], capture_output=True,
                               text=True, timeout=15, creationflags=_NO_WINDOW)
            if r.returncode == 0 and _win_account_disabled(account) is True:
                disabled.append(account)
                _win_log(f"Windows account disabled and verified account={account}")
            else:
                _win_log(f"Windows account disable verification failed account={account} exit={r.returncode}")
        except Exception:
            _win_log(f"Windows account disable exception account={account}")
    return disabled


def _win_enable_lock_accounts(users: list[str] | None = None) -> list[str]:
    """Re-enable sign-in for the given accounts. Returns the accounts we FAILED to
    re-enable (still exist but could not be reactivated) so the caller can report
    an honest unlock status instead of silently swallowing a permission error."""
    failed: list[str] = []
    for u in (users or []):
        account = u.strip().rsplit("\\", 1)[-1]
        if not _win_account_exists(account):
            continue
        try:
            r = subprocess.run(["net", "user", account, "/active:yes"], capture_output=True,
                               text=True, timeout=15, creationflags=_NO_WINDOW)
            if r.returncode != 0 or _win_account_disabled(account) is not False:
                failed.append(account)
        except Exception:
            failed.append(u)
    return failed


_WIN_POLICY_KEY = r"HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System"


def _win_set_legalnotice(caption: str, text: str) -> None:
    for v, d in (("legalnoticecaption", caption), ("legalnoticetext", text)):
        try:
            subprocess.run(["reg", "add", _WIN_POLICY_KEY, "/v", v, "/t", "REG_SZ",
                            "/d", d, "/f"], capture_output=True, text=True,
                           timeout=15, creationflags=_NO_WINDOW)
        except Exception:
            pass


def _win_clear_legalnotice() -> bool:
    ok = True
    for v in ("legalnoticecaption", "legalnoticetext"):
        try:
            r = subprocess.run(["reg", "add", _WIN_POLICY_KEY, "/v", v, "/t", "REG_SZ",
                                "/d", "", "/f"], capture_output=True, text=True,
                               timeout=15, creationflags=_NO_WINDOW)
            if r.returncode != 0:
                ok = False
        except Exception:
            ok = False
    return ok


def _win_force_logoff(disabled: list[str]) -> bool:
    """From a SYSTEM/admin context, log off the interactive sessions of the accounts
    we just disabled so the user is dropped to the (now-blocked) sign-in screen
    immediately instead of keeping their current session. Best-effort and silent —
    only touches sessions belonging to a disabled account, never other users."""
    if not disabled:
        return False
    _win_log(f"Windows logoff attempt accounts={disabled}")
    targets = {u.strip().lower() for u in disabled}
    session_ids: list[str] = []
    try:
        out = subprocess.run(["quser"], capture_output=True, text=True, timeout=15,
                             creationflags=_NO_WINDOW).stdout
    except Exception:
        out = ""
    # A few Windows editions omit the quser header or return a localized
    # session table. query session is a compatible fallback.
    if not out.strip():
        try:
            out = subprocess.run(["query", "session"], capture_output=True, text=True,
                                 timeout=15, creationflags=_NO_WINDOW).stdout
        except Exception:
            out = ""
    for line in out.splitlines():
        # quser rows: ">miles  console  1  Active ..." — the active session is
        # prefixed with '>'. Columns are whitespace-separated; the session ID is
        # the first standalone integer on the row.
        parts = line.replace(">", " ").split()
        if not parts:
            continue
        uname = parts[0].strip().rsplit("\\", 1)[-1].lower()
        if uname not in targets:
            continue
        sid = next((t for t in parts if t.isdigit()), None)
        if not sid:
            continue
        session_ids.append(sid)
        try:
            result = subprocess.run(["logoff", sid], capture_output=True, text=True,
                                    timeout=15, creationflags=_NO_WINDOW)
            _win_log(f"Windows logoff session={sid} exit={result.returncode}")
        except Exception:
            pass
    if not session_ids:
        # No session means the user is already at the sign-in screen. That is
        # a valid enforced state after a reboot or an earlier successful logoff.
        return True
    # Do not claim a completed hard lock until every session we targeted is
    # gone. A SYSTEM task can disable the account successfully while failing
    # to evict the interactive session; in that case the desktop remains usable.
    time.sleep(1)
    try:
        verify = subprocess.run(["quser"], capture_output=True, text=True, timeout=15,
                                creationflags=_NO_WINDOW).stdout
    except Exception:
        verify = ""
    if not verify.strip():
        try:
            verify = subprocess.run(["query", "session"], capture_output=True,
                                    text=True, timeout=15, creationflags=_NO_WINDOW).stdout
        except Exception:
            verify = ""
    for line in verify.splitlines():
        parts = line.replace(">", " ").split()
        if not parts:
            continue
        uname = parts[0].strip().rsplit("\\", 1)[-1].lower()
        sid = next((t for t in parts if t.isdigit()), None)
        if uname in targets and sid in session_ids:
            return False
    _win_log(f"Windows session disappearance verified sessions={session_ids}")
    return True


def _lock_screen_running() -> bool:
    pid = _read_lock_state().get("screen_pid")
    if not pid:
        return False
    try:
        out = subprocess.run(["tasklist", "/FI", f"PID eq {int(pid)}"],
                             capture_output=True, text=True, timeout=10,
                             creationflags=_NO_WINDOW).stdout
        return str(int(pid)) in out
    except Exception:
        return False


def _spawn_lock_screen() -> None:
    """Launch the branded kiosk as a detached, windowless process (Windows only)."""
    if not IS_WIN:
        return
    try:
        if _lock_screen_running():
            return
        if getattr(sys, "frozen", False):
            args = [os.path.abspath(sys.argv[0]), "__lockscreen__"]
        else:
            py_dir = os.path.dirname(os.path.abspath(sys.executable))
            pyw = os.path.join(py_dir, "pythonw.exe")
            exe = pyw if os.path.exists(pyw) else os.path.abspath(sys.executable)
            args = [exe, os.path.abspath(sys.argv[0]), "__lockscreen__"]
        p = subprocess.Popen(args, creationflags=0x08000000 | 0x00000008, close_fds=True)
        st = _read_lock_state()
        st["screen_pid"] = p.pid
        _write_lock_state(st)
    except Exception:
        pass


def _kill_lock_screen() -> None:
    if not IS_WIN:
        return
    pid = _read_lock_state().get("screen_pid")
    if pid:
        try:
            subprocess.run(["taskkill", "/PID", str(int(pid)), "/F"], capture_output=True,
                           text=True, timeout=10, creationflags=_NO_WINDOW)
        except Exception:
            pass
    try:
        st = _read_lock_state()
        st.pop("screen_pid", None)
        _write_lock_state(st)
    except Exception:
        pass


def _lock_screen_main() -> int:
    """Render the branded full-screen lock kiosk. Reads the Asset ID + message
    from the lock state, refuses to close/minimise, stays on top, and self-exits
    the moment the device is unlocked. Never raises into the caller."""
    try:
        import tkinter as tk
    except Exception:
        return 0
    st = _read_lock_state()
    asset_tag = str(st.get("asset_tag") or "").strip()
    message = (str(st.get("lock_message") or LOCK_SCREEN_DEFAULT).strip() or LOCK_SCREEN_DEFAULT)
    try:
        root = tk.Tk()
    except Exception:
        return 0
    root.title(LOCK_SCREEN_TITLE)
    root.configure(bg=LOCK_SCREEN_BG)
    try:
        root.attributes("-fullscreen", True)
    except Exception:
        try:
            root.overrideredirect(True)
            root.geometry(f"{root.winfo_screenwidth()}x{root.winfo_screenheight()}+0+0")
        except Exception:
            pass
    try:
        root.attributes("-topmost", True)
    except Exception:
        pass
    root.protocol("WM_DELETE_WINDOW", lambda: None)
    try:
        root.config(cursor="none")
    except Exception:
        pass

    wrap = tk.Frame(root, bg=LOCK_SCREEN_BG)
    wrap.place(relx=0.5, rely=0.5, anchor="center")
    tk.Label(wrap, text=LOCK_SCREEN_BRAND, fg=LOCK_SCREEN_ACCENT, bg=LOCK_SCREEN_BG,
             font=("Segoe UI", 26, "bold")).pack(pady=(0, 24))
    tk.Label(wrap, text="\U0001F512", fg=LOCK_SCREEN_FG, bg=LOCK_SCREEN_BG,
             font=("Segoe UI", 64)).pack(pady=(0, 16))
    tk.Label(wrap, text=LOCK_SCREEN_TITLE, fg=LOCK_SCREEN_FG, bg=LOCK_SCREEN_BG,
             font=("Segoe UI", 40, "bold")).pack(pady=(0, 18))
    tk.Label(wrap, text=message, fg=LOCK_SCREEN_FG, bg=LOCK_SCREEN_BG,
             font=("Segoe UI", 18), wraplength=900, justify="center").pack(pady=(0, 22))
    if asset_tag:
        tk.Label(wrap, text=f"Asset ID: {asset_tag}", fg=LOCK_SCREEN_ACCENT,
                 bg=LOCK_SCREEN_BG, font=("Segoe UI", 20, "bold")).pack(pady=(0, 10))
    tk.Label(wrap, text="Please contact the IT Asset Management Team to restore access.",
             fg=LOCK_SCREEN_ACCENT, bg=LOCK_SCREEN_BG, font=("Segoe UI", 14)).pack()

    for seq in ("<Escape>", "<Alt-F4>", "<Control-w>", "<Control-W>"):
        try:
            root.bind(seq, lambda e: "break")
        except Exception:
            pass

    def _tick():
        if not _read_local_lock():
            try:
                root.destroy()
            except Exception:
                pass
            return
        try:
            root.attributes("-topmost", True)
            root.lift()
            root.focus_force()
        except Exception:
            pass
        root.after(1000, _tick)

    root.after(800, _tick)
    try:
        root.mainloop()
    except Exception:
        pass
    return 0


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


# These names are centrally protected for every macOS account operation. The
# IT service account is deliberately included alongside Apple/system accounts:
# User Push must never turn it into an employee account or alter its role.
MAC_PROTECTED_ACCOUNTS = frozenset({
    "root", "daemon", "nobody", "miles-it-support", "administrator",
    "system", "loginwindow", "_windowserver", "_mbsetupuser", "_spotlight",
    "_windowserver", "_coreaudiod", "_networkd", "_appleevents",
})


def _mac_temporary_password() -> str:
    """Generate a strong password without using predictable process state."""
    alphabet = string.ascii_letters + string.digits + "!#$%+,-.:=@^_"
    required = [
        secrets.choice(string.ascii_lowercase),
        secrets.choice(string.ascii_uppercase),
        secrets.choice(string.digits),
        secrets.choice("!#$%+,-.:=@^_"),
    ]
    required.extend(secrets.choice(alphabet) for _ in range(20))
    secrets.SystemRandom().shuffle(required)
    return "".join(required)


_MAC_REQUIRED_ACCOUNT_FIELDS = (
    "UniqueID", "PrimaryGroupID", "NFSHomeDirectory", "UserShell", "RealName",
)


def _mac_dscl_record(username: str) -> tuple[bool, str]:
    """Read the fields needed to distinguish a complete account from a partial record."""
    try:
        result = subprocess.run(
            ["dscl", ".", "-read", f"/Users/{username}", *_MAC_REQUIRED_ACCOUNT_FIELDS],
            capture_output=True, text=True, timeout=10, creationflags=_NO_WINDOW,
        )
    except OSError:
        return False, ""
    return (
        result.returncode == 0
        and all(f"{field}:" in (result.stdout or "") for field in _MAC_REQUIRED_ACCOUNT_FIELDS),
        result.stdout or "",
    )


def _mac_employee_marker(username: str) -> str | None:
    try:
        result = subprocess.run(
            ["dscl", ".", "-read", f"/Users/{username}", "milesEmployeeCode"],
            capture_output=True, text=True, timeout=10, creationflags=_NO_WINDOW,
        )
    except OSError:
        return None
    if result.returncode != 0:
        return None
    for line in (result.stdout or "").splitlines():
        line = line.strip()
        for prefix in ("milesEmployeeCode:", "dsAttrTypeNative:milesEmployeeCode:"):
            if line.startswith(prefix):
                return line[len(prefix):].strip().upper()
    return None


def _mac_is_admin(username: str) -> bool | None:
    try:
        result = subprocess.run(
            ["dseditgroup", "-o", "checkmember", "-m", username, "admin"],
            capture_output=True, text=True, timeout=10, creationflags=_NO_WINDOW,
        )
    except OSError:
        return None
    output = f"{result.stdout or ''}\n{result.stderr or ''}".lower()
    if result.returncode != 0 and "yes" not in output and "no" not in output:
        return None
    return "yes" in output and "no" not in output


def _mac_cleanup_marked_partial(username: str) -> bool:
    """Remove only a matching partial Directory Services record.

    The home directory is deliberately never removed. A normal existing account
    cannot reach this function because the caller requires the Miles marker and
    incomplete account fields first.
    """
    try:
        result = subprocess.run(
            ["dscl", ".", "-delete", f"/Users/{username}"],
            capture_output=True, text=True, timeout=15, creationflags=_NO_WINDOW,
        )
    except OSError:
        return False
    return result.returncode == 0


def _mac_safe_creation_reason(stderr: str, password: str) -> str:
    """Return bounded diagnostics without allowing the temporary password through."""
    reason = " ".join((stderr or "").split()).replace(password, "[redacted]")
    return reason[:240] or "unknown sysadminctl error"


WIN_PROVISION_PROTECTED_ACCOUNTS = {
    "miles-it-support", "administrator", "defaultaccount", "guest",
    "wdagutilityaccount", "system", "local service", "network service",
}
LINUX_PROVISION_PROTECTED_ACCOUNTS = {
    "miles-it-support", "root", "daemon", "bin", "sys", "sync", "games",
    "man", "lp", "mail", "news", "uucp", "proxy", "www-data", "backup",
    "list", "irc", "gnats", "nobody", "systemd-network", "systemd-resolve",
    "messagebus", "syslog", "_apt", "gdm",
}


def _provisioning_username(employee_code: object) -> tuple[str, str | None]:
    raw = str(employee_code or "").strip()
    username = raw.lower()
    if (
        not raw or len(raw) > 32 or not raw[0].isalpha()
        or any(ch not in "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._-" for ch in raw)
    ):
        return "", "invalid Employee Code"
    return username, None


def _win_local_user_record(user: str) -> dict | None:
    safe = user.replace("'", "''")
    output = _ps(
        f"$u=Get-LocalUser -Name '{safe}' -ErrorAction SilentlyContinue;"
        "if($u){$u | Select-Object Name,Enabled,Description | ConvertTo-Json -Compress}"
    )
    if not output:
        return None
    try:
        value = json.loads(output)
        return value if isinstance(value, dict) else None
    except Exception:
        return None


def _win_user_is_administrator(user: str) -> bool | None:
    safe = user.replace("'", "''")
    output = _ps(
        "$ErrorActionPreference='Stop';"
        f"$u=Get-LocalUser -Name '{safe}' -ErrorAction SilentlyContinue;"
        "if(-not $u){'UNKNOWN';exit};"
        "$members=Get-LocalGroupMember -SID 'S-1-5-32-544' -ErrorAction Stop;"
        "if($members | Where-Object {$_.SID -eq $u.SID}){'MEMBER'}else{'NOT_MEMBER'}"
    ).strip().upper()
    if output == "MEMBER":
        return True
    if output == "NOT_MEMBER":
        return False
    return None


def _win_protected_account_is_admin() -> bool:
    result = _win_user_is_administrator("miles-it-support")
    return result is True


_WIN_BUILTIN_USERS_SID = "S-1-5-32-545"
_WIN_USERLIST_KEY = r"HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon\SpecialAccounts\UserList"


def _win_user_in_standard_users_group(user: str) -> bool | None:
    """Return whether a local account belongs to the built-in Users group.

    The group SID avoids relying on the localized display name (``Users`` /
    ``Benutzer`` / etc.) on Windows Home Single Language installations.
    """
    safe = user.replace("'", "''")
    output = _ps(
        "$ErrorActionPreference='Stop';"
        f"$u=Get-LocalUser -Name '{safe}' -ErrorAction SilentlyContinue;"
        "if(-not $u){'UNKNOWN';exit};"
        f"$members=Get-LocalGroupMember -SID '{_WIN_BUILTIN_USERS_SID}' -ErrorAction Stop;"
        "if($members | Where-Object {$_.SID -eq $u.SID}){'MEMBER'}else{'NOT_MEMBER'}"
    ).strip().upper()
    if output == "MEMBER":
        return True
    if output == "NOT_MEMBER":
        return False
    return None


def _win_add_to_standard_users_group(user: str) -> bool:
    """Add the account to the built-in standard Users group, if absent."""
    safe = user.replace("'", "''")
    output = _ps(
        "$ErrorActionPreference='Stop';"
        f"$u=Get-LocalUser -Name '{safe}' -ErrorAction Stop;"
        f"$g=Get-LocalGroup -SID '{_WIN_BUILTIN_USERS_SID}' -ErrorAction Stop;"
        "Add-LocalGroupMember -Group $g -Member $u -ErrorAction Stop;"
        "'OK'"
    ).strip().upper()
    return output == "OK"


def _win_userlist_visibility(user: str) -> str:
    """Return HIDDEN, VISIBLE, NOT_CONFIGURED, or UNKNOWN for Winlogon UserList."""
    safe = user.replace("'", "''")
    output = _ps(
        "$ErrorActionPreference='Stop';"
        f"$key=Get-Item -Path '{_WIN_USERLIST_KEY}' -ErrorAction SilentlyContinue;"
        "if(-not $key){'NOT_CONFIGURED';exit};"
        f"if($key.GetValueNames() -notcontains '{safe}'){{'NOT_CONFIGURED';exit}};"
        f"if([int]$key.GetValue('{safe}') -eq 0){{'HIDDEN'}}else{{'VISIBLE'}}"
    ).strip().upper()
    return output if output in {"HIDDEN", "VISIBLE", "NOT_CONFIGURED"} else "UNKNOWN"


def _win_remove_userlist_hidden_flag(user: str) -> bool:
    """Remove only this employee's explicit Winlogon hide flag."""
    safe = user.replace("'", "''")
    output = _ps(
        "$ErrorActionPreference='Stop';"
        f"Remove-ItemProperty -Path '{_WIN_USERLIST_KEY}' -Name '{safe}' -ErrorAction Stop;"
        "'OK'"
    ).strip().upper()
    return output == "OK"


def _win_can_interactively_logon(user: str, password: str) -> tuple[bool, str | None]:
    """Validate credentials and interactive-logon policy without creating a desktop."""
    if not IS_WIN:
        return False, "interactive Windows logon verification is unavailable on this platform"
    try:
        import ctypes
        from ctypes import wintypes

        token = wintypes.HANDLE()
        advapi32 = ctypes.WinDLL("advapi32", use_last_error=True)
        advapi32.LogonUserW.argtypes = [
            wintypes.LPCWSTR, wintypes.LPCWSTR, wintypes.LPCWSTR,
            wintypes.DWORD, wintypes.DWORD, ctypes.POINTER(wintypes.HANDLE),
        ]
        advapi32.LogonUserW.restype = wintypes.BOOL
        # LOGON32_LOGON_INTERACTIVE verifies the same local logon right used by
        # the Windows sign-in screen. It returns a token only; it does not
        # create a user session or auto-log the employee into the device.
        ok = advapi32.LogonUserW(user, ".", password, 2, 0, ctypes.byref(token))
        if ok:
            ctypes.WinDLL("kernel32", use_last_error=True).CloseHandle(token)
            return True, None
        return False, f"interactive Windows logon verification failed (Win32 error {ctypes.get_last_error()})"
    except Exception as exc:
        return False, f"interactive Windows logon verification could not run ({type(exc).__name__})"


def _win_prepare_employee_signin(user: str) -> tuple[bool, str | None]:
    """Repair only employee-specific visibility prerequisites before verification."""
    membership = _win_user_in_standard_users_group(user)
    if membership is None:
        return False, "could not verify Windows standard Users group membership"
    if membership is False:
        if not _win_add_to_standard_users_group(user):
            return False, "could not add employee account to the Windows standard Users group"
        if _win_user_in_standard_users_group(user) is not True:
            return False, "Windows standard Users group membership could not be confirmed"

    visibility = _win_userlist_visibility(user)
    if visibility == "UNKNOWN":
        return False, "could not inspect Windows per-user sign-in visibility"
    if visibility == "HIDDEN":
        if not _win_remove_userlist_hidden_flag(user):
            return False, "could not remove Windows per-user sign-in hide flag"
        if _win_userlist_visibility(user) == "HIDDEN":
            return False, "Windows per-user sign-in hide flag remains active"

    return True, None


def _win_verify_employee_signin(
    user: str, employee_code: str, password: str | None,
) -> tuple[bool, str | None]:
    """Verify the account is a usable standard local sign-in, not just a SAM row."""
    record = _win_local_user_record(user)
    marker_ok = bool(
        record and re.search(
            rf"(?i)\bMilesEmployeeCode={re.escape(employee_code)}\b",
            str(record.get("Description") or ""),
        )
    )
    if not record or record.get("Enabled") is not True or not marker_ok:
        return False, "Windows account verification failed: account is not an enabled managed user"
    if _win_user_is_administrator(user) is not False:
        return False, "Windows account verification failed: employee account is an Administrator"
    if _win_user_in_standard_users_group(user) is not True:
        return False, "Windows account verification failed: employee is not in the standard Users group"
    if _win_userlist_visibility(user) == "HIDDEN":
        return False, "Windows account verification failed: employee is hidden from sign-in"
    if password is not None:
        eligible, reason = _win_can_interactively_logon(user, password)
        if not eligible:
            return False, reason or "Windows account verification failed: interactive local logon is unavailable"
    return True, None


def _win_provision_user(
    payload: dict, command_id: str | None = None,
) -> tuple[str, str | None, str | None]:
    """Create or verify one local Windows standard user without changing macOS."""
    if not IS_WIN:
        return ("failed", None, "Windows user provisioning is not supported on this platform")
    username, validation_error = _provisioning_username(payload.get("employee_code"))
    if validation_error or username in WIN_PROVISION_PROTECTED_ACCOUNTS:
        return ("failed", None, "invalid or protected Windows employee username")
    supplied = str(payload.get("os_username") or "").strip().lower()
    if supplied and supplied != username:
        return ("failed", None, "Employee Code and Windows username do not match")
    if str(payload.get("account_type") or "standard").lower() != "standard":
        return ("failed", None, "employee account must be a Standard User")
    if not _win_is_admin():
        return ("requires_admin", None, "Windows user provisioning requires Administrator or SYSTEM context")
    if not _win_protected_account_is_admin():
        return ("failed", None, "protected Windows administrator miles-it-support is not an Administrator")

    code = str(payload.get("employee_code") or "").strip().upper()
    existing = _win_local_user_record(username)
    if existing is not None:
        description = str(existing.get("Description") or "")
        marker = re.search(r"(?i)\bMilesEmployeeCode=([A-Z0-9._-]+)\b", description)
        admin = _win_user_is_administrator(username)
        if marker and marker.group(1).upper() == code and existing.get("Enabled") is True and admin is False:
            # An existing account has no password in this process. Never
            # regenerate or retrieve the one-time credential merely to retry
            # User Push. Completion is safe only when the server proves this
            # exact command already has a credential that was made available
            # after a successful first-run verification.
            attestation = _post("/credentials/status", {"command_id": command_id})
            if (
                not isinstance(attestation, dict)
                or not attestation.get("success")
                or attestation.get("credential_status") != "available"
            ):
                return (
                    "failed", None,
                    "existing Windows account requires credential recovery; "
                    "no verified available credential is bound to this command",
                )
            prepared, reason = _win_prepare_employee_signin(username)
            if not prepared:
                return ("failed", None, reason or "Windows sign-in preparation failed")
            verified, reason = _win_verify_employee_signin(username, code, None)
            if not verified:
                return ("failed", None, reason or "Windows sign-in verification failed")
            return ("completed", f"User already provisioned: {username}", None)
        if admin is True:
            return ("failed", None, "existing Windows username is an Administrator; refusing conflict")
        return ("failed", None, "existing Windows username is not a compatible Miles employee account")
    if not command_id:
        return ("failed", None, "provisioning command id is missing")

    password = _mac_temporary_password()
    display_name = str(payload.get("display_name") or code).replace("\r", " ").replace("\n", " ").strip()[:200]
    safe_user = username.replace("'", "''")
    safe_display = display_name.replace("'", "''")
    script = (
        "$password=[Console]::In.ReadLine();"
        "$secure=ConvertTo-SecureString $password -AsPlainText -Force;"
        f"New-LocalUser -Name '{safe_user}' -Password $secure -FullName '{safe_display}' "
        f"-Description 'MilesEmployeeCode={code}' -AccountNeverExpires -PasswordNeverExpires:$false "
        "-ErrorAction Stop | Out-Null"
    )
    try:
        prepared = _post("/credentials/prepare", {
            "command_id": command_id, "employee_code": code,
            "os_username": username, "password": password,
        })
        if not isinstance(prepared, dict) or not prepared.get("success"):
            return ("failed", None, "secure credential preparation failed; no account was created")
        try:
            created = subprocess.run(
                ["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", script],
                input=password + "\n", stdout=subprocess.DEVNULL, stderr=subprocess.PIPE,
                text=True, timeout=60, creationflags=_NO_WINDOW,
            )
        except Exception as exc:
            _post("/credentials/revoke", {"command_id": command_id})
            return ("failed", None, f"Windows account creation failed: {type(exc).__name__}")
        if created.returncode != 0:
            _post("/credentials/revoke", {"command_id": command_id})
            return ("failed", None, "Windows account creation failed; diagnostics were withheld")
        signin_prepared, reason = _win_prepare_employee_signin(username)
        if not signin_prepared:
            _post("/credentials/revoke", {"command_id": command_id})
            return ("failed", None, reason or "Windows sign-in preparation failed")
        verified, reason = _win_verify_employee_signin(username, code, password)
        if not verified:
            _post("/credentials/revoke", {"command_id": command_id})
            return ("failed", None, reason or "Windows sign-in verification failed")
        confirmed = _post("/credentials/confirm", {"command_id": command_id})
        if not isinstance(confirmed, dict) or not confirmed.get("success"):
            _post("/credentials/revoke", {"command_id": command_id})
            return ("failed", None, "secure credential publication could not be confirmed")
        return ("completed", f"Provisioned standard Windows user {username}", None)
    finally:
        password = ""


def _linux_uid_threshold() -> int:
    try:
        value = int(os.environ.get("MILES_LINUX_NORMAL_UID_MIN", "1000"))
        return max(100, value)
    except ValueError:
        return 1000


def _linux_user_groups(user: str) -> set[str]:
    try:
        import grp
        groups = {
            entry.gr_name for entry in grp.getgrall()
            if user in entry.gr_mem
        }
        try:
            import pwd
            groups.add(grp.getgrgid(pwd.getpwnam(user).pw_gid).gr_name)
        except Exception:
            pass
        return groups
    except Exception:
        return set()


def _linux_user_marker(record: object) -> str | None:
    gecos = str(getattr(record, "pw_gecos", "") or "")
    match = re.search(r"(?i)\bMilesEmployeeCode=([A-Z0-9._-]+)\b", gecos)
    return match.group(1).upper() if match else None


def _linux_provision_user(
    payload: dict, command_id: str | None = None,
) -> tuple[str, str | None, str | None]:
    """Create or verify one normal Ubuntu/Linux user without touching macOS."""
    if not IS_LIN:
        return ("failed", None, "Linux user provisioning is not supported on this platform")
    username, validation_error = _provisioning_username(payload.get("employee_code"))
    if validation_error or username in LINUX_PROVISION_PROTECTED_ACCOUNTS:
        return ("failed", None, "invalid or protected Linux employee username")
    supplied = str(payload.get("os_username") or "").strip().lower()
    if supplied and supplied != username:
        return ("failed", None, "Employee Code and Linux username do not match")
    if str(payload.get("account_type") or "standard").lower() != "standard":
        return ("failed", None, "employee account must be a Standard User")
    if not _is_root():
        return ("requires_admin", None, "Linux user provisioning requires root/system-service context")
    try:
        import pwd
        existing = pwd.getpwnam(username)
    except KeyError:
        existing = None
    except Exception as exc:
        return ("failed", None, f"could not inspect Linux account: {type(exc).__name__}")

    def valid_existing(record: object) -> bool:
        try:
            home = str(record.pw_dir)
            stat = os.stat(home)
            groups = _linux_user_groups(username)
            return (
                int(record.pw_uid) >= _linux_uid_threshold()
                and home == f"/home/{username}"
                and stat.st_uid == int(record.pw_uid)
                and _linux_user_marker(record) == code
                and not groups.intersection({"sudo", "admin", "wheel"})
                and _linux_account_locked(username) is False
            )
        except Exception:
            return False

    code = str(payload.get("employee_code") or "").strip().upper()
    if existing is not None:
        if valid_existing(existing):
            return ("completed", f"User already provisioned: {username}", None)
        if username in LINUX_PROVISION_PROTECTED_ACCOUNTS or int(getattr(existing, "pw_uid", 0)) < _linux_uid_threshold():
            return ("failed", None, "existing Linux username is a protected/system account")
        return ("failed", None, "existing Linux username is not a compatible Miles employee account")
    if not command_id:
        return ("failed", None, "provisioning command id is missing")

    # The permanent support account must remain privileged when it exists.
    try:
        support = pwd.getpwnam("miles-it-support")
        if not _linux_user_groups("miles-it-support").intersection({"sudo", "admin", "wheel"}):
            return ("failed", None, "protected Linux administrator miles-it-support is not privileged")
        _ = support
    except KeyError:
        pass
    except Exception:
        return ("failed", None, "could not verify protected Linux administrator")

    password = _mac_temporary_password()
    display_name = str(payload.get("display_name") or code).replace(":", " ").replace("\n", " ").strip()[:200]
    gecos = f"MilesEmployeeCode={code}, {display_name}"
    try:
        prepared = _post("/credentials/prepare", {
            "command_id": command_id, "employee_code": code,
            "os_username": username, "password": password,
        })
        if not isinstance(prepared, dict) or not prepared.get("success"):
            return ("failed", None, "secure credential preparation failed; no account was created")
        created = subprocess.run(
            ["useradd", "--create-home", "--shell", "/bin/bash",
             "--comment", gecos, username],
            input=None, capture_output=True, text=True, timeout=30,
        )
        if created.returncode != 0:
            _post("/credentials/revoke", {"command_id": command_id})
            return ("failed", None, "Linux account creation failed; diagnostics were withheld")
        password_set = subprocess.run(
            ["chpasswd"], input=f"{username}:{password}\n",
            stdout=subprocess.DEVNULL, stderr=subprocess.PIPE,
            text=True, timeout=30,
        )
        if password_set.returncode != 0:
            _post("/credentials/revoke", {"command_id": command_id})
            return ("failed", None, "Linux account password setup failed; diagnostics were withheld")
        try:
            verified = pwd.getpwnam(username)
        except Exception:
            _post("/credentials/revoke", {"command_id": command_id})
            return ("failed", None, "Linux account could not be verified after creation")
        if not valid_existing(verified):
            _post("/credentials/revoke", {"command_id": command_id})
            return ("failed", None, "Linux account verification failed: account is not a standard managed user")
        confirmed = _post("/credentials/confirm", {"command_id": command_id})
        if not isinstance(confirmed, dict) or not confirmed.get("success"):
            _post("/credentials/revoke", {"command_id": command_id})
            return ("failed", None, "secure credential publication could not be confirmed")
        return ("completed", f"Provisioned standard Linux user {username}", None)
    finally:
        password = ""


def _mac_provision_user(
    payload: dict, command_id: str | None = None,
) -> tuple[str, str | None, str | None]:
    """Validate and create one standard user with complete Directory Services fields.

    macOS versions tested here do not document ``-password -`` as stdin input.
    The supported sysadminctl form therefore receives the password as a direct
    argument for the shortest possible subprocess lifetime. No shell is used,
    so it cannot enter shell history; stdout/stderr and command results remain
    sanitized and the credential is never sent in the device command.
    """
    if not IS_MAC:
        return ("failed", None, "provision_user is macOS only; no account was changed")

    raw_code = str(payload.get("employee_code") or "").strip()
    username = raw_code.lower()
    if (
        not raw_code
        or len(raw_code) > 32
        or not raw_code[0].isalpha()
        or any(ch not in "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._-" for ch in raw_code)
        or not username
        or username in MAC_PROTECTED_ACCOUNTS
    ):
        return ("failed", None, "invalid or protected macOS employee username")

    supplied_username = str(payload.get("os_username") or "").strip().lower()
    if supplied_username and supplied_username != username:
        return ("failed", None, "Employee Code and macOS username do not match")
    if str(payload.get("account_type") or "standard").lower() != "standard":
        return ("failed", None, "employee account must be a Standard User")
    if username == "miles-it-support":
        return ("failed", None, "protected account miles-it-support cannot be modified")
    if not _is_root():
        return (
            "requires_admin", None,
            "macOS user provisioning requires the agent to run as root",
        )

    # Check compatibility without changing an existing account. A local user
    # lacking our marker is a conflict, not permission to take ownership.
    partial_marked = False
    try:
        import pwd
        existing = pwd.getpwnam(username)
    except KeyError:
        existing = None
    except Exception as exc:
        return ("failed", None, f"could not inspect macOS account: {type(exc).__name__}")

    marker = _mac_employee_marker(username)
    complete, _ = _mac_dscl_record(username)
    if marker == raw_code.upper() and not complete:
        partial_marked = True
    elif existing is not None:
        if username in MAC_PROTECTED_ACCOUNTS:
            return ("failed", None, "protected macOS account cannot be modified")
        admin_check = _mac_is_admin(username)
        if admin_check is None:
            return ("failed", None, "could not verify existing account role safely")
        if admin_check:
            return ("failed", None, "existing username is an administrator; refusing conflict")
        if marker != raw_code.upper() or not complete:
            return ("failed", None, "existing username is not a compatible Miles employee account")
        return ("completed", f"standard employee account {username} already exists", None)

    if partial_marked:
        if not _mac_cleanup_marked_partial(username):
            return (
                "failed", None,
                "matching partial Miles account found but its Directory Services record could not be safely removed",
            )
        try:
            import pwd
            existing = pwd.getpwnam(username)
        except KeyError:
            existing = None
        except Exception:
            return ("failed", None, "could not verify existing account role safely")
        if existing is not None:
            return ("failed", None, "matching partial Miles account cleanup did not remove the account record")

    if not command_id:
        return ("failed", None, "provisioning command id is missing")

    password = _mac_temporary_password()
    try:
        prepared = _post("/credentials/prepare", {
            "command_id": command_id,
            "employee_code": raw_code.upper(),
            "os_username": username,
            "password": password,
        })
        if not isinstance(prepared, dict) or not prepared.get("success"):
            return ("failed", None, "secure credential preparation failed; no account was created")

        display_name = str(payload.get("display_name") or raw_code).strip()[:200]
        created = subprocess.run(
            [
                "sysadminctl", "-addUser", username,
                "-fullName", display_name,
                "-password", password,
            ],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
            text=True,
            timeout=60,
            creationflags=_NO_WINDOW,
        )
        if created.returncode != 0:
            _post("/credentials/revoke", {"command_id": command_id})
            return (
                "failed", None,
                f"sysadminctl account creation failed: {_mac_safe_creation_reason(created.stderr, password)}",
            )

        marker = subprocess.run(
            ["dscl", ".", "-create", f"/Users/{username}",
             "milesEmployeeCode", raw_code.upper()],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            timeout=15, creationflags=_NO_WINDOW,
        )
        if marker.returncode != 0:
            _post("/credentials/revoke", {"command_id": command_id})
            return ("failed", None, "macOS employee identity marker could not be recorded")

        try:
            import pwd
            pwd.getpwnam(username)
        except Exception:
            _post("/credentials/revoke", {"command_id": command_id})
            return ("failed", None, "macOS account creation could not be verified: passwd record is incomplete")

        complete, _ = _mac_dscl_record(username)
        if not complete:
            _post("/credentials/revoke", {"command_id": command_id})
            return ("failed", None, "macOS account creation could not be verified: Directory Services record is incomplete")
        if _mac_employee_marker(username) != raw_code.upper():
            _post("/credentials/revoke", {"command_id": command_id})
            return ("failed", None, "macOS employee identity marker could not be verified")

        admin_check = _mac_is_admin(username)
        if admin_check is None:
            _post("/credentials/revoke", {"command_id": command_id})
            return ("failed", None, "macOS account role could not be verified safely")
        if admin_check:
            _post("/credentials/revoke", {"command_id": command_id})
            return ("failed", None, "created employee account unexpectedly has admin privileges")

        confirmed = _post("/credentials/confirm", {"command_id": command_id})
        if not isinstance(confirmed, dict) or not confirmed.get("success"):
            _post("/credentials/revoke", {"command_id": command_id})
            return ("failed", None, "secure credential publication could not be confirmed")
        wallpaper_status, _wallpaper_error = apply_active_wallpaper_for_user(username)
        warning = (
            " User provisioned successfully; wallpaper will retry on next policy sync."
            if wallpaper_status != "applied" else ""
        )
        return ("completed", f"Provisioned standard macOS user {username}.{warning}", None)
    finally:
        # Remove the local reference as soon as the command path is complete.
        password = ""


def _mac_reset_user_password(
    payload: dict, command_id: str | None = None,
) -> tuple[str, str | None, str | None]:
    """Reset only the mapped standard employee account on macOS."""
    if not IS_MAC:
        return ("failed", None, "reset_user_password is macOS only")
    raw_code = str(payload.get("employee_code") or "").strip()
    username = raw_code.lower()
    supplied = str(payload.get("os_username") or "").strip().lower()
    if not raw_code or supplied != username or username in MAC_PROTECTED_ACCOUNTS:
        return ("failed", None, "employee identity does not match a permitted managed account")
    if not command_id:
        return ("failed", None, "password reset command id is missing")
    if not _is_root():
        return ("requires_admin", None, "macOS password reset requires the agent to run as root")

    try:
        import pwd
        before = pwd.getpwnam(username)
    except KeyError:
        return ("failed", None, "managed employee macOS account does not exist")
    except Exception as exc:
        return ("failed", None, f"could not inspect macOS account: {type(exc).__name__}")

    if _mac_employee_marker(username) != raw_code.upper():
        return ("failed", None, "macOS employee identity marker does not match")
    complete, _ = _mac_dscl_record(username)
    if not complete:
        return ("failed", None, "macOS employee account is incomplete")
    admin_check = _mac_is_admin(username)
    if admin_check is None:
        return ("failed", None, "could not verify existing account role safely")
    if admin_check:
        return ("failed", None, "managed employee account unexpectedly has admin privileges")

    credential = _post("/credentials/reveal-reset", {"command_id": command_id})
    password = credential.get("password") if isinstance(credential, dict) else None
    if not isinstance(password, str) or len(password) < 20:
        return ("failed", None, "secure reset credential unavailable")
    try:
        result = subprocess.run(
            ["sysadminctl", "-resetPasswordFor", username, "-newPassword", password],
            stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True,
            timeout=60, creationflags=_NO_WINDOW,
        )
        if result.returncode != 0:
            return (
                "failed", None,
                f"macOS password reset failed: {_mac_safe_creation_reason(result.stderr, password)}",
            )
        after = pwd.getpwnam(username)
        if (before.pw_uid, before.pw_gid, before.pw_dir) != (
            after.pw_uid, after.pw_gid, after.pw_dir
        ):
            return ("failed", None, "password reset changed protected account identity fields")
        if _mac_employee_marker(username) != raw_code.upper():
            return ("failed", None, "password reset changed the employee identity marker")
        if _mac_is_admin(username) is not False:
            return ("failed", None, "password reset changed or obscured the employee role")
        confirmed = _post("/credentials/confirm-reset", {"command_id": command_id})
        if not isinstance(confirmed, dict) or not confirmed.get("success"):
            return ("failed", None, "password reset completed but secure credential publication failed")
        return ("completed", f"Password reset successfully for macOS user {username}", None)
    finally:
        password = ""


def _mac_gui_argv(argv: list[str]) -> list[str]:
    """Wrap argv so it executes inside the console user's Aqua GUI session when the
    agent runs as root (a LaunchDaemon). NSWorkspace / osascript / killall must run
    in the user's session, not the bare root daemon context, or they no-op. When the
    agent is not root (legacy per-user LaunchAgent) the argv runs unchanged."""
    if IS_MAC and _is_root():
        user = _MAC_WALLPAPER_TARGET_USER or _mac_console_user()
        uid = _mac_uid_for(user) if _MAC_WALLPAPER_TARGET_USER else _mac_console_uid()
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


def _linux_user_sessions() -> list[dict[str, str]] | None:
    """Return login sessions, with logind's authoritative class/type metadata.

    `list-sessions` includes the per-user manager session (CLASS=manager) as
    well as the actual desktop session.  Never treat the manager as an
    interactive session and never infer a graphical session from DISPLAY/X11.
    """
    sessions: list[dict[str, str]] = []
    try:
        listed = subprocess.run(["loginctl", "list-sessions", "--no-legend"],
                                capture_output=True, text=True, timeout=10)
        if listed.returncode != 0:
            return None
        for line in listed.stdout.splitlines():
            parts = line.split()
            if not parts:
                continue
            sid = parts[0]
            details = subprocess.run(
                 ["loginctl", "show-session", sid, "-p", "User", "-p", "Name",
                  "-p", "Class", "-p", "Type", "-p", "Seat", "-p", "Active"],
                capture_output=True, text=True, timeout=10,
            )
            if details.returncode != 0:
                continue
            values: dict[str, str] = {}
            for item in details.stdout.splitlines():
                key, sep, value = item.partition("=")
                if sep:
                    values[key] = value
            uid_text = values.get("User", "")
            username = values.get("Name", "")
            if not uid_text.isdigit() or int(uid_text) < 1000 or not username:
                continue
            sessions.append({
                "id": sid,
                "uid": uid_text,
                "user": username,
                "class": values.get("Class", ""),
                "type": values.get("Type", ""),
                "seat": values.get("Seat", ""),
                "active": values.get("Active", ""),
            })
    except Exception:
        return None
    return sessions


def _linux_console_user() -> str | None:
    """Return the human user owning the graphical console session.

    SSH/TTY sessions are CLASS=user on some Ubuntu/logind combinations, but they
    have no seat. Prefer an active graphical seat so a root service never locks
    an SSH operator instead of the person using the laptop.
    """
    sessions = _linux_user_sessions()
    if sessions is not None:
        candidates = [
            s for s in sessions
            if s["class"] == "user" and s["seat"]
            and s["type"].lower() in ("x11", "wayland", "mir")
        ]
        if not candidates:
            candidates = [
                s for s in sessions
                if s["class"] == "user" and s["seat"] and s["type"]
            ]
        if candidates:
            active = [s for s in candidates if s.get("active", "").lower() == "yes"]
            return (active or candidates)[0]["user"]
        return None
    # Only use legacy fallbacks when logind is unavailable, not when it
    # successfully reports sessions. This avoids selecting gdm/system users.
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


def _linux_is_graphical_session(session: dict[str, str]) -> bool:
    return (
        session.get("class") == "user"
        and bool(session.get("seat"))
        and bool(session.get("type"))
        and session.get("type", "").lower() in ("x11", "wayland", "mir")
    )


def _linux_user_has_session(user: str) -> bool:
    """True if `user` still owns the graphical laptop session."""
    sessions = _linux_user_sessions()
    return sessions is None or any(
        s["user"] == user and _linux_is_graphical_session(s) for s in sessions
    )


def _linux_terminate_user_sessions(user: str) -> bool:
    """Terminate only the user's interactive CLASS=user sessions.

    A desktop session can survive a normal terminate request when a display
    manager or a stubborn child process immediately keeps it alive. Escalate
    against the specific session IDs with SIGKILL, never ``kill-user``: the
    latter can also destroy the user's CLASS=manager service session.
    """
    sessions = _linux_user_sessions()
    if sessions is None:
        return False
    targets = [
        s for s in sessions
        if s["user"] == user and _linux_is_graphical_session(s)
    ]
    for session in targets:
        subprocess.run(
            ["loginctl", "terminate-session", session["id"]],
            capture_output=True, text=True, timeout=15,
        )

    for _ in range(3):
        if not _linux_user_has_session(user):
            return True
        remaining = _linux_user_sessions() or []
        for session in remaining:
            if session["user"] == user and _linux_is_graphical_session(session):
                subprocess.run(
                    ["loginctl", "kill-session", session["id"],
                     "--kill-who=all", "--signal=SIGKILL"],
                    capture_output=True, text=True, timeout=15,
                )
        time.sleep(0.5)
    return not _linux_user_has_session(user)


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


def _linux_lock_account(user: str) -> tuple[bool, str]:
    """Lock an account and require a positive `passwd -S` verification."""
    detail = "usermod --lock"
    try:
        r = subprocess.run(["usermod", "--lock", user], capture_output=True, text=True, timeout=15)
        if r.returncode != 0:
            detail = "passwd -l"
            r = subprocess.run(["passwd", "-l", user], capture_output=True, text=True, timeout=15)
        if r.returncode != 0:
            return (False, (r.stderr or r.stdout or "account lock command failed").strip())
    except Exception as exc:
        return (False, str(exc))
    return (_linux_account_locked(user) is True, detail)


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


def _apply_hard_lock(payload: dict | None = None) -> tuple[str, str | None, str | None]:
    """Lock the device at the OS level. Returns (status, result, error) where
    status is 'completed' (truly locked), 'failed', or 'requires_admin'.
    On Linux the locked username is persisted so unlock can target it later.
    `payload` (the queued command's payload) may carry the Asset ID + message so
    the branded lock screen / login banner can show them, even offline."""
    payload = payload or {}
    _prev = _read_lock_state()
    asset_tag = str(payload.get("asset_tag") or _prev.get("asset_tag") or "").strip()
    lock_msg = (str(payload.get("message") or _prev.get("lock_message") or LOCK_SCREEN_DEFAULT).strip()
                or LOCK_SCREEN_DEFAULT)
    try:
        if IS_WIN:
            # A durable Windows lock means BLOCKING SIGN-IN by disabling the
            # end-user account — only then does the lock survive a reboot and a
            # password attempt. A bare workstation lock is dismissed the instant
            # the user types their password, so it is NOT, on its own, enforcement.
            # Mirror the macOS/Linux contract: if we cannot disable a sign-in
            # account we report 'requires_admin', change NOTHING, and never write a
            # 'locked' state the server can't confirm (so reconcile won't fight us).
            admin = _win_is_admin()
            _win_log(f"Windows lock execution privilege admin={admin}")
            disabled = _win_disable_lock_accounts() if admin else []
            _win_log(f"Windows lock accounts changed={disabled}")
            if not disabled:
                if not admin:
                    msg = ("Cannot enforce the lock: blocking Windows sign-in requires the "
                           "agent to run with administrator rights, but it is running as a "
                           "normal user. Reinstall the agent as an administrator / system "
                           "service, then retry the lock.")
                else:
                    msg = ("Cannot enforce the lock: no active interactive Windows account "
                           "could be identified and disabled. "
                           + (_win_last_lock_error + " " if _win_last_lock_error else "")
                           + "The agent will not guess an account or disable SYSTEM/service "
                           "accounts. Sign in to the employee account, ensure the agent is "
                           "installed as the SYSTEM task, then retry the lock.")
                return ("requires_admin", None, msg)
            # At least one sign-in account was disabled → real enforcement.
            state = {"locked": True, "platform": "windows", "asset_tag": asset_tag,
                     "lock_message": lock_msg, "legalnotice_set": True,
                     "disabled_users": disabled}
            if _prev.get("screen_pid"):
                state["screen_pid"] = _prev["screen_pid"]
            _win_set_legalnotice(WIN_LOCK_CAPTION, lock_msg)
            _write_lock_state(state)
            _win_log(f"Windows lock state persisted disabled_users={disabled}")
            ok, _err = _win_lock_now()
            _spawn_lock_screen()
            # Drop the just-disabled user(s) to the sign-in screen so the lock takes
            # effect now, not only after the next reboot. Their account is disabled,
            # so the login attempt is rejected and the legal-notice banner shows.
            if not _win_force_logoff(disabled):
                # Account disabling is persistent, but the live desktop would
                # remain usable if logoff failed. Roll back rather than report
                # a false success; the portal will show the IT-admin recovery
                # message and the command can be retried safely.
                _win_enable_lock_accounts(disabled)
                _win_clear_legalnotice()
                _write_lock_state({"locked": False, "platform": "windows",
                                   "asset_tag": asset_tag})
                return (
                    "failed",
                    None,
                    "Windows account sign-in was disabled, but the active session "
                    "could not be logged off and the desktop may still be usable. "
                    "The temporary lock was rolled back. Please contact the IT "
                    "administrator or retry from a SYSTEM agent.",
                )
            ws = "workstation locked" if ok else "workstation lock call failed (sign-in already blocked)"
            return ("completed",
                    f"Sign-in disabled for {','.join(disabled)}; {ws}; active session signed "
                    f"out; branded notice shown|USERS={','.join(disabled)}", None)

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
            # 1) Show the login-window banner (verified by read-back). Build a
            # branded banner that carries the Asset ID so the locked-out user sees
            # exactly which device and who to contact.
            _banner = f"{LOCK_SCREEN_TITLE}\n{lock_msg}"
            if asset_tag:
                _banner += f"\nAsset ID: {asset_tag}"
            _banner += f"\nContact the IT Asset Management Team to restore access. — {LOCK_SCREEN_BRAND}"
            banner_ok = _mac_set_login_message(_banner)
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
            _write_lock_state({"locked": True, "platform": "macos", "user": user,
                               "asset_tag": asset_tag, "lock_message": lock_msg})
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
            # 1) Password-lock the account so the user cannot log back in. A
            # missing/ambiguous passwd status is a failure, not a success.
            locked_ok, lock_detail = _linux_lock_account(user)
            if not locked_ok:
                locked_state = _linux_account_locked(user)
                return ("failed", None,
                        f"Failed to positively verify the lock for account '{user}' "
                        f"({lock_detail}; status={locked_state}). The device was NOT locked.")
            # 2) Terminate only the employee's interactive CLASS=user sessions.
            # The per-user CLASS=manager session is intentionally left alone.
            if not _linux_terminate_user_sessions(user):
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
            _write_lock_state({"locked": True, "platform": "linux", "user": user,
                               "asset_tag": asset_tag, "lock_message": lock_msg})
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
        # Windows: tear down the branded kiosk, then truthfully reverse every
        # privileged side-effect. A lock that disabled sign-in accounts / set the
        # legal-notice banner can ONLY be undone with admin rights, so report
        # honestly instead of clearing the server's is_locked while the device is
        # still effectively locked.
        _prev = _read_lock_state()
        _kill_lock_screen()
        disabled = _prev.get("disabled_users") or []
        notice_set = bool(_prev.get("legalnotice_set"))
        if disabled or notice_set:
            if not _win_is_admin():
                return ("requires_admin", None,
                        "Cannot unlock: this device was locked at the administrator level "
                        "(sign-in accounts were disabled), but the agent is not running with "
                        "admin rights now, so it cannot re-enable them. Run/reinstall the "
                        "agent as an administrator, then retry the unlock.")
            notice_ok = (not notice_set) or _win_clear_legalnotice()
            failed_users = _win_enable_lock_accounts(disabled) if disabled else []
            if failed_users or not notice_ok:
                problems = []
                if failed_users:
                    problems.append(f"these accounts are still disabled: {','.join(failed_users)}")
                if not notice_ok:
                    problems.append("the sign-in banner could not be cleared")
                return ("failed", None,
                        "Could not fully restore access — " + "; ".join(problems) +
                        ". Retry the unlock with administrator rights.")
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
            # Keep the standard accounts disabled and the branded kiosk on screen
            # in case either was tampered with since the last cycle.
            if _win_is_admin():
                # Re-apply the exact accounts changed by the confirmed lock.
                # Do not discover a different account at the sign-in screen.
                _win_disable_lock_accounts(_read_lock_state().get("disabled_users") or None)
            if not _lock_screen_running():
                _spawn_lock_screen()
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
        _post("/sync", {"payload": collect_system_info(False)})
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
            return _apply_hard_lock(cmd.get("payload") or {})
    if ctype == "unlock":
        with _lock_mutex:
            return _release_lock()
    if ctype == "provision_user":
        payload = cmd.get("payload") or {}
        command_id = str(cmd.get("id") or "")
        if IS_MAC:
            return _mac_provision_user(payload, command_id)
        if IS_WIN:
            return _win_provision_user(payload, command_id)
        if IS_LIN:
            return _linux_provision_user(payload, command_id)
        return ("failed", None, f"unsupported platform: {sys.platform}")
    if ctype == "reset_user_password":
        return _mac_reset_user_password(cmd.get("payload") or {}, str(cmd.get("id") or ""))
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
    if not isinstance(resp, dict) or resp.get("success") or resp.get("retryable"):
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





def poll_commands() -> tuple[bool, int]:
    """Poll + execute queued commands. Returns (revoked, processed):
      - `revoked`   True if the portal has revoked our token (so the caller can
                    tear the agent down and exit).
      - `processed` number of commands executed this poll — drives adaptive
                    polling, since any command means we should keep the fast
                    cadence so follow-up actions still apply within seconds."""
    global _command_poll_degraded, _command_retry_delay
    _flush_command_status_outbox()
    resp = _get("/commands")
    if not resp.get("success"):
        _win_log(f"command poll failed: {resp.get('error', 'unknown error')}")
        if _looks_revoked(resp):
            _win_log("agent token rejected: explicit revocation response")
        if resp.get("retryable"):
            if not _command_poll_degraded:
                _win_log("temporary communication failure; agent remains installed")
            _command_poll_degraded = True
            _command_retry_delay = min(
                COMMAND_RETRY_BACKOFF_MAX_SEC,
                max(COMMAND_RETRY_BACKOFF_MIN_SEC, _command_retry_delay * 2 or COMMAND_RETRY_BACKOFF_MIN_SEC),
            )
            _win_log(f"retry scheduled in {_command_retry_delay}s")
        return _looks_revoked(resp), 0
    if _command_poll_degraded:
        _win_log("command poll recovered")
    _win_log("agent token accepted; command poll response received")
    _command_poll_degraded = False
    _command_retry_delay = 0
    processed = 0
    commands = resp.get("commands", [])
    _win_log(f"commands fetched: {len(commands)}")
    for cmd in commands:
        command_id = str(cmd.get("id", "unknown"))
        command_type = str(cmd.get("type", "unknown"))
        _win_log(f"command fetched id={command_id} type={command_type}")
        _win_log(f"command claim result=claimed id={command_id}")
        try:
            _win_log(f"command execution started id={command_id} type={command_type}")
            status, result, err = execute_command(cmd)
        except Exception as exc:
            status, result, err = ("failed", None, f"{type(exc).__name__}: {exc}")
            _win_log(f"command execution exception id={command_id}: {err}")
        _win_log(
            f"command execution finished id={command_id} status={status}"
            + (f" error={err}" if err else "")
        )
        _post_command_status({
            "id":     cmd["id"],
            "status": status,
            "result": result,
            "error":  err,
        })
        _win_log(f"command status queued id={command_id} status={status}")
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
    print(json.dumps(_post("/register", {
        "payload": collect_system_info(include_location_request=True)
    }), indent=2))
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
            # Machine-wide mutex: SYSTEM and legacy interactive instances cannot
            # consume the same command concurrently.
            h = ctypes.windll.kernel32.CreateMutexW(None, False, "Global\\MilesAgentSingleton")
            if ctypes.windll.kernel32.GetLastError() == ERROR_ALREADY_EXISTS:
                return False
            _SINGLETON_HANDLE = h
            return True
        except Exception:
            return False  # fail closed rather than allow duplicate command consumers
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
    _enable_runtime_log()
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
                sync = _post("/sync", {
                    "payload": collect_system_info(include_location_request=True)
                })
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
            if processed > 0:
                print(f"[{datetime.now(timezone.utc).isoformat()}] processed "
                      f"{processed} command(s)")
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
        normal_sleep = active_sec if active else idle_sec
        time.sleep(max(normal_sleep, _command_retry_delay))


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
    print("ERROR: managed macOS installation requires sudo so the agent can run as a "
          "root LaunchDaemon. The legacy user LaunchAgent was not changed.",
          file=sys.stderr)
    return 2


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

    # Retire the legacy user LaunchAgent only after the root daemon loaded.
    _remove_legacy_mac_user_agent()
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
    os.makedirs(LIN_SYS_INSTALL_DIR, exist_ok=True)

    prog_args, dst = _service_program_args(LIN_SYS_INSTALL_DIR)
    exec_start = " ".join(shlex.quote(a) for a in prog_args)

    env_dir = os.path.dirname(LIN_SYS_ENV_FILE)
    os.makedirs(env_dir, exist_ok=True)
    env_tmp = LIN_SYS_ENV_FILE + ".tmp"
    with open(env_tmp, "w", encoding="utf-8") as fh:
        fh.write(f"MILES_AGENT_TOKEN={TOKEN}\n")
        fh.write(f"MILES_AGENT_API_BASE={API_BASE}\n")
        fh.write(f"MILES_AGENT_SYNC_INTERVAL={SYNC_INTERVAL_SEC}\n")
    os.chmod(env_tmp, 0o600)
    os.replace(env_tmp, LIN_SYS_ENV_FILE)
    try:
        os.chown(LIN_SYS_ENV_FILE, 0, 0)
    except OSError:
        pass

    unit = f"""[Unit]
Description=Miles IT Assets Device Agent (system)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart={exec_start}
Restart=always
RestartSec=15
EnvironmentFile={LIN_SYS_ENV_FILE}

[Install]
WantedBy=multi-user.target
"""
    with open(LIN_SYS_UNIT_PATH, "w") as fh:
        fh.write(unit)
    os.chmod(LIN_SYS_UNIT_PATH, 0o644)

    for args in (
        ["systemctl", "daemon-reload"],
        ["systemctl", "enable", LIN_UNIT_NAME],
        ["systemctl", "restart", LIN_UNIT_NAME],
    ):
        r = subprocess.run(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        if r.returncode != 0:
            print(f"ERROR: {' '.join(args)} failed:", r.stderr.decode(errors="ignore"), file=sys.stderr)
            return 1

    # Retire the legacy user service only after the root system service is
    # installed and restarted successfully.
    _remove_legacy_user_service()
    print(f"✓ Service '{LIN_UNIT_NAME}' installed and started (system service, root).")
    print(f"  Binary:   {dst}")
    print(f"  Unit:     {LIN_SYS_UNIT_PATH}")
    print(f"  Status:   systemctl status {LIN_UNIT_NAME}")
    print(f"  Logs:     journalctl -u {LIN_UNIT_NAME} -f")
    print(f"  Sync every: {SYNC_INTERVAL_SEC} seconds")
    print("  Hard lock: ENABLED (running as root).")
    return 0


def install_service_linux() -> int:
    """Install the managed agent as a root systemd service."""
    if not TOKEN:
        print("ERROR: MILES_AGENT_TOKEN must be set so the background service can authenticate.",
              file=sys.stderr)
        return 2

    if _is_root():
        return _install_service_linux_system()

    print("ERROR: managed Linux installation requires sudo so the agent can run as a "
          "root systemd service. The legacy user service was not changed.", file=sys.stderr)
    return 2


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


# ── Windows auto-start ───────────────────────────────────────────────────────
# Two install modes:
#   • ADMIN (preferred): a SYSTEM scheduled task started at boot. The agent runs
#     as LocalSystem, so it CAN disable sign-in accounts / set the HKLM login
#     banner — i.e. it can actually enforce a device lock that survives reboot and
#     a password attempt. install.ps1 auto-elevates to reach this path.
#   • NON-ADMIN (fallback): a hidden Startup-folder VBS launcher that starts the
#     agent as the logged-in user. Inventory/sync work, but lock ENFORCEMENT does
#     not (a normal user cannot block Windows sign-in) — lock reports requires_admin.
WIN_TASK_NAME   = "MilesAgent"
WIN_SYS_DIR     = os.path.expandvars(r"%ProgramData%\MilesAgent") if IS_WIN else ""
WIN_INSTALL_DIR = os.path.expandvars(r"%LOCALAPPDATA%\MilesAgent") if IS_WIN else ""
WIN_STARTUP_DIR = (os.path.expandvars(r"%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup")
                   if IS_WIN else "")
WIN_VBS_PATH    = os.path.join(WIN_STARTUP_DIR, "MilesAgent.vbs") if IS_WIN else ""
WIN_RUN_CMD     = os.path.join(WIN_INSTALL_DIR, "run.cmd") if IS_WIN else ""


def _win_remove_peruser_launchers() -> None:
    """Remove any old per-user Startup-folder launchers across every profile so a
    leftover non-admin agent doesn't run alongside the new SYSTEM task. Best-effort."""
    try:
        users_root = os.path.expandvars(r"%SystemDrive%\Users")
        rel = r"AppData\Roaming\Microsoft\Windows\Start Menu\Programs\Startup\MilesAgent.vbs"
        for prof in os.listdir(users_root):
            vbs = os.path.join(users_root, prof, rel)
            if os.path.exists(vbs):
                try:
                    os.remove(vbs)
                except Exception:
                    pass
    except Exception:
        pass


def _win_stop_other_agents() -> None:
    """Stop any OTHER running agent processes (e.g. a leftover per-user `run` agent
    from a prior non-admin install) so they can't keep polling commands with the
    same token and grab a lock command in a context that can't enforce it. Never
    kills the current process. Best-effort and silent."""
    try:
        me = os.getpid()
        ps = (
            f"$me={me}; "
            "Get-CimInstance Win32_Process | Where-Object { "
            "$_.ProcessId -ne $me -and $_.CommandLine -and ("
            "($_.CommandLine -match 'laptop_agent\\.py' -and $_.CommandLine -match '\\brun\\b') "
            "-or ($_.Name -ieq 'miles-agent.exe' -and $_.CommandLine -match '\\brun\\b')"
            ") } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"
        )
        subprocess.run(["powershell", "-NoProfile", "-Command", ps],
                       capture_output=True, text=True, timeout=30, creationflags=_NO_WINDOW)
    except Exception:
        pass


def _install_service_windows_system() -> int:
    """Admin path: install the agent as a SYSTEM scheduled task that starts at boot.
    Files live under %ProgramData%\\MilesAgent (readable by LocalSystem)."""
    os.makedirs(WIN_SYS_DIR, exist_ok=True)
    # Do not rely only on the environment inherited by Task Scheduler. A
    # machine-scope environment change can be stale in an already-running
    # SYSTEM task. Persist the current enrollment key and restrict the file to
    # SYSTEM and local Administrators; _load_token prefers this file on Windows.
    try:
        with open(WIN_SYS_TOKEN_FILE, "w", encoding="utf-8") as fh:
            fh.write(TOKEN + "\n")
        subprocess.run(
            ["icacls", WIN_SYS_TOKEN_FILE, "/inheritance:r",
             "/grant:r", "*S-1-5-18:F", "*S-1-5-32-544:F"],
            capture_output=True, text=True, timeout=20, creationflags=_NO_WINDOW,
        )
    except Exception as e:
        print(f"ERROR: could not persist the SYSTEM enrollment key: {e}", file=sys.stderr)
        return 1

    if getattr(sys, "frozen", False):
        exe = os.path.abspath(sys.argv[0])
        dst = os.path.join(WIN_SYS_DIR, "miles-agent.exe")
        if os.path.abspath(exe) != os.path.abspath(dst):
            shutil.copy2(exe, dst)
        tr = f'"{dst}" run'
    else:
        src = os.path.abspath(sys.argv[0])
        dst = os.path.join(WIN_SYS_DIR, "laptop_agent.py")
        if os.path.abspath(src) != os.path.abspath(dst):
            shutil.copy2(src, dst)
        py_dir = os.path.dirname(os.path.abspath(sys.executable))
        pythonw = os.path.join(py_dir, "pythonw.exe")
        if not os.path.exists(pythonw):
            pythonw = os.path.abspath(sys.executable)
        tr = f'"{pythonw}" "{dst}" run'

    # Create (or replace) the SYSTEM task. /RU SYSTEM needs no password; /RL HIGHEST
    # gives it the rights to disable accounts; /SC ONSTART runs it at every boot so
    # the lock is re-asserted before anyone can sign in.
    r = subprocess.run(["schtasks", "/Create", "/TN", WIN_TASK_NAME, "/TR", tr,
                        "/SC", "ONSTART", "/RU", "SYSTEM", "/RL", "HIGHEST", "/F"],
                       capture_output=True, text=True, timeout=30, creationflags=_NO_WINDOW)
    if r.returncode != 0:
        print("ERROR: could not create the SYSTEM scheduled task: "
              + (r.stderr or r.stdout or "unknown error").strip(), file=sys.stderr)
        return 1

    # Start and verify the SYSTEM task before retiring legacy user launchers.
    try:
        subprocess.run(["schtasks", "/Run", "/TN", WIN_TASK_NAME], capture_output=True,
                       text=True, timeout=30, creationflags=_NO_WINDOW)
    except Exception:
        pass
    try:
        q = subprocess.run(["schtasks", "/Query", "/TN", WIN_TASK_NAME, "/V", "/FO", "LIST"],
                           capture_output=True, text=True, timeout=20, creationflags=_NO_WINDOW)
        if q.returncode != 0 or "SYSTEM" not in (q.stdout or "").upper():
            print("ERROR: SYSTEM task could not be verified; legacy launcher was kept.",
                  file=sys.stderr)
            return 1
    except Exception as e:
        print(f"ERROR: SYSTEM task verification failed; legacy launcher was kept: {e}",
              file=sys.stderr)
        return 1
    # The global mutex prevents a race if an old process is still exiting.
    _win_remove_peruser_launchers()
    _win_stop_other_agents()
    print("\u2713 Service installed as a SYSTEM task — runs at boot with the rights "
          "needed to enforce device lock.")
    print(f"  Agent: {dst}")
    print(f"  Task:  {WIN_TASK_NAME} (SYSTEM, ONSTART)")
    # Verify the task is actually registered to run as SYSTEM (surfaced in install.log).
    try:
        q = subprocess.run(["schtasks", "/Query", "/TN", WIN_TASK_NAME, "/V", "/FO", "LIST"],
                           capture_output=True, text=True, timeout=20, creationflags=_NO_WINDOW)
        if "SYSTEM" in (q.stdout or "").upper():
            print("  Verified: task is registered to run as SYSTEM.")
        else:
            print("  WARNING: could not verify SYSTEM run-as; check Task Scheduler > MilesAgent.",
                  file=sys.stderr)
    except Exception:
        pass
    return 0


def install_service_windows() -> int:
    if not TOKEN:
        print("ERROR: MILES_AGENT_TOKEN must be set so the background service can authenticate.",
              file=sys.stderr)
        return 2

    # Preferred: SYSTEM task (real lock enforcement). Requires admin — install.ps1
    # auto-elevates so this is the normal path.
    if _win_is_admin():
        return _install_service_windows_system()

    # Managed installs must not fall back to a login-scoped Startup launcher.
    # Keep legacy artifacts intact so an administrator can migrate them safely.
    print("ERROR: managed Windows installation requires administrator rights so the "
          "agent can run as the SYSTEM boot task. The legacy Startup launcher was "
          "not changed.", file=sys.stderr)
    return 2

    print("warning: installing WITHOUT administrator rights — inventory/sync will "
          "work, but DEVICE LOCK CANNOT BE ENFORCED (a normal user cannot block "
          "Windows sign-in). Re-run the installer as administrator to enable locking.",
          file=sys.stderr)

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
    # Remove the SYSTEM task (admin) if present.
    try:
        subprocess.run(["schtasks", "/Delete", "/TN", WIN_TASK_NAME, "/F"],
                       capture_output=True, text=True, timeout=30, creationflags=_NO_WINDOW)
    except Exception:
        pass
    # Remove any per-user Startup launchers across profiles.
    _win_remove_peruser_launchers()
    try:
        if WIN_VBS_PATH and os.path.exists(WIN_VBS_PATH):
            os.remove(WIN_VBS_PATH)
    except Exception:
        pass
    for d in (WIN_INSTALL_DIR, WIN_SYS_DIR):
        if d and os.path.isdir(d):
            shutil.rmtree(d, ignore_errors=True)
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
    if cmd == "__lockscreen__": return _lock_screen_main()
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
